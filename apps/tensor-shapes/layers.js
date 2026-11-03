// torch.nn layers and their torch.nn.functional versions. No page layout here.
//
// nn.Conv2d(3, 16, 3) returns a layer { kind: "layer", type, attrs, forward(ctx, inputs) }.
// Calling it on a tensor runs forward(). nn.Sequential holds layers in .children
// and the evaluator runs them one by one so each shows as its own step.
(function () {
  "use strict";
  const TS = window.TS;
  const { fail, tensor, dim, isTensor, shapeText, numel, normDim, isInt, args, asTensor, dimName } = TS;
  const FN = TS.FN, M = TS.METHOD;
  const NN = "torch.nn.", F = "torch.nn.functional.";

  // An int or a tuple of n ints: kernel_size=3 → [3, 3].
  function tup(v, n, what) {
    const a = Array.isArray(v) ? v.slice() : Array(n).fill(v);
    if (a.length !== n || !a.every(isInt)) fail(what + " must be a whole number or " + n + " of them; got " + TS.show(v) + ".", "", "torch");
    return a.map(Number);
  }
  const layer = (type, attrs, forward) => ({ kind: "layer", type, attrs, forward, label: type });
  const param = (shape, labels) => tensor(shape, shape.map((n, i) => dim(labels[i] || "", n === 1)), "torch");
  const input = (inputs, type) => {
    const t = inputs[0];
    if (!isTensor(t)) fail(type + " needs a tensor as input, not " + TS.show(t) + ".", "", "torch");
    if (t.lib === "numpy") fail(type + " is a PyTorch layer; it needs a tensor, not a NumPy array. Convert with torch.from_numpy(a).float().", "", "torch");
    return t;
  };

  // Conv and pooling take (N, C, *spatial) or, without a batch, (C, *spatial).
  const SPATIAL = { 1: "L", 2: "H, W", 3: "D, H, W" };
  function channelAt(t, n, what) {
    const nd = t.shape.length;
    if (nd !== n + 1 && nd !== n + 2) {
      fail(
        what + " expects " + (n + 2) + "D input (N, C, " + SPATIAL[n] + ") or " + (n + 1) + "D without a batch (C, " + SPATIAL[n] + "), but got " + nd + "D " + shapeText(t.shape) + "." + (nd === n ? " Add the channel dimension with .unsqueeze(0)." : ""),
        /^conv/.test(what) ? "Expected " + (n + 1) + "D (unbatched) or " + (n + 2) + "D (batched) input to " + what + ", but got input of size: [" + t.shape.join(", ") + "]" : "",
        "torch"
      );
    }
    return nd - n - 1;
  }
  // Output length of one spatial dimension, with the formula for the note.
  function slide(L, k, s, p, d, opts) {
    const eff = d * (k - 1) + 1;
    if (opts.transposed) {
      const out = (L - 1) * s - 2 * p + d * (k - 1) + opts.outPad + 1;
      return { out, text: "(" + L + " − 1)×" + s + " − 2×" + p + " + " + (d === 1 ? "" : d + "×") + "(" + k + " − 1)" + (opts.outPad ? " + " + opts.outPad : "") + " + 1 = " + out };
    }
    const raw = (L + 2 * p - eff) / s;
    let out = (opts.ceil ? Math.ceil(raw) : Math.floor(raw)) + 1;
    if (opts.ceil && (out - 1) * s >= L + p) out--;
    const k2 = d === 1 ? String(k) : d + "×(" + k + " − 1) − 1 + 1";
    return { out, text: (opts.ceil ? "⌈" : "⌊") + "(" + L + (p ? " + 2×" + p : "") + " − " + k2 + ") / " + s + (opts.ceil ? "⌉" : "⌋") + " + 1 = " + out };
  }
  function spatial(ctx, t, c, cfg, what) {
    const shape = t.shape.slice(), lines = [];
    cfg.k.forEach((k, i) => {
      const j = c + 1 + i, L = t.shape[j];
      if (cfg.same) {
        lines.push((t.dims[j].label || "dim " + j) + ": padding='same' keeps " + L);
        return;
      }
      const r = slide(L, k, cfg.s[i], cfg.p[i], cfg.d[i], cfg);
      if (r.out < 1) {
        fail("The " + (cfg.pool ? "window" : "kernel") + " doesn't fit: " + dimName(t, j) + " is too small for size " + k + (cfg.d[i] > 1 ? " with dilation " + cfg.d[i] : "") + (cfg.p[i] ? " and padding " + cfg.p[i] : "") + ", so the output would be " + r.out + ". Use a smaller kernel, add padding, or remove a downsampling step before this.", "", "torch");
      }
      shape[j] = r.out;
      lines.push((t.dims[j].label || "dim " + j) + ": " + r.text);
    });
    ctx.note(lines.join(" · "));
    return shape;
  }

  // Which input positions along one spatial dimension feed output position o: [lo, hi], or null.
  function windowRange(o, L, k, cfg, i) {
    const s = cfg.s[i], d = cfg.d[i], span = d * (k - 1);
    let lo, hi;
    if (cfg.transposed) {
      const p = cfg.p[i];
      lo = Math.ceil((o + p - span) / s);
      hi = Math.floor((o + p) / s);
    } else {
      lo = o * s - (cfg.same ? Math.floor(span / 2) : cfg.p[i]);
      hi = lo + span;
    }
    lo = Math.max(lo, 0);
    hi = Math.min(hi, L - 1);
    return lo > hi ? null : [lo, hi];
  }
  // Sliding windows over the spatial dims after position c. channels(idx) gives the input channel entry.
  // With dilation the window skips positions, so the range is an overestimate.
  function windowDep(out, t, c, cfg, channels) {
    return TS.dep(out, t, (idx) => {
      const r = idx.slice();
      r[c] = channels(idx[c]);
      for (let i = 0; i < cfg.k.length; i++) {
        const w = windowRange(idx[c + 1 + i], t.shape[c + 1 + i], cfg.k[i], cfg, i);
        if (!w) return null; // only padding under this window
        r[c + 1 + i] = w;
      }
      return r;
    }, cfg.d.some((x) => x > 1) || (cfg.transposed && cfg.s.some((x) => x > 1)));
  }

  // ---------- Convolution ----------

  function convCfg(a, n, transposed) {
    const cfg = { k: tup(a.kernel_size, n, "kernel_size"), s: tup(a.stride, n, "stride"), d: tup(a.dilation, n, "dilation"), transposed };
    if (a.padding === "same") {
      if (cfg.s.some((x) => x !== 1)) fail("padding='same' only works with stride 1.", "padding='same' is not supported for strided convolutions", "torch");
      cfg.same = true;
    } else cfg.p = a.padding === "valid" ? Array(n).fill(0) : tup(a.padding, n, "padding");
    if (transposed) cfg.outPad = tup(a.output_padding, n, "output_padding")[0];
    return cfg;
  }
  function convForward(ctx, t, n, inC, outC, groups, cfg, weightShape, what, weight) {
    const c = channelAt(t, n, what);
    if (t.shape[c] !== inC) {
      fail(
        "This layer expects " + inC + " input channels (at dim " + c + "), but the input has " + t.shape[c] + ". " + (t.shape[t.shape.length - 1] === inC ? "The channels look like they're last: PyTorch wants channels first, so try .permute(0, 3, 1, 2)." : "Check in_channels, or the layer before."),
        cfg.transposed ? "" : "Given groups=" + groups + ", weight of size [" + weightShape.join(", ") + "], expected input[" + t.shape.join(", ") + "] to have " + inC + " channels, but got " + t.shape[c] + " channels instead",
        "torch"
      );
    }
    const shape = spatial(ctx, t, c, cfg, what);
    shape[c] = outC;
    const dims = t.dims.slice();
    dims[c] = dim(t.dims[c].label);
    ctx.note("Channels: " + inC + " → " + outC + (c === 0 ? ". No batch dimension: PyTorch treats this as one unbatched sample." : "."));
    // Every input channel of the group, under the window.
    const perIn = inC / groups, perOut = outC / groups;
    const out = windowDep(tensor(shape, dims, "torch"), t, c, cfg, (oc) => {
      const g = Math.floor(oc / perOut);
      return [g * perIn, (g + 1) * perIn - 1];
    });
    // F.conv's weight is a tensor here: filter oc, all of it.
    if (weight) TS.dep(out, weight, (idx) => weight.shape.map((m, i) => (i === 0 ? Math.min(idx[c], m - 1) : TS.ALL(m))));
    return out;
  }
  for (const n of [1, 2, 3]) {
    FN[NN + "Conv" + n + "d"] = (ctx, call) => {
      const a = args(ctx, call, [["in_channels"], ["out_channels"], ["kernel_size"], ["stride", 1], ["padding", 0], ["dilation", 1], ["groups", 1], ["bias", true]], "Conv" + n + "d");
      if (![a.in_channels, a.out_channels].every(isInt)) fail("Conv" + n + "d needs in_channels and out_channels as whole numbers.", "", "torch");
      if (a.in_channels % a.groups || a.out_channels % a.groups) fail("in_channels and out_channels must both divide by groups (" + a.groups + ").", a.in_channels % a.groups ? "in_channels must be divisible by groups" : "out_channels must be divisible by groups", "torch");
      const cfg = convCfg(a, n, false);
      const w = [a.out_channels, a.in_channels / a.groups, ...cfg.k];
      return layer("Conv" + n + "d", { in_channels: a.in_channels, out_channels: a.out_channels, kernel_size: cfg.k, stride: cfg.s, padding: a.padding, weight: () => param(w, ["out", "in"]), bias: a.bias ? () => param([a.out_channels], ["out"]) : null },
        (ctx, inputs) => convForward(ctx, input(inputs, "Conv" + n + "d"), n, a.in_channels, a.out_channels, a.groups, cfg, w, "conv" + n + "d"));
    };
    FN[NN + "ConvTranspose" + n + "d"] = (ctx, call) => {
      const a = args(ctx, call, [["in_channels"], ["out_channels"], ["kernel_size"], ["stride", 1], ["padding", 0], ["output_padding", 0], ["groups", 1], ["bias", true], ["dilation", 1]], "ConvTranspose" + n + "d");
      if (a.padding === "same" || a.padding === "valid") fail("ConvTranspose only takes numbers for padding.", "", "torch");
      const cfg = convCfg(a, n, true);
      if (cfg.outPad >= Math.max(...cfg.s) && cfg.outPad >= Math.max(...cfg.d)) fail("output_padding must be smaller than stride or dilation.", "", "torch");
      const w = [a.in_channels, a.out_channels / a.groups, ...cfg.k];
      return layer("ConvTranspose" + n + "d", { in_channels: a.in_channels, out_channels: a.out_channels, kernel_size: cfg.k, weight: () => param(w, ["in", "out"]), bias: a.bias ? () => param([a.out_channels], ["out"]) : null },
        (ctx, inputs) => convForward(ctx, input(inputs, "ConvTranspose" + n + "d"), n, a.in_channels, a.out_channels, a.groups, cfg, w, "conv_transpose" + n + "d"));
    };
    FN[F + "conv" + n + "d"] = (ctx, call) => {
      const a = args(ctx, call, [["input"], ["weight"], ["bias"], ["stride", 1], ["padding", 0], ["dilation", 1], ["groups", 1]], "conv" + n + "d");
      const w = a.weight;
      if (!isTensor(w) || w.shape.length !== n + 2) fail("conv" + n + "d's weight must be " + (n + 2) + "D: (out_channels, in_channels / groups, " + "k, ".repeat(n).slice(0, -2) + ").", "", "torch");
      a.kernel_size = w.shape.slice(2);
      return convForward(ctx, input([a.input], "conv" + n + "d"), n, w.shape[1] * a.groups, w.shape[0], a.groups, convCfg(a, n, false), w.shape, "conv" + n + "d", w);
    };
  }

  // ---------- Pooling ----------

  function poolCfg(a, n, what) {
    const k = tup(a.kernel_size, n, "kernel_size");
    const cfg = { k, s: a.stride === null || (Array.isArray(a.stride) && !a.stride.length) ? k : tup(a.stride, n, "stride"), p: tup(a.padding, n, "padding"), d: tup(a.dilation === undefined || a.dilation === null ? 1 : a.dilation, n, "dilation"), ceil: !!a.ceil_mode, pool: true };
    cfg.p.forEach((p, i) => {
      const eff = cfg.d[i] * (k[i] - 1) + 1;
      if (p > Math.floor(eff / 2)) fail("Padding (" + p + ") can be at most half the window size (" + k[i] + ").", /max/i.test(what) ? "pad should be at most half of effective kernel size, but got pad=" + p + ", kernel_size=" + k[i] + " and dilation=" + cfg.d[i] : "", "torch");
    });
    return cfg;
  }
  function poolForward(ctx, t, n, cfg, what) {
    const c = channelAt(t, n, what);
    if (cfg.defaultStride) ctx.note("No stride given, so it's the window size (" + cfg.k.join("×") + ").");
    const shape = spatial(ctx, t, c, cfg, what);
    return windowDep(tensor(shape, t.dims, "torch"), t, c, cfg, (ch) => ch);
  }
  for (const n of [1, 2, 3]) {
    for (const kind of ["Max", "Avg"]) {
      const sig = [["kernel_size"], ["stride"], ["padding", 0], ...(kind === "Max" ? [["dilation", 1], ["return_indices"], ["ceil_mode", false]] : [["ceil_mode", false]])];
      const name = kind + "Pool" + n + "d", fname = kind.toLowerCase() + "_pool" + n + "d";
      FN[NN + name] = (ctx, call) => {
        const a = args(ctx, call, sig, name);
        const cfg = poolCfg(a, n, name);
        cfg.defaultStride = a.stride === null;
        return layer(name, { kernel_size: cfg.k, stride: cfg.s }, (ctx, inputs) => poolForward(ctx, input(inputs, name), n, cfg, fname));
      };
      FN[F + fname] = (ctx, call) => {
        const a = args(ctx, call, [["input"], ...sig], fname);
        const cfg = poolCfg(a, n, fname);
        cfg.defaultStride = a.stride === null;
        return poolForward(ctx, input([a.input], fname), n, cfg, fname);
      };
    }
    for (const kind of ["Avg", "Max"]) {
      const name = "Adaptive" + kind + "Pool" + n + "d", fname = "adaptive_" + kind.toLowerCase() + "_pool" + n + "d";
      const forward = (ctx, t, size) => {
        const c = channelAt(t, n, fname);
        const want = Array.isArray(size) ? size : Array(n).fill(size);
        if (want.length !== n) fail("output_size needs " + n + " numbers.", "", "torch");
        const shape = t.shape.slice();
        want.forEach((w, i) => w !== null && (shape[c + 1 + i] = w));
        ctx.note("Adaptive pooling picks the window size itself so the output is exactly " + want.map((w) => (w === null ? "unchanged" : w)).join(" × ") + ", whatever the input size.");
        // PyTorch's windows: from ⌊o·L/O⌋ to ⌈(o+1)·L/O⌉ − 1.
        return TS.dep(tensor(shape, t.dims, "torch"), t, (idx) => idx.map((o, j) => {
          if (j <= c) return o;
          const L = t.shape[j], O = shape[j];
          return [Math.floor((o * L) / O), Math.ceil(((o + 1) * L) / O) - 1];
        }));
      };
      FN[NN + name] = (ctx, call) => {
        const a = args(ctx, call, [["output_size"], ["return_indices"]], name);
        return layer(name, { output_size: a.output_size }, (ctx, inputs) => forward(ctx, input(inputs, name), a.output_size));
      };
      FN[F + fname] = (ctx, call) => {
        const a = args(ctx, call, [["input"], ["output_size"], ["return_indices"]], fname);
        return forward(ctx, input([a.input], fname), a.output_size);
      };
    }
  }

  // ---------- Linear and embeddings ----------

  function linearForward(ctx, t, inF, outF) {
    if (!t.shape.length) fail("Linear needs at least a 1D input; this is a single number.", "", "torch");
    const last = t.shape[t.shape.length - 1];
    if (last !== inF) {
      const rows = numel(t.shape.slice(0, -1));
      fail(
        "Linear works on the last dimension, which must equal in_features (" + inF + "), but it's " + last + " here (shape " + shapeText(t.shape) + ")." +
          (t.shape.includes(inF) ? " The " + inF + " is at another position: move it last (permute/transpose)." : t.shape.length > 2 ? " Did you forget to flatten? x.flatten(1) would give " + shapeText([t.shape[0], numel(t.shape.slice(1))]) + "." : ""),
        t.shape.length >= 2 ? "mat1 and mat2 shapes cannot be multiplied (" + rows + "x" + last + " and " + inF + "x" + outF + ")" : "",
        "torch"
      );
    }
    const dims = t.dims.slice(0, -1);
    if (t.shape.length > 2) ctx.note("Only the last dimension changes (" + inF + " → " + outF + "); the leading " + shapeText(t.shape.slice(0, -1)) + " are treated as a batch.");
    else ctx.note("Features: " + inF + " → " + outF + ".");
    return TS.dep(tensor([...t.shape.slice(0, -1), outF], [...dims, dim("")], "torch"), t, (idx) => [...idx.slice(0, -1), TS.ALL(inF)]);
  }
  FN[NN + "Linear"] = (ctx, call) => {
    const a = args(ctx, call, [["in_features"], ["out_features"], ["bias", true]], "Linear");
    if (![a.in_features, a.out_features].every(isInt)) fail("Linear needs in_features and out_features as whole numbers.", "", "torch");
    return layer("Linear", { in_features: a.in_features, out_features: a.out_features, weight: () => param([a.out_features, a.in_features], ["out", "in"]), bias: a.bias ? () => param([a.out_features], ["out"]) : null },
      (ctx, inputs) => linearForward(ctx, input(inputs, "Linear"), a.in_features, a.out_features));
  };
  FN[NN + "LazyLinear"] = (ctx, call) => {
    const a = args(ctx, call, [["out_features"], ["bias", true]], "LazyLinear");
    return layer("LazyLinear", { out_features: a.out_features }, (ctx, inputs) => {
      const t = input(inputs, "LazyLinear");
      ctx.note("LazyLinear takes in_features from its first input: " + t.shape[t.shape.length - 1] + ".");
      return linearForward(ctx, t, t.shape[t.shape.length - 1], a.out_features);
    });
  };
  FN[F + "linear"] = (ctx, call) => {
    const a = args(ctx, call, [["input"], ["weight"], ["bias"]], "linear");
    const w = a.weight;
    if (!isTensor(w) || w.shape.length !== 2) fail("F.linear's weight must be 2D: (out_features, in_features).", "", "torch");
    ctx.note("weight is (out, in) = " + shapeText(w.shape) + ", so this is x @ weight.T.");
    const out = linearForward(ctx, input([a.input], "linear"), w.shape[1], w.shape[0]);
    TS.dep(out, w, (idx) => [idx[idx.length - 1], TS.ALL(w.shape[1])]);
    if (isTensor(a.bias) && a.bias.shape.length === 1) TS.link(out, a.bias, (idx) => [idx[idx.length - 1]]);
    return out;
  };
  FN[NN + "Bilinear"] = (ctx, call) => {
    const a = args(ctx, call, [["in1_features"], ["in2_features"], ["out_features"]], "Bilinear");
    return layer("Bilinear", a, (ctx, inputs) => {
      const [x, y] = inputs;
      linearForward({ note() {} }, x, a.in1_features, a.out_features);
      linearForward({ note() {} }, y, a.in2_features, a.out_features);
      const out = tensor([...x.shape.slice(0, -1), a.out_features], [...x.dims.slice(0, -1), dim("")], "torch");
      TS.dep(out, x, (idx) => [...idx.slice(0, -1), TS.ALL(a.in1_features)]);
      return TS.dep(out, y, (idx) => [...idx.slice(0, -1), TS.ALL(a.in2_features)]);
    });
  };
  function embed(ctx, t, num, size, weight) {
    ctx.note("Each index becomes a vector of " + size + " numbers, so a dimension of size " + size + " is added at the end. Indices must be whole numbers from 0 to " + (num - 1) + ".");
    const out = TS.link(tensor([...t.shape, size], [...t.dims, dim("")], "torch"), t, (idx) => idx.slice(0, -1));
    if (weight) TS.dep(out, weight, (idx) => [TS.ALL(num), idx[idx.length - 1]], true);
    return out;
  }
  FN[NN + "Embedding"] = (ctx, call) => {
    const a = args(ctx, call, [["num_embeddings"], ["embedding_dim"], ["padding_idx"]], "Embedding");
    return layer("Embedding", { num_embeddings: a.num_embeddings, embedding_dim: a.embedding_dim, weight: () => param([a.num_embeddings, a.embedding_dim], ["", ""]) },
      (ctx, inputs) => embed(ctx, input(inputs, "Embedding"), a.num_embeddings, a.embedding_dim));
  };
  FN[F + "embedding"] = (ctx, call) => {
    const w = call.args[1];
    if (!isTensor(w) || w.shape.length !== 2) fail("F.embedding's weight must be 2D: (num_embeddings, embedding_dim).", "", "torch");
    return embed(ctx, input(call.args, "embedding"), w.shape[0], w.shape[1], w);
  };
  FN[F + "one_hot"] = (ctx, call) => {
    const a = args(ctx, call, [["tensor"], ["num_classes", -1]], "one_hot");
    if (a.num_classes === -1) fail("Without num_classes, one_hot uses the largest value in the data plus 1, which this tool can't know. Pass num_classes=.", "", "torch");
    ctx.note("Adds a dimension of size " + a.num_classes + " at the end: one slot per class.");
    return TS.link(tensor([...a.tensor.shape, a.num_classes], [...a.tensor.dims, dim("")], "torch"), a.tensor, (idx) => idx.slice(0, -1));
  };

  // ---------- Reshaping layers ----------

  FN[NN + "Flatten"] = (ctx, call) => {
    const a = args(ctx, call, [["start_dim", 1], ["end_dim", -1]], "Flatten");
    return layer("Flatten", a, (ctx, inputs) => {
      const t = input(inputs, "Flatten");
      if (a.start_dim === 1 && !("start_dim" in call.kwargs) && !call.args.length) ctx.note("nn.Flatten starts at dim 1 by default (keeping the batch), unlike torch.flatten, which starts at 0.");
      return M.flatten(ctx, t, { args: [a.start_dim, a.end_dim], kwargs: {}, nodes: [], kwnodes: {} });
    });
  };
  FN[NN + "Unflatten"] = (ctx, call) => {
    const a = args(ctx, call, [["dim"], ["unflattened_size"]], "Unflatten");
    return layer("Unflatten", a, (ctx, inputs) => M.unflatten(ctx, input(inputs, "Unflatten"), { args: [a.dim, a.unflattened_size], kwargs: {}, nodes: [null, a.$nodes.unflattened_size], kwnodes: {} }));
  };
  function pixelShuffle(ctx, t, r) {
    if (t.shape.length < 3) fail("PixelShuffle needs at least 3 dimensions (C, H, W).", "", "torch");
    const nd = t.shape.length, C = t.shape[nd - 3];
    if (C % (r * r)) fail("PixelShuffle needs the channels (" + C + ") to divide by " + r + "² = " + r * r + ".", "pixel_shuffle expects its input's 'channel' dimension to be divisible by the square of upscale_factor, but input.size(-3)=" + C + " is not divisible by " + r * r, "torch");
    const shape = t.shape.slice();
    shape[nd - 3] = C / (r * r);
    shape[nd - 2] *= r;
    shape[nd - 1] *= r;
    ctx.note("Moves channel groups of " + r * r + " into " + r + "×" + r + " blocks of pixels: C ÷ " + r * r + ", H × " + r + ", W × " + r + ".");
    return TS.link(tensor(shape, t.dims, "torch"), t, (idx) => {
      const [c, h, w] = idx.slice(nd - 3);
      return [...idx.slice(0, nd - 3), c * r * r + (h % r) * r + (w % r), Math.floor(h / r), Math.floor(w / r)];
    });
  }
  FN[NN + "PixelShuffle"] = (ctx, call) => {
    const r = call.args[0];
    return layer("PixelShuffle", { upscale_factor: r }, (ctx, inputs) => pixelShuffle(ctx, input(inputs, "PixelShuffle"), r));
  };
  FN[F + "pixel_shuffle"] = (ctx, call) => pixelShuffle(ctx, input(call.args, "pixel_shuffle"), call.args[1]);

  // Upsample / interpolate: (N, C, *spatial).
  function resize(ctx, t, size, scale, mode) {
    const n = t.shape.length - 2;
    if (n < 1 || n > 3) fail("Upsampling expects 3D, 4D or 5D input (N, C, then 1–3 spatial sizes); got " + t.shape.length + "D. Without a batch, add one with .unsqueeze(0).", "", "torch");
    if ((size === null) === (scale === null)) fail("Give either size or scale_factor (exactly one).", "either size or scale_factor should be defined", "torch");
    const shape = t.shape.slice();
    for (let i = 0; i < n; i++) {
      const L = t.shape[2 + i];
      shape[2 + i] = size !== null ? (Array.isArray(size) ? size[i] : size) : Math.floor(L * (Array.isArray(scale) ? scale[i] : scale));
    }
    ctx.note("Only the spatial sizes change: " + t.shape.slice(2).join(" × ") + " → " + shape.slice(2).join(" × ") + ".");
    const out = tensor(shape, t.dims, "torch");
    const reach = !mode || mode === "nearest" || mode === "nearest-exact" ? 0 : mode === "bicubic" ? 2 : 1;
    const at = (o, j) => Math.min(t.shape[j] - 1, Math.floor((o * t.shape[j]) / shape[j]));
    if (!reach) return TS.link(out, t, (idx) => idx.map((o, j) => (j < 2 ? o : at(o, j))));
    // Neighbors on each side; align_corners shifts them a little, so the range is a safe estimate.
    return TS.dep(out, t, (idx) => idx.map((o, j) => (j < 2 ? o : [Math.max(0, at(o, j) - reach), Math.min(t.shape[j] - 1, at(o, j) + reach)])), true);
  }
  FN[NN + "Upsample"] = (ctx, call) => {
    const a = args(ctx, call, [["size"], ["scale_factor"], ["mode"]], "Upsample");
    return layer("Upsample", a, (ctx, inputs) => resize(ctx, input(inputs, "Upsample"), a.size, a.scale_factor, a.mode));
  };
  FN[F + "interpolate"] = FN[F + "upsample"] = (ctx, call) => {
    const a = args(ctx, call, [["input"], ["size"], ["scale_factor"], ["mode"]], "interpolate");
    return resize(ctx, input([a.input], "interpolate"), a.size, a.scale_factor, a.mode);
  };

  // F.pad(x, (left, right, top, bottom, ...)): pairs apply from the last dimension backwards.
  function pad(ctx, t, p, mode) {
    if (!Array.isArray(p) || p.length % 2) fail("pad needs an even number of sizes: (left, right) for the last dimension, then (top, bottom) for the one before, and so on.", "Padding length must be divisible by 2", "torch");
    if (p.length / 2 > t.shape.length) fail("pad has sizes for " + p.length / 2 + " dimensions but the tensor only has " + t.shape.length + ".", "Padding length should be less than or equal to two times the input dimension but got padding length " + p.length + " and input of dimension " + t.shape.length, "torch");
    const shape = t.shape.slice(), parts = [];
    for (let i = 0; i < p.length / 2; i++) {
      const j = t.shape.length - 1 - i;
      shape[j] += p[2 * i] + p[2 * i + 1];
      if (shape[j] < 0) fail("Negative padding cuts more than " + dimName(t, j) + " has.", "", "torch");
      parts.push((t.dims[j].label || "dim " + j) + " " + t.shape[j] + " + " + p[2 * i] + " + " + p[2 * i + 1] + " = " + shape[j]);
    }
    ctx.note("Pairs apply from the last dimension backwards: " + parts.join(" · ") + ".");
    const nd = t.shape.length;
    const before = t.shape.map((_, j) => (nd - 1 - j < p.length / 2 ? p[2 * (nd - 1 - j)] : 0));
    const fold = (i, L) => {
      if (mode === "reflect") {
        const period = 2 * (L - 1) || 1;
        i = ((i % period) + period) % period;
        return i < L ? i : period - i;
      }
      if (mode === "replicate") return Math.min(L - 1, Math.max(0, i));
      if (mode === "circular") return ((i % L) + L) % L;
      return i >= 0 && i < L ? i : null;
    };
    return TS.link(tensor(shape, t.dims, "torch"), t, (idx) => {
      const r = idx.map((o, j) => fold(o - before[j], t.shape[j]));
      return r.includes(null) ? null : r;
    }, !mode || mode === "constant");
  }
  FN[F + "pad"] = (ctx, call) => {
    const a = args(ctx, call, [["input"], ["pad"], ["mode"], ["value"]], "pad");
    return pad(ctx, input([a.input], "pad"), a.pad, a.mode || "constant");
  };
  for (const kind of ["Zero", "Constant", "Reflection", "Replication", "Circular"]) {
    for (const n of [1, 2, 3]) {
      const name = kind + "Pad" + n + "d";
      FN[NN + name] = (ctx, call) => {
        const p = call.args[0];
        const sides = Array.isArray(p) ? p : Array(2 * n).fill(p);
        if (sides.length !== 2 * n) fail(name + " needs one number or " + 2 * n + " of them.", "", "torch");
        const mode = { Zero: "constant", Constant: "constant", Reflection: "reflect", Replication: "replicate", Circular: "circular" }[kind];
        return layer(name, { padding: sides }, (ctx, inputs) => pad(ctx, input(inputs, name), sides, mode));
      };
    }
  }

  // ---------- Normalization ----------

  for (const n of [1, 2, 3]) {
    const name = "BatchNorm" + n + "d";
    FN[NN + name] = (ctx, call) => {
      const a = args(ctx, call, [["num_features"], ["eps"], ["momentum"], ["affine"], ["track_running_stats"]], name);
      return layer(name, { num_features: a.num_features, weight: () => param([a.num_features], ["C"]), bias: () => param([a.num_features], ["C"]) }, (ctx, inputs) => {
        const t = input(inputs, name), nd = t.shape.length;
        const ok = n === 1 ? nd === 2 || nd === 3 : nd === n + 2;
        if (!ok) fail(name + " expects " + (n === 1 ? "2D (N, C) or 3D (N, C, L)" : n + 2 + "D (N, C, " + SPATIAL[n] + ")") + " input, but got " + nd + "D " + shapeText(t.shape) + ".", "expected " + (n === 1 ? "2D or 3D" : n + 2 + "D") + " input (got " + nd + "D input)", "torch");
        if (t.shape[1] !== a.num_features) fail(name + "(" + a.num_features + ") expects " + a.num_features + " channels at dim 1, but the input has " + t.shape[1] + ".", "running_mean should contain " + t.shape[1] + " elements not " + a.num_features, "torch");
        ctx.note("Normalizes each of the " + a.num_features + " channels over the batch" + (nd > 2 ? " and the other positions" : "") + "; the shape doesn't change.");
        // In training mode the statistics come from the whole batch: every element of the same channel.
        return TS.depAlong(tensor(t.shape, t.dims, "torch"), t, t.shape.map((_, i) => i).filter((i) => i !== 1));
      });
    };
  }
  function layerNorm(ctx, t, shape) {
    const ns = Array.isArray(shape) ? shape : [shape];
    const tail = t.shape.slice(t.shape.length - ns.length);
    if (ns.length > t.shape.length || !TS.sameShape(tail, ns)) {
      fail("LayerNorm" + shapeText(ns) + " normalizes over the last " + (ns.length === 1 ? "dimension, which must be " + ns[0] : ns.length + " dimensions, which must be " + shapeText(ns)) + ", but the input ends with " + shapeText(t.shape.slice(-ns.length)) + ".", "Given normalized_shape=[" + ns.join(", ") + "], expected input with shape [*, " + ns.join(", ") + "], but got input of size[" + t.shape.join(", ") + "]", "torch");
    }
    ctx.note("Normalizes over the last " + (ns.length === 1 ? "dimension" : ns.length + " dimensions") + " for each position separately; the shape doesn't change.");
    return TS.depAlong(tensor(t.shape, t.dims, "torch"), t, t.shape.map((_, i) => i).slice(t.shape.length - ns.length));
  }
  FN[NN + "LayerNorm"] = (ctx, call) => {
    const a = args(ctx, call, [["normalized_shape"], ["eps"], ["elementwise_affine"]], "LayerNorm");
    const ns = Array.isArray(a.normalized_shape) ? a.normalized_shape : [a.normalized_shape];
    return layer("LayerNorm", { normalized_shape: ns, weight: () => param(ns, []), bias: () => param(ns, []) }, (ctx, inputs) => layerNorm(ctx, input(inputs, "LayerNorm"), ns));
  };
  FN[F + "layer_norm"] = (ctx, call) => layerNorm(ctx, input(call.args, "layer_norm"), call.args[1]);
  FN[NN + "RMSNorm"] = (ctx, call) => {
    const ns = call.args[0];
    return layer("RMSNorm", { normalized_shape: ns }, (ctx, inputs) => layerNorm(ctx, input(inputs, "RMSNorm"), ns));
  };
  FN[NN + "GroupNorm"] = (ctx, call) => {
    const a = args(ctx, call, [["num_groups"], ["num_channels"], ["eps"], ["affine"]], "GroupNorm");
    if (a.num_channels % a.num_groups) fail("num_channels (" + a.num_channels + ") must divide by num_groups (" + a.num_groups + ").", "num_channels must be divisible by num_groups", "torch");
    return layer("GroupNorm", a, (ctx, inputs) => {
      const t = input(inputs, "GroupNorm");
      if (t.shape.length < 2 || t.shape[1] !== a.num_channels) fail("GroupNorm expects " + a.num_channels + " channels at dim 1; the input is " + shapeText(t.shape) + ".", "", "torch");
      ctx.note("Splits the " + a.num_channels + " channels into " + a.num_groups + " groups of " + a.num_channels / a.num_groups + " and normalizes each; the shape doesn't change.");
      const per = a.num_channels / a.num_groups;
      return TS.dep(tensor(t.shape, t.dims, "torch"), t, (idx) => idx.map((v, i) => (i === 0 ? v : i === 1 ? [Math.floor(v / per) * per, Math.floor(v / per) * per + per - 1] : TS.ALL(t.shape[i]))));
    });
  };

  // ---------- Same shape ----------

  const SAME = ["ReLU", "ReLU6", "LeakyReLU", "PReLU", "RReLU", "GELU", "SiLU", "Mish", "ELU", "SELU", "CELU", "Sigmoid", "Tanh", "Softplus", "Softsign", "Hardtanh", "Hardswish", "Hardsigmoid", "LogSigmoid", "Tanhshrink", "Threshold", "Dropout", "Dropout1d", "Dropout2d", "Dropout3d", "AlphaDropout", "Identity", "InstanceNorm1d", "InstanceNorm2d", "InstanceNorm3d", "LocalResponseNorm", "Softmax2d"];
  for (const name of SAME) {
    FN[NN + name] = () => layer(name, {}, (ctx, inputs) => {
      const t = input(inputs, name);
      if (/^Dropout/.test(name)) ctx.note("Dropout zeroes random values while training; the shape never changes.");
      const out = tensor(t.shape, t.dims, "torch"), nd = t.shape.length;
      // Instance norm: each channel over its own positions. Softmax2d: over channels. LRN: nearby channels.
      if (/^InstanceNorm/.test(name)) return TS.depAlong(out, t, t.shape.map((_, i) => i).slice(nd - Number(name[12])));
      if (name === "Softmax2d" && nd >= 3) return TS.depAlong(out, t, [nd - 3]);
      if (name === "LocalResponseNorm" && nd >= 2) return TS.depAlong(out, t, [1], true);
      return TS.linkSame(out, t);
    });
  }
  for (const name of ["Softmax", "LogSoftmax"]) {
    FN[NN + name] = (ctx, call) => {
      const a = args(ctx, call, [["dim"]], name);
      return layer(name, { dim: a.dim }, (ctx, inputs) => M[name === "Softmax" ? "softmax" : "log_softmax"](ctx, input(inputs, name), { args: a.dim === null ? [] : [a.dim], kwargs: {}, nodes: [], kwnodes: {} }));
    };
  }

  // ---------- Losses ----------

  function regression(ctx, x, y, reduction, what) {
    if (!TS.sameShape(x.shape, y.shape)) {
      if (/with_logits|WithLogits/.test(what)) fail("The target " + shapeText(y.shape) + " must have exactly the input's shape " + shapeText(x.shape) + ".", "Target size (torch.Size([" + y.shape.join(", ") + "])) must be the same as input size (torch.Size([" + x.shape.join(", ") + "]))", "torch");
      const b = TS.broadcast([x, y], "torch");
      ctx.warn("The input " + shapeText(x.shape) + " and target " + shapeText(y.shape) + " have different shapes, so they broadcast to " + shapeText(b.shape) + " and the loss compares the wrong pairs. PyTorch warns: “Using a target size (torch.Size([" + y.shape.join(", ") + "])) that is different to the input size (torch.Size([" + x.shape.join(", ") + "]))”. Usually fix with .squeeze(-1) or .view(-1, 1).");
      if (reduction === "none") return TS.linkBroadcast(TS.linkBroadcast(b, x), y);
      return TS.depAll(TS.depAll(tensor([], [], "torch"), x), y);
    }
    if (reduction === "none") return TS.linkSame(TS.linkSame(tensor(x.shape, x.dims, "torch"), x), y);
    ctx.note("reduction='" + (reduction || "mean") + "' gives one number (0D).");
    return TS.depAll(TS.depAll(tensor([], [], "torch"), x), y);
  }
  function classification(ctx, x, y, reduction) {
    const nd = x.shape.length;
    if (!nd) fail("cross_entropy needs class scores: (N, C), or (C,) for one sample.", "", "torch");
    const C = nd === 1 ? x.shape[0] : x.shape[1];
    const probs = TS.sameShape(x.shape, y.shape);
    const expect = nd === 1 ? [] : [x.shape[0], ...x.shape.slice(2)];
    if (!probs && !TS.sameShape(y.shape, expect)) {
      fail(
        "With input " + shapeText(x.shape) + " (C = " + C + " classes " + (nd === 1 ? "" : "at dim 1") + "), the target must be class indices of shape " + shapeText(expect) + " or probabilities of shape " + shapeText(x.shape) + ", but it's " + shapeText(y.shape) + "." + (y.shape.length === 2 && y.shape[1] === 1 ? " Remove the extra dimension with .squeeze(1)." : ""),
        nd > 1 && y.shape.length && y.shape[0] !== x.shape[0] ? "Expected input batch_size (" + x.shape[0] + ") to match target batch_size (" + y.shape[0] + ")." : "",
        "torch"
      );
    }
    ctx.note(probs ? "The target has the input's shape, so it's read as class probabilities." : "The target holds class indices: whole numbers from 0 to " + (C - 1) + " (dtype torch.long), one per sample, e.g. torch.randint(0, " + C + ", " + shapeText(expect) + ").");
    if (reduction === "none") {
      // One loss per sample (and position): all C class scores of it, and its target.
      const out = tensor(probs ? expect : y.shape, probs ? x.dims.filter((_, i) => i !== (nd === 1 ? 0 : 1)) : y.dims, "torch");
      const withC = (idx) => (nd === 1 ? [TS.ALL(C)] : [idx[0], TS.ALL(C), ...idx.slice(1)]);
      TS.dep(out, x, withC);
      return probs ? TS.dep(out, y, withC) : TS.linkSame(out, y);
    }
    return TS.depAll(TS.depAll(tensor([], [], "torch"), x), y);
  }
  const LOSSES = { MSELoss: "mse_loss", L1Loss: "l1_loss", SmoothL1Loss: "smooth_l1_loss", HuberLoss: "huber_loss", BCELoss: "binary_cross_entropy", BCEWithLogitsLoss: "binary_cross_entropy_with_logits", CrossEntropyLoss: "cross_entropy", NLLLoss: "nll_loss", KLDivLoss: "kl_div" };
  for (const [name, fname] of Object.entries(LOSSES)) {
    const run = (ctx, x, y, reduction) => {
      if (!isTensor(x) || !isTensor(y)) fail(name + " needs two tensors: (input, target).", "", "torch");
      return /cross_entropy$|nll/.test(fname) ? classification(ctx, x, y, reduction) : regression(ctx, x, y, reduction, fname);
    };
    FN[NN + name] = (ctx, call) => {
      const reduction = call.kwargs.reduction || "mean";
      return layer(name, { reduction }, (ctx, inputs) => run(ctx, inputs[0], inputs[1], reduction));
    };
    FN[F + fname] = (ctx, call) => run(ctx, call.args[0], call.args[1], call.kwargs.reduction || "mean");
  }

  // ---------- Containers and the unsupported ----------

  FN[NN + "Sequential"] = (ctx, call) => {
    const children = call.args;
    children.forEach((c, i) => {
      if (!c || c.kind !== "layer") fail("nn.Sequential takes layers; item " + i + " is " + TS.show(c) + ".", "", "torch");
    });
    const seq = layer("Sequential", {}, null);
    seq.children = children;
    return seq;
  };
  FN[NN + "ModuleList"] = (ctx, call) => {
    const seq = layer("ModuleList", {}, null);
    seq.children = call.args[0] || [];
    seq.noCall = true;
    return seq;
  };
  TS.UNSUPPORTED = {
    LSTM: "Recurrent layers", GRU: "Recurrent layers", RNN: "Recurrent layers", LSTMCell: "Recurrent layers", GRUCell: "Recurrent layers",
    MultiheadAttention: "Attention layers", Transformer: "Transformer layers", TransformerEncoder: "Transformer layers", TransformerEncoderLayer: "Transformer layers", TransformerDecoder: "Transformer layers", TransformerDecoderLayer: "Transformer layers"
  };

  // softmax(q @ k.mT / √E) @ v, with batch dims broadcast: (…, L, E), (…, S, E), (…, S, Ev) → (…, L, Ev).
  FN[F + "scaled_dot_product_attention"] = (ctx, call) => {
    const [q, k, v] = call.args.slice(0, 3).map((x) => input([x], "scaled_dot_product_attention"));
    if ([q, k, v].some((t) => t.shape.length < 2)) fail("query, key and value need at least 2 dimensions: (…, length, features).", "", "torch");
    const E = q.shape[q.shape.length - 1];
    if (k.shape[k.shape.length - 1] !== E) fail("query and key must have the same last size (features): " + E + " vs " + k.shape[k.shape.length - 1] + ".", "", "torch");
    if (k.shape[k.shape.length - 2] !== v.shape[v.shape.length - 2]) fail("key and value must have the same length (second-to-last size): " + k.shape[k.shape.length - 2] + " vs " + v.shape[v.shape.length - 2] + ".", "", "torch");
    const scores = TS.matmul({ note() {} }, q, TS.attrMT({ note() {}, warn() {} }, k));
    ctx.note("Scores q @ kᵀ are " + shapeText(scores.shape) + " (each query position against each key position), then softmax, then @ v.");
    const out = TS.matmul({ note() {} }, scores, v);
    out.src = [];
    const nb = out.shape.length - 2;
    const lead = (idx, t) => TS.alignBatch(idx, t, t.shape.length - 2, nb - (t.shape.length - 2));
    TS.dep(out, q, (idx) => [...lead(idx, q), idx[nb], TS.ALL(E)]);
    TS.dep(out, k, (idx) => [...lead(idx, k), TS.ALL(k.shape[k.shape.length - 2]), TS.ALL(E)]);
    return TS.dep(out, v, (idx) => [...lead(idx, v), TS.ALL(v.shape[v.shape.length - 2]), idx[nb + 1]]);
  };
})();
