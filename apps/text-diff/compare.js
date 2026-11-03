// Comparing two texts. No page layout here. The matching itself is done by
// vendor/diff.min.js (jsdiff, BSD-3); this file turns its output into rows.
//
//   TextDiff.lines(a, b, options)  -> { rows, stats } or { tooBig: true }
//       rows: { type: "same" | "del" | "add" | "mod", oldNo, newNo, oldText, newText,
//               oldParts, newParts }   parts = [[text, changed?], ...] for "mod" rows
//   TextDiff.words(a, b, options)  -> { parts: [[text, "same" | "del" | "add"]], stats } or { tooBig: true }
//   TextDiff.fold(rows, context)   -> rows with runs of unchanged lines replaced by { type: "fold", rows }
//   TextDiff.patch(a, b, nameA, nameB)  unified diff text, for developers
//
// options: { ignoreCase, ignoreSpace }  ignoreSpace treats any run of spaces or
// tabs as one space and ignores spaces at the start and end of lines.
(function () {
  "use strict";
  /* global Diff */
  const TD = (window.TextDiff = window.TextDiff || {});

  // Stop instead of freezing the page on huge, very different texts.
  TD.TIMEOUT_MS = 4000;

  TD.splitLines = (text) => (text === "" ? [] : text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"));

  function normalizer(o) {
    return (line) => {
      if (o.ignoreSpace) line = line.replace(/[ \t ]+/g, " ").trim();
      if (o.ignoreCase) line = line.toLowerCase();
      return line;
    };
  }

  // Highlights what changed inside a pair of lines, word by word. If the two
  // lines have little in common, highlighting bits of them would be noise, so
  // the whole line is marked instead.
  function inline(oldText, newText, o) {
    const changes = Diff.diffWordsWithSpace(oldText, newText, { ignoreCase: !!o.ignoreCase });
    const oldParts = [], newParts = [];
    let same = 0;
    for (const c of changes) {
      if (!c.added) oldParts.push([c.value, !!c.removed]);
      if (!c.removed) newParts.push([c.value, !!c.added]);
      if (!c.added && !c.removed) same += c.value.trim().length;
    }
    const longest = Math.max(oldText.trim().length, newText.trim().length);
    if (longest && same / longest < 0.3) return { oldParts: [[oldText, true]], newParts: [[newText, true]] };
    return { oldParts, newParts };
  }

  TD.lines = function (a, b, o) {
    o = o || {};
    const oldLines = TD.splitLines(a);
    const newLines = TD.splitLines(b);
    const norm = normalizer(o);
    const changes = Diff.diffArrays(oldLines.map(norm), newLines.map(norm), { timeout: TD.TIMEOUT_MS });
    if (!changes) return { tooBig: true };

    const rows = [];
    const stats = { added: 0, removed: 0, changed: 0, same: 0 };
    let i = 0; // position in oldLines
    let j = 0; // position in newLines
    for (let k = 0; k < changes.length; k++) {
      const c = changes[k];
      if (!c.added && !c.removed) {
        for (let n = 0; n < c.count; n++, i++, j++) {
          rows.push({ type: "same", oldNo: i + 1, newNo: j + 1, oldText: oldLines[i], newText: newLines[j] });
        }
        stats.same += c.count;
        continue;
      }
      // A removal followed by an addition: pair the lines up as changed lines.
      let removed = 0, added = 0;
      if (c.removed) {
        removed = c.count;
        if (changes[k + 1] && changes[k + 1].added) added = changes[++k].count;
      } else added = c.count;
      const paired = Math.min(removed, added);
      for (let n = 0; n < paired; n++) {
        const oldText = oldLines[i + n], newText = newLines[j + n];
        rows.push({ type: "mod", oldNo: i + n + 1, newNo: j + n + 1, oldText, newText, ...inline(oldText, newText, o) });
      }
      for (let n = paired; n < removed; n++) rows.push({ type: "del", oldNo: i + n + 1, newNo: null, oldText: oldLines[i + n] });
      for (let n = paired; n < added; n++) rows.push({ type: "add", oldNo: null, newNo: j + n + 1, newText: newLines[j + n] });
      stats.changed += paired;
      stats.removed += removed - paired;
      stats.added += added - paired;
      i += removed;
      j += added;
    }
    return { rows, stats };
  };

  TD.words = function (a, b, o) {
    o = o || {};
    const clean = (t) => (o.ignoreSpace ? t.replace(/[ \t ]+/g, " ") : t).replace(/\r\n?/g, "\n");
    const changes = Diff.diffWordsWithSpace(clean(a), clean(b), { ignoreCase: !!o.ignoreCase, timeout: TD.TIMEOUT_MS });
    if (!changes) return { tooBig: true };
    const stats = { added: 0, removed: 0 };
    // "250,000", "team's" and "U.S" count as one word each.
    const countWords = (t) => (t.match(/[\p{L}\p{N}]+(?:['’.,][\p{L}\p{N}]+)*/gu) || []).length;
    const parts = changes.map((c) => {
      if (c.added) stats.added += countWords(c.value);
      if (c.removed) stats.removed += countWords(c.value);
      return [c.value, c.added ? "add" : c.removed ? "del" : "same"];
    });
    return { parts, stats };
  };

  // Keeps `context` unchanged lines around each change and folds the rest.
  TD.fold = function (rows, context) {
    const keep = new Array(rows.length).fill(false);
    rows.forEach((r, n) => {
      if (r.type === "same") return;
      for (let m = Math.max(0, n - context); m <= Math.min(rows.length - 1, n + context); m++) keep[m] = true;
    });
    const out = [];
    let run = [];
    const flush = () => {
      // Folding fewer than 4 lines saves no space.
      if (run.length >= 4) out.push({ type: "fold", rows: run });
      else out.push(...run);
      run = [];
    };
    rows.forEach((r, n) => {
      if (keep[n]) {
        flush();
        out.push(r);
      } else run.push(r);
    });
    flush();
    return out;
  };

  TD.patch = (a, b, nameA, nameB) => Diff.createTwoFilesPatch(nameA, nameB, a.replace(/\r\n?/g, "\n"), b.replace(/\r\n?/g, "\n"), "", "", { context: 3 });
})();
