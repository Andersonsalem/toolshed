// Reads the text out of a resume file, entirely in the browser.
// Supports .docx (a zip of XML files) and plain text. PDFs aren't supported:
// reading them reliably needs a large library, so people are told to paste instead.
(function () {
  "use strict";
  const NS = (window.ResumeMatch = window.ResumeMatch || {});

  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const MAX_BYTES = 10 * 1024 * 1024;
  const NOT_DOCX = "That file couldn't be read as a Word document. Try copying the text from Word and pasting it instead.";

  // A .docx is a zip archive; the text is in word/document.xml (read with shared/zip.js).
  async function docxToText(file) {
    if (!Zip.canRead()) {
      throw new Error("This browser can't open Word files here. Copy the text from Word and paste it instead.");
    }
    let bytes;
    try {
      const entry = (await Zip.read(await file.arrayBuffer())).get("word/document.xml");
      if (!entry) throw new Error(NOT_DOCX);
      bytes = await entry();
    } catch (e) {
      throw new Error(NOT_DOCX);
    }
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(NOT_DOCX);

    const lines = [];
    for (const paragraph of doc.getElementsByTagNameNS(WORD_NS, "p")) {
      let line = "";
      for (const node of paragraph.getElementsByTagNameNS(WORD_NS, "*")) {
        if (node.localName === "t") line += node.textContent;
        else if (node.localName === "tab") line += "\t";
        else if (node.localName === "br") line += "\n";
      }
      lines.push(line);
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Resolves with the file's text, or rejects with a message a person can read.
  NS.readResumeFile = async function (file) {
    const name = file.name.toLowerCase();
    if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB, which is too big for a resume. Paste the text instead.");
    if (name.endsWith(".pdf")) {
      throw new Error("PDFs can't be read here. Open the PDF, select all the text (Ctrl+A or Cmd+A), copy it, and paste it in the box.");
    }
    if (name.endsWith(".doc")) {
      throw new Error("Older .doc files can't be read here. Save it as .docx in Word, or copy and paste the text.");
    }
    if (name.endsWith(".docx")) return docxToText(file);
    if (name.endsWith(".txt") || name.endsWith(".md")) return (await file.text()).trim();
    throw new Error("That file type isn't supported. Use a .docx or .txt file, or paste the text.");
  };
})();
