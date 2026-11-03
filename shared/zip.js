// Reading and writing .zip files in the browser, for any tool that needs it.
// (.docx and .xlsx files are zip archives too.)
//
//   Zip.make([{ name, data: Uint8Array }])  -> Blob   files stored as-is, no compression
//   await Zip.read(arrayBuffer)              -> Map of name -> async () => Uint8Array
//
// Zip.read rejects with Zip.NOT_A_ZIP for anything it can't read, so callers
// can show their own message. Reading compressed entries needs
// DecompressionStream (all current browsers); Zip.canRead() says if it's there.
(function () {
  "use strict";

  const NOT_A_ZIP = "not-a-zip";

  // ---------- Writing ----------

  const CRC_TABLE = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Date and time in the old MS-DOS format zip files use.
  function dosDateTime(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function make(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const crc = crc32(file.data);
      const size = file.data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // names are UTF-8
      local.setUint16(8, 0, true); // stored, no compression
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(local, name, file.data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); // central directory header
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);

      offset += 30 + name.length + size;
    }

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }

  // ---------- Reading ----------

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function read(buffer) {
    const view = new DataView(buffer);

    // The "end of central directory" record sits in the last 64 KB of the file.
    let end = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end === -1) throw new Error(NOT_A_ZIP);

    const entries = new Map();
    const count = view.getUint16(end + 10, true);
    let pos = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();

    try {
      for (let n = 0; n < count; n++) {
        if (view.getUint32(pos, true) !== 0x02014b50) break;
        const method = view.getUint16(pos + 10, true);
        const size = view.getUint32(pos + 20, true);
        const nameLength = view.getUint16(pos + 28, true);
        const extraLength = view.getUint16(pos + 30, true);
        const commentLength = view.getUint16(pos + 32, true);
        const offset = view.getUint32(pos + 42, true);
        const name = decoder.decode(new Uint8Array(buffer, pos + 46, nameLength));

        entries.set(name, async () => {
          const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
          const data = new Uint8Array(buffer, start, size);
          if (method === 0) return data;
          if (method === 8) return inflateRaw(data);
          throw new Error(NOT_A_ZIP);
        });
        pos += 46 + nameLength + extraLength + commentLength;
      }
    } catch (e) {
      throw new Error(NOT_A_ZIP);
    }
    return entries;
  }

  window.Zip = {
    NOT_A_ZIP,
    make,
    read,
    canRead: () => typeof DecompressionStream !== "undefined"
  };
})();
