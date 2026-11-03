// Small helpers shared by the image editor and the signature maker.
(function () {
  "use strict";
  const NS = (window.ImageToolkit = window.ImageToolkit || {});

  // Browsers struggle with very large canvases (Safari's limit is about 16 MP),
  // so bigger images are refused with a clear message instead of failing oddly.
  NS.MAX_PIXELS = 16 * 1000 * 1000;

  NS.canvas = function (width, height) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
  };

  // Resolves with a Blob. Some browsers can't make WebP; they hand back PNG,
  // which the caller can detect from blob.type.
  NS.toBlob = function (canvas, type, quality) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be created."))), type, quality)
    );
  };

  NS.download = function (blob, name) {
    const link = document.createElement("a");
    link.download = name;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  };

  NS.sizeText = function (bytes) {
    if (bytes < 1024) return bytes + " bytes";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  // Opens an image file as something drawable. Rejects with a readable message.
  NS.openImage = async function (file) {
    const name = file.name.toLowerCase();
    if (/\.(heic|heif)$/.test(name) || /heic|heif/.test(file.type)) {
      throw new Error("HEIC photos (the iPhone default) can't be opened in most browsers. On the iPhone, share the photo and choose “Save as JPEG”, or set Camera › Formats to “Most Compatible”.");
    }
    if (file.type && !file.type.startsWith("image/")) throw new Error("That file isn't an image.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      throw new Error("That image couldn't be opened. It may be damaged, or a format this browser can't read.");
    }
    if (bitmap.width * bitmap.height > NS.MAX_PIXELS) {
      const mp = Math.round((bitmap.width * bitmap.height) / 1e6);
      bitmap.close();
      throw new Error("That image is " + mp + " megapixels, more than browsers handle reliably (16). Shrink it with another app first.");
    }
    return bitmap;
  };

  // Crops a canvas to its non-transparent pixels, plus padding. Null if it's empty.
  NS.trim = function (source, padding) {
    const ctx = source.getContext("2d", { willReadFrequently: true });
    const { width, height } = source;
    const data = ctx.getImageData(0, 0, width, height).data;
    let top = height, left = width, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) return null;
    const pad = padding || 0;
    const out = NS.canvas(right - left + 1 + pad * 2, bottom - top + 1 + pad * 2);
    out.getContext("2d").drawImage(source, left, top, right - left + 1, bottom - top + 1, pad, pad, right - left + 1, bottom - top + 1);
    return out;
  };
})();
