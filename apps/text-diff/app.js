// Text Compare page: inputs, files, options and drawing the differences.
// Comparing is in compare.js. Only settings are saved, never the texts.
(function () {
  "use strict";
  const { el } = window.UI;
  const TD = window.TextDiff;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("text-diff", 1);

  const MAX_FILE = 5 * 1024 * 1024; // bigger plain-text files are rare and slow to show
  const MAX_ROWS = 20000; // rows drawn at once, after folding
  const CONTEXT = 3; // unchanged lines kept around each change

  function clean(raw) {
    raw = raw || {};
    return {
      mode: raw.mode === "words" ? "words" : "lines",
      view: raw.view === "unified" ? "unified" : "split",
      ignoreCase: raw.ignoreCase === true,
      ignoreSpace: raw.ignoreSpace === true
    };
  }
  const s = clean(store.load({}));
  const names = { a: "", b: "" };
  const opened = new Set(); // folds the person has opened, by first row's line numbers

  // ---------- Inputs ----------

  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  };
  for (const side of ["a", "b"]) {
    const area = $("text-" + side);
    area.addEventListener("input", () => {
      // Typed or pasted over: the file name no longer describes the text.
      if (names[side]) setName(side, "");
      later();
    });
    // Dropping a file anywhere on the box opens it.
    const box = document.querySelector('.input[data-side="' + side + '"]');
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("is-drop");
    });
    box.addEventListener("dragleave", () => box.classList.remove("is-drop"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("is-drop");
      if (e.dataTransfer.files[0]) openFile(side, e.dataTransfer.files[0]);
    });
  }

  function setName(side, name) {
    names[side] = name;
    $("name-" + side).textContent = name;
  }

  let openingSide = "a";
  document.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      openingSide = b.dataset.open;
      $("file").click();
    })
  );
  $("file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) openFile(openingSide, f);
  });

  async function openFile(side, file) {
    const fail = (msg) => {
      $("file-error").textContent = msg;
      $("file-error").hidden = false;
    };
    $("file-error").hidden = true;
    if (file.size > MAX_FILE) return fail(file.name + " is larger than 5 MB. Open a smaller file, or paste just the part you need.");
    let text;
    try {
      text = await file.text();
    } catch (e) {
      return fail(file.name + " couldn't be read.");
    }
    // Plain text never contains a NUL character; Word, PDF, images and zips do.
    if (text.includes("\u0000")) {
      return fail(file.name + " isn't a plain-text file. For Word or PDF documents, copy the text out of them and paste it here.");
    }
    $("text-" + side).value = text.replace(/^﻿/, "");
    setName(side, file.name);
    update();
  }

  // ---------- Options ----------

  function fillOptions() {
    document.querySelector('input[name="mode"][value="' + s.mode + '"]').checked = true;
    document.querySelector('input[name="view"][value="' + s.view + '"]').checked = true;
    $("ignore-case").checked = s.ignoreCase;
    $("ignore-space").checked = s.ignoreSpace;
  }
  $("toolbar").addEventListener("change", () => {
    s.mode = document.querySelector('input[name="mode"]:checked').value;
    s.view = document.querySelector('input[name="view"]:checked').value;
    s.ignoreCase = $("ignore-case").checked;
    s.ignoreSpace = $("ignore-space").checked;
    store.save(s);
    update();
  });

  $("swap").addEventListener("click", () => {
    const a = $("text-a").value, na = names.a;
    $("text-a").value = $("text-b").value;
    $("text-b").value = a;
    const nb = names.b;
    setName("a", nb);
    setName("b", na);
    update();
  });
  $("clear").addEventListener("click", () => {
    $("text-a").value = "";
    $("text-b").value = "";
    setName("a", "");
    setName("b", "");
    $("file-error").hidden = true;
    update();
  });
  $("example").addEventListener("click", () => {
    $("text-a").value = EXAMPLE_A;
    $("text-b").value = EXAMPLE_B;
    setName("a", "");
    setName("b", "");
    update();
  });

  const EXAMPLE_A = "Dear Ms. Patel,\n\nI am writing to apply for the Project Coordinator role at Northwind.\nI have three years of experience planning events and managing budgets.\n\nIn my current role I organised a conference for 400 people.\nI also introduced a shared calendar that cut scheduling conflicts.\n\nThank you for your time.\nKind regards,\nSam Rivera";
  const EXAMPLE_B = "Dear Ms. Patel,\n\nI am writing to apply for the Project Coordinator position at Northwind.\nI have four years of experience planning events and managing budgets of up to $250,000.\n\nIn my current role I organised a conference for 400 people.\nI also introduced a shared calendar that cut scheduling conflicts by half.\nI would bring the same care to your team's projects.\n\nThank you for your time.\nBest regards,\nSam Rivera";

  // ---------- Drawing ----------

  // Text with changed parts wrapped in <del> or <ins>.
  function partsNode(parts, tag) {
    const span = el("span", { class: "code" });
    for (const [text, changed] of parts) span.append(changed ? el(tag, { text }) : text);
    return span;
  }
  const plain = (text) => el("span", { class: "code", text: text });
  const num = (n) => el("td", { class: "num", text: n ? String(n) : "" });

  function foldRow(fold, columns) {
    const key = fold.rows[0].oldNo + ":" + fold.rows[0].newNo;
    const n = fold.rows.length;
    const button = el("button", { class: "fold", type: "button", text: "⋯ Show " + n.toLocaleString() + " unchanged lines" });
    button.addEventListener("click", () => {
      opened.add(key);
      update();
    });
    return el("tr", { class: "row-fold" }, [el("td", { colspan: String(columns) }, [button])]);
  }

  function splitRows(rows) {
    const out = [];
    for (const r of rows) {
      if (r.type === "fold") {
        out.push(foldRow(r, 4));
        continue;
      }
      const left = r.type === "add" ? el("td", { class: "line empty" }) : el("td", { class: "line" + (r.type === "same" ? "" : " is-del") }, [r.type === "mod" ? partsNode(r.oldParts, "del") : plain(r.oldText)]);
      const right = r.type === "del" ? el("td", { class: "line empty" }) : el("td", { class: "line" + (r.type === "same" ? "" : " is-add") }, [r.type === "mod" ? partsNode(r.newParts, "ins") : plain(r.newText)]);
      out.push(el("tr", { class: "row-" + r.type }, [num(r.oldNo), left, num(r.newNo), right]));
    }
    return el("table", { class: "diff diff--split" }, [
      el("colgroup", {}, [el("col", { class: "col-num" }), el("col"), el("col", { class: "col-num" }), el("col")]),
      el("tbody", {}, out)
    ]);
  }

  function unifiedRows(rows) {
    const out = [];
    const line = (type, oldNo, newNo, content) =>
      el("tr", { class: "row-" + type }, [num(oldNo), num(newNo), el("td", { class: "sign", text: type === "del" ? "−" : type === "add" ? "+" : "" }), el("td", { class: "line" + (type === "del" ? " is-del" : type === "add" ? " is-add" : "") }, [content])]);
    for (const r of rows) {
      if (r.type === "fold") out.push(foldRow(r, 4));
      else if (r.type === "same") out.push(line("same", r.oldNo, r.newNo, plain(r.oldText)));
      else if (r.type === "del") out.push(line("del", r.oldNo, null, plain(r.oldText)));
      else if (r.type === "add") out.push(line("add", null, r.newNo, plain(r.newText)));
      else {
        out.push(line("del", r.oldNo, null, partsNode(r.oldParts, "del")));
        out.push(line("add", null, r.newNo, partsNode(r.newParts, "ins")));
      }
    }
    return el("table", { class: "diff diff--unified" }, [
      el("colgroup", {}, [el("col", { class: "col-num" }), el("col", { class: "col-num" }), el("col", { class: "col-sign" }), el("col")]),
      el("tbody", {}, out)
    ]);
  }

  const plural = (n, word) => n.toLocaleString() + " " + word + (n === 1 ? "" : "s");

  function summary(text, identical) {
    $("summary").textContent = text;
    $("summary").classList.toggle("is-same", !!identical);
  }

  function update() {
    const a = $("text-a").value, b = $("text-b").value;
    const output = $("output");
    current = -1;
    $("view-box").hidden = s.mode !== "lines";
    $("nav").hidden = true;
    if (!a && !b) {
      summary("Paste or open two texts above to compare them.");
      return output.replaceChildren();
    }
    const ignoring = [s.ignoreCase && "capitals", s.ignoreSpace && "extra spaces"].filter(Boolean);
    const ignoreNote = ignoring.length ? " (ignoring " + ignoring.join(" and ") + ")" : "";

    if (s.mode === "words") {
      const r = TD.words(a, b, s);
      if (r.tooBig) return tooBig();
      if (!r.stats.added && !r.stats.removed && r.parts.every((p) => p[1] === "same")) {
        summary("No differences" + ignoreNote + ".", true);
        return output.replaceChildren(el("div", { class: "word-diff", text: b }));
      }
      summary(plural(r.stats.added, "word") + " added, " + plural(r.stats.removed, "word") + " removed" + ignoreNote + ".");
      const box = el("div", { class: "word-diff" });
      for (const [text, type] of r.parts) box.append(type === "same" ? text : el(type === "add" ? "ins" : "del", { text }));
      output.replaceChildren(box);
      $("nav").hidden = false;
      $("patch").hidden = true;
      return;
    }

    const r = TD.lines(a, b, s);
    if (r.tooBig) return tooBig();
    const st = r.stats;
    if (!st.added && !st.removed && !st.changed) {
      const onlyBreaks = !ignoring.length && a !== b;
      summary(onlyBreaks ? "The text is the same; only the line breaks differ (Windows vs Mac/Linux line endings, or a line break at the very end)." : "No differences" + ignoreNote + ".", true);
      return output.replaceChildren();
    }
    summary([st.changed && plural(st.changed, "line") + " changed", st.added && plural(st.added, "line") + " added", st.removed && plural(st.removed, "line") + " removed"].filter(Boolean).join(", ") + ignoreNote + ".");

    let rows = [];
    for (const row of TD.fold(r.rows, CONTEXT)) {
      if (row.type === "fold" && opened.has(row.rows[0].oldNo + ":" + row.rows[0].newNo)) rows.push(...row.rows);
      else rows.push(row);
    }
    let cut = 0;
    if (rows.length > MAX_ROWS) {
      cut = rows.length - MAX_ROWS;
      rows = rows.slice(0, MAX_ROWS);
    }
    // Phones are too narrow for two columns of text.
    const split = s.view === "split" && matchMedia("(min-width: 700px)").matches;
    output.replaceChildren(
      el("div", { class: "table-wrap" }, [split ? splitRows(rows) : unifiedRows(rows)]),
      ...(cut ? [el("p", { class: "notice small", text: "Only the first " + MAX_ROWS.toLocaleString() + " rows are shown; " + cut.toLocaleString() + " more aren't. The .patch file has everything." })] : [])
    );
    $("nav").hidden = false;
    $("patch").hidden = false;
  }

  function tooBig() {
    summary("These texts are too long and too different to compare in the browser. Try comparing a smaller part of them.");
    $("output").replaceChildren();
  }

  // ---------- Moving between changes ----------

  // The first row (or word) of each change.
  function changeStarts() {
    const all = [...$("output").querySelectorAll(".word-diff ins, .word-diff del, tr.row-del, tr.row-add, tr.row-mod")];
    return all.filter((node) => {
      const prev = node.tagName === "TR" ? node.previousElementSibling : node.previousSibling;
      if (!prev) return true;
      if (node.tagName === "TR") return !/row-(del|add|mod)/.test(prev.className);
      // In words mode, a change continues across a single space or across ins/del neighbours.
      return !(prev.nodeType === 1 && /^(INS|DEL)$/.test(prev.tagName));
    });
  }
  let current = -1;
  function go(step) {
    const starts = changeStarts();
    if (!starts.length) return;
    // Continue from whatever is on screen now (the person may have scrolled),
    // but always move at least one change: near the end of the page the last
    // changes can't scroll up to the top, so position alone would get stuck.
    const top = 80; // matches scroll-margin-top in app.css
    const tops = starts.map((n) => n.getBoundingClientRect().top);
    let n;
    if (step > 0) {
      n = tops.findIndex((t) => t > top + 4);
      if (n === -1 || n <= current) n = current + 1;
    } else {
      n = tops.length - 1;
      while (n >= 0 && tops[n] >= top - 4) n--;
      if (n === -1 || n >= current) n = current - 1;
    }
    current = n >= starts.length ? 0 : n < 0 ? starts.length - 1 : n;
    const target = starts[current];
    target.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("output").querySelectorAll(".is-flash").forEach((n) => n.classList.remove("is-flash"));
    void target.offsetWidth; // restart the highlight animation
    target.classList.add("is-flash");
  }
  $("next").addEventListener("click", () => go(1));
  $("prev").addEventListener("click", () => go(-1));

  $("patch").addEventListener("click", () => {
    const text = TD.patch($("text-a").value, $("text-b").value, names.a || "original.txt", names.b || "changed.txt");
    const link = el("a", { download: (names.b || "changes").replace(/\.[^.]+$/, "") + ".patch" });
    link.href = URL.createObjectURL(new Blob([text], { type: "text/x-diff" }));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  });

  // Side by side switches to one column on narrow screens, so redraw when that changes.
  matchMedia("(min-width: 700px)").addEventListener("change", update);

  fillOptions();
  update();
})();
