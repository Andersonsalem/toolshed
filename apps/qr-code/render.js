// Turning text into a QR code, and drawing it as a canvas or SVG. No page layout here.
// The encoding itself is done by vendor/qrcode.js (qrcode-generator, MIT).
//
//   QR.make(text, level)          -> { size, version, dark(row, col) } or { error }
//   QR.draw(canvas, code, style)  draws at whole pixels per square, so edges stay sharp
//   QR.svg(code, style)           -> SVG text
//   QR.contrast(hexA, hexB)       WCAG contrast ratio, 1 to 21
(function () {
  "use strict";
  const QR = (window.QR = window.QR || {});
  /* global qrcode */
  // Without this the library would mangle accents and emoji.
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  // Error correction: how much of the code can be damaged or covered and still scan.
  QR.LEVELS = [["L", "Low (7%)"], ["M", "Medium (15%)"], ["Q", "Quartile (25%)"], ["H", "High (30%)"]];
  // Most bytes a version-40 code holds at each level (the QR standard's own table).
  QR.MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  QR.bytes = (text) => new TextEncoder().encode(text).length;

  QR.make = function (text, level) {
    const n = QR.bytes(text);
    if (n > QR.MAX_BYTES[level]) {
      return { error: "Too much for one QR code: " + n.toLocaleString() + " bytes, and the most at this error-correction level is " + QR.MAX_BYTES[level].toLocaleString() + ". Shorten it, or lower the error correction." };
    }
    const q = qrcode(0, level); // 0 = smallest version that fits
    q.addData(text, "Byte");
    q.make();
    const size = q.getModuleCount();
    return { size, version: (size - 17) / 4, dark: (r, c) => q.isDark(r, c) };
  };

  // style: { scale (pixels per square), margin (squares), fg, bg, transparent }
  QR.draw = function (canvas, code, style) {
    const total = code.size + style.margin * 2;
    canvas.width = canvas.height = total * style.scale;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!style.transparent) {
      ctx.fillStyle = style.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = style.fg;
    for (let r = 0; r < code.size; r++) {
      for (let c = 0; c < code.size; c++) {
        if (code.dark(r, c)) ctx.fillRect((c + style.margin) * style.scale, (r + style.margin) * style.scale, style.scale, style.scale);
      }
    }
  };

  // One path, one square per unit; runs of dark squares in a row are merged to keep the file small.
  QR.svg = function (code, style) {
    const total = code.size + style.margin * 2;
    let d = "";
    for (let r = 0; r < code.size; r++) {
      for (let c = 0; c < code.size; c++) {
        if (!code.dark(r, c)) continue;
        let run = 1;
        while (c + run < code.size && code.dark(r, c + run)) run++;
        d += "M" + (c + style.margin) + " " + (r + style.margin) + "h" + run + "v1h-" + run + "z";
        c += run - 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + " " + total + '" width="' + total * 10 + '" height="' + total * 10 + '" shape-rendering="crispEdges">' +
      (style.transparent ? "" : '<rect width="100%" height="100%" fill="' + style.bg + '"/>') +
      '<path fill="' + style.fg + '" d="' + d + '"/></svg>';
  };

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  QR.luminance = luminance;
  QR.contrast = function (a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
})();
