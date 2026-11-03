// "Make a signature": draw it, type it, or clean up a photo of it, and get a
// transparent PNG. Each mode draws onto its own canvas; the result is that
// canvas trimmed to the ink.
(function () {
  "use strict";
  const IT = window.ImageToolkit;
  const { el } = window.UI;
  const $ = (id) => document.getElementById(id);

  const PAD_HEIGHT = 220;
  const TYPE_SIZE = 72;
  const PHOTO_MAX_WIDTH = 1600;

  // Handwriting fonts that may already be on the device. Only installed ones are offered.
  const FONTS = [
    "Segoe Script",
    "Lucida Handwriting",
    "Brush Script MT",
    "Snell Roundhand",
    "Bradley Hand",
    "Savoye LET",
    "Ink Free",
    "Dancing Script"
  ];

  let mode = "draw";
  let output = null; // trimmed canvas, or null

  const ink = () => $("sig-color").value;

  // ---------- Draw ----------

  const pad = $("sig-pad");
  let strokes = [];
  let current = null;

  function sizePad() {
    const ratio = window.devicePixelRatio || 1;
    const width = pad.clientWidth || 600;
    pad.width = Math.round(width * ratio);
    pad.height = Math.round(PAD_HEIGHT * ratio);
    pad.style.height = PAD_HEIGHT + "px";
    drawStrokes();
  }

  // Smooth lines: curves through the midpoints between recorded points.
  function drawStrokes() {
    const ratio = pad.width / (pad.clientWidth || 600);
    const ctx = pad.getContext("2d");
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink();
    for (const stroke of strokes) {
      ctx.lineWidth = stroke.width * ratio;
      const p = stroke.points;
      ctx.beginPath();
      ctx.moveTo(p[0].x * ratio, p[0].y * ratio);
      if (p.length === 1) ctx.lineTo(p[0].x * ratio + 0.1, p[0].y * ratio);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i].x + p[i + 1].x) / 2;
        const my = (p[i].y + p[i + 1].y) / 2;
        ctx.quadraticCurveTo(p[i].x * ratio, p[i].y * ratio, mx * ratio, my * ratio);
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1].x * ratio, p[p.length - 1].y * ratio);
      ctx.stroke();
    }
  }

  function point(e) {
    const box = pad.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // Keeps the stroke going if the pen slides off the pad. Not essential, so a failure is ignored.
    try {
      pad.setPointerCapture(e.pointerId);
    } catch (error) {
      /* drawing still works without it */
    }
    current = { width: Number($("sig-pen").value), points: [point(e)] };
    strokes.push(current);
    drawStrokes();
  });
  pad.addEventListener("pointermove", (e) => {
    if (!current) return;
    // In-between points the browser grouped together, for smoother lines. The
    // list can be empty, so the event itself is the fallback.
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of coalesced.length ? coalesced : [e]) current.points.push(point(ev));
    drawStrokes();
  });
  const endStroke = () => {
    if (!current) return;
    current = null;
    update();
  };
  pad.addEventListener("pointerup", endStroke);
  pad.addEventListener("pointercancel", endStroke);

  $("sig-undo").addEventListener("click", () => {
    strokes.pop();
    drawStrokes();
    update();
  });
  $("sig-clear").addEventListener("click", () => {
    strokes = [];
    drawStrokes();
    update();
  });

  // ---------- Type ----------

  // A font is installed if text in it measures differently from the fallbacks.
  function installed(font) {
    const ctx = IT.canvas(10, 10).getContext("2d");
    const sample = "Signature mwiI 0123";
    return ["monospace", "serif", "sans-serif"].some((fallback) => {
      ctx.font = "40px " + fallback;
      const base = ctx.measureText(sample).width;
      ctx.font = '40px "' + font + '", ' + fallback;
      return ctx.measureText(sample).width !== base;
    });
  }

  const fonts = FONTS.filter(installed);
  if (!fonts.length) fonts.push("cursive");
  let chosenFont = fonts[0];

  function renderFontChoices() {
    const name = $("sig-name").value.trim() || "Your Name";
    $("sig-fonts").replaceChildren(
      ...fonts.map((font) => {
        const option = el("button", {
          class: "sig-font",
          type: "button",
          role: "radio",
          "aria-checked": String(font === chosenFont),
          "aria-label": font === "cursive" ? "Your device's handwriting style" : font
        }, [el("span", { text: name })]);
        option.firstChild.style.fontFamily = font === "cursive" ? "cursive" : '"' + font + '", cursive';
        option.addEventListener("click", () => {
          chosenFont = font;
          renderFontChoices();
          update();
        });
        return option;
      })
    );
  }

  function typedCanvas() {
    const name = $("sig-name").value.trim();
    if (!name) return null;
    const family = chosenFont === "cursive" ? "cursive" : '"' + chosenFont + '", cursive';
    const measure = IT.canvas(10, 10).getContext("2d");
    measure.font = TYPE_SIZE + "px " + family;
    const width = measure.measureText(name).width;
    // Generous room: handwriting fonts have long loops above and below.
    const c = IT.canvas(width + TYPE_SIZE, TYPE_SIZE * 2);
    const ctx = c.getContext("2d");
    ctx.font = TYPE_SIZE + "px " + family;
    ctx.fillStyle = ink();
    ctx.textBaseline = "middle";
    ctx.fillText(name, TYPE_SIZE / 2, c.height / 2);
    return c;
  }

  $("sig-name").addEventListener("input", () => {
    renderFontChoices();
    update();
  });

  // ---------- From a photo ----------

  let photo = null; // canvas holding the photo, scaled down if large

  function photoMessage(text, isError) {
    $("sig-photo-message").textContent = text;
    $("sig-photo-message").className = "small" + (isError ? " is-error" : " muted");
    $("sig-photo-message").hidden = !text;
  }

  async function openPhoto(file) {
    photoMessage("");
    let bitmap;
    try {
      bitmap = await IT.openImage(file);
    } catch (error) {
      return photoMessage(error.message, true);
    }
    const scale = Math.min(1, PHOTO_MAX_WIDTH / bitmap.width);
    photo = IT.canvas(bitmap.width * scale, bitmap.height * scale);
    photo.getContext("2d").drawImage(bitmap, 0, 0, photo.width, photo.height);
    bitmap.close();
    $("sig-photo-controls").hidden = false;
    update();
  }

  // Light pixels become see-through; dark pixels become ink, fading softly at the edges.
  function cleanedPhoto() {
    if (!photo) return null;
    const threshold = Number($("sig-threshold").value);
    const out = IT.canvas(photo.width, photo.height);
    const src = photo.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, photo.width, photo.height);
    const color = ink();
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const d = src.data;
    for (let i = 0; i < d.length; i += 4) {
      const light = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const alpha = light >= threshold ? 0 : Math.min(255, (threshold - light) * 4);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = alpha;
    }
    out.getContext("2d").putImageData(src, 0, 0);
    return out;
  }

  $("sig-photo-choose").addEventListener("click", () => $("sig-photo-file").click());
  $("sig-photo-file").addEventListener("change", (e) => {
    if (e.target.files[0]) openPhoto(e.target.files[0]);
    e.target.value = "";
  });
  $("sig-threshold").addEventListener("input", (e) => {
    $("sig-threshold-value").textContent = e.target.value;
    updateSoon();
  });

  // ---------- Result ----------

  function update() {
    const source = mode === "draw" ? (strokes.length ? pad : null) : mode === "type" ? typedCanvas() : cleanedPhoto();
    output = source ? IT.trim(source, 12) : null;
    if (mode === "photo" && photo && !output) photoMessage("Nothing dark enough was found. Move the slider right.", true);
    else if (mode === "photo" && photo) photoMessage("");

    const preview = $("sig-preview");
    $("sig-empty").hidden = !!output;
    preview.hidden = !output;
    if (output) preview.src = output.toDataURL("image/png");
    $("sig-download").disabled = !output;
    $("sig-copy").disabled = !output;
    $("sig-status").textContent = "";
  }

  let timer;
  function updateSoon() {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll(".sig-mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    $("sig-draw").hidden = mode !== "draw";
    $("sig-type").hidden = mode !== "type";
    $("sig-photo").hidden = mode !== "photo";
    if (mode === "draw") sizePad();
    update();
  }

  document.querySelectorAll(".sig-mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("sig-color").addEventListener("change", () => {
    drawStrokes();
    renderFontChoices();
    update();
  });

  $("sig-download").addEventListener("click", async () => {
    if (!output) return;
    IT.download(await IT.toBlob(output, "image/png"), "signature.png");
  });
  $("sig-copy").addEventListener("click", async () => {
    if (!output) return;
    try {
      const blob = await IT.toBlob(output, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      $("sig-status").textContent = "Copied. Paste it into your document.";
    } catch (e) {
      $("sig-status").textContent = "This browser can't copy images. Use Download instead.";
    }
  });

  // The drawing pad needs its real width, which it only has once visible.
  window.addEventListener("resize", () => {
    if (!$("panel-signature").hidden && mode === "draw") sizePad();
  });
  IT.showSignature = () => setMode(mode);

  $("sig-threshold-value").textContent = $("sig-threshold").value;
  renderFontChoices();
  update();
})();
