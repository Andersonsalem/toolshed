// JSON, YAML & CSV Viewer page. Parsing is in formats.js, explanations in schema.js.
// Nothing is saved or sent anywhere: the file lives only in this tab.
(function () {
  "use strict";
  const { el } = window.UI;
  const DV = window.DataViewer;
  const $ = (id) => document.getElementById(id);

  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_CHILDREN = 300; // per level, before a "show more" button
  const MAX_TABLE_ROWS = 1000;
  const MAX_UNSET = 60;

  const S = {
    fileName: "",
    format: null, // what the file was read as
    value: undefined,
    doc: null, // YAML document, keeps comments
    kind: null,
    schema: null,
    view: "tree",
    sort: null // { column, dir }
  };

  // ---------- Reading ----------

  let parseTimer;
  let parseToken = 0;
  let lastParsed = null;

  function scheduleParse() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(parse, 300);
  }

  async function parse() {
    const text = $("source").value;
    if (text === lastParsed) return;
    lastParsed = text;
    const token = ++parseToken;
    $("error").hidden = true;
    if (!text.trim()) {
      $("views").hidden = true;
      $("status").textContent = "";
      return;
    }
    const choice = $("format").value;
    const format = choice === "auto" ? DV.detect(text, S.fileName) : choice;
    let result;
    try {
      result = await DV.parse(text, format);
    } catch (e) {
      result = { error: { message: "The YAML reader couldn't be loaded. Reload the page and try again." } };
    }
    if (token !== parseToken) return; // a newer edit is being read
    if (result.error) {
      showError(result.error, format, text);
      $("views").hidden = true;
      $("status").textContent = "";
      return;
    }
    Object.assign(S, { format, value: result.value, doc: result.doc, kind: null, schema: null, sort: null });
    S.kind = DV.recognise(S.value, format);
    if (S.kind) {
      try {
        S.schema = await DV.schemaFor(S.kind);
      } catch (e) {
        S.schema = null;
      }
      if (token !== parseToken) return;
    }
    $("out-format").value = format;
    renderStatus();
    $("views").hidden = false;
    renderView();
  }

  function showError(error, format, text) {
    const box = $("error");
    const lines = text.split("\n");
    const parts = [el("p", {}, [
      el("strong", { text: "This isn't valid " + format.toUpperCase() + (error.line ? " (line " + error.line + ", column " + error.column + ")" : "") + ": " }),
      error.message
    ])];
    if (error.line) {
      const from = Math.max(1, error.line - 1);
      const width = String(error.line + 1).length;
      const snippet = [];
      for (let n = from; n <= Math.min(lines.length, error.line + 1); n++) {
        snippet.push(String(n).padStart(width) + " | " + lines[n - 1]);
        if (n === error.line) snippet.push(" ".repeat(width) + " | " + " ".repeat(Math.max(0, (error.column || 1) - 1)) + "^");
      }
      parts.push(el("pre", { text: snippet.join("\n") }));
      const go = el("button", { class: "button button--small button--ghost", type: "button", text: "Go to line " + error.line });
      go.addEventListener("click", () => {
        const start = lines.slice(0, error.line - 1).reduce((t, l) => t + l.length + 1, 0);
        const ta = $("source");
        ta.focus();
        ta.setSelectionRange(start, start + (lines[error.line - 1] || "").length);
        // Scroll the line into view inside the text box.
        ta.scrollTop = Math.max(0, (error.line - 3) * parseFloat(getComputedStyle(ta).lineHeight));
      });
      parts.push(go);
    }
    if (format !== "json" && $("format").value === "auto") {
      parts.push(el("p", { class: "muted small", text: "Read as " + format.toUpperCase() + " automatically. If that's wrong, choose the right format in “Read as”." }));
    }
    box.replaceChildren(...parts);
    box.hidden = false;
  }

  function count(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
    return 0;
  }

  function renderStatus() {
    const lines = $("source").value.split("\n").length;
    const kind = DV.KINDS.find((k) => k.id === S.kind);
    $("status").textContent = S.format.toUpperCase() + " · " + lines + (lines === 1 ? " line" : " lines") + (kind ? " · recognised as a " + kind.name : "");
    $("kind").replaceChildren(
      kind
        ? el("span", { class: "kind-badge", text: kind.name + ": settings explained" })
        : el("span", { class: "muted", text: S.format === "csv" ? "CSV file" : "Not a recognised config file: showing the structure only." })
    );
    $("credits").hidden = !kind;
  }

  // ---------- Tree ----------

  const isContainer = (v) => v !== null && typeof v === "object";

  // First sentence of the explanation, with "More" for the rest. Options are only
  // listed for single values (where they also appear in the dropdown), and only
  // when the list is short enough to read.
  function infoLine(info, forContainer) {
    if (!info) return null;
    const parts = [];
    if (info.description) {
      const short = DV.short(info.description, 220);
      const text = el("span", { text: short });
      parts.push(text);
      if (short.length < info.description.length) {
        const more = el("button", { class: "link-button", type: "button", text: "More" });
        more.addEventListener("click", () => {
          text.textContent = info.description;
          more.remove();
        });
        parts.push(" ", more);
      }
    }
    if (!forContainer && info.options.length && info.options.length <= 12) {
      parts.push(el("span", { class: "options", text: "Options: " + info.options.map(String).join(", ") }));
    } else if (!forContainer && info.default !== undefined && typeof info.default !== "object") {
      parts.push(el("span", { class: "options", text: "Default: " + String(info.default) }));
    }
    return parts.length ? el("p", { class: "node__info" }, parts) : null;
  }

  function keyLabel(key) {
    return typeof key === "number" ? el("span", { class: "index", text: "item " + (key + 1) }) : String(key);
  }

  // The settings this spot could have but doesn't, folded away, each with what it does.
  function unsetLine(value, path) {
    if (!S.schema || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const missing = DV.childKeys(S.schema, path).filter((k) => !(k in value));
    if (!missing.length) return null;
    const details = el("details", { class: "unset" }, [
      el("summary", { text: missing.length + (missing.length === 1 ? " more setting" : " more settings") + " you could add here" })
    ]);
    details.addEventListener("toggle", () => {
      if (!details.open || details.querySelector("ul")) return;
      details.append(el("ul", {}, missing.slice(0, MAX_UNSET).map((k) => {
        const info = DV.explain(S.schema, path.concat(k));
        return el("li", {}, [el("code", { text: k }), info && info.description ? ": " + DV.short(info.description, 160) : ""]);
      })));
      if (missing.length > MAX_UNSET) details.append(el("p", { text: "…and " + (missing.length - MAX_UNSET) + " more." }));
    });
    return details;
  }

  function renderChildren(value, path, openAll) {
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
    const list = el("ul");
    const add = (from) => {
      for (const [k, v] of entries.slice(from, from + MAX_CHILDREN)) list.append(renderEntry(k, v, path.concat(k), openAll));
      if (entries.length > from + MAX_CHILDREN) {
        const more = el("button", { class: "button button--small button--ghost more", type: "button", text: "Show " + Math.min(MAX_CHILDREN, entries.length - from - MAX_CHILDREN) + " more of " + (entries.length - from - MAX_CHILDREN) });
        const li = el("li", {}, [more]);
        more.addEventListener("click", () => {
          li.remove();
          add(from + MAX_CHILDREN);
        });
        list.append(li);
      }
    };
    add(0);
    return list;
  }

  function renderEntry(key, value, path, openAll) {
    const info = S.schema ? DV.explain(S.schema, path) : null;
    const deprecated = info && info.deprecated ? el("span", { class: "deprecated", text: "deprecated" }) : null;
    if (isContainer(value)) {
      const n = count(value);
      const meta = Array.isArray(value) ? n + (n === 1 ? " item" : " items") : n + (n === 1 ? " setting" : " settings");
      const details = el("details", {}, [
        el("summary", {}, [el("span", { class: "summary__key" }, [keyLabel(key)]), el("span", { class: "summary__meta", text: meta }), deprecated])
      ]);
      const info2 = infoLine(info, true);
      if (info2) details.append(info2);
      let filled = false;
      const fill = () => {
        if (filled) return;
        filled = true;
        const unset = unsetLine(value, path);
        if (unset) details.append(unset);
        details.append(renderChildren(value, path, openAll));
      };
      details.addEventListener("toggle", () => details.open && fill());
      if (openAll || path.length < 2) {
        details.open = true;
        fill();
      }
      return el("li", {}, [details]);
    }
    return el("li", {}, [
      el("div", { class: "node" }, [
        el("span", { class: "node__key" }, [keyLabel(key), deprecated]),
        el("span", { class: "node__value" }, [editorFor(value, path, info)]),
        infoLine(info)
      ])
    ]);
  }

  function editorFor(value, path, info) {
    const label = "Value of " + path.join(" › ");
    if (typeof value === "boolean") {
      const box = el("input", { type: "checkbox", "aria-label": label });
      box.checked = value;
      box.addEventListener("change", () => applyEdit(path, box.checked));
      return box;
    }
    if (info && info.options.length) {
      const options = info.options.slice();
      if (!options.some((o) => o === value)) options.unshift(value);
      const select = el("select", { "aria-label": label }, options.map((o, i) => el("option", { value: String(i), text: o === null ? "null" : String(o) })));
      select.value = String(options.findIndex((o) => o === value));
      select.addEventListener("change", () => applyEdit(path, options[Number(select.value)]));
      return select;
    }
    const input = el("input", { type: "text", "aria-label": label, spellcheck: "false" });
    input.value = value === null ? "null" : String(value);
    input.addEventListener("change", () => {
      const text = input.value;
      let next = text;
      // Keep numbers as numbers and null as null when the new text still looks like one.
      if (typeof value === "number" && text.trim() !== "" && Number.isFinite(Number(text))) next = Number(text);
      else if (value === null && text.trim() === "null") next = null;
      applyEdit(path, next);
    });
    return input;
  }

  function setIn(obj, path, next) {
    let target = obj;
    for (const k of path.slice(0, -1)) target = target[k];
    target[path[path.length - 1]] = next;
  }

  async function applyEdit(path, next) {
    if (S.doc) {
      const YAML = await DV.yaml();
      // Change the value inside the existing node, so its comments stay put.
      const node = S.doc.getIn(path, true);
      if (YAML.isScalar(node)) node.value = next;
      else S.doc.setIn(path, next);
      S.value = S.doc.toJS({ maxAliasCount: 1000 });
      $("source").value = S.doc.toString({ lineWidth: 0 });
    } else {
      setIn(S.value, path, next);
      $("source").value = await DV.write(S.value, S.format);
    }
    lastParsed = $("source").value; // already up to date: no need to read it again
    renderStatus();
    if (S.view !== "tree") renderView();
  }

  function renderTree(openAll) {
    const v = S.value;
    if (!isContainer(v)) {
      $("tree").replaceChildren(el("ul", {}, [renderEntry("value", v, [], openAll)]));
      return;
    }
    const unset = unsetLine(v, []);
    $("tree").replaceChildren(...[unset, renderChildren(v, [], openAll)].filter(Boolean));
  }

  // ---------- Table ----------

  // The biggest list of records anywhere in the file, as a table.
  function findTable(value, path, best) {
    const t = DV.tableOf(value);
    if (t && (!best || t.rows.length > best.table.rows.length)) best = { table: t, path };
    if (value && typeof value === "object" && path.length < 6) {
      for (const [k, v] of Array.isArray(value) ? [] : Object.entries(value)) {
        if (v && typeof v === "object") best = findTable(v, path.concat(k), best);
      }
    }
    return best;
  }

  function cellText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      const s = JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 79) + "…" : s;
    }
    return String(v);
  }

  function renderTable() {
    const found = findTable(S.value, [], null);
    const box = $("table");
    if (!found) {
      box.replaceChildren(el("p", { class: "table-empty", text: "This file has no list of records to show as a table. The Tree view shows everything." }));
      $("table-count").textContent = "";
      return;
    }
    const { table, path } = found;
    const query = $("table-search").value.trim().toLowerCase();
    let rows = table.rows.filter((r) => !query || table.columns.some((c) => cellText(r[c]).toLowerCase().includes(query)));
    if (S.sort) {
      const { column, dir } = S.sort;
      rows = rows.slice().sort((a, b) => {
        const x = a[column], y = b[column];
        const nx = Number(x), ny = Number(y);
        const cmp = x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : cellText(x).localeCompare(cellText(y), undefined, { numeric: true });
        return dir * cmp;
      });
    }
    $("table-count").textContent = (path.length ? "Showing " + path.join(" › ") + ": " : "") + rows.length + " of " + table.rows.length + " rows" +
      (rows.length > MAX_TABLE_ROWS ? " (first " + MAX_TABLE_ROWS + " shown)" : "");
    const head = table.columns.map((c) => {
      const b = el("button", { type: "button", text: c + (S.sort && S.sort.column === c ? (S.sort.dir > 0 ? " ▲" : " ▼") : "") });
      b.addEventListener("click", () => {
        S.sort = S.sort && S.sort.column === c ? { column: c, dir: -S.sort.dir } : { column: c, dir: 1 };
        renderTable();
      });
      return el("th", { scope: "col", "aria-sort": S.sort && S.sort.column === c ? (S.sort.dir > 0 ? "ascending" : "descending") : "none" }, [b]);
    });
    box.replaceChildren(
      el("table", { class: "data-table" }, [
        el("thead", {}, [el("tr", {}, head)]),
        el("tbody", {}, rows.slice(0, MAX_TABLE_ROWS).map((r) =>
          el("tr", {}, table.columns.map((c) => {
            const v = r[c];
            return el("td", { class: typeof v === "number" ? "num" : "", title: typeof v === "object" && v !== null ? JSON.stringify(v) : "", text: cellText(v) });
          }))
        ))
      ])
    );
  }

  // ---------- Save & convert ----------

  // A copy of the YAML with each recognised setting's description written above it.
  async function withComments() {
    const YAML = await DV.yaml();
    const doc = YAML.parseDocument(S.doc ? S.doc.toString() : YAML.stringify(S.value));
    let added = 0;
    YAML.visit(doc, {
      Pair(_, pair, ancestors) {
        if (!YAML.isScalar(pair.key) || pair.key.commentBefore) return;
        const path = [];
        ancestors.forEach((node, i) => {
          const next = ancestors[i + 1] || pair;
          if (YAML.isPair(node) && YAML.isScalar(node.key)) path.push(node.key.value);
          else if (YAML.isSeq(node)) path.push(node.items.indexOf(next));
        });
        path.push(pair.key.value);
        const info = DV.explain(S.schema, path);
        if (!info || !info.description) return;
        let comment = " " + DV.short(info.description);
        if (info.options.length && info.options.length <= 8) comment += "\n Options: " + info.options.join(", ");
        // The first setting of a list item: put the comment above the "- ", not after it.
        const parent = ancestors[ancestors.length - 1];
        const grandparent = ancestors[ancestors.length - 2];
        const target = YAML.isMap(parent) && parent.items[0] === pair && YAML.isSeq(grandparent) ? parent : pair.key;
        if (target.commentBefore) return;
        target.commentBefore = comment;
        added += 1;
      }
    });
    return { text: doc.toString({ lineWidth: 0 }), added };
  }

  let outputText = "";
  async function renderSave() {
    const out = $("out-format").value;
    const canComment = out === "yaml" && !!S.schema;
    $("comments-option").hidden = !canComment;
    const note = [];
    try {
      if (canComment && $("comments").checked) {
        const r = await withComments();
        outputText = r.text;
        note.push("Added explanations above " + r.added + " settings. Settings that already had a comment above them were left alone.");
      } else if (out === "csv" && !DV.tableOf(S.value)) {
        // CSV holds one table: use the biggest list of records in the file, like the Table view.
        const found = findTable(S.value, [], null);
        if (!found) throw new Error("This file has no list of records, so it can't be saved as CSV.");
        outputText = await DV.write(found.table.rows, "csv", null);
        note.push("Saved the “" + found.path.join(" › ") + "” list (" + found.table.rows.length + " rows); the rest of the file isn't included.");
      } else {
        outputText = await DV.write(S.value, out, out === S.format ? S.doc : null);
      }
      if (out !== S.format) note.push("Converted from " + S.format.toUpperCase() + "." + (S.format === "yaml" && S.doc && S.doc.toString().includes("#") ? " Comments can't be carried over to " + out.toUpperCase() + "." : ""));
      if (out === "csv") note.push("Nested values are written as JSON text in their cell.");
      $("output").textContent = outputText;
      $("copy").disabled = $("download").disabled = false;
    } catch (e) {
      outputText = "";
      $("output").textContent = "";
      note.push(e.message);
      $("copy").disabled = $("download").disabled = true;
    }
    $("save-note").textContent = note.join(" ");
    $("save-status").textContent = "";
  }

  // ---------- Views ----------

  function renderView() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === S.view)));
    for (const v of ["tree", "table", "save"]) $("view-" + v).hidden = v !== S.view;
    if (S.view === "tree") renderTree(false);
    else if (S.view === "table") renderTable();
    else renderSave();
  }

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      S.view = t.dataset.view;
      renderView();
    })
  );
  $("expand").addEventListener("click", () => renderTree(true));
  $("collapse").addEventListener("click", () => {
    renderTree(false);
    $("tree").querySelectorAll("details").forEach((d) => (d.open = false));
  });
  $("table-search").addEventListener("input", renderTable);
  $("out-format").addEventListener("change", renderSave);
  $("comments").addEventListener("change", renderSave);

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      $("save-status").textContent = "Copied.";
    } catch (e) {
      $("save-status").textContent = "Couldn't copy here. Select the text above and copy it yourself.";
    }
  });
  $("download").addEventListener("click", () => {
    const out = $("out-format").value;
    const ext = { json: "json", yaml: "yaml", csv: "csv" }[out];
    const stem = (S.fileName || "data").replace(/\.[^.]+$/, "") || "data";
    const link = el("a", { download: stem + (out === S.format ? "" : "-converted") + "." + ext });
    link.href = URL.createObjectURL(new Blob([outputText], { type: out === "json" ? "application/json" : out === "csv" ? "text/csv" : "text/yaml" }));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  });

  // ---------- Input ----------

  function loadText(text, name) {
    S.fileName = name || "";
    $("source").value = text;
    $("format").value = "auto";
    lastParsed = null;
    S.view = "tree";
    parse();
  }

  async function openFile(file) {
    if (file.size > MAX_BYTES) {
      $("status").textContent = "That file is over 10 MB, which is too big to show comfortably here.";
      return;
    }
    loadText(await file.text(), file.name);
  }

  $("source").addEventListener("input", scheduleParse);
  // Pasting over everything means a different file: forget the old file name.
  $("source").addEventListener("paste", (e) => {
    const ta = e.target;
    if (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length) S.fileName = "";
  });
  $("format").addEventListener("change", () => {
    lastParsed = null;
    parse();
  });
  $("open").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => {
    if (e.target.files[0]) openFile(e.target.files[0]);
    e.target.value = "";
  });
  $("clear").addEventListener("click", () => loadText("", ""));

  for (const [i, ex] of DV.EXAMPLES.entries()) $("example").append(el("option", { value: String(i), text: ex.name }));
  $("example").addEventListener("change", (e) => {
    const ex = DV.EXAMPLES[Number(e.target.value)];
    e.target.value = "";
    if (!ex) return;
    if ($("source").value.trim() && !confirm("Replace what's in the box with the example?")) return;
    loadText(ex.text, ex.file);
  });

  // Drop a file anywhere on the page.
  document.addEventListener("dragover", (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      document.querySelector(".source").classList.add("is-over");
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.querySelector(".source").classList.remove("is-over");
  });
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    document.querySelector(".source").classList.remove("is-over");
    openFile(e.dataTransfer.files[0]);
  });

  // Tab inserts two spaces in the text box instead of leaving it.
  $("source").addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const ta = e.target;
    ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
    scheduleParse();
  });
})();
