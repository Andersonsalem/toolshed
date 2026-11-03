// "Edit an image": open, crop, rotate, flip, resize, convert, shrink, download.
// Everything is drawn with the browser's canvas; nothing leaves the device.
(function () {
  "use strict";
  const IT = window.ImageToolkit;
  const { el } = window.UI;
  const $ = (id) => document.getElementById(id);

  const MIN_CROP = 16;
  const FORMATS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  // The open image and every edit made to it.
  let ed = null;
  // { name, bytes, bitmap, rotate (0/90/180/270), flipH, flipV,
  //   crop: { x, y, w, h } in the rotated image's pixels, or null for none,
  //   aspect ("none" | "free" | number), width, height (output size),
  //   format, quality (0.1–1), result: Blob }

  // ---------- Opening ----------

  function message(text, isError) {
    $("ed-message").textContent = text;
    $("ed-message").className = "message" + (isError ? " is-error" : "");
    $("ed-message").hidden = !text;
  }

  async function open(file) {
    message("");
    let bitmap;
    try {
      bitmap = await IT.openImage(file);
    } catch (error) {
      return message(error.message, true);
    }
    if (ed) ed.bitmap.close();
    const buffer = await file.arrayBuffer();
    ed = {
      name: file.name.replace(/\.[^.]+$/, "") || "image",
      bytes: file.size,
      type: file.type,
      bitmap,
      exif: IT.readExif(buffer)
    };
    resetEdits();
    // Keep the original format where it's one we can save, otherwise JPEG.
    ed.format = FORMATS[file.type] ? file.type : "image/jpeg";
    $("ed-format").value = ed.format;
    $("ed-drop").hidden = true;
    $("ed-work").hidden = false;
    renderMeta();
    renderAll();
  }

  function resetEdits() {
    Object.assign(ed, { rotate: 0, flipH: false, flipV: false, crop: null, aspect: "none", quality: 0.85, oriented: null });
    ed.width = ed.bitmap.width;
    ed.height = ed.bitmap.height;
    $("ed-aspect").value = "none";
    $("ed-target-note").textContent = "";
  }

  // ---------- Geometry ----------

  // The image after rotating and flipping (cached until those change).
  function oriented() {
    if (ed.oriented) return ed.oriented;
    const { bitmap, rotate } = ed;
    const sideways = rotate % 180 !== 0;
    const c = IT.canvas(sideways ? bitmap.height : bitmap.width, sideways ? bitmap.width : bitmap.height);
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.scale(ed.flipH ? -1 : 1, ed.flipV ? -1 : 1);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    ed.oriented = c;
    return c;
  }

  // The part of the rotated image that will be saved.
  function region() {
    const o = oriented();
    return ed.crop || { x: 0, y: 0, w: o.width, h: o.height };
  }

  // Largest centred box with the given width/height ratio.
  function centredCrop(ratio) {
    const o = oriented();
    let w = o.width;
    let h = w / ratio;
    if (h > o.height) {
      h = o.height;
      w = h * ratio;
    }
    return { x: (o.width - w) / 2, y: (o.height - h) / 2, w, h };
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // New crop box after dragging a handle by (dx, dy) image pixels.
  function dragCrop(start, handle, dx, dy) {
    const o = oriented();
    const W = o.width;
    const H = o.height;
    if (handle === "move") {
      return { ...start, x: clamp(start.x + dx, 0, W - start.w), y: clamp(start.y + dy, 0, H - start.h) };
    }
    let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
    if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP);
    if (handle.includes("e")) right = clamp(right + dx, left + MIN_CROP, W);
    if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP);
    if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, H);

    const ratio = typeof ed.aspect === "number" ? ed.aspect : null;
    if (ratio) {
      // Width leads; height follows, anchored at the opposite corner.
      let w = right - left;
      let h = w / ratio;
      const limit = handle.includes("n") ? bottom : H - top;
      if (h > limit) {
        h = limit;
        w = h * ratio;
        if (handle.includes("w")) left = right - w;
        else right = left + w;
      }
      if (handle.includes("n")) top = bottom - h;
      else bottom = top + h;
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // ---------- Rendering ----------

  function renderStage() {
    const o = oriented();
    const canvas = $("ed-canvas");
    // The on-screen preview is drawn at most ~1600px wide; saving uses full size.
    const scale = Math.min(1, 1600 / Math.max(o.width, o.height));
    canvas.width = Math.round(o.width * scale);
    canvas.height = Math.round(o.height * scale);
    canvas.getContext("2d").drawImage(o, 0, 0, canvas.width, canvas.height);
    renderCrop();
  }

  function renderCrop() {
    const box = $("ed-crop");
    box.hidden = !ed.crop;
    $("ed-crop-hint").hidden = !ed.crop;
    if (!ed.crop) return;
    const o = oriented();
    const toPct = (v, total) => (v / total) * 100 + "%";
    box.style.left = toPct(ed.crop.x, o.width);
    box.style.top = toPct(ed.crop.y, o.height);
    box.style.width = toPct(ed.crop.w, o.width);
    box.style.height = toPct(ed.crop.h, o.height);
  }

  function renderMeta() {
    const box = $("ed-meta");
    const x = ed.exif;
    const found = [];
    if (x) {
      if (x.location) found.push("where it was taken (GPS location)");
      if (x.taken) found.push("when it was taken (" + x.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") + ")");
      if (x.camera) found.push("the camera or phone (" + x.camera + ")");
      if (x.software) found.push("the software used (" + x.software + ")");
      found.push(...x.other);
    }
    box.hidden = false;
    box.className = "card meta" + (x && x.location ? " meta--warning" : "");
    box.replaceChildren(
      el("h2", { class: "card-title", text: "Hidden data" }),
      found.length
        ? el("div", {}, [
            el("p", { class: "small", text: "This photo contains:" }),
            el("ul", { class: "small" }, found.map((f) => el("li", { text: f }))),
            el("p", { class: "small muted", text: "None of this is included in what you download here." })
          ])
        : el("p", { class: "small muted", text: "No camera or location data found. Downloads from here never include hidden data either way." })
    );
  }

  function renderSize() {
    $("ed-width").value = ed.width;
    $("ed-height").value = ed.height;
    const r = region();
    const bigger = ed.width > Math.round(r.w) + 1;
    $("ed-size-note").hidden = !bigger;
    $("ed-size-note").textContent = bigger ? "Making an image bigger than it is doesn't add detail; it will look softer." : "";
  }

  function renderFormat() {
    const lossy = ed.format !== "image/png";
    $("ed-quality-row").hidden = !lossy;
    $("ed-quality").value = Math.round(ed.quality * 100);
    $("ed-quality-value").textContent = Math.round(ed.quality * 100) + "%";
  }

  function renderAll() {
    renderStage();
    renderSize();
    renderFormat();
    scheduleResult();
  }

  // ---------- Output ----------

  // Draws the saved image: crop, then resize in halving steps (sharper than one big jump).
  function drawOutput() {
    const o = oriented();
    const r = region();
    let source = o;
    let sx = r.x, sy = r.y, sw = r.w, sh = r.h;
    while (sw / 2 >= ed.width && sh / 2 >= ed.height) {
      const half = IT.canvas(sw / 2, sh / 2);
      const hctx = half.getContext("2d");
      hctx.imageSmoothingQuality = "high";
      hctx.drawImage(source, sx, sy, sw, sh, 0, 0, half.width, half.height);
      source = half;
      sx = 0;
      sy = 0;
      sw = half.width;
      sh = half.height;
    }
    const out = IT.canvas(ed.width, ed.height);
    const ctx = out.getContext("2d");
    if (ed.format === "image/jpeg") {
      // JPEG has no transparency: put see-through areas on white, not black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  let resultTimer;
  let resultToken = 0;
  function scheduleResult() {
    clearTimeout(resultTimer);
    $("ed-result-info").textContent = "Updating…";
    resultTimer = setTimeout(makeResult, 250);
  }

  async function makeResult() {
    const token = ++resultToken;
    const blob = await IT.toBlob(drawOutput(), ed.format, ed.quality);
    if (token !== resultToken) return; // a newer change is already being made
    ed.result = blob;
    const img = $("ed-result");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);

    let note = "";
    if (blob.type !== ed.format) {
      note = " This browser can't save " + ed.format.split("/")[1].toUpperCase() + ", so it will be " + blob.type.split("/")[1].toUpperCase() + ".";
    }
    const change = blob.size < ed.bytes ? ", " + Math.round((1 - blob.size / ed.bytes) * 100) + "% smaller" : "";
    $("ed-result-info").textContent =
      ed.width + " × " + ed.height + " px, " + IT.sizeText(blob.size) + " (was " + IT.sizeText(ed.bytes) + change + ")." + note;
  }

  // Lowest quality that still fits: searches between 30% and 95%.
  async function fitUnder() {
    const kb = Number($("ed-target").value);
    const note = $("ed-target-note");
    if (!kb || kb < 1) return (note.textContent = "Enter a size in KB, like 500.");
    const limit = kb * 1024;
    if (ed.format === "image/png") {
      note.textContent = "PNG has no quality setting. Switch to JPEG or WebP, or make the image smaller in pixels.";
      return;
    }
    note.textContent = "Searching…";
    const canvas = drawOutput();
    let lo = 0.3, hi = 0.95, best = null;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      const blob = await IT.toBlob(canvas, ed.format, q);
      if (blob.size <= limit) {
        best = q;
        lo = q;
      } else {
        hi = q;
      }
    }
    if (best === null) {
      const smallest = await IT.toBlob(canvas, ed.format, 0.3);
      if (smallest.size > limit) {
        note.textContent = "Even at low quality it's " + IT.sizeText(smallest.size) + ". Make it smaller in pixels (try 50%) and press Fit again.";
        return;
      }
      best = 0.3;
    }
    ed.quality = Math.floor(best * 100) / 100;
    renderFormat();
    scheduleResult();
    note.textContent = "Quality set to " + Math.round(ed.quality * 100) + "% to fit under " + kb + " KB.";
  }

  // ---------- Controls ----------

  function setSize(width, height) {
    ed.width = Math.max(1, Math.round(width));
    ed.height = Math.max(1, Math.round(height));
    renderSize();
    scheduleResult();
  }

  // Output size follows the crop box at full resolution.
  function sizeToRegion() {
    const r = region();
    ed.width = Math.round(r.w);
    ed.height = Math.round(r.h);
  }

  function reorient(change) {
    change();
    ed.oriented = null;
    // The old crop box doesn't line up with the turned image; start it fresh.
    if (ed.crop) ed.crop = typeof ed.aspect === "number" ? centredCrop(ed.aspect) : centredCrop(oriented().width / oriented().height);
    sizeToRegion();
    renderAll();
  }

  $("ed-choose").addEventListener("click", () => $("ed-file").click());
  $("ed-new").addEventListener("click", () => $("ed-file").click());
  $("ed-file").addEventListener("change", (e) => {
    if (e.target.files[0]) open(e.target.files[0]);
    e.target.value = "";
  });

  // Drop an image anywhere while this tab is showing.
  document.addEventListener("dragover", (e) => {
    if (!$("panel-edit").hidden && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if ($("panel-edit").hidden || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    open(e.dataTransfer.files[0]);
  });

  $("ed-rotate-left").addEventListener("click", () => reorient(() => (ed.rotate = (ed.rotate + 270) % 360)));
  $("ed-rotate-right").addEventListener("click", () => reorient(() => (ed.rotate = (ed.rotate + 90) % 360)));
  $("ed-flip-h").addEventListener("click", () => reorient(() => (ed.flipH = !ed.flipH)));
  $("ed-flip-v").addEventListener("click", () => reorient(() => (ed.flipV = !ed.flipV)));

  $("ed-aspect").addEventListener("change", (e) => {
    const value = e.target.value;
    const o = oriented();
    if (value === "none") {
      ed.aspect = "none";
      ed.crop = null;
    } else if (value === "free") {
      ed.aspect = "free";
      // Start a little inside the edges so the handles are easy to grab.
      ed.crop = ed.crop || { x: o.width * 0.05, y: o.height * 0.05, w: o.width * 0.9, h: o.height * 0.9 };
    } else {
      ed.aspect = Number(value);
      ed.crop = centredCrop(ed.aspect);
    }
    sizeToRegion();
    renderCrop();
    renderSize();
    scheduleResult();
  });

  // Dragging the crop box or its corners (mouse, touch or pen).
  let drag = null;
  $("ed-crop").addEventListener("pointerdown", (e) => {
    if (!ed || !ed.crop) return;
    e.preventDefault();
    const stage = $("ed-stage").getBoundingClientRect();
    drag = {
      handle: e.target.dataset.handle || "move",
      start: { ...ed.crop },
      x: e.clientX,
      y: e.clientY,
      scale: oriented().width / stage.width // image pixels per screen pixel
    };
    // Keeps the drag going if the pointer leaves the box. Not essential, so a failure is ignored.
    try {
      $("ed-crop").setPointerCapture(e.pointerId);
    } catch (error) {
      /* dragging still works inside the box */
    }
  });
  $("ed-crop").addEventListener("pointermove", (e) => {
    if (!drag) return;
    ed.crop = dragCrop(drag.start, drag.handle, (e.clientX - drag.x) * drag.scale, (e.clientY - drag.y) * drag.scale);
    renderCrop();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    sizeToRegion();
    renderSize();
    scheduleResult();
  };
  $("ed-crop").addEventListener("pointerup", endDrag);
  $("ed-crop").addEventListener("pointercancel", endDrag);

  // Width and height stay in proportion to the crop.
  $("ed-width").addEventListener("change", (e) => {
    const r = region();
    const w = Number(e.target.value);
    if (w > 0) setSize(w, (w * r.h) / r.w);
    else renderSize();
  });
  $("ed-height").addEventListener("change", (e) => {
    const r = region();
    const h = Number(e.target.value);
    if (h > 0) setSize((h * r.w) / r.h, h);
    else renderSize();
  });
  document.querySelectorAll("[data-scale]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = region();
      const s = Number(b.dataset.scale);
      setSize(r.w * s, r.h * s);
    })
  );

  $("ed-format").addEventListener("change", (e) => {
    ed.format = e.target.value;
    $("ed-target-note").textContent = "";
    renderFormat();
    scheduleResult();
  });
  $("ed-quality").addEventListener("input", (e) => {
    ed.quality = Number(e.target.value) / 100;
    $("ed-quality-value").textContent = e.target.value + "%";
    scheduleResult();
  });
  $("ed-fit").addEventListener("click", () => ed && fitUnder());
  $("ed-target").addEventListener("keydown", (e) => {
    if (e.key === "Enter") fitUnder();
  });

  $("ed-reset").addEventListener("click", () => {
    resetEdits();
    renderAll();
  });

  $("ed-download").addEventListener("click", async () => {
    clearTimeout(resultTimer);
    await makeResult();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[ed.result.type] || "png";
    IT.download(ed.result, ed.name + " (edited)." + ext);
  });
})();
