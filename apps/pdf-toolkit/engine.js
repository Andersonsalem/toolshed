// PDF work for the toolkit, all in the browser. No page layout here.
//   pdf-lib (vendor/pdf-lib.min.js)   reads PDFs and builds new ones.
//   pdf.js  (shared/pdfjs.js loads it) draws page previews.
// Exposes PdfToolkit.loadFile(file), .renderPage(source, index, width), .build(pages).
(function () {
  "use strict";
  const NS = (window.PdfToolkit = window.PdfToolkit || {});

  const MAX_FILE_MB = 200;
  const PROTECTED = "is password-protected or encrypted, so it can't be edited here. Remove the protection first, then add it again.";
  const UNREADABLE = "couldn't be read. It may be damaged, or not really a PDF.";

  function looksLikePdf(bytes) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    return head.includes("%PDF-");
  }

  // Resolves with a "source": one opened PDF. Rejects with a message a person can read.
  NS.loadFile = async function (file) {
    const label = "“" + file.name + "”";
    if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(label + " is over " + MAX_FILE_MB + " MB, which is too big to handle in a browser tab.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) throw new Error(label + " isn't a PDF.");

    let lib;
    try {
      lib = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      throw new Error(label + " " + (/encrypt/i.test(String(error && error.message)) ? PROTECTED : UNREADABLE));
    }

    let view;
    try {
      view = await PdfJs.open(bytes);
    } catch (error) {
      if (error && error.name === "PasswordException") throw new Error(label + " " + PROTECTED);
      view = null; // Previews unavailable, but pdf-lib can still use the pages.
    }

    return {
      name: file.name,
      size: file.size,
      lib,
      view,
      pageCount: lib.getPageCount(),
      rotations: lib.getPages().map((p) => p.getRotation().angle)
    };
  };

  // Draws one page (0-based index) into a new canvas about `width` pixels wide.
  // Resolves with null when previews aren't available for this file.
  NS.renderPage = async function (source, index, width) {
    if (!source.view) return null;
    const page = await source.view.getPage(index + 1);
    const unscaled = page.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
    page.cleanup();
    return canvas;
  };

  // pages: [{ source, index, rotate }] in output order, rotate in extra degrees.
  // Resolves with the new PDF's bytes.
  NS.build = async function (pages) {
    const out = await PDFLib.PDFDocument.create();
    for (const { source, index, rotate } of pages) {
      const [copy] = await out.copyPages(source.lib, [index]);
      copy.setRotation(PDFLib.degrees((((source.rotations[index] + rotate) % 360) + 360) % 360));
      out.addPage(copy);
    }
    return out.save();
  };

  NS.supported = function () {
    if (!/^https?:$/.test(location.protocol)) {
      return "This tool only works when the page is opened from a web address, not from a file on your computer.";
    }
    if (typeof PDFLib === "undefined") return "The PDF library didn't load. Reload the page to try again.";
    return "";
  };
})();
