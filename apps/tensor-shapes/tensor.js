// The tensor model and the shape helpers every operation uses. No page layout here.
//
// A tensor here has no values, only:
//   shape    [8, 3, 32, 32]
//   dims     one object per dimension: { label, color } shared between tensors,
//            so a dimension keeps its color when it moves (permute, reshape...)
//   lib      "torch" or "numpy": the rules differ in places
//   strides  memory layout in elements (PyTorch only), to know when .view() fails
(function () {
  "use strict";
  const TS = (window.TS = window.TS || {});

  TS.PALETTE_SIZE = 6;
  let nextColor = 0;
  TS.resetColors = () => (nextColor = 0);
  // A new dimension. label "" = unnamed (shown by its size). color -1 = grey (size-1 dims).
  TS.dim = (label, neutral) => ({ label: label || "", color: neutral ? -1 : nextColor++ % TS.PALETTE_SIZE });

  TS.contiguous = (shape) => {
    const s = new Array(shape.length);
    let acc = 1;
    for (let i = shape.length - 1; i >= 0; i--) {
      s[i] = acc;
      acc *= Math.max(shape[i], 1);
    }
    return s;
  };

  let uid = 0;
  TS.tensor = function (shape, dims, lib, strides) {
    dims = dims ? dims.slice() : shape.map((n) => TS.dim("", n === 1));
    // A grey (size-1) dimension that grew gets its own color.
    dims.forEach((d, i) => {
      if (d.color < 0 && shape[i] !== 1) dims[i] = TS.dim(d.label);
    });
    // uid: the order tensors were made in (inputs always come before their results).
    return { kind: "tensor", uid: ++uid, shape: shape.slice(), dims, lib, strides: strides || TS.contiguous(shape), name: "", layoutBy: "" };
  };
  TS.isTensor = (v) => v && v.kind === "tensor";
  TS.numel = (shape) => shape.reduce((a, b) => a * b, 1);
  TS.shapeText = (shape) => "(" + shape.join(", ") + (shape.length === 1 ? "," : "") + ")";
  // How dims read in messages: "C (3)" or just "3".
  TS.dimText = (t, i) => (t.dims[i].label ? t.dims[i].label + " = " + t.shape[i] : "size " + t.shape[i]);

  TS.libName = (lib) => (lib === "numpy" ? "NumPy" : lib === "python" ? "Python" : "PyTorch");

  // A shape error: what went wrong in plain words, and the library's own message.
  TS.fail = function (plain, real, lib) {
    const e = new TS.Error(plain);
    e.real = real ? TS.libName(lib) + " would say: " + real : "";
    throw e;
  };

  // A dimension index, allowing negatives. `extra` = 1 for ops that add a dim (unsqueeze, stack).
  TS.normDim = function (d, ndim, lib, extra) {
    const n = ndim + (extra || 0);
    if (!Number.isInteger(d)) TS.fail("The dimension must be a whole number, not " + JSON.stringify(d) + ".", "", lib);
    if (d < -n || d >= n) {
      TS.fail(
        "There's no dimension " + d + ": this " + (extra ? "operation accepts" : "tensor has " + ndim + " dimension" + (ndim === 1 ? "" : "s") + ", so it accepts") + " " + (n ? -n + " to " + (n - 1) : "none") + ".",
        lib === "numpy" ? "axis " + d + " is out of bounds for array of dimension " + n : "Dimension out of range (expected to be in range of [" + -Math.max(n, 1) + ", " + (Math.max(n, 1) - 1) + "], but got " + d + ")",
        lib
      );
    }
    return d < 0 ? d + n : d;
  };

  // Broadcasting: align shapes on the right; each size must match or be 1.
  TS.broadcast = function (tensors, lib) {
    const nd = Math.max(...tensors.map((t) => t.shape.length));
    const shape = [], dims = [];
    for (let k = 0; k < nd; k++) {
      let size = 1, dim = null;
      for (const t of tensors) {
        const i = t.shape.length - nd + k;
        if (i < 0) continue;
        const n = t.shape[i];
        if (n !== 1) {
          if (size !== 1 && n !== size) {
            const a = tensors.find((x) => x.shape.length - nd + k >= 0 && x.shape[x.shape.length - nd + k] !== 1);
            TS.fail(
              "These shapes can't be broadcast together: lined up from the right, one has " + size + " and another has " + n + " in the same position, and neither is 1. " +
                tensors.map((x) => TS.shapeText(x.shape)).join(" and ") + ".",
              lib === "numpy"
                ? "operands could not be broadcast together with shapes " + tensors.map((x) => TS.shapeText(x.shape).replace(/ /g, "")).join(" ")
                : "The size of tensor a (" + a.shape[a.shape.length - nd + k] + ") must match the size of tensor b (" + n + ") at non-singleton dimension " + k,
              lib
            );
          }
          if (size === 1) {
            size = n;
            dim = t.dims[i];
          }
        } else if (!dim) dim = t.dims[i];
      }
      shape.push(size);
      dims.push(dim || TS.dim("", true));
    }
    return TS.tensor(shape, dims, lib);
  };

  // Which dims survive a reshape: walks both shapes in blocks whose sizes multiply
  // to the same number. One-to-one keeps the dim; merged dims get a joint label.
  TS.reshapeDims = function (from, newShape) {
    const old = from.shape, out = new Array(newShape.length);
    let i = 0, j = 0;
    while (i < old.length || j < newShape.length) {
      const i0 = i, j0 = j;
      let po = i < old.length ? old[i++] : 1;
      let pn = j < newShape.length ? newShape[j++] : 1;
      while (po !== pn) {
        if (po < pn && i < old.length) po *= old[i++];
        else if (pn < po && j < newShape.length) pn *= newShape[j++];
        else break;
      }
      // Trailing 1s belong to this block too.
      while (i < old.length && old[i] === 1 && (j >= newShape.length || newShape[j] !== 1)) i++;
      while (j < newShape.length && newShape[j] === 1 && (i >= old.length || old[i] !== 1)) j++;
      const O = [];
      for (let a = i0; a < i; a++) if (old[a] !== 1) O.push(a);
      const N = [];
      for (let b = j0; b < j; b++) {
        if (newShape[b] === 1) out[b] = TS.dim("", true);
        else N.push(b);
      }
      const label = (a) => from.dims[a].label || String(old[a]);
      if (O.length === 1 && N.length === 1) out[N[0]] = from.dims[O[0]];
      else if (N.length === 1) out[N[0]] = TS.dim(O.map(label).join("·"));
      else N.forEach((b, k) => (out[b] = TS.dim(O.length === 1 && from.dims[O[0]].label ? from.dims[O[0]].label + (k + 1) : "")));
    }
    return out;
  };

  // Port of PyTorch's computeStride: the strides a view would have, or null when
  // the memory layout can't be viewed with this shape (then .view() raises).
  TS.viewStrides = function (oldShape, oldStrides, newShape) {
    if (!oldShape.length) return TS.contiguous(newShape);
    if (TS.numel(oldShape) === 0) return TS.contiguous(newShape);
    const newStrides = new Array(newShape.length);
    let viewD = newShape.length - 1;
    let chunkBase = oldStrides[oldStrides.length - 1];
    let tensorNumel = 1, viewNumel = 1;
    for (let d = oldShape.length - 1; d >= 0; d--) {
      tensorNumel *= oldShape[d];
      if (d === 0 || (oldShape[d - 1] !== 1 && oldStrides[d - 1] !== tensorNumel * chunkBase)) {
        while (viewD >= 0 && (viewNumel < tensorNumel || newShape[viewD] === 1)) {
          newStrides[viewD] = viewNumel * chunkBase;
          viewNumel *= newShape[viewD];
          viewD--;
        }
        if (viewNumel !== tensorNumel) return null;
        if (d > 0) {
          chunkBase = oldStrides[d - 1];
          tensorNumel = 1;
          viewNumel = 1;
        }
      }
    }
    return viewD === -1 ? newStrides : null;
  };
  // Where each element of a result comes from, so the page can show elements moving.
  // out.src = [{ t: input, map(outIndex) -> inputIndex, partial }]
  //   partial: some positions come from another input (cat, stack); map returns null there.
  //   Otherwise every position uses this input (with broadcasting, also the others).
  TS.ravel = (idx, shape) => idx.reduce((acc, v, k) => acc * shape[k] + v, 0);
  TS.unravel = (lin, shape) => {
    const r = new Array(shape.length);
    for (let k = shape.length - 1; k >= 0; k--) {
      r[k] = lin % shape[k];
      lin = Math.floor(lin / shape[k]);
    }
    return r;
  };
  TS.link = (out, t, map, partial) => {
    if (TS.isTensor(t)) (out.src = out.src || []).push({ t, map, partial: !!partial });
    return out;
  };
  // Reshapes read and write elements in row-major order (the last index changes fastest).
  TS.linkReshape = (out, t) => TS.link(out, t, (idx) => TS.unravel(TS.ravel(idx, out.shape), t.shape));
  // Broadcasting: lined up from the right; a size-1 dimension always reads index 0.
  TS.linkBroadcast = (out, t) => {
    const lead = out.shape.length - t.shape.length;
    return TS.link(out, t, (idx) => t.shape.map((n, i) => (n === 1 ? 0 : idx[i + lead])));
  };
  // Each element from the element at the same place.
  TS.linkSame = (out, t) => TS.link(out, t, (idx) => idx.slice());

  // Many elements feeding one (sums, matmul, conv…): map(outIndex) -> a box, one entry per
  // input dimension: a number, or [lo, hi] for a whole range (inclusive). null = none.
  // approx: the box is a safe overestimate (the exact elements depend on the values).
  TS.dep = (out, t, map, approx) => {
    if (TS.isTensor(t)) (out.src = out.src || []).push({ t, map, mixes: true, approx: !!approx });
    return out;
  };
  TS.ALL = (n) => [0, n - 1];
  // Same shape; every element along `dims` (positions in t) feeds each one (softmax, sort, norms).
  TS.depAlong = (out, t, dims, approx) => TS.dep(out, t, (idx) => idx.map((v, i) => (dims.includes(i) ? TS.ALL(t.shape[i]) : v)), approx);
  // Every element feeds every element (a loss, a determinant of one matrix…).
  TS.depAll = (out, t, approx) => TS.dep(out, t, () => t.shape.map(TS.ALL), approx);
  // Batch dims lined up from the right, like broadcasting: out positions [from, from + count).
  TS.alignBatch = (idx, t, count, from) => t.shape.slice(0, count).map((n, i) => (n === 1 ? 0 : idx[from + i]));

  TS.isContiguous = (t) => {
    const c = TS.contiguous(t.shape);
    return t.shape.every((n, i) => n === 1 || t.strides[i] === c[i]);
  };
})();
