// Reading and writing JSON, YAML and CSV. No page layout here.
//
//   DV.detect(text, fileName)          -> "json" | "yaml" | "csv"
//   await DV.parse(text, format)       -> { value, doc, error }
//       value: plain data; doc: the YAML document (keeps comments) or null;
//       error: { message, line, column } or null
//   await DV.write(value, format, doc) -> text
//   DV.tableOf(value)                  -> { columns, rows } or null if it isn't table-shaped
(function () {
  "use strict";
  const DV = (window.DataViewer = window.DataViewer || {});
  const base = new URL("./", document.currentScript.src).href;

  // The YAML library (vendor/yaml, ISC licence) is only loaded when needed.
  let yamlLib;
  DV.yaml = function () {
    if (!yamlLib) {
      yamlLib = import(base + "vendor/yaml/index.js").then((m) => m.default || m);
      yamlLib.catch(() => (yamlLib = null));
    }
    return yamlLib;
  };

  // Content that clearly looks like JSON wins; then the file name; then a guess.
  DV.detect = function (text, fileName) {
    const t = text.trim();
    if (/^[[{]/.test(t)) return "json";
    const name = (fileName || "").toLowerCase();
    if (/\.json$|\.jsonc$|\.geojson$/.test(name)) return "json";
    if (/\.ya?ml$/.test(name)) return "yaml";
    if (/\.(csv|tsv)$/.test(name)) return "csv";
    // Several lines with the same number of commas (or tabs/semicolons) and no colons-then-space: CSV.
    const lines = t.split(/\r?\n/).slice(0, 6).filter(Boolean);
    if (lines.length >= 2) {
      for (const sep of [",", "\t", ";"]) {
        const counts = lines.map((l) => l.split(sep).length - 1);
        if (counts[0] > 0 && counts.every((c) => c === counts[0]) && !/^\s*[\w"'-]+:\s/.test(lines[0])) return "csv";
      }
    }
    return "yaml";
  };

  function lineColumn(text, position) {
    const before = text.slice(0, position).split("\n");
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }

  // Browsers' JSON errors don't always say where the problem is, or say it
  // clearly. This walks the text once (only after JSON.parse has failed) and
  // returns { message, at } for the first problem, in plain words.
  function findJsonProblem(text) {
    const n = text.length;
    let i = 0;
    const fail = (message, at) => {
      throw { message, at: at === undefined ? i : at };
    };
    const space = () => {
      while (i < n) {
        const c = text[i];
        if (c === " " || c === "\n" || c === "\r" || c === "\t") i++;
        else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) fail("Comments aren't allowed in JSON.");
        else break;
      }
    };
    const string = () => {
      const start = i++;
      while (i < n) {
        const c = text[i];
        if (c === '"') return i++;
        if (c === "\\") i += 2;
        else if (c === "\n") break;
        else i++;
      }
      fail("This text isn't closed: a closing \" is missing.", start);
    };
    const number = () => {
      const m = text.slice(i, i + 400).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
      if (!m || m[0] === "-" || /^-?0\d/.test(text.slice(i, i + 3))) fail("This number isn't written the way JSON needs.");
      i += m[0].length;
    };
    const value = () => {
      space();
      if (i >= n) fail("The data ends too early: something isn't closed.");
      const c = text[i];
      if (c === "{") return object();
      if (c === "[") return array();
      if (c === '"') return string();
      if (c === "'") fail("JSON needs double quotes (\"), not single quotes.");
      if (c === "-" || (c >= "0" && c <= "9")) return number();
      for (const word of ["true", "false", "null"]) {
        if (text.startsWith(word, i)) {
          i += word.length;
          return;
        }
      }
      const word = text.slice(i).match(/^[A-Za-z_][\w-]*/);
      if (word) fail("Unexpected “" + word[0] + "”. Text values need double quotes, and true, false and null are written in lowercase.");
      fail("Unexpected “" + c + "” here.");
    };
    const array = () => {
      i++;
      space();
      if (text[i] === "]") return i++;
      for (;;) {
        value();
        space();
        if (text[i] === ",") {
          const at = i++;
          space();
          if (text[i] === "]") fail("Remove this comma: JSON doesn't allow a comma before ].", at);
          continue;
        }
        if (text[i] === "]") return i++;
        if (i >= n) fail("A [ is never closed with ].");
        fail("Missing comma between items (or a ] is missing).");
      }
    };
    const object = () => {
      i++;
      space();
      if (text[i] === "}") return i++;
      for (;;) {
        space();
        if (i >= n) fail("A { is never closed with }.");
        if (text[i] === "'") fail("JSON needs double quotes (\"), not single quotes.");
        if (text[i] !== '"') fail("Setting names need double quotes, like \"name\".");
        string();
        space();
        if (text[i] !== ":") fail("Missing : after the setting name.");
        i++;
        value();
        space();
        if (text[i] === ",") {
          const at = i++;
          space();
          if (text[i] === "}") fail("Remove this comma: JSON doesn't allow a comma before }.", at);
          continue;
        }
        if (text[i] === "}") return i++;
        if (i >= n) fail("A { is never closed with }.");
        fail("Missing comma between settings (or a } is missing).");
      }
    };
    try {
      value();
      space();
      if (i < n) fail("There's more text after the end of the data.");
      return null;
    } catch (problem) {
      if (problem && typeof problem.at === "number") return problem;
      throw problem;
    }
  }

  DV.parse = async function (text, format) {
    if (format === "json") {
      try {
        return { value: JSON.parse(text.replace(/^﻿/, "")), doc: null, error: null };
      } catch (e) {
        const problem = findJsonProblem(text.replace(/^﻿/, ""));
        if (problem) return { value: null, doc: null, error: { message: problem.message, ...lineColumn(text, problem.at) } };
        // Our checker found nothing: fall back to the browser's own message.
        const msg = String(e.message);
        let where = null;
        const lc = msg.match(/line (\d+) column (\d+)/);
        const pos = msg.match(/position (\d+)/);
        if (lc) where = { line: +lc[1], column: +lc[2] };
        else if (pos) where = lineColumn(text, +pos[1]);
        const clean = msg.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, "").replace(/ \(line \d+ column \d+\)$/, "");
        return { value: null, doc: null, error: { message: clean, ...(where || {}) } };
      }
    }
    if (format === "yaml") {
      const YAML = await DV.yaml();
      const doc = YAML.parseDocument(text, { prettyErrors: true, uniqueKeys: true });
      if (doc.errors.length) {
        const e = doc.errors[0];
        const p = e.linePos && e.linePos[0];
        return { value: null, doc: null, error: { message: e.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, ""), line: p && p.line, column: p && p.col } };
      }
      return { value: doc.toJS({ maxAliasCount: 1000 }), doc, error: null };
    }
    // CSV: first row is the column names.
    const rows = Sheet.parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim() !== ""));
    if (rows.length < 1) return { value: [], doc: null, error: null };
    const headers = rows[0].map((h, i) => h.trim() || "Column " + (i + 1));
    return { value: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))), doc: null, error: null };
  };

  // Turns any value into a CSV cell; formulas are neutralised for spreadsheet apps.
  function csvCell(v) {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // A list of records, or an object whose values are all records, as columns and rows.
  DV.tableOf = function (value) {
    let list = null;
    if (Array.isArray(value)) list = value;
    else if (value && typeof value === "object") {
      const vals = Object.values(value);
      if (vals.length && vals.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
        list = Object.entries(value).map(([k, v]) => ({ "(key)": k, ...v }));
      }
    }
    if (!list || !list.length) return null;
    if (!list.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
      // A plain list of values: one column.
      if (list.every((r) => r === null || typeof r !== "object")) return { columns: ["value"], rows: list.map((v) => ({ value: v })) };
      return null;
    }
    const columns = [];
    for (const r of list) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
    return { columns, rows: list };
  };

  DV.write = async function (value, format, doc) {
    if (format === "json") return JSON.stringify(value, null, 2) + "\n";
    if (format === "yaml") {
      const YAML = await DV.yaml();
      return doc ? doc.toString({ lineWidth: 0 }) : YAML.stringify(value, { lineWidth: 0 });
    }
    const table = DV.tableOf(value);
    if (!table) throw new Error("Only a list of records can be saved as CSV (each item with the same kind of fields).");
    return [table.columns.map(csvCell).join(",")].concat(table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(","))).join("\r\n") + "\r\n";
  };
})();
