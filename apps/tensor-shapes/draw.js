// Draws a tensor's shape as SVG. Shape only: no values.
//
//   TS.draw(t, width, paint, marks) -> { svg: "<svg…>", note: "", hidden, pick(x, y) }
//     width: the room available, in pixels
//     paint: optional (index) -> CSS color or null, to color the elements one by one
//     marks: optional [{ cls, set: Set of flat indexes, boxes: [box] }] to highlight (a trace).
//            A box face is see-through for marks: a marked cell means "here or behind it".
//     hidden: how many marked elements are in boxes not drawn (behind the "…")
//     pick(x, y): the element under a point of the drawing (in its own units), or null
//
// 0D a dot · 1D a bar · 2D a grid · 3D a box (a stack of grids going back)
// 4D a row of boxes · 5D rows of boxes · more: the last 5 dims, with a note.
// Lengths grow with the logarithm of the size so 1024 still fits next to 3.
// Each dimension's edge and label use its color (CSS classes d0–d5, dn = size 1).
(function () {
  "use strict";
  const TS = window.TS;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const len = (n) => (n <= 1 ? 10 : Math.min(240, 10 + 24 * Math.log2(n)));
  const cls = (d) => (d.color < 0 ? "dn" : "d" + d.color);
  const label = (t, i) => (t.dims[i].label && t.dims[i].label !== String(t.shape[i]) ? t.dims[i].label + " = " : "") + t.shape[i].toLocaleString("en-US");
  const textWidth = (s) => s.length * 7 + 4;
  const r1 = (v) => Math.round(v * 10) / 10;

  // A color per index along a followed dimension: a sweep of hues, so order reads too.
  TS.indexColor = (v, n) => "hsl(" + Math.round((210 + (300 * v) / Math.max(n - 1, 1)) % 360) + " 68% 52%)";

  // Painting samples at most this many cells per edge, so big sizes stay quick.
  const MAX_CELLS = 24, MAX_DEPTH = 12;
  const sample = (k, R, n) => Math.min(n - 1, Math.floor(((k + 0.5) * n) / R));
  // Cells along one run (k = 0..R-1) with the same color become one shape.
  function runs(R, colorAt, shape, out) {
    let k0 = 0, c0 = colorAt(0);
    for (let k = 1; k <= R; k++) {
      const c = k < R ? colorAt(k) : undefined;
      if (c === c0) continue;
      if (c0) out.push(shape(k0 / R, k / R, c0));
      k0 = k;
      c0 = c;
    }
  }
  const ptsText = (pts) => pts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ");
  // The corners of one cell of the top face (u across, v going back) or the side face (t down, v going back).
  const topCell = (fx, fy, w, dx, dy, u0, u1, v0, v1) => [[fx + u0 * w + v0 * dx, fy - v0 * dy], [fx + u1 * w + v0 * dx, fy - v0 * dy], [fx + u1 * w + v1 * dx, fy - v1 * dy], [fx + u0 * w + v1 * dx, fy - v1 * dy]];
  const sideCell = (fx, fy, w, h, dx, dy, t0, t1, v0, v1) => [[fx + w + v0 * dx, fy + t0 * h - v0 * dy], [fx + w + v1 * dx, fy + t0 * h - v1 * dy], [fx + w + v1 * dx, fy + t1 * h - v1 * dy], [fx + w + v0 * dx, fy + t1 * h - v0 * dy]];
  const poly = (pts, color, face) => `<polygon class="paint paint--${face}" fill="${color}" points="${pts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}"/>`;

  // One block for the last 1–3 dims. Returns its size and a draw(x, y, withLabels) function.
  function block(t, first, s) {
    const rank = t.shape.length - first;
    const at = (k) => first + k; // position in t of the block's k-th dim
    const c = t.shape[at(rank - 1)];
    const r = rank >= 2 ? t.shape[at(rank - 2)] : null;
    const d = rank === 3 ? t.shape[at(0)] : null;
    const w = len(c) * s, h = (r === null ? 16 : len(r)) * s;
    const dp = d === null ? 0 : len(d) * 0.5 * s;
    const dx = dp * 0.85, dy = dp * 0.55;
    const ci = at(rank - 1), ri = r === null ? -1 : at(rank - 2), di = d === null ? -1 : at(0);
    return {
      w: w + dx, h: h + dy, frontW: w, dx, dy,
      leftLabel: ri >= 0 ? textWidth(label(t, ri)) : 0,
      rightLabel: di >= 0 ? textWidth(label(t, di)) : 0,
      // prefix: the indexes of the outer dims for this block. paint: see TS.draw.
      // marks: [{ cls, front, top, side }] cell numbers to highlight. geo: collects the faces, for pick().
      draw(x, y, withLabels, prefix, paint, marks, geo) {
        const o = [];
        const fx = x, fy = y + dy;
        const empty = c === 0 || r === 0 || d === 0;
        const dash = empty ? ' stroke-dasharray="4 3"' : "";
        if (empty) paint = null;
        const R = r === null ? 1 : Math.min(r, MAX_CELLS), C = Math.min(c, MAX_CELLS), D = d === null ? 1 : Math.min(d, MAX_DEPTH);
        // The color of the element at (depth, row, column), each a sampled cell number.
        if (geo && !empty) geo.push({ fx, fy, w, h, dx, dy, prefix, R, C, D, r, c, d });
        const colorOf = (kz, ky, kx) => paint(prefix.concat(d === null ? [] : [sample(kz, D, d)], r === null ? [] : [sample(ky, R, r)], [sample(kx, C, c)])) || "";
        if (dp) {
          const topPts = [[fx, fy], [fx + dx, y], [fx + w + dx, y], [fx + w, fy]];
          const sidePts = [[fx + w, fy], [fx + w + dx, y], [fx + w + dx, y + h], [fx + w, fy + h]];
          o.push(`<polygon class="face top" points="${topPts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}"${dash}/>`);
          o.push(`<polygon class="face side" points="${sidePts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}"${dash}/>`);
          if (paint) {
            // Top face: the first row, every column, going back. Side face: the last column.
            for (let kz = 0; kz < D; kz++) {
              const v0 = kz / D, v1 = (kz + 1) / D;
              runs(C, (kx) => colorOf(kz, 0, kx), (u0, u1, col) => poly([[fx + u0 * w + v0 * dx, fy - v0 * dy], [fx + u1 * w + v0 * dx, fy - v0 * dy], [fx + u1 * w + v1 * dx, fy - v1 * dy], [fx + u0 * w + v1 * dx, fy - v1 * dy]], col, "top"), o);
              runs(R, (ky) => colorOf(kz, ky, C - 1), (t0, t1, col) => poly([[fx + w + v0 * dx, fy + t0 * h - v0 * dy], [fx + w + v1 * dx, fy + t0 * h - v1 * dy], [fx + w + v1 * dx, fy + t1 * h - v1 * dy], [fx + w + v0 * dx, fy + t1 * h - v0 * dy]], col, "side"), o);
            }
            o.push(`<polygon class="outline" points="${topPts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}"/>`);
            o.push(`<polygon class="outline" points="${sidePts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ")}"/>`);
          }
          for (const m of marks || []) {
            for (const k of m.top) {
              const kz = Math.floor(k / C), kx = k % C;
              o.push(`<polygon class="mark mark--${m.cls} mark--top" points="${ptsText(topCell(fx, fy, w, dx, dy, kx / C, (kx + 1) / C, kz / D, (kz + 1) / D))}"/>`);
            }
            for (const k of m.side) {
              const kz = Math.floor(k / R), ky = k % R;
              o.push(`<polygon class="mark mark--${m.cls} mark--side" points="${ptsText(sideCell(fx, fy, w, h, dx, dy, ky / R, (ky + 1) / R, kz / D, (kz + 1) / D))}"/>`);
            }
          }
          // Slices going back: one grid per entry of the depth dimension.
          if (d > 1 && d <= 32 && dp / d >= 2.5) {
            for (let k = 1; k < d; k++) {
              const ox = (dx * k) / d, oy = (dy * k) / d;
              o.push(`<path class="grid" d="M${r1(fx + ox)},${r1(fy - oy)} H${r1(fx + w + ox)} V${r1(fy - oy + h)}"/>`);
            }
          }
        }
        o.push(`<rect class="face front" x="${r1(fx)}" y="${r1(fy)}" width="${r1(w)}" height="${r1(h)}"${dash}/>`);
        if (paint) {
          // Front face: the first slice of depth.
          for (let ky = 0; ky < R; ky++) {
            runs(C, (kx) => colorOf(0, ky, kx), (u0, u1, col) => `<rect class="paint" fill="${col}" x="${r1(fx + u0 * w)}" y="${r1(fy + (ky * h) / R)}" width="${r1((u1 - u0) * w)}" height="${r1(h / R)}"/>`, o);
          }
          o.push(`<rect class="outline" x="${r1(fx)}" y="${r1(fy)}" width="${r1(w)}" height="${r1(h)}"/>`);
        }
        for (const m of marks || []) {
          for (const k of m.front) {
            const ky = Math.floor(k / C), kx = k % C;
            o.push(`<rect class="mark mark--${m.cls}" x="${r1(fx + (kx * w) / C)}" y="${r1(fy + (ky * h) / R)}" width="${r1(w / C)}" height="${r1(h / R)}"/>`);
          }
        }
        if (c > 1 && c <= 48 && w / c >= 3) for (let k = 1; k < c; k++) o.push(`<path class="grid" d="M${r1(fx + (w * k) / c)},${r1(fy)} v${r1(h)}"/>`);
        if (r > 1 && r <= 48 && h / r >= 3) for (let k = 1; k < r; k++) o.push(`<path class="grid" d="M${r1(fx)},${r1(fy + (h * k) / r)} h${r1(w)}"/>`);
        if (!withLabels) return o.join("");
        // Colored edges: bottom = last dim, left = second-to-last, the edge going back = third-to-last.
        o.push(`<path class="edge ${cls(t.dims[ci])}" d="M${r1(fx)},${r1(fy + h)} h${r1(w)}"/>`);
        o.push(`<text class="lbl ${cls(t.dims[ci])}" x="${r1(fx + w / 2)}" y="${r1(fy + h + 16)}" text-anchor="middle">${esc(label(t, ci))}</text>`);
        if (ri >= 0) {
          o.push(`<path class="edge ${cls(t.dims[ri])}" d="M${r1(fx)},${r1(fy)} v${r1(h)}"/>`);
          o.push(`<text class="lbl ${cls(t.dims[ri])}" x="${r1(fx - 6)}" y="${r1(fy + h / 2 + 4)}" text-anchor="end">${esc(label(t, ri))}</text>`);
        }
        if (di >= 0) {
          o.push(`<path class="edge ${cls(t.dims[di])}" d="M${r1(fx + w)},${r1(fy)} L${r1(fx + w + dx)},${r1(y)}"/>`);
          o.push(`<text class="lbl ${cls(t.dims[di])}" x="${r1(fx + w + dx)}" y="${r1(y - 6)}" text-anchor="middle">${esc(label(t, di))}</text>`);
        }
        return o.join("");
      }
    };
  }

  // Which entries of an outer dimension to draw: all if few, else the first few, "…", the last.
  const pick = (n, max) => (n <= max ? Array.from({ length: n }, (_, i) => i) : [...Array.from({ length: max - 1 }, (_, i) => i), -1, n - 1]);

  // Marked elements, projected onto the cells each drawn block shows:
  // front = (row, column) through the depth, top = (depth, column) through the rows,
  // side = (depth, row) through the columns. Returns { blocks: Map(prefix -> marks), hidden }.
  function project(t, marks, first, skip, rows, cols, across) {
    const nd = t.shape.length, rank = nd - first;
    const c = t.shape[nd - 1], r = rank >= 2 ? t.shape[nd - 2] : null, d = rank === 3 ? t.shape[first] : null;
    const R = r === null ? 1 : Math.min(r, MAX_CELLS), C = Math.min(c, MAX_CELLS), D = d === null ? 1 : Math.min(d, MAX_DEPTH);
    const cell = (v, K, n) => Math.min(K - 1, Math.floor((v * K) / n));
    const drawnRows = new Set(rows.filter((v) => v >= 0)), drawnCols = new Set(cols.filter((v) => v >= 0));
    const drawnPrefixes = [];
    for (const ri of rows) for (const ci of cols) {
      if (ri < 0 || ci < 0) continue;
      const p = Array(skip).fill(0);
      for (let i = skip; i < first; i++) p.push(i === across ? ci : ri);
      drawnPrefixes.push(p);
    }
    const blocks = new Map();
    let hidden = 0;
    const slot = (key, cls) => {
      if (!blocks.has(key)) blocks.set(key, []);
      let m = blocks.get(key).find((x) => x.cls === cls);
      if (!m) blocks.get(key).push((m = { cls, front: new Set(), top: new Set(), side: new Set() }));
      return m;
    };
    const visible = (p) => p.every((v, i) => (i < skip ? v === 0 : i === across ? drawnCols.has(v) : drawnRows.has(v)));
    for (const mk of marks) {
      for (const f of mk.set || []) {
        const idx = TS.unravel(f, t.shape), p = idx.slice(0, first);
        if (!visible(p)) {
          hidden++;
          continue;
        }
        const m = slot(p.join(","), mk.cls);
        const x = cell(idx[nd - 1], C, c), y = r === null ? 0 : cell(idx[nd - 2], R, r), z = d === null ? 0 : cell(idx[first], D, d);
        m.front.add(y * C + x);
        m.top.add(z * C + x);
        m.side.add(z * R + y);
      }
      for (const box of mk.boxes || []) {
        const rg = box.map((e) => (typeof e === "number" ? [e, e] : e));
        const local = rg.slice(first), localVol = local.reduce((a, lh) => a * (lh[1] - lh[0] + 1), 1);
        const span = (lh, K, n) => [cell(lh[0], K, n), cell(lh[1], K, n)];
        let shownBlocks = 0;
        for (const p of drawnPrefixes) {
          if (!p.every((v, i) => v >= rg[i][0] && v <= rg[i][1])) continue;
          shownBlocks++;
          const m = slot(p.join(","), mk.cls);
          const [x0, x1] = span(local[local.length - 1], C, c);
          const [y0, y1] = r === null ? [0, 0] : span(local[local.length - 2], R, r);
          const [z0, z1] = d === null ? [0, 0] : span(local[0], D, d);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.front.add(y * C + x);
          for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) m.top.add(z * C + x);
            for (let y = y0; y <= y1; y++) m.side.add(z * R + y);
          }
        }
        hidden += rg.reduce((a, lh) => a * (lh[1] - lh[0] + 1), 1) - shownBlocks * localVol;
      }
    }
    return { blocks, hidden };
  }

  // The element under point (px, py), from the faces drawn. Big sizes pick the cell's middle element.
  function pickFrom(geo, px, py) {
    for (const g of geo) {
      const at = (z, y, x) => g.prefix.concat(g.d === null ? [] : [z], g.r === null ? [] : [y], [x]);
      if (px >= g.fx && px <= g.fx + g.w && py >= g.fy && py <= g.fy + g.h) {
        const kx = Math.min(g.C - 1, Math.floor(((px - g.fx) / g.w) * g.C)), ky = Math.min(g.R - 1, Math.floor(((py - g.fy) / g.h) * g.R));
        return at(0, sample(ky, g.R, g.r || 1), sample(kx, g.C, g.c));
      }
      if (!g.dy) continue;
      // Top face: v going back, u across.
      let v = (g.fy - py) / g.dy, u = (px - g.fx - v * g.dx) / g.w;
      if (v >= 0 && v <= 1 && u >= 0 && u <= 1) return at(sample(Math.min(g.D - 1, Math.floor(v * g.D)), g.D, g.d), 0, sample(Math.min(g.C - 1, Math.floor(u * g.C)), g.C, g.c));
      // Side face: v going back, t down.
      v = (px - g.fx - g.w) / g.dx;
      const tt = (py - g.fy + v * g.dy) / g.h;
      if (v >= 0 && v <= 1 && tt >= 0 && tt <= 1) return at(sample(Math.min(g.D - 1, Math.floor(v * g.D)), g.D, g.d), sample(Math.min(g.R - 1, Math.floor(tt * g.R)), g.R, g.r), g.c - 1);
    }
    return null;
  }

  TS.draw = function (t, width, paint, marks) {
    const room = Math.max(260, Math.min(620, (width || 620) - 40));
    const nd = t.shape.length;
    if (nd === 0) {
      const m = (marks || []).find((x) => (x.set && x.set.size) || (x.boxes && x.boxes.length));
      return { svg: `<svg viewBox="0 0 120 40" width="120" height="40" class="tensor-svg" role="img" aria-label="A single number (0D)"><rect class="face front${m ? " mark mark--" + m.cls : ""}" x="8" y="8" width="20" height="20" rx="3"/><text class="lbl dn" x="36" y="23">one number</text></svg>`, note: "", hidden: 0, pick: () => [] };
    }
    const skip = Math.max(0, nd - 5);
    const first = Math.max(skip, nd - 3); // where the block's dims start
    const outer = []; // [rowsDim, colsDim] positions among the drawn outer dims
    for (let i = skip; i < first; i++) outer.push(i);
    const across = outer.length ? outer[outer.length - 1] : -1;
    const down = outer.length === 2 ? outer[0] : -1;
    const cols = across >= 0 ? pick(t.shape[across], room < 480 ? 3 : 4) : [0];
    const rows = down >= 0 ? pick(t.shape[down], 3) : [0];

    // Fit the widest row into the room there is.
    let s = 1, b = block(t, first, 1);
    const gap = 14, dots = 26;
    const rowWidth = (bb) => cols.reduce((acc, k, i) => acc + (k < 0 ? dots : bb.w) + (i ? gap : 0), 0);
    if (rowWidth(b) > room) {
      s = room / rowWidth(b);
      b = block(t, first, s);
    }
    const capH = across >= 0 ? 16 : 0; // index captions under each block
    const left = 10 + Math.max(b.leftLabel, down >= 0 ? textWidth(label(t, down)) + 18 : 0);
    const top = first < nd - 2 ? 22 : 8; // room for the depth label above a box
    const rowH = b.h + 22 + capH;
    const W = left + rowWidth(b) + Math.max(b.rightLabel / 2 + 4, 12);
    const parts = [], geo = [];
    const shown = marks && marks.length ? project(t, marks, first, skip, rows, cols, across) : null;
    let y = top;
    rows.forEach((ri, rIdx) => {
      if (ri < 0) {
        parts.push(`<text class="dots" x="${r1(left + rowWidth(b) / 2)}" y="${r1(y + 14)}" text-anchor="middle">⋮</text>`);
        y += 24;
        return;
      }
      let x = left;
      cols.forEach((ci, cIdx) => {
        if (cIdx) x += gap;
        if (ci < 0) {
          parts.push(`<text class="dots" x="${r1(x + dots / 2)}" y="${r1(y + b.dy + (b.h - b.dy) / 2 + 5)}" text-anchor="middle">…</text>`);
          x += dots;
          return;
        }
        // Outer indexes: the skipped dims (6D and up) are drawn at index 0.
        const prefix = Array(skip).fill(0);
        for (let i = skip; i < first; i++) prefix.push(i === across ? ci : ri);
        parts.push(b.draw(x, y, rIdx === 0 && cIdx === 0, prefix, paint || null, shown && shown.blocks.get(prefix.join(",")), geo));
        if (across >= 0) parts.push(`<text class="idx" x="${r1(x + b.frontW / 2)}" y="${r1(y + b.h + 20 + (rIdx === 0 && cIdx === 0 ? 14 : 0))}" text-anchor="middle">${down >= 0 ? (ri < 0 ? "" : ri + ",") : ""}${ci}</text>`);
        x += b.w;
      });
      y += rowH + (rIdx === 0 ? 14 : 0);
    });
    // Brackets for the outer dims: under the row, and down the left side.
    if (across >= 0) {
      const by = y - 2;
      parts.push(`<path class="edge ${cls(t.dims[across])}" d="M${r1(left)},${r1(by - 6)} v6 H${r1(left + rowWidth(b))} v-6"/>`);
      parts.push(`<text class="lbl ${cls(t.dims[across])}" x="${r1(left + rowWidth(b) / 2)}" y="${r1(by + 16)}" text-anchor="middle">${esc(label(t, across))}</text>`);
      y += 22;
    }
    if (down >= 0) {
      const bx = left - 10;
      parts.push(`<path class="edge ${cls(t.dims[down])}" d="M${r1(bx + 6)},${r1(top)} h-6 V${r1(y - 40)} h6"/>`);
      parts.push(`<text class="lbl ${cls(t.dims[down])}" x="${r1(bx - 6)}" y="${r1((top + y - 40) / 2 + 4)}" text-anchor="end">${esc(label(t, down))}</text>`);
    }
    const H = y + 6;
    const desc = "Shape " + TS.shapeText(t.shape);
    const svg = `<svg viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" class="tensor-svg" role="img" aria-label="${esc(desc)}" width="${Math.ceil(W)}" height="${Math.ceil(H)}">${parts.join("")}</svg>`;
    const note = skip ? "Drawn: the last 5 dimensions. The first " + skip + " (" + t.shape.slice(0, skip).join(" × ") + ") would repeat this whole picture " + TS.numel(t.shape.slice(0, skip)).toLocaleString("en-US") + " times." : "";
    return { svg, note, hidden: shown ? shown.hidden : 0, pick: (px, py) => pickFrom(geo, px, py), width: Math.ceil(W), height: Math.ceil(H) };
  };
})();
