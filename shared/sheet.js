// Reads spreadsheets in the browser, for any tool that needs it. Needs shared/zip.js for .xlsx.
//
//   await Sheet.read(file, { maxRows })  -> { headers, rows, truncated, maxRows }
//     .csv / .tsv / .txt and .xlsx (first sheet); the first row is the column names.
//     Rejects with a message a person can read.
//   Sheet.parseCsv(text)                  -> array of rows (arrays of cells)
(function () {
  "use strict";

  const MAX_BYTES = 5 * 1024 * 1024;
  const DEFAULT_MAX_ROWS = 1000;
  const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  // ---------- CSV ----------

  // Picks the separator used most on the first line: comma, semicolon or tab.
  function guessSeparator(text) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = [",", ";", "\t"].map((sep) => [sep, firstLine.split(sep).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ",";
  }

  // Handles quoted cells, doubled quotes and line breaks inside quotes.
  function parseCsv(text) {
    const sep = guessSeparator(text);
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"' && cell === "") {
        quoted = true;
      } else if (ch === sep) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  // ---------- XLSX ----------

  function xml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("bad xml");
    return doc;
  }

  // "C12" -> 2 (zero-based column index)
  function columnIndex(ref) {
    const letters = (ref.match(/^[A-Z]+/) || ["A"])[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function parseXlsx(buffer) {
    const files = await Zip.read(buffer);
    const text = async (name) => {
      const entry = files.get(name);
      return entry ? new TextDecoder().decode(await entry()) : null;
    };

    // Find the first sheet's file through the workbook and its relationships.
    const workbook = xml(await text("xl/workbook.xml"));
    const firstSheet = workbook.getElementsByTagNameNS(SHEET_NS, "sheet")[0];
    let sheetPath = "xl/worksheets/sheet1.xml";
    const rels = await text("xl/_rels/workbook.xml.rels");
    if (firstSheet && rels) {
      const id = firstSheet.getAttributeNS(REL_NS, "id");
      for (const rel of xml(rels).getElementsByTagName("Relationship")) {
        if (rel.getAttribute("Id") === id) {
          const target = rel.getAttribute("Target");
          sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
        }
      }
    }

    const shared = [];
    const sharedText = await text("xl/sharedStrings.xml");
    if (sharedText) {
      for (const si of xml(sharedText).getElementsByTagNameNS(SHEET_NS, "si")) {
        shared.push([...si.getElementsByTagNameNS(SHEET_NS, "t")].map((t) => t.textContent).join(""));
      }
    }

    const sheetText = await text(sheetPath);
    if (!sheetText) throw new Error("no sheet");
    const rows = [];
    for (const rowNode of xml(sheetText).getElementsByTagNameNS(SHEET_NS, "row")) {
      const row = [];
      for (const c of rowNode.getElementsByTagNameNS(SHEET_NS, "c")) {
        const type = c.getAttribute("t");
        const v = c.getElementsByTagNameNS(SHEET_NS, "v")[0];
        let value = "";
        if (type === "s") value = shared[Number(v && v.textContent)] || "";
        else if (type === "inlineStr") value = [...c.getElementsByTagNameNS(SHEET_NS, "t")].map((t) => t.textContent).join("");
        else if (type === "b") value = v && v.textContent === "1" ? "TRUE" : "FALSE";
        else value = v ? v.textContent : "";
        row[columnIndex(c.getAttribute("r") || "")] = value;
      }
      const rowIndex = Number(rowNode.getAttribute("r")) - 1;
      rows[Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : rows.length] = Array.from(row, (x) => x || "");
    }
    return Array.from(rows, (r) => r || []);
  }

  // ---------- Entry point ----------

  async function read(file, options) {
    const maxRows = (options && options.maxRows) || DEFAULT_MAX_ROWS;
    const name = file.name.toLowerCase();
    if (file.size > MAX_BYTES) throw new Error("That file is over 5 MB. Split it into smaller files.");

    let rows;
    if (/\.(csv|tsv|txt)$/.test(name)) {
      rows = parseCsv((await file.text()).replace(/^﻿/, ""));
    } else if (name.endsWith(".xlsx")) {
      if (!Zip.canRead()) throw new Error("This browser can't open Excel files here. Save the sheet as .csv and try that.");
      try {
        rows = await parseXlsx(await file.arrayBuffer());
      } catch (e) {
        throw new Error("That Excel file couldn't be read. Try saving it again as .xlsx or .csv.");
      }
    } else if (/\.(xls|ods|numbers)$/.test(name)) {
      throw new Error("That spreadsheet format isn't supported. Save it as .xlsx or .csv and try again.");
    } else {
      throw new Error("Use a .csv or .xlsx file.");
    }

    // Drop empty rows, then use the first remaining row as column names.
    rows = rows.map((r) => r.map((cell) => String(cell).trim())).filter((r) => r.some(Boolean));
    if (rows.length < 2) throw new Error("The sheet needs a row of column names and at least one row below it.");
    const width = Math.max(...rows.map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => rows[0][i] || "Column " + (i + 1));
    const body = rows.slice(1, maxRows + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] || ""));
    return { headers, rows: body, truncated: rows.length - 1 > maxRows, maxRows };
  }

  window.Sheet = { read, parseCsv };
})();
