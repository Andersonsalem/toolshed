// PDF Toolkit page: add files, arrange pages, download. PDF work is in engine.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const PT = window.PdfToolkit;

  const THUMB_WIDTH = 140;
  const MAX_UNDO = 50;
  const PAGE_WARNING = 1000;

  const $ = (id) => document.getElementById(id);

  // Opened files by id, and the page list the person is arranging.
  // A page: { key, sourceId, index (0-based in its file), rotate (extra degrees), selected }
  const sources = new Map();
  let pages = [];
  let undoStack = [];
  let nextSourceId = 1;
  let busy = false;

  // ---------- Messages ----------

  function message(text, isError) {
    const node = $("message");
    node.textContent = text;
    node.className = "message" + (isError ? " is-error" : "");
    node.hidden = !text;
  }

  function outputStatus(text, isError) {
    $("output-status").textContent = text;
    $("output-status").className = "small" + (isError ? " is-error" : " muted");
  }

  // ---------- Changing the page list (every change can be undone) ----------

  function change(mutate) {
    undoStack.push(pages.map((p) => ({ ...p })));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    mutate();
    render();
  }

  function undo() {
    if (!undoStack.length) return;
    pages = undoStack.pop();
    render();
  }

  function move(from, to) {
    if (to < 0 || to >= pages.length || from === to) return;
    change(() => {
      const [page] = pages.splice(from, 1);
      pages.splice(to, 0, page);
    });
  }

  // ---------- Adding files ----------

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length || busy) return;
    busy = true;
    const firstFiles = sources.size === 0;
    const errors = [];
    let added = 0;
    message("Opening " + (files.length === 1 ? files[0].name : files.length + " files") + "…");

    const newPages = [];
    for (const file of files) {
      try {
        const source = await PT.loadFile(file);
        const id = nextSourceId++;
        sources.set(id, source);
        for (let i = 0; i < source.pageCount; i++) {
          newPages.push({ key: id + ":" + i, sourceId: id, index: i, rotate: 0, selected: false });
        }
        if (!source.view) errors.push("Previews aren't available for “" + file.name + "”, but its pages can still be used.");
        added += 1;
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (newPages.length) {
      if (!$("out-name").value) $("out-name").value = suggestName(files, firstFiles);
      change(() => pages.push(...newPages));
    }
    busy = false;

    const summary = added ? "Added " + added + (added === 1 ? " file" : " files") + " (" + newPages.length + (newPages.length === 1 ? " page)." : " pages).") : "";
    const warning = pages.length > PAGE_WARNING ? " That's a lot of pages: your browser may slow down." : "";
    message([summary + warning].concat(errors).filter(Boolean).join(" "), errors.length > 0 && !added);
  }

  // One file on its own keeps its name; anything more is "combined".
  function suggestName(files, firstFiles) {
    if (firstFiles && files.length === 1) return files[0].name.replace(/\.pdf$/i, "") + " (edited).pdf";
    return "combined.pdf";
  }

  // ---------- Rendering ----------

  // Previews are drawn once per page and reused, only when the page scrolls
  // into view, and one at a time: drawing two at once made pdf.js drop letters
  // while both waited for the same font.
  const thumbs = new Map();
  const queue = [];
  const MAX_RENDERING = 1;
  let rendering = 0;

  function requestThumb(page, holder) {
    if (thumbs.has(page.key)) {
      holder.replaceChildren(thumbs.get(page.key));
      return;
    }
    queue.push({ page, holder });
    pump();
  }

  function pump() {
    while (rendering < MAX_RENDERING && queue.length) {
      const { page, holder } = queue.shift();
      if (thumbs.has(page.key)) {
        holder.replaceChildren(thumbs.get(page.key));
        continue;
      }
      rendering += 1;
      PT.renderPage(sources.get(page.sourceId), page.index, THUMB_WIDTH)
        .then((canvas) => {
          if (!canvas) return;
          thumbs.set(page.key, canvas);
          if (holder.isConnected) holder.replaceChildren(canvas);
        })
        .catch(() => {
          holder.replaceChildren(el("span", { class: "thumb__placeholder", text: "No preview" }));
        })
        .finally(() => {
          rendering -= 1;
          pump();
        });
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const page = pages.find((p) => p.key === entry.target.dataset.key);
        if (page) requestThumb(page, entry.target.querySelector(".thumb"));
      }
    },
    { rootMargin: "300px" }
  );

  function pageTile(page, position) {
    const source = sources.get(page.sourceId);
    const number = position + 1;

    const select = el("input", { type: "checkbox", "aria-label": "Select page " + number });
    select.checked = page.selected;
    select.addEventListener("change", () => {
      page.selected = select.checked;
      render();
    });

    const holder = el("div", { class: "thumb" + (page.rotate % 180 ? " is-sideways" : "") }, [
      thumbs.get(page.key) || el("span", { class: "thumb__placeholder", text: "Loading…" })
    ]);
    // Rotation is shown by turning the preview, which is drawn once and reused.
    const canvas = thumbs.get(page.key);
    if (canvas) canvas.style.transform = "rotate(" + page.rotate + "deg)";

    const button = (text, label, onClick, disabled, extraClass) => {
      const b = el("button", { type: "button", "aria-label": label, title: label, text, class: extraClass || "" });
      b.disabled = !!disabled;
      b.addEventListener("click", onClick);
      return b;
    };

    const tile = el("li", { class: "page" + (page.selected ? " is-selected" : ""), draggable: "true", "data-key": page.key }, [
      el("div", { class: "page__top" }, [el("span", { class: "page__number", text: String(number) }), select]),
      holder,
      el("p", { class: "page__source", title: source.name + ", page " + (page.index + 1), text: source.name + " · p" + (page.index + 1) }),
      el("div", { class: "page__actions" }, [
        button("←", "Move page " + number + " earlier", () => move(position, position - 1), position === 0),
        button("→", "Move page " + number + " later", () => move(position, position + 1), position === pages.length - 1),
        button("↻", "Rotate page " + number, () => change(() => (page.rotate = (page.rotate + 90) % 360))),
        button("✕", "Remove page " + number, () => change(() => pages.splice(position, 1)), false, "is-remove")
      ])
    ]);
    addDragHandlers(tile, position);
    if (!canvas) observer.observe(tile);
    return tile;
  }

  function render() {
    const has = pages.length > 0;
    $("workspace").hidden = !has;
    $("drop").classList.toggle("is-compact", has);
    $("drop").querySelector(".drop__title").textContent = has ? "Add more PDFs" : "Drop PDF files here";

    $("pages").replaceChildren(...pages.map(pageTile));

    const selected = pages.filter((p) => p.selected).length;
    const files = new Set(pages.map((p) => p.sourceId)).size;
    $("summary").textContent = pages.length + (pages.length === 1 ? " page" : " pages") + " from " + files + (files === 1 ? " file" : " files");
    $("selected-count").textContent = selected ? selected + " selected" : "";
    $("rotate-selected").disabled = !selected;
    $("delete-selected").disabled = !selected;
    $("select-none").disabled = !selected;
    $("undo").disabled = undoStack.length === 0;
    $("download-selected").disabled = !selected;
    $("download-selected").textContent = selected ? "Download " + selected + " selected" + (selected === 1 ? " page" : " pages") : "Download selected pages";
    $("download-all").textContent = "Download PDF (" + pages.length + (pages.length === 1 ? " page)" : " pages)");
    $("download-split").disabled = pages.length < 2;
  }

  // ---------- Drag and drop to reorder ----------

  let dragFrom = -1;

  function addDragHandlers(tile, position) {
    tile.addEventListener("dragstart", (e) => {
      dragFrom = position;
      tile.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(position));
    });
    tile.addEventListener("dragend", () => {
      dragFrom = -1;
      tile.classList.remove("is-dragging");
    });
    tile.addEventListener("dragover", (e) => {
      if (dragFrom === -1) return;
      e.preventDefault();
      // Measured against the tile, not e.offsetX, which is relative to whatever
      // child (like the preview) the pointer happens to be over.
      const box = tile.getBoundingClientRect();
      const after = e.clientX > box.left + box.width / 2;
      tile.classList.toggle("drop-after", after);
      tile.classList.toggle("drop-before", !after);
    });
    tile.addEventListener("dragleave", () => tile.classList.remove("drop-before", "drop-after"));
    tile.addEventListener("drop", (e) => {
      if (dragFrom === -1) return;
      e.preventDefault();
      e.stopPropagation();
      const after = tile.classList.contains("drop-after");
      tile.classList.remove("drop-before", "drop-after");
      let to = position + (after ? 1 : 0);
      if (dragFrom < to) to -= 1;
      move(dragFrom, to);
    });
  }

  // ---------- Downloads ----------

  function fileName(suffix) {
    let name = ($("out-name").value || "document.pdf").trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-");
    name = name.replace(/\.pdf$/i, "") || "document";
    return name + (suffix || "") + ".pdf";
  }

  function download(blob, name) {
    const link = el("a", { download: name });
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
  }

  function forOutput(list) {
    return list.map((p) => ({ source: sources.get(p.sourceId), index: p.index, rotate: p.rotate }));
  }

  function sizeText(bytes) {
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  async function run(label, work) {
    if (busy) return;
    busy = true;
    // render() in "finally" sets the buttons back to their proper state.
    document.querySelectorAll(".output__actions button").forEach((b) => (b.disabled = true));
    outputStatus(label);
    try {
      outputStatus(await work());
    } catch (error) {
      outputStatus("Something went wrong building the file: " + (error && error.message ? error.message : error), true);
    } finally {
      busy = false;
      render();
    }
  }

  $("download-all").addEventListener("click", () =>
    run("Building the PDF…", async () => {
      const bytes = await PT.build(forOutput(pages));
      download(new Blob([bytes], { type: "application/pdf" }), fileName());
      return "Downloaded " + fileName() + " (" + pages.length + " pages, " + sizeText(bytes.length) + ").";
    })
  );

  $("download-selected").addEventListener("click", () => {
    const chosen = pages.filter((p) => p.selected);
    run("Building the PDF…", async () => {
      const bytes = await PT.build(forOutput(chosen));
      download(new Blob([bytes], { type: "application/pdf" }), fileName(" (selected pages)"));
      return "Downloaded " + fileName(" (selected pages)") + " (" + chosen.length + " pages, " + sizeText(bytes.length) + ").";
    });
  });

  $("download-split").addEventListener("click", () =>
    run("Building " + pages.length + " PDFs…", async () => {
      const stem = fileName().replace(/\.pdf$/, "");
      const width = String(pages.length).length;
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        outputStatus("Building page " + (i + 1) + " of " + pages.length + "…");
        files.push({ name: stem + " - page " + String(i + 1).padStart(width, "0") + ".pdf", data: await PT.build(forOutput([pages[i]])) });
      }
      const zip = Zip.make(files);
      download(zip, stem + " - pages.zip");
      return "Downloaded " + stem + " - pages.zip (" + files.length + " PDFs, " + sizeText(zip.size) + ").";
    })
  );

  // ---------- Controls ----------

  $("choose").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });

  // Files can be dropped on the drop area, or anywhere on the page.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    dragDepth += 1;
    $("drop").classList.add("is-over");
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("drop").classList.remove("is-over");
  });
  document.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("drop").classList.remove("is-over");
    addFiles(e.dataTransfer.files);
  });

  $("undo").addEventListener("click", undo);
  $("select-all").addEventListener("click", () => {
    pages.forEach((p) => (p.selected = true));
    render();
  });
  $("select-none").addEventListener("click", () => {
    pages.forEach((p) => (p.selected = false));
    render();
  });
  $("rotate-selected").addEventListener("click", () =>
    change(() => pages.forEach((p) => p.selected && (p.rotate = (p.rotate + 90) % 360)))
  );
  $("delete-selected").addEventListener("click", () => change(() => (pages = pages.filter((p) => !p.selected))));
  // Start over is confirmed instead of undoable, and frees the files' memory.
  $("remove-all").addEventListener("click", () => {
    if (!confirm("Remove all files and pages and start over?")) return;
    for (const source of sources.values()) if (source.view) source.view.close();
    sources.clear();
    thumbs.clear();
    queue.length = 0;
    pages = [];
    undoStack = [];
    $("out-name").value = "";
    outputStatus("");
    message("");
    render();
  });

  // Ctrl/Cmd+Z undoes, unless the person is typing in a box.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      if (undoStack.length) {
        e.preventDefault();
        undo();
      }
    }
  });

  const problem = PT.supported();
  if (problem) {
    $("unsupported").textContent = problem;
    $("unsupported").hidden = false;
    $("drop").hidden = true;
  }
  render();
})();
