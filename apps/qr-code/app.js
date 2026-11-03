// QR Code page: the form for each kind, the preview, warnings and downloads.
// Formats are in formats.js, drawing in render.js. Only style settings are
// saved: what people type (Wi-Fi passwords, contact details) never is.
(function () {
  "use strict";
  const { el } = window.UI;
  const QR = window.QR;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("qr-code", 1);
  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

  function clean(raw) {
    raw = raw || {};
    const margin = Math.round(Number(raw.margin));
    return {
      kind: QR.KINDS.some((k) => k.id === raw.kind) ? raw.kind : "link",
      level: QR.LEVELS.some((l) => l[0] === raw.level) ? raw.level : "M",
      fg: isHex(raw.fg) ? raw.fg : "#000000",
      bg: isHex(raw.bg) ? raw.bg : "#ffffff",
      transparent: raw.transparent === true,
      margin: margin >= 0 && margin <= 8 ? margin : 4,
      pngSize: ["300", "1000", "2000"].includes(raw.pngSize) ? raw.pngSize : "1000"
    };
  }
  const s = clean(store.load({}));
  const fromHash = location.hash.slice(1);
  if (QR.KINDS.some((k) => k.id === fromHash)) s.kind = fromHash;

  // What's typed, per kind, for this visit only (switching kinds keeps it).
  const values = {};
  let code = null; // the current code, or null
  let encoded = "";

  // ---------- Kind buttons and fields ----------

  const kindButtons = QR.KINDS.map((k) => {
    const b = el("button", { class: "kind", type: "button", role: "tab", text: k.label });
    b.addEventListener("click", () => {
      s.kind = k.id;
      history.replaceState(null, "", "#" + k.id);
      store.save(s);
      renderFields();
      update();
    });
    return [k.id, b];
  });
  $("kinds").append(...kindButtons.map((x) => x[1]));

  function renderFields() {
    const kind = QR.KINDS.find((k) => k.id === s.kind);
    const v = (values[kind.id] = values[kind.id] || {});
    kindButtons.forEach(([id, b]) => b.setAttribute("aria-selected", String(id === s.kind)));
    const rows = kind.fields.map(([id, label, type, extra]) => {
      extra = extra || {};
      const fid = "f-" + id;
      let input;
      if (type === "textarea") input = el("textarea", { id: fid, rows: "4" });
      else if (type === "select") {
        input = el("select", { id: fid }, extra.options.map(([value, text]) => el("option", { value, text })));
        if (v[id] === undefined) v[id] = extra.options[0][0];
      } else input = el("input", { id: fid, type: type === "checkbox" ? "checkbox" : type === "url" ? "text" : type, spellcheck: "false" });
      if (extra.placeholder) input.placeholder = extra.placeholder;
      if (type === "url") input.inputMode = "url";
      if (type === "checkbox") input.checked = !!v[id];
      else input.value = v[id] || "";
      input.addEventListener("input", () => {
        v[id] = type === "checkbox" ? input.checked : input.value;
        if (kind.id === "wifi" && id === "security") renderFields(); // show or hide the password
        update();
      });
      const hide = kind.id === "wifi" && id === "password" && v.security === "nopass";
      if (type === "checkbox") return el("label", { class: "check wide" }, [input, " " + label]);
      const row = el("div", { class: "field" + (extra.half ? "" : " wide") }, [el("label", { for: fid, text: label }), input]);
      row.hidden = hide;
      return row;
    });
    $("fields").replaceChildren(el("div", { class: "field-grid" }, rows));
  }
  $("fields").addEventListener("submit", (e) => e.preventDefault());

  // ---------- Style ----------

  for (const [value, text] of QR.LEVELS) $("level").append(el("option", { value, text }));
  function fillStyle() {
    $("fg").value = s.fg;
    $("bg").value = s.bg;
    $("transparent").checked = s.transparent;
    $("margin").value = s.margin;
    $("margin-out").textContent = s.margin;
    $("level").value = s.level;
    $("png-size").value = s.pngSize;
  }
  $("style-box").addEventListener("input", () => {
    s.fg = $("fg").value;
    s.bg = $("bg").value;
    s.transparent = $("transparent").checked;
    s.margin = Number($("margin").value);
    s.level = $("level").value;
    s.pngSize = $("png-size").value;
    $("margin-out").textContent = s.margin;
    store.save(s);
    update();
  });

  // ---------- Preview ----------

  const style = (scale) => ({ scale, margin: s.margin, fg: s.fg, bg: s.bg, transparent: s.transparent });

  function warnings() {
    const out = [];
    if (s.kind === "wifi") out.push("Anyone who can see this code can join your network, so put it where only guests will see it.");
    if (QR.luminance(s.fg) > QR.luminance(s.bg) && !s.transparent) out.push("Light code on a dark background: many scanner apps can't read this. Use a dark code color on a light background.");
    else if (!s.transparent && QR.contrast(s.fg, s.bg) < 3) out.push("The colors are too close together, so the code may not scan. Pick colors with more contrast.");
    if (s.transparent) out.push("Transparent background: place it on a plain, light background, or it may not scan.");
    if (s.margin < 4) out.push("The QR standard asks for a border of 4 squares. A thinner one can fail on busy backgrounds or next to other print.");
    if (code && code.version >= 15) out.push("This is a dense code. Shorter content or lower error correction makes it easier to scan, especially when printed small.");
    return out;
  }

  function update() {
    const result = QR.encode(s.kind, values[s.kind] || {});
    code = null;
    encoded = "";
    let message = result.error;
    if (!message) {
      const made = QR.make(result.text, s.level);
      if (made.error) message = made.error;
      else {
        code = made;
        encoded = result.text;
      }
    }

    const canvas = $("canvas");
    canvas.hidden = !code;
    $("placeholder").hidden = !!code;
    $("placeholder").textContent = message || "";
    $("encoded").textContent = encoded;
    $("status").textContent = "";
    ["dl-png", "dl-svg", "copy"].forEach((id) => ($(id).disabled = !code));

    if (code) {
      // Draw the preview at whole pixels per square (sharp), then let CSS fit it.
      QR.draw(canvas, code, style(Math.max(2, Math.floor(600 / (code.size + s.margin * 2)))));
      canvas.setAttribute("aria-label", "QR code for: " + encoded.slice(0, 200));
      // A square should be at least about 0.5 mm when printed for phones to read it reliably.
      const cm = Math.max(2, Math.ceil(((code.size + s.margin * 2) * 0.05) * 2) / 2);
      $("info").textContent = code.size + " × " + code.size + " squares · " + QR.bytes(encoded).toLocaleString() + " bytes · print at least " + cm + " cm (" + (cm / 2.54).toFixed(1) + " in) wide";
    } else $("info").textContent = "";
    $("warnings").replaceChildren(...(code ? warnings() : []).map((w) => el("li", { text: w })));
  }

  // ---------- Download and copy ----------

  const fileName = (ext) => "qr-" + s.kind + "." + ext;

  function download(blob, name) {
    const link = el("a", { download: name });
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  function pngBlob() {
    const c = document.createElement("canvas");
    const total = code.size + s.margin * 2;
    QR.draw(c, code, style(Math.max(1, Math.round(Number(s.pngSize) / total))));
    return new Promise((resolve) => c.toBlob(resolve, "image/png"));
  }

  $("dl-png").addEventListener("click", async () => download(await pngBlob(), fileName("png")));
  $("dl-svg").addEventListener("click", () => download(new Blob([QR.svg(code, style(1))], { type: "image/svg+xml" }), fileName("svg")));
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
      $("status").textContent = "Copied. Paste it into a document or message.";
    } catch (e) {
      $("status").textContent = "Your browser didn't allow copying images. Use Download PNG instead.";
    }
  });

  fillStyle();
  renderFields();
  update();
})();
