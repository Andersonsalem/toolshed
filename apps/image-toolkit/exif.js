// Finds the hidden data in a JPEG photo (EXIF), so people can see what a
// photo gives away before sharing it. Only reads; it never changes files.
// ImageToolkit.readExif(arrayBuffer) -> { location, camera, taken, software, other } or null
(function () {
  "use strict";
  const NS = (window.ImageToolkit = window.ImageToolkit || {});

  const TAGS = {
    0x010f: "make",
    0x0110: "model",
    0x0131: "software",
    0x0132: "modified",
    0x013b: "artist",
    0x8298: "copyright",
    0x8769: "exifPointer",
    0x8825: "gpsPointer",
    0x9003: "taken"
  };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function readIfd(view, tiff, offset, little, out) {
    if (offset + 2 > view.byteLength) return;
    const count = view.getUint16(offset, little);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > view.byteLength) return;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const n = view.getUint32(entry + 4, little);
      const name = TAGS[tag];
      if (!name) continue;
      if (name === "exifPointer" || name === "gpsPointer") {
        out[name] = view.getUint32(entry + 8, little);
      } else if (type === 2) {
        const size = n * TYPE_SIZE[2];
        const start = size > 4 ? tiff + view.getUint32(entry + 8, little) : entry + 8;
        if (start + size > view.byteLength) continue;
        let text = "";
        for (let k = 0; k < size; k++) {
          const ch = view.getUint8(start + k);
          if (ch === 0) break;
          text += String.fromCharCode(ch);
        }
        out[name] = text.trim();
      }
    }
  }

  NS.readExif = function (buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

    let pos = 2;
    while (pos + 4 <= view.byteLength) {
      const marker = view.getUint16(pos);
      const length = view.getUint16(pos + 2);
      if ((marker & 0xff00) !== 0xff00) return null;
      // APP1 segment starting with "Exif\0\0"
      if (marker === 0xffe1 && view.getUint32(pos + 4) === 0x45786966) {
        const tiff = pos + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const raw = {};
        readIfd(view, tiff, tiff + view.getUint32(tiff + 4, little), little, raw);
        if (raw.exifPointer) readIfd(view, tiff, tiff + raw.exifPointer, little, raw);
        let hasGps = false;
        if (raw.gpsPointer && tiff + raw.gpsPointer + 2 <= view.byteLength) {
          // A GPS section with entries beyond the version tag means a location is stored.
          hasGps = view.getUint16(tiff + raw.gpsPointer, little) > 1;
        }
        return {
          location: hasGps,
          camera: [raw.make, raw.model].filter(Boolean).join(" "),
          taken: raw.taken || raw.modified || "",
          software: raw.software || "",
          other: [raw.artist && "author name", raw.copyright && "copyright notice"].filter(Boolean)
        };
      }
      if (marker === 0xffda) break; // image data starts: no EXIF before it
      pos += 2 + length;
    }
    return null;
  };
})();
