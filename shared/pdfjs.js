// Loads pdf.js (Mozilla's PDF reader, in shared/vendor/pdfjs/) only when a tool
// needs it, and opens PDFs with safe settings.
//
//   await PdfJs.open(bytes)  -> pdf.js document (rejects with error.name "PasswordException" if locked)
//   doc.close()              -> frees its memory (pdf.js 6 has no doc.destroy(); use this)
//
// pdf.js ships as .mjs files; they're renamed to .js because some servers
// (including Python's) label .mjs as plain text, which browsers refuse to run.
// Loading it needs the page to come from a web address, not a file on disk.
(function () {
  "use strict";
  const base = new URL("./vendor/pdfjs/", document.currentScript.src).href;

  let loading;
  function load() {
    if (!loading) {
      loading = import(base + "pdf.min.js").then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
        return lib;
      });
      loading.catch(() => (loading = null));
    }
    return loading;
  }

  // Fonts and decoders come from local copies, and code inside PDFs is never run.
  const OPTIONS = {
    isEvalSupported: false,
    enableScripting: false,
    standardFontDataUrl: base + "standard_fonts/",
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    wasmUrl: base + "wasm/",
    iccUrl: base + "iccs/"
  };

  // pdf.js takes ownership of the buffer it's given, so it gets a copy.
  async function open(bytes) {
    const task = (await load()).getDocument({ data: bytes.slice(), ...OPTIONS });
    const doc = await task.promise;
    doc.close = () => task.destroy();
    return doc;
  }

  window.PdfJs = { open };
})();
