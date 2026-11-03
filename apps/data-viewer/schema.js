// Explanations for well-known config files, from their official JSON Schemas
// (bundled in schemas/, from SchemaStore and the Compose Specification,
// Apache-2.0). Nothing is guessed: settings the schema doesn't describe get
// no explanation.
//
//   DV.KINDS                         -> recognisable file kinds
//   DV.recognise(value, format)      -> kind id or null
//   await DV.schemaFor(kindId)       -> schema object
//   DV.explain(schema, path)         -> { description, options, type, default, deprecated } or null
//   DV.childKeys(schema, path)       -> settings that could be added at this spot
(function () {
  "use strict";
  const DV = (window.DataViewer = window.DataViewer || {});
  const base = new URL("./schemas/", document.currentScript.src).href;

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  // Order matters: the first match wins.
  DV.KINDS = [
    {
      id: "github-workflow", name: "GitHub Actions workflow", file: "github-workflow.json",
      test: (v) => isObj(v) && isObj(v.jobs) && ("on" in v || true in v)
    },
    {
      id: "docker-compose", name: "Docker Compose file", file: "docker-compose.json",
      test: (v) => isObj(v) && isObj(v.services) && Object.values(v.services).some((s) => isObj(s) && ("image" in s || "build" in s))
    },
    {
      id: "dependabot", name: "Dependabot configuration", file: "dependabot.json",
      test: (v) => isObj(v) && String(v.version) === "2" && Array.isArray(v.updates)
    },
    {
      id: "pre-commit", name: "pre-commit configuration", file: "pre-commit.json",
      test: (v) => isObj(v) && Array.isArray(v.repos) && v.repos.some((r) => isObj(r) && ("hooks" in r || "repo" in r))
    },
    {
      id: "tsconfig", name: "TypeScript configuration (tsconfig.json)", file: "tsconfig.json",
      test: (v) => isObj(v) && (isObj(v.compilerOptions) || ("extends" in v && ("include" in v || "files" in v)))
    },
    {
      id: "package", name: "npm package.json", file: "package.json",
      test: (v, format) => format === "json" && isObj(v) && typeof v.name === "string" && ("version" in v || "dependencies" in v || "scripts" in v || "devDependencies" in v)
    }
  ];

  DV.recognise = function (value, format) {
    const kind = DV.KINDS.find((k) => {
      try {
        return k.test(value, format);
      } catch (e) {
        return false;
      }
    });
    return kind ? kind.id : null;
  };

  const loaded = new Map();
  DV.schemaFor = function (id) {
    const kind = DV.KINDS.find((k) => k.id === id);
    if (!kind) return Promise.resolve(null);
    if (!loaded.has(id)) {
      loaded.set(id, fetch(base + kind.file).then((r) => {
        if (!r.ok) throw new Error("The explanations for this file couldn't be loaded.");
        return r.json();
      }));
      loaded.get(id).catch(() => loaded.delete(id));
    }
    return loaded.get(id);
  };

  // ---------- Walking a schema ----------

  // Follows "#/definitions/x" style references inside the same schema.
  // References to other files aren't followed (treated as "no explanation").
  function deref(root, node) {
    let guard = 0;
    while (node && typeof node.$ref === "string" && guard++ < 20) {
      if (!node.$ref.startsWith("#")) return null;
      let target = root;
      for (const part of node.$ref.slice(1).split("/").filter(Boolean)) {
        target = target && target[decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      // Keep the referring node's own description, if any.
      node = target && node.description ? { ...target, description: node.description } : target;
    }
    return node || null;
  }

  // A node plus every branch it could be (allOf / anyOf / oneOf / if-then-else).
  function expand(root, node, out, seen) {
    node = deref(root, node);
    if (!node || typeof node !== "object" || seen.has(node)) return out;
    seen.add(node);
    out.push(node);
    for (const key of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(node[key])) for (const n of node[key]) expand(root, n, out, seen);
    for (const key of ["then", "else"]) if (node[key]) expand(root, node[key], out, seen);
    return out;
  }

  function childOf(root, node, key) {
    const found = [];
    if (typeof key === "number") {
      if (Array.isArray(node.prefixItems) && node.prefixItems[key]) found.push(node.prefixItems[key]);
      else if (Array.isArray(node.items)) {
        if (node.items[key]) found.push(node.items[key]);
      } else if (node.items) found.push(node.items);
      return found;
    }
    if (node.properties && node.properties[key]) found.push(node.properties[key]);
    if (node.patternProperties) {
      for (const [pattern, sub] of Object.entries(node.patternProperties)) {
        try {
          if (new RegExp(pattern, "u").test(key)) found.push(sub);
        } catch (e) {
          /* a pattern this browser can't read: skip it */
        }
      }
    }
    if (!found.length && node.additionalProperties && typeof node.additionalProperties === "object") found.push(node.additionalProperties);
    return found;
  }

  // Every schema node that could describe the value at `path`.
  function nodesAt(schema, path) {
    let nodes = expand(schema, schema, [], new Set());
    for (const key of path) {
      const next = [];
      const seen = new Set();
      for (const n of nodes) for (const c of childOf(schema, n, key)) expand(schema, c, next, seen);
      nodes = next;
      if (!nodes.length) break;
    }
    return nodes;
  }

  // Plain text from a schema description: no markdown links, code ticks or HTML.
  function plain(text) {
    return String(text)
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  DV.explain = function (schema, path) {
    if (!schema) return null;
    const nodes = nodesAt(schema, path);
    if (!nodes.length) return null;
    const pick = (key) => {
      for (const n of nodes) if (n[key] !== undefined) return n[key];
      return undefined;
    };
    let description = pick("description") || pick("markdownDescription") || pick("title");
    const options = [];
    for (const n of nodes) {
      if (Array.isArray(n.enum)) for (const e of n.enum) if (e !== null && typeof e !== "object" && !options.includes(e)) options.push(e);
      if (n.const !== undefined && typeof n.const !== "object" && !options.includes(n.const)) options.push(n.const);
    }
    const types = [...new Set(nodes.flatMap((n) => (Array.isArray(n.type) ? n.type : n.type ? [n.type] : [])))];
    const info = {
      description: description ? plain(description) : "",
      options: options.slice(0, 60),
      type: types,
      default: pick("default"),
      deprecated: nodes.some((n) => n.deprecated === true) || /\bdeprecated\b/i.test(description || "")
    };
    return info.description || info.options.length ? info : null;
  };

  DV.childKeys = function (schema, path) {
    if (!schema) return [];
    const keys = [];
    for (const n of nodesAt(schema, path)) if (n.properties) for (const k of Object.keys(n.properties)) if (!keys.includes(k)) keys.push(k);
    return keys;
  };

  // First sentence or so, for a comment above a setting.
  DV.short = function (description, max) {
    const limit = max || 160;
    const sentence = description.match(/^.+?[.!?](\s|$)/);
    let s = (sentence ? sentence[0] : description).trim();
    if (s.length > limit) s = s.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…";
    return s;
  };
})();
