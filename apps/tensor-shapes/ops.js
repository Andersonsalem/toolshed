// Shape rules for PyTorch and NumPy operations. No page layout here.
//
//   TS.FN["torch.cat"](ctx, call)       functions, by full name
//   TS.METHOD.reshape(ctx, t, call)     tensor methods: x.reshape(...)
//
// call = { args, kwargs, nodes, kwnodes }: the values, and the code each came from,
// so a size written as a name (B) can label its dimension.
// ctx.note(text) explains the step; ctx.warn(text) is a caution.
// Rules follow PyTorch 2.x and NumPy 2.x. A library's own error text is only
// quoted where it's known exactly.
(function () {
  "use strict";
  const TS = window.TS;
  const { fail, tensor, dim, isTensor, shapeText, numel, normDim } = TS;
  const FN = (TS.FN = {});
  const M = (TS.METHOD = {});

  const isInt = (TS.isInt = (v) => (typeof v === "number" && Number.isInteger(v)) || typeof v === "boolean");
  const np = (lib) => lib === "numpy";
  const same = (TS.sameShape = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]));
  const dimName = (TS.dimName = (t, i) => (t.dims[i].label ? t.dims[i].label + " (" + t.shape[i] + ")" : "dim " + i + " (" + t.shape[i] + ")"));
  const plain = (shape) => shapeText(shape).replace(/ /g, "");
  const list = (a) => ((a.list = true), a);
  const kindOf = (lib) => (np(lib) ? "array" : "tensor");

  // Python-style text for a value, for messages.
  const show = (TS.show = function (v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return Number.isNaN(v) ? "a value from the data" : String(v);
    if (typeof v === "string") return "'" + v + "'";
    if (isTensor(v)) return "a " + kindOf(v.lib) + " of shape " + shapeText(v.shape);
    if (Array.isArray(v)) return (v.list ? "[" : "(") + v.map(show).join(", ") + (v.length === 1 && !v.list ? "," : "") + (v.list ? "]" : ")");
    return v.label || "an object";
  });

  // A new tensor made from t. Pass strides for PyTorch views (they share memory).
  const derive = (TS.derive = function (t, shape, dims, strides, by) {
    const out = tensor(shape, dims, t.lib, strides);
    if (strides && !TS.isContiguous(out)) out.layoutBy = by || t.layoutBy || "an earlier step";
    return out;
  });
  const view = (t) => !np(t.lib); // only PyTorch strides are tracked

  // Pairs like max(dim=...) returns: (values, indices).
  const pair = (TS.pair = (a, b) => Object.assign([a, b], { names: ["values", "indices"] }));

  // Keyword arguments that never change a shape.
  const HARMLESS = new Set(["dtype", "device", "requires_grad", "generator", "pin_memory", "layout", "memory_format", "non_blocking", "copy", "order", "out", "inplace", "casting", "where", "unbiased", "correction", "ddof", "p", "ord", "approximate", "negative_slope", "alpha", "beta", "eps", "momentum", "affine", "bias", "padding_mode", "mode", "align_corners", "count_include_pad", "divisor_override", "return_indices", "endpoint", "base", "replace", "seed", "loc", "scale", "training", "min", "max", "value", "descending", "stable", "kind", "weight", "label_smoothing", "ignore_index", "nan", "posinf", "neginf", "decimals", "threshold", "lambd", "upper", "lower"]);

  // Matches arguments to a signature like Python does.
  // sig: [[name, default, [aliases]], ...]. Returns { name: value } plus .$nodes.
  const args = (TS.args = function (ctx, call, sig, what) {
    const out = { $nodes: {} };
    for (const s of sig) out[s[0]] = s[1] === undefined ? null : s[1];
    if (np(ctx.lib)) {
      if ("dim" in call.kwargs) fail("NumPy calls it axis=, not dim=.", what + "() got an unexpected keyword argument 'dim'", "numpy");
      if ("keepdim" in call.kwargs) fail("NumPy spells it keepdims= (with an s).", what + "() got an unexpected keyword argument 'keepdim'", "numpy");
    } else if ("keepdims" in call.kwargs) ctx.warn("PyTorch documents this as keepdim= (no s). Use that spelling to be safe.");
    if (call.args.length > sig.length) fail(what + "() was given " + call.args.length + " positional arguments; this tool knows it with at most " + sig.length + ".", "", ctx.lib);
    call.args.forEach((v, i) => {
      out[sig[i][0]] = v;
      out.$nodes[sig[i][0]] = call.nodes[i];
    });
    for (const k of Object.keys(call.kwargs)) {
      const s = sig.find((x) => x[0] === k || (x[2] && x[2].includes(k)));
      if (s) {
        out[s[0]] = call.kwargs[k];
        out.$nodes[s[0]] = call.kwnodes[k];
      } else if (!HARMLESS.has(k)) ctx.warn("Ignored " + k + "=: this tool doesn't model it, so check it doesn't change the shape.");
    }
    return out;
  });

  // Sizes written f(2, 3), f((2, 3)), f([2, 3]) or f(x.shape). Names (B, C) label dims.
  const sizes = (TS.sizes = function (ctx, vals, nodes, what) {
    nodes = nodes || [];
    let dims = null;
    if (vals.length === 1 && Array.isArray(vals[0])) {
      dims = vals[0].dims || null;
      const n = nodes[0];
      nodes = n && (n.t === "tuple" || n.t === "list") ? n.items : [];
      vals = vals[0];
    }
    for (const v of vals) {
      if (typeof v === "number" && Number.isNaN(v)) fail("That size comes from the data (like .item() or .sum()), which this tool doesn't have. Write the number.", "", ctx.lib);
      if (!isInt(v)) fail((what || "Sizes") + " must be whole numbers; got " + show(v) + ".", "", ctx.lib);
    }
    return { sizes: vals.map(Number), names: vals.map((_, i) => (nodes[i] && nodes[i].t === "name" ? nodes[i].v : "")), dims };
  });
  // Gives unnamed dims the names their sizes were written with (view(B, -1) → B).
  const nameDims = (t, names) => names.forEach((n, i) => n && t.dims[i] && !t.dims[i].label && t.shape[i] !== 1 && (t.dims[i].label = n));

  // Turns numbers and nested lists into tensors.
  const asTensor = (TS.asTensor = function (v, lib, what) {
    if (isTensor(v)) return v;
    if (typeof v === "number" || typeof v === "boolean") return tensor([], [], lib);
    if (Array.isArray(v)) {
      const s = literal(v, lib);
      return tensor(s.shape, s.dims, lib);
    }
    return fail((what || "This") + " needs a " + kindOf(lib) + " or numbers, not " + show(v) + ".", "", lib);
  });
  function literal(v, lib) {
    if (isTensor(v)) {
      if (!np(lib) && numel(v.shape) !== 1) fail("torch.tensor() can't take a list of tensors. To join tensors into a new dimension, use torch.stack(list).", "only one element tensors can be converted to Python scalars", lib);
      return np(lib) ? { shape: v.shape, dims: v.dims } : { shape: [] };
    }
    if (typeof v === "number" || typeof v === "boolean") return { shape: [] };
    if (!Array.isArray(v)) return fail("Can't make a " + kindOf(lib) + " from " + show(v) + ".", "", lib);
    if (!v.length) return { shape: [0] };
    const subs = v.map((x) => literal(x, lib));
    if (subs.some((s) => !same(s.shape, subs[0].shape))) {
      fail("The nested lists have different lengths, so they don't make a rectangle (a “ragged” array). Every row needs the same length.", "", lib);
    }
    return { shape: [v.length, ...subs[0].shape], dims: subs[0].dims ? [dim(""), ...subs[0].dims] : undefined };
  }

  // Calls a method with the tensor as the first argument: torch.sum(x, 1) → x.sum(1).
  const viaMethod = (name, lib) => (ctx, call) => {
    if (!call.args.length) fail(name + "() needs a " + kindOf(lib) + " as its first argument.", "", lib);
    const t = asTensor(call.args[0], lib, name + "()");
    return M[name](ctx, t, { args: call.args.slice(1), kwargs: call.kwargs, nodes: call.nodes.slice(1), kwnodes: call.kwnodes });
  };
  const both = (name, fn) => {
    FN["torch." + name] = fn || viaMethod(name, "torch");
    FN["np." + name] = fn || viaMethod(name, "numpy");
  };

  // ---------- Making tensors ----------

  function make(ctx, s, lib) {
    for (const n of s.sizes) {
      if (n < 0) fail("A size can't be negative; got " + n + ".", np(lib) ? "negative dimensions are not allowed" : "Trying to create tensor with negative dimension " + n + ": [" + s.sizes.join(", ") + "]", lib);
    }
    return tensor(s.sizes, s.sizes.map((n, i) => (s.dims && s.dims[i]) || dim(s.names[i], n === 1)), lib);
  }
  // A size argument that may be an int or a tuple: np.zeros(3), np.random.random((2, 3)).
  const shapeArg = (ctx, v, node, lib) => (v === null ? null : make(ctx, sizes(ctx, Array.isArray(v) ? [v] : [v], [node]), lib));

  for (const n of ["randn", "rand", "zeros", "ones", "empty"]) {
    FN["torch." + n] = (ctx, call) => {
      const vals = "size" in call.kwargs ? [call.kwargs.size] : call.args;
      const nodes = "size" in call.kwargs ? [call.kwnodes.size] : call.nodes;
      return make(ctx, sizes(ctx, vals, nodes), "torch");
    };
  }
  FN["torch.full"] = (ctx, call) => {
    const a = args(ctx, call, [["size"], ["fill_value"]], "full");
    if (!Array.isArray(a.size)) fail("torch.full needs the shape as a tuple: torch.full((2, 3), 7).", "", "torch");
    return make(ctx, sizes(ctx, [a.size], [a.$nodes.size]), "torch");
  };
  FN["torch.randint"] = (ctx, call) => {
    const a = call.args;
    const size = "size" in call.kwargs ? call.kwargs.size : a[a.length - 1];
    const node = "size" in call.kwargs ? call.kwnodes.size : call.nodes[a.length - 1];
    if (!Array.isArray(size)) fail("torch.randint needs the shape as a tuple, after the range: torch.randint(0, 10, (3, 4)).", "", "torch");
    return make(ctx, sizes(ctx, [size], [node]), "torch");
  };
  FN["torch.randperm"] = (ctx, call) => make(ctx, sizes(ctx, call.args.slice(0, 1), call.nodes), "torch");

  function arange(ctx, call, lib) {
    const a = args(ctx, call, [["start"], [np(lib) ? "stop" : "end", null, ["end", "stop"]], ["step", 1]], "arange");
    let start = a.start, end = a[np(lib) ? "stop" : "end"];
    if (end === null) [start, end] = [0, start];
    if (![start, end, a.step].every((x) => typeof x === "number")) fail("arange needs numbers.", "", lib);
    if (a.step === 0) fail("arange's step can't be 0.", "", lib);
    const n = Math.max(0, Math.ceil((end - start) / a.step));
    if (!Number.isInteger(start) || !Number.isInteger(a.step)) ctx.note("With decimal steps the length is ⌈(end − start) / step⌉ = " + n + "; rounding can make it one more than you expect. linspace is safer.");
    return tensor([n], [dim("", n === 1)], lib);
  }
  FN["torch.arange"] = (ctx, call) => arange(ctx, call, "torch");
  FN["np.arange"] = (ctx, call) => arange(ctx, call, "numpy");
  for (const n of ["linspace", "logspace"]) {
    FN["torch." + n] = (ctx, call) => {
      const a = args(ctx, call, [["start"], ["end"], ["steps"]], n);
      if (!isInt(a.steps)) fail("torch." + n + " needs the number of points: torch." + n + "(0, 1, steps=5).", "", "torch");
      return tensor([a.steps], null, "torch");
    };
    FN["np." + n] = (ctx, call) => {
      const a = args(ctx, call, [["start"], ["stop"], ["num", 50]], n);
      if (!isInt(a.num)) fail("num must be a whole number.", "", "numpy");
      if (!("num" in call.kwargs) && call.args.length < 3) ctx.note("No num given, so NumPy makes 50 points.");
      return tensor([a.num], null, "numpy");
    };
  }
  FN["torch.eye"] = (ctx, call) => {
    const a = args(ctx, call, [["n"], ["m"]], "eye");
    return make(ctx, sizes(ctx, [a.n, a.m === null ? a.n : a.m], [a.$nodes.n, a.$nodes.m || a.$nodes.n]), "torch");
  };
  FN["np.eye"] = (ctx, call) => {
    const a = args(ctx, call, [["N"], ["M"]], "eye");
    return make(ctx, sizes(ctx, [a.N, a.M === null ? a.N : a.M], [a.$nodes.N, a.$nodes.M || a.$nodes.N]), "numpy");
  };
  FN["np.identity"] = (ctx, call) => make(ctx, sizes(ctx, [call.args[0], call.args[0]], [call.nodes[0], call.nodes[0]]), "numpy");

  function fromData(ctx, v, lib) {
    if (isTensor(v)) {
      if (v.lib !== lib) ctx.note("Converted from " + TS.libName(v.lib) + " to " + TS.libName(lib) + "; the shape stays " + shapeText(v.shape) + ".");
      return TS.linkSame(tensor(v.shape, v.dims, lib), v);
    }
    const out = asTensor(v, lib);
    if (out.shape.length > 1) ctx.note("Shape read from the nesting: " + out.shape.map((n, i) => (i ? "each of those holds " : "the outer list holds ") + n).join(", ") + ".");
    return out;
  }
  for (const n of ["tensor", "as_tensor", "asarray"]) FN["torch." + n] = (ctx, call) => fromData(ctx, call.args[0], "torch");
  FN["torch.from_numpy"] = (ctx, call) => {
    if (!isTensor(call.args[0]) || call.args[0].lib !== "numpy") fail("torch.from_numpy needs a NumPy array.", "expected np.ndarray (got " + (isTensor(call.args[0]) ? "Tensor" : "list") + ")", "torch");
    return fromData(ctx, call.args[0], "torch");
  };
  for (const n of ["array", "asarray", "ascontiguousarray"]) FN["np." + n] = (ctx, call) => fromData(ctx, call.args[0], "numpy");

  // zeros_like(x) and friends: same shape, same dims.
  for (const n of ["zeros_like", "ones_like", "empty_like", "rand_like", "randn_like", "full_like", "randint_like"]) {
    const make = (lib) => (ctx, call) => {
      const t = asTensor(call.args[0], lib, n);
      // Only the shape is copied: none of the values feed the result.
      return Object.assign(tensor(t.shape, t.dims, lib), { fresh: true });
    };
    FN["torch." + n] = make("torch");
    if (!/^rand/.test(n)) FN["np." + n] = make("numpy");
  }

  // np.random: varargs sizes for randn/rand, size= everywhere else. No size → one number.
  FN["np.random.randn"] = FN["np.random.rand"] = (ctx, call) => (call.args.length ? make(ctx, sizes(ctx, call.args, call.nodes), "numpy") : NaN);
  const npRandom = (sig) => (ctx, call) => {
    const a = args(ctx, call, sig, "random");
    if (a.size === null) return NaN;
    return shapeArg(ctx, a.size, a.$nodes.size, "numpy");
  };
  const RANDOM = {
    random: [["size"]], random_sample: [["size"]], standard_normal: [["size"]],
    normal: [["loc"], ["scale"], ["size"]], uniform: [["low"], ["high"], ["size"]],
    randint: [["low"], ["high"], ["size"]], choice: [["a"], ["size"]],
    integers: [["low"], ["high"], ["size"]], exponential: [["scale"], ["size"]], poisson: [["lam"], ["size"]]
  };
  for (const [n, sig] of Object.entries(RANDOM)) {
    if (n !== "integers") FN["np.random." + n] = npRandom(sig);
    // A Generator from np.random.default_rng() has the same calls (and integers()).
    if (!/^(random_sample|randint)$/.test(n)) FN["np.rng." + n] = npRandom(sig);
  }
  FN["np.random.permutation"] = FN["np.rng.permutation"] = (ctx, call) => (isTensor(call.args[0]) ? tensor(call.args[0].shape, call.args[0].dims, "numpy") : make(ctx, sizes(ctx, [call.args[0]], call.nodes), "numpy"));
  FN["np.random.default_rng"] = () => ({ kind: "rng", label: "a random generator" });
  FN["np.random.seed"] = FN["torch.manual_seed"] = () => null;

  // np.zeros((2, 3)): one shape argument. np.zeros(2, 3) is a classic slip.
  for (const n of ["zeros", "ones", "empty", "full"]) {
    FN["np." + n] = (ctx, call) => {
      if (n !== "full" && call.args.length > 1 && isInt(call.args[1])) {
        fail("np." + n + " takes the shape as one tuple: np." + n + "((" + call.args.map(show).join(", ") + ")). The second argument is the data type.", "Cannot interpret '" + call.args[1] + "' as a data type", "numpy");
      }
      const a = args(ctx, call, [["shape"], ...(n === "full" ? [["fill_value"]] : [])], n);
      return shapeArg(ctx, a.shape, a.$nodes.shape, "numpy");
    };
  }

  // ---------- Same shape ----------

  // One input, same shape out. Methods and functions in both libraries.
  const SAME = ["relu", "sigmoid", "tanh", "exp", "exp2", "log", "log2", "log10", "log1p", "expm1", "sqrt", "rsqrt", "abs", "absolute", "neg", "negative", "sin", "cos", "tan", "arcsin", "arccos", "arctan", "asin", "acos", "atan", "sinh", "cosh", "floor", "ceil", "round", "trunc", "sign", "square", "reciprocal", "erf", "clone", "detach", "float", "double", "half", "bfloat16", "int", "long", "short", "bool", "byte", "cpu", "cuda", "to", "type", "type_as", "requires_grad_", "clamp", "clip", "nan_to_num", "isnan", "isinf", "isfinite", "logical_not", "bitwise_not", "conj", "real", "imag", "angle", "deg2rad", "rad2deg", "copy", "astype", "fill_", "zero_", "normal_", "uniform_", "random_", "bernoulli", "sigmoid_", "relu_", "clamp_", "abs_", "exp_", "sqrt_", "neg_", "tanh_", "pin_memory", "share_memory_", "retain_grad", "nan_to_num_", "fliplr", "flipud", "triu", "tril", "rot90"];
  const SAME_F = ["relu", "relu6", "elu", "selu", "celu", "gelu", "silu", "mish", "sigmoid", "tanh", "softplus", "softsign", "leaky_relu", "hardtanh", "hardswish", "hardsigmoid", "logsigmoid", "tanhshrink", "dropout", "dropout1d", "dropout2d", "dropout3d", "alpha_dropout", "normalize", "gumbel_softmax", "prelu", "rrelu", "glu_"];
  const sameShape = (ctx, t) => TS.linkSame(tensor(t.shape, t.dims, t.lib), t);
  // Same shape, where every element along dims ds feeds each element.
  const along = (t, ds, approx) => TS.depAlong(tensor(t.shape, t.dims, t.lib), t, ds, approx);
  // These overwrite the values: nothing from before feeds the result.
  const FRESH = /^(fill_|zero_|normal_|uniform_|random_)$/;
  const flipped = (t, ds) => TS.link(tensor(t.shape, t.dims, t.lib), t, (idx) => idx.map((v, i) => (ds.includes(i) ? t.shape[i] - 1 - v : v)));
  for (const n of SAME) M[n] = (ctx, t, call) => {
    if (FRESH.test(n)) return Object.assign(tensor(t.shape, t.dims, t.lib), { fresh: true });
    if (n === "fliplr" || n === "flipud") return flipped(t, [n === "fliplr" ? 1 : 0]);
    if (n === "rot90") {
      const a = args(ctx, call, [["k", 1], ["dims", [0, 1], ["axes"]]], n);
      if (a.k % 2 === 0) return sameShape(ctx, t);
      const [i, j] = a.dims.map((d) => normDim(d, t.shape.length, t.lib));
      const shape = t.shape.slice(), dims = t.dims.slice();
      [shape[i], shape[j], dims[i], dims[j]] = [shape[j], shape[i], dims[j], dims[i]];
      // Each element moves somewhere in the same plane: tracked as the whole plane.
      return TS.depAlong(tensor(shape, dims, t.lib), t, [i, j], true);
    }
    return sameShape(ctx, t);
  };
  // As functions: torch.exp(x), np.exp(a). Some only exist in one library.
  const NOT_NP = /^(clone|detach|rsqrt|erf|bernoulli|pin_memory|relu|sigmoid|neg|asin|acos|atan|sigmoid_|logical_not_)$/;
  const NOT_TORCH = /^(copy|absolute_|astype)$/;
  for (const n of SAME) {
    if (/_$/.test(n) || /^(float|double|half|bfloat16|int|long|short|bool|byte|cpu|cuda|to|type|type_as|astype|requires_grad_|pin_memory|retain_grad)$/.test(n)) continue;
    if (!NOT_TORCH.test(n)) FN["torch." + n] = viaMethod(n, "torch");
    if (!NOT_NP.test(n)) FN["np." + n] = viaMethod(n, "numpy");
  }
  for (const n of SAME_F) FN["torch.nn.functional." + n] = (ctx, call) => viaMethodSame(ctx, call, n);
  function viaMethodSame(ctx, call, name) {
    const t = asTensor(call.args[0], "torch");
    // normalize divides by the norm along dim; gumbel_softmax is a softmax along dim.
    if (/normalize|gumbel_softmax/.test(name) && t.shape.length) {
      const d = call.kwargs.dim !== undefined ? call.kwargs.dim : /normalize/.test(name) ? (call.args[2] !== undefined ? call.args[2] : 1) : -1;
      return along(t, [normDim(d, t.shape.length, "torch")]);
    }
    return sameShape(ctx, t);
  }
  for (const n of ["softmax", "log_softmax"]) {
    M[n] = (ctx, t, call) => {
      const a = args(ctx, call, [["dim", null, ["axis"]]], n);
      let d;
      if (a.dim === null) {
        // PyTorch's old rule when dim is missing (it warns about it).
        d = [0, 1, 3].includes(t.shape.length) ? 0 : 1;
        ctx.warn("No dim given: PyTorch warns and guesses dim=" + d + " from the number of dimensions. Always pass dim=, usually dim=-1.");
      } else {
        d = normDim(a.dim, t.shape.length, t.lib);
        ctx.note("Each slice along " + dimName(t, d) + " now adds up to 1; the shape doesn't change.");
      }
      return t.shape.length ? along(t, [d]) : sameShape(ctx, t);
    };
    FN["torch." + n] = FN["torch.nn.functional." + n] = viaMethod(n, "torch");
  }
  // Running totals: element i along d is fed by elements 0…i.
  const upTo = (t, d) => TS.dep(tensor(t.shape, t.dims, t.lib), t, (idx) => idx.map((v, i) => (i === d ? [0, v] : v)));
  for (const n of ["cumsum", "cumprod", "cummax", "cummin", "logcumsumexp"]) {
    M[n] = (ctx, t, call) => {
      if (np(t.lib)) {
        const a = args(ctx, call, [["axis"], ["dtype"], ["out"]], n);
        if (a.axis === null && t.shape.length > 1) {
          ctx.note("No axis given, so NumPy flattens first and the result is 1D.");
          return tensor([numel(t.shape)], [dim("")], t.lib);
        }
        return a.axis === null ? (t.shape.length ? upTo(t, 0) : sameShape(ctx, t)) : upTo(t, normDim(a.axis, t.shape.length, t.lib));
      }
      const a = args(ctx, call, [["dim", null, ["axis"]]], n);
      if (a.dim === null) fail(n + "() in PyTorch needs a dim: x." + n + "(dim=0).", "", "torch");
      const d = normDim(a.dim, t.shape.length, t.lib);
      return /cummax|cummin/.test(n) ? pair(upTo(t, d), upTo(t, d)) : upTo(t, d);
    };
    FN["torch." + n] = viaMethod(n, "torch");
    if (/^cum(sum|prod)$/.test(n)) FN["np." + n] = viaMethod(n, "numpy");
  }
  for (const n of ["sort", "argsort"]) {
    M[n] = (ctx, t, call) => {
      if (np(t.lib)) {
        const a = args(ctx, call, [["axis", -1], ["kind"], ["order"]], n);
        if (a.axis === null) return TS.depAll(tensor([numel(t.shape)], [dim("")], t.lib), t);
        if (!t.shape.length) return sameShape(ctx, t);
        return along(t, [normDim(a.axis, t.shape.length, t.lib)]);
      }
      const a = args(ctx, call, [["dim", -1], ["descending", false]], n);
      const sorted = () => (t.shape.length ? along(t, [normDim(a.dim, t.shape.length, t.lib)]) : sameShape(ctx, t));
      if (n === "sort") {
        ctx.note("PyTorch's sort returns two tensors: (values, indices).");
        return pair(sorted(), sorted());
      }
      return sorted();
    };
    both(n);
  }
  M.flip = (ctx, t, call) => {
    const a = args(ctx, call, [np(t.lib) ? "axis" : "dims"].map((k) => [k, null, ["dims", "axis"]]), "flip");
    const d = a.dims !== undefined ? a.dims : a.axis;
    if (d === null && !np(t.lib)) fail("torch.flip needs dims: x.flip(0) or x.flip(dims=(0, 1)).", "", "torch");
    const ds = d === null ? t.shape.map((_, i) => i) : (Array.isArray(d) ? d : [d]).map((x) => normDim(x, t.shape.length, t.lib));
    return flipped(t, ds);
  };
  both("flip");
  // Each element moves along the rolled dims (or the whole flattened tensor): tracked as those dims.
  M.roll = (ctx, t, call) => {
    const d = call.kwargs.dims !== undefined ? call.kwargs.dims : call.kwargs.axis !== undefined ? call.kwargs.axis : call.args[1];
    if (d === undefined || d === null) return TS.depAll(tensor(t.shape, t.dims, t.lib), t, true);
    return along(t, (Array.isArray(d) ? d : [d]).map((x) => normDim(x, t.shape.length, t.lib)), true);
  };
  both("roll");

  // ---------- Element by element, with broadcasting ----------

  const elementwise = (TS.elementwise = function (ctx, vals) {
    const ts = vals.filter(isTensor);
    const lib = ts[0].lib;
    if (ts.some((t) => t.lib !== lib)) {
      fail("This mixes a NumPy array and a PyTorch tensor. Convert one first: torch.from_numpy(a) or t.numpy(). (What happens without converting depends on the order and the versions, so this tool doesn't guess.)", "", lib);
    }
    const all = vals.map((v) => asTensor(v, lib));
    const out = TS.broadcast(all, lib);
    vals.forEach((v) => isTensor(v) && TS.linkBroadcast(out, v));
    all.forEach((t) => {
      if (!isTensor(t) || !t.shape.length || same(t.shape, out.shape)) return;
      const padded = Array(out.shape.length - t.shape.length).fill(1).concat(t.shape);
      const grown = out.shape.map((n, i) => (padded[i] === 1 && n !== 1 ? i : -1)).filter((i) => i >= 0);
      ctx.note(
        shapeText(t.shape) + " is stretched to " + shapeText(out.shape) + ": lined up from the right" +
          (padded.length > t.shape.length ? ", it acts as " + shapeText(padded) : "") + ", and " +
          grown.map((i) => (out.dims[i].label ? out.dims[i].label : "dim " + i) + " is repeated " + out.shape[i] + " times").join(", ") + " (no copy is made)."
      );
    });
    return out;
  });
  const binary = (n) => (ctx, t, call) => {
    const other = call.args[0] !== undefined ? call.args[0] : call.kwargs.other;
    const out = elementwise(ctx, [t, other]);
    // In-place versions (add_) must keep the shape they started with.
    return out;
  };
  const BINARY = ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "true_divide", "floor_divide", "pow", "power", "fmod", "remainder", "mod", "maximum", "minimum", "fmax", "fmin", "atan2", "arctan2", "hypot", "eq", "ne", "lt", "le", "gt", "ge", "equal", "not_equal", "less", "less_equal", "greater", "greater_equal", "logical_and", "logical_or", "logical_xor", "bitwise_and", "bitwise_or", "copysign", "lerp", "xlogy"];
  for (const n of BINARY) {
    M[n] = binary(n);
    both(n, (ctx, call) => elementwise(ctx, call.args.slice(0, n === "lerp" ? 3 : 2)));
  }
  FN["torch.where"] = FN["np.where"] = (ctx, call) => {
    if (call.args.length === 1) fail("where(condition) with one argument returns the positions of the True values, so its size depends on the data, which this tool doesn't have.", "", ctx.lib);
    ctx.note("where(condition, a, b) picks from a or b; all three are broadcast together.");
    return elementwise(ctx, call.args.slice(0, 3));
  };
  M.where = (ctx, t, call) => elementwise(ctx, [call.args[0], t, call.args[1]]);
  M.masked_fill = (ctx, t, call) => {
    const out = elementwise(ctx, [t, call.args[0]]);
    if (!same(out.shape, t.shape)) fail("The mask " + shapeText(call.args[0].shape) + " must broadcast to the tensor's own shape " + shapeText(t.shape) + "; it would make " + shapeText(out.shape) + ".", "", t.lib);
    return TS.linkBroadcast(sameShape(ctx, t), call.args[0]);
  };

  // ---------- Reductions ----------

  // The dims to reduce: null = all of them.
  function reduceDims(ctx, t, d, tuple, what) {
    if (d === null || d === undefined) return null;
    if (Array.isArray(d) && !tuple) fail(what + "() takes one dimension here, not a tuple. Reduce one at a time, or reshape first.", "", t.lib);
    const ds = (Array.isArray(d) ? d : [d]).map((x) => normDim(x, t.shape.length, t.lib));
    const dup = ds.find((x, i) => ds.indexOf(x) !== i);
    if (dup !== undefined) fail("Dimension " + dup + " is listed twice.", np(t.lib) ? "duplicate value in 'axis'" : "dim " + dup + " appears multiple times in the list of dims", t.lib);
    return ds;
  }
  const reduced = (TS.reduced = function (ctx, t, ds, keep, verb) {
    const all = ds === null ? t.shape.map((_, i) => i) : ds;
    const shape = [], dims = [];
    t.shape.forEach((n, i) => {
      if (!all.includes(i)) {
        shape.push(n);
        dims.push(t.dims[i]);
      } else if (keep) {
        shape.push(1);
        dims.push(dim("", true));
      }
    });
    if (all.length) {
      ctx.note(
        verb + " over " + all.map((i) => dimName(t, i)).join(" and ") +
          (keep ? ": kept as size 1, so the result still lines up with the input for broadcasting."
            : shape.length ? ": " + (all.length === 1 ? "that dimension is" : "those dimensions are") + " gone." : ": everything becomes one number (0D).")
      );
    }
    // Each result element is fed by the whole range of every reduced dimension.
    return TS.dep(tensor(shape, dims, t.lib), t, (idx) => {
      let j = 0;
      return t.shape.map((n, i) => {
        if (!all.includes(i)) return idx[j++];
        if (keep) j++;
        return TS.ALL(n);
      });
    });
  });

  const REDUCE = {
    sum: ["Summed", true], nansum: ["Summed", true], mean: ["Averaged", true], nanmean: ["Averaged", true],
    prod: ["Multiplied", false], std: ["Took the standard deviation", true], var: ["Took the variance", true],
    amax: ["Took the maximum", true], amin: ["Took the minimum", true], any: ["Checked “any”", true], all: ["Checked “all”", true],
    logsumexp: ["Took log-sum-exp", true], count_nonzero: ["Counted non-zeros", true], argmax: ["Found the position of the maximum", false],
    argmin: ["Found the position of the minimum", false], ptp: ["Took max − min", true], nanstd: ["Took the standard deviation", true]
  };
  for (const [n, [verb, tuple]] of Object.entries(REDUCE)) {
    M[n] = (ctx, t, call) => {
      if (np(t.lib)) {
        const extra = /^(std|var|nanstd)$/.test(n) ? [["dtype"], ["out"], ["ddof"]] : /^(sum|nansum|mean|nanmean|prod)$/.test(n) ? [["dtype"], ["out"]] : [["out"]];
        const a = args(ctx, call, [["axis"], ...extra, ["keepdims", false]], n);
        return reduced(ctx, t, reduceDims(ctx, t, a.axis, !/^arg/.test(n), n), a.keepdims, verb);
      }
      const sig = /^(std|var)$/.test(n) ? [["dim", null, ["axis"]], ["unbiased"], ["keepdim", false, ["keepdims"]]] : [["dim", null, ["axis"]], ["keepdim", false, ["keepdims"]]];
      const a = args(ctx, call, sig, n);
      if (n === "logsumexp" && a.dim === null) fail("torch.logsumexp needs a dim: torch.logsumexp(x, dim=-1).", "", "torch");
      return reduced(ctx, t, reduceDims(ctx, t, a.dim, tuple, n), a.keepdim, verb);
    };
    both(n);
  }
  FN["np.average"] = viaMethod("mean", "numpy");
  // A second result fed by the same elements (the indices that go with max values…).
  const twin = (o) => Object.assign(tensor(o.shape, o.dims, o.lib), { src: o.src });
  for (const n of ["max", "min", "median", "mode", "nanmedian"]) {
    const verb = { max: "Took the maximum", min: "Took the minimum", median: "Took the median", mode: "Took the most common value", nanmedian: "Took the median" }[n];
    M[n] = (ctx, t, call) => {
      if (np(t.lib)) {
        const a = args(ctx, call, [["axis"], ["out"], ["keepdims", false]], n);
        return reduced(ctx, t, reduceDims(ctx, t, a.axis, true, n), a.keepdims, verb);
      }
      const a = args(ctx, call, [["dim", null, ["axis", "other"]], ["keepdim", false, ["keepdims"]]], n);
      if (isTensor(a.dim)) {
        ctx.note("Given a second tensor, " + n + "() compares them element by element, like torch." + (n === "max" ? "maximum" : "minimum") + ".");
        return elementwise(ctx, [t, a.dim]);
      }
      if (a.dim === null && n !== "mode") return reduced(ctx, t, null, false, verb);
      const out = reduced(ctx, t, reduceDims(ctx, t, a.dim === null ? -1 : a.dim, false, n), a.keepdim, verb);
      ctx.note("With a dim, " + n + "() returns two tensors: (values, indices). Use ." + n + "(dim).values, or unpack: v, i = x." + n + "(dim).");
      return pair(out, twin(out));
    };
    if (n !== "mode") FN["np." + n] = viaMethod(n, "numpy");
    FN["torch." + n] = viaMethod(n, "torch");
  }
  FN["np.amax"] = viaMethod("max", "numpy");
  FN["np.amin"] = viaMethod("min", "numpy");
  M.topk = (ctx, t, call) => {
    const a = args(ctx, call, [["k"], ["dim", -1], ["largest"], ["sorted"]], "topk");
    const d = normDim(a.dim, t.shape.length, t.lib);
    if (a.k > t.shape[d]) fail("Asked for the top " + a.k + " but " + dimName(t, d) + " only has " + t.shape[d] + ".", "selected index k out of range", "torch");
    const shape = t.shape.slice();
    shape[d] = a.k;
    ctx.note("Keeps the " + a.k + " largest along " + dimName(t, d) + ", as (values, indices).");
    const out = TS.depAlong(derive(t, shape, t.dims), t, [d]);
    return pair(out, twin(out));
  };
  FN["torch.topk"] = viaMethod("topk", "torch");

  // Norms: torch.norm(x, p, dim), torch.linalg.norm(x, ord, dim), np.linalg.norm(x, ord, axis).
  function norm(ctx, t, d, keep) {
    return reduced(ctx, t, reduceDims(ctx, t, d, true, "norm"), keep, "Took the norm");
  }
  M.norm = (ctx, t, call) => {
    const a = args(ctx, call, [["p"], ["dim", null, ["axis"]], ["keepdim", false]], "norm");
    return norm(ctx, t, a.dim, a.keepdim);
  };
  FN["torch.norm"] = viaMethod("norm", "torch");
  FN["torch.linalg.norm"] = FN["torch.linalg.vector_norm"] = (ctx, call) => {
    const a = args(ctx, call, [["input"], ["ord"], ["dim"], ["keepdim", false]], "norm");
    return norm(ctx, asTensor(a.input, "torch"), a.dim, a.keepdim);
  };
  FN["torch.linalg.matrix_norm"] = (ctx, call) => {
    const a = args(ctx, call, [["input"], ["ord"], ["dim", [-2, -1]], ["keepdim", false]], "matrix_norm");
    return norm(ctx, asTensor(a.input, "torch"), a.dim, a.keepdim);
  };
  FN["np.linalg.norm"] = (ctx, call) => {
    const a = args(ctx, call, [["x"], ["ord"], ["axis"], ["keepdims", false]], "norm");
    return norm(ctx, asTensor(a.x, "numpy"), a.axis, a.keepdims);
  };

  // ---------- Reshaping ----------

  // Fills in -1 and checks the element count stays the same.
  function newShape(ctx, t, s, what) {
    const shape = s.sizes.slice(), lib = t.lib, total = numel(t.shape);
    const unknown = shape.map((n, i) => (n === -1 ? i : -1)).filter((i) => i >= 0);
    if (unknown.length > 1) fail("Only one size can be -1 (“work this one out”).", np(lib) ? "can only specify one unknown dimension" : "only one dimension can be inferred", lib);
    const bad = shape.find((n) => n < -1);
    if (bad !== undefined) fail("A size can't be " + bad + ".", np(lib) ? "negative dimensions not allowed" : "invalid shape dimension " + bad, lib);
    if (unknown.length) {
      const rest = numel(shape.filter((n) => n !== -1));
      if (rest === 0 || total % rest) {
        fail("-1 can't be worked out: " + total + " elements don't divide evenly into groups of " + rest + " (the other sizes multiplied).", np(lib) ? "cannot reshape array of size " + total + " into shape " + plain(s.sizes) : "shape '[" + s.sizes.join(", ") + "]' is invalid for input of size " + total, lib);
      }
      shape[unknown[0]] = total / rest;
      ctx.note("-1 became " + total / rest + (rest === 1 ? " (all the elements)." : " (" + total + " elements ÷ " + rest + ")."));
    }
    if (numel(shape) !== total) {
      fail(
        "A " + shapeText(t.shape) + " " + kindOf(lib) + " has " + total.toLocaleString("en-US") + " elements, but " + shapeText(shape) + " needs " + numel(shape).toLocaleString("en-US") + ". " + what + " can rearrange elements, not add or remove them.",
        np(lib) ? "cannot reshape array of size " + total + " into shape " + plain(s.sizes) : "shape '[" + s.sizes.join(", ") + "]' is invalid for input of size " + total,
        lib
      );
    }
    return shape;
  }
  // Reshape to `shape` (already checked). PyTorch returns a view when the memory allows.
  function reshapeTo(ctx, t, shape, names, how) {
    const dims = TS.reshapeDims(t, shape);
    let out;
    if (view(t)) {
      const strides = TS.viewStrides(t.shape, t.strides, shape);
      if (!strides) {
        if (how === "view") {
          fail(
            "Can't .view() this tensor: " + t.layoutBy + " rearranged it without moving the data, so its memory isn't in the order .view() needs. Use .reshape() (copies if needed) or .contiguous().view().",
            "view size is not compatible with input tensor's size and stride (at least one dimension spans across two contiguous subspaces). Use .reshape(...) instead.",
            "torch"
          );
        }
        ctx.note("This makes a copy: " + (t.layoutBy || "an earlier step") + " left the memory out of order, so a view isn't possible.");
        out = tensor(shape, dims, t.lib);
      } else out = derive(t, shape, dims, strides);
    } else out = tensor(shape, dims, t.lib);
    nameDims(out, names || []);
    return TS.linkReshape(out, t);
  }
  function reshapeMethod(how) {
    return (ctx, t, call) => {
      if (how === "view" && np(t.lib)) fail("In NumPy, .view() reinterprets the data type; it doesn't change the shape. Use .reshape().", "", "numpy");
      const vals = "shape" in call.kwargs ? [call.kwargs.shape] : call.args;
      const nodes = "shape" in call.kwargs ? [call.kwnodes.shape] : call.nodes;
      if (!vals.length) fail("." + how + "() needs the new shape.", "", t.lib);
      const s = sizes(ctx, vals, nodes);
      return reshapeTo(ctx, t, newShape(ctx, t, s, how === "view" ? "A view" : "Reshaping"), s.names, how);
    };
  }
  M.reshape = reshapeMethod("reshape");
  M.view = reshapeMethod("view");
  both("reshape");
  M.view_as = (ctx, t, call) => reshapeTo(ctx, t, newShape(ctx, t, { sizes: call.args[0].shape }, "A view"), [], "view");
  M.reshape_as = (ctx, t, call) => reshapeTo(ctx, t, newShape(ctx, t, { sizes: call.args[0].shape }, "Reshaping"), [], "reshape");

  M.flatten = (ctx, t, call) => {
    if (np(t.lib)) {
      if (call.args.length && typeof call.args[0] !== "string") fail("NumPy's flatten() takes no dimensions; it always makes 1D. For PyTorch-style flatten(1), write a.reshape(a.shape[0], -1).", "order must be str, not int", "numpy");
      if (t.shape.length > 1) ctx.note("NumPy's flatten() always makes 1D (and always copies).");
      return TS.linkReshape(tensor([numel(t.shape)], TS.reshapeDims(t, [numel(t.shape)]), t.lib), t);
    }
    const a = args(ctx, call, [["start_dim", 0], ["end_dim", -1]], "flatten");
    if (!t.shape.length) return reshapeTo(ctx, t, [1], [], "reshape");
    const s = normDim(a.start_dim, t.shape.length, t.lib), e = normDim(a.end_dim, t.shape.length, t.lib);
    if (s > e) fail("flatten's start_dim comes after end_dim.", "flatten() has invalid args: start_dim cannot come after end_dim", "torch");
    const shape = [...t.shape.slice(0, s), numel(t.shape.slice(s, e + 1)), ...t.shape.slice(e + 1)];
    if (e > s) ctx.note("Merged " + t.shape.slice(s, e + 1).join(" × ") + " = " + shape[s] + " into one dimension" + (s > 0 ? "; " + (s === 1 ? "dim 0 is" : "dims 0 to " + (s - 1) + " are") + " kept" : "") + ".");
    return reshapeTo(ctx, t, shape, [], "reshape");
  };
  FN["torch.flatten"] = viaMethod("flatten", "torch");
  M.ravel = (ctx, t) => reshapeTo(ctx, t, [numel(t.shape)], [], "reshape");
  both("ravel");
  M.unflatten = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"], ["sizes"]], "unflatten");
    const d = normDim(a.dim, t.shape.length, t.lib);
    const s = sizes(ctx, [a.sizes], [a.$nodes.sizes]);
    const part = newShape(ctx, { shape: [t.shape[d]], lib: t.lib }, s, "unflatten");
    return reshapeTo(ctx, t, [...t.shape.slice(0, d), ...part, ...t.shape.slice(d + 1)], [...t.shape.slice(0, d).map(() => ""), ...s.names], "reshape");
  };
  FN["torch.unflatten"] = viaMethod("unflatten", "torch");

  // Removes and inserts dims, keeping strides for PyTorch views.
  function keepOnly(t, keep, by, fixed) {
    const idx = t.shape.map((_, i) => i).filter((i) => keep(i));
    const out = derive(t, idx.map((i) => t.shape[i]), idx.map((i) => t.dims[i]), view(t) ? idx.map((i) => t.strides[i]) : null, by);
    return TS.link(out, t, (o) => {
      let j = 0;
      return t.shape.map((_, i) => (keep(i) ? o[j++] : fixed ? fixed(i) : 0));
    });
  }
  M.squeeze = (ctx, t, call) => {
    const a = args(ctx, call, [[np(t.lib) ? "axis" : "dim", null, ["dim", "axis"]]], "squeeze");
    const d = np(t.lib) ? a.axis : a.dim;
    if (d === null) {
      const ones = t.shape.filter((n) => n === 1).length;
      ctx.note(ones ? "Removed every size-1 dimension (" + ones + "). Careful: with a batch of 1, this removes the batch dimension too." : "There are no size-1 dimensions, so nothing changes.");
      return keepOnly(t, (i) => t.shape[i] !== 1);
    }
    const ds = (Array.isArray(d) ? d : [d]).map((x) => normDim(x, t.shape.length, t.lib));
    for (const i of ds) {
      if (t.shape[i] === 1) continue;
      if (np(t.lib)) fail("Can't squeeze " + dimName(t, i) + ": only size-1 dimensions can be removed.", "cannot select an axis to squeeze out which has size not equal to one", "numpy");
      ctx.warn(dimName(t, i) + " isn't size 1, so PyTorch silently leaves it in place (no error). NumPy would raise an error here.");
    }
    return keepOnly(t, (i) => !(ds.includes(i) && t.shape[i] === 1));
  };
  both("squeeze");
  function insertOnes(ctx, t, positions) {
    const nd = t.shape.length + positions.length;
    const ps = positions.map((p) => normDim(p, nd, t.lib));
    if (new Set(ps).size !== ps.length) fail("The same position is listed twice.", "repeated axis", t.lib);
    const shape = [], dims = [], strides = [];
    let j = 0;
    for (let i = 0; i < nd; i++) {
      if (ps.includes(i)) {
        shape.push(1);
        dims.push(dim("", true));
        strides.push(j < t.shape.length ? t.strides[j] * t.shape[j] : 1);
      } else {
        shape.push(t.shape[j]);
        dims.push(t.dims[j]);
        strides.push(t.strides[j]);
        j++;
      }
    }
    ctx.note("Added a size-1 dimension at position " + ps.join(", ") + ". Nothing is copied; it's useful for broadcasting.");
    return TS.link(derive(t, shape, dims, view(t) ? strides : null), t, (o) => o.filter((_, i) => !ps.includes(i)));
  }
  M.unsqueeze = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"]], "unsqueeze");
    if (a.dim === null) fail("unsqueeze needs a position: x.unsqueeze(0).", "", t.lib);
    return insertOnes(ctx, t, [a.dim]);
  };
  FN["torch.unsqueeze"] = viaMethod("unsqueeze", "torch");
  FN["np.expand_dims"] = (ctx, call) => {
    const a = args(ctx, call, [["a"], ["axis"]], "expand_dims");
    return insertOnes(ctx, asTensor(a.a, "numpy"), Array.isArray(a.axis) ? a.axis : [a.axis]);
  };

  function permuteTo(ctx, t, order, by) {
    const shape = order.map((i) => t.shape[i]), dims = order.map((i) => t.dims[i]);
    const out = derive(t, shape, dims, view(t) ? order.map((i) => t.strides[i]) : null, by);
    TS.link(out, t, (o) => {
      const r = [];
      order.forEach((p, k) => (r[p] = o[k]));
      return r;
    });
    return out;
  }
  // A full reordering: permute (PyTorch) or transpose(axes) (NumPy).
  function permute(ctx, t, order, what) {
    const nd = t.shape.length, lib = t.lib;
    if (order.length !== nd) {
      fail(
        what + " needs one entry per dimension: the " + kindOf(lib) + " has " + nd + ", but " + order.length + (order.length === 1 ? " was" : " were") + " given.",
        np(lib) ? "axes don't match array" : "permute(sparse_coo): number of dimensions in the tensor input does not match the length of the desired ordering of dimensions i.e. input.dim() = " + nd + " is not equal to len(dims) = " + order.length,
        lib
      );
    }
    const ps = order.map((d) => normDim(d, nd, lib));
    if (new Set(ps).size !== nd) fail("Each dimension must appear exactly once in the new order.", np(lib) ? "repeated axis in transpose" : "permute(): duplicate dims are not allowed.", lib);
    const out = permuteTo(ctx, t, ps, "." + what + "()");
    if (ps.some((p, i) => p !== i)) {
      ctx.note("New order: " + ps.map((p) => (t.dims[p].label || "dim " + p)).join(", ") + ". Nothing moves in memory" + (view(t) ? ", so .view() won't work on the result until .contiguous(); .reshape() will." : "."));
    }
    return out;
  }
  M.permute = (ctx, t, call) => {
    const vals = "dims" in call.kwargs ? call.kwargs.dims : call.args.length === 1 && Array.isArray(call.args[0]) ? call.args[0] : call.args;
    return permute(ctx, t, vals, "permute");
  };
  FN["torch.permute"] = viaMethod("permute", "torch");
  function swap(ctx, t, d0, d1, by) {
    const nd = t.shape.length;
    const a = normDim(d0, nd, t.lib), b = normDim(d1, nd, t.lib);
    const order = t.shape.map((_, i) => i);
    [order[a], order[b]] = [order[b], order[a]];
    if (a !== b) ctx.note("Swapped " + dimName(t, a) + " and " + dimName(t, b) + "." + (view(t) ? " Nothing moves in memory, so .view() won't work on the result until .contiguous()." : ""));
    return permuteTo(ctx, t, order, by);
  }
  M.transpose = (ctx, t, call) => {
    if (np(t.lib)) {
      const vals = "axes" in call.kwargs ? call.kwargs.axes : call.args.length === 1 && (Array.isArray(call.args[0]) || call.args[0] === null) ? call.args[0] : call.args;
      if (vals === null || !vals.length) return reverse(ctx, t, ".transpose()");
      return permute(ctx, t, vals, "transpose");
    }
    const a = args(ctx, call, [["dim0"], ["dim1"]], "transpose");
    if (a.dim0 === null || a.dim1 === null) fail("PyTorch's transpose swaps two dimensions and needs both: x.transpose(0, 1). To reorder all of them, use .permute().", "", "torch");
    return swap(ctx, t, a.dim0, a.dim1, ".transpose()");
  };
  both("transpose");
  for (const n of ["swapaxes", "swapdims"]) {
    M[n] = (ctx, t, call) => swap(ctx, t, call.args[0], call.args[1], "." + n + "()");
    both(n);
  }
  function reverse(ctx, t, by) {
    if (t.shape.length > 1) ctx.note("Reverses the order of all " + t.shape.length + " dimensions.");
    return permuteTo(ctx, t, t.shape.map((_, i) => t.shape.length - 1 - i), by);
  }
  M.t = (ctx, t) => {
    if (t.shape.length > 2) fail(".t() only works on tensors with up to 2 dimensions; this one has " + t.shape.length + ". Use .transpose(a, b) or .mT.", "t() expects a tensor with <= 2 dimensions, but self is " + t.shape.length + "D", "torch");
    return t.shape.length === 2 ? swap(ctx, t, 0, 1, ".t()") : sameShape(ctx, t);
  };
  FN["torch.t"] = viaMethod("t", "torch");
  // .T and .mT are attributes, called by the evaluator.
  TS.attrT = function (ctx, t) {
    if (np(t.lib)) {
      if (t.shape.length > 2) ctx.warn(".T reverses all " + t.shape.length + " dimensions, not just the last two. For a batch of matrices use .swapaxes(-1, -2) (or .mT in NumPy 2).");
      return reverse(ctx, t, ".T");
    }
    if (t.shape.length === 2) return swap(ctx, t, 0, 1, ".T");
    if (t.shape.length > 2) ctx.warn("On tensors that aren't 2D, .T reverses all dimensions and PyTorch warns it's deprecated. Use .mT to swap the last two, or .permute().");
    return reverse(ctx, t, ".T");
  };
  TS.attrMT = function (ctx, t) {
    if (t.shape.length < 2) fail(".mT needs at least 2 dimensions (a matrix or a batch of them).", np(t.lib) ? "" : "tensor.mT is only supported on matrices or batches of matrices. Got " + t.shape.length + "-D tensor.", t.lib);
    return swap(ctx, t, -2, -1, ".mT");
  };
  function moveDims(ctx, t, src, dst, what) {
    const nd = t.shape.length;
    const s = (Array.isArray(src) ? src : [src]).map((d) => normDim(d, nd, t.lib));
    const d = (Array.isArray(dst) ? dst : [dst]).map((x) => normDim(x, nd, t.lib));
    if (s.length !== d.length) fail(what + " needs as many destinations as sources.", "", t.lib);
    const order = new Array(nd).fill(-1);
    s.forEach((x, i) => (order[d[i]] = x));
    const rest = t.shape.map((_, i) => i).filter((i) => !s.includes(i));
    for (let i = 0; i < nd; i++) if (order[i] < 0) order[i] = rest.shift();
    ctx.note("Moved " + s.map((x) => dimName(t, x)).join(", ") + " to position " + d.join(", ") + "; the others keep their order.");
    return permuteTo(ctx, t, order, "." + what + "()");
  }
  for (const n of ["movedim", "moveaxis"]) {
    M[n] = (ctx, t, call) => moveDims(ctx, t, call.args[0], call.args[1], n);
    both(n);
  }

  // expand / broadcast_to: stretch size-1 dims without copying.
  function expandTo(ctx, t, target, lib, what) {
    const nd = t.shape.length;
    if (target.length < nd) {
      fail("The target shape has fewer dimensions (" + target.length + ") than the " + kindOf(lib) + " (" + nd + ").", np(lib) ? "input operand has more dimensions than allowed by the axis remapping" : "expand(torch.FloatTensor{[" + t.shape.join(", ") + "]}, size=[" + target.join(", ") + "]): the number of sizes provided (" + target.length + ") must be greater or equal to the number of dimensions in the tensor (" + nd + ")", lib);
    }
    const lead = target.length - nd, shape = [], dims = [], strides = [];
    target.forEach((n, i) => {
      const j = i - lead;
      if (j < 0) {
        if (n === -1) fail("-1 (keep the size) only works for existing dimensions.", "", lib);
        shape.push(n);
        dims.push(dim("", n === 1));
        strides.push(0);
        return;
      }
      const old = t.shape[j];
      const size = n === -1 && !np(lib) ? old : n;
      if (old !== 1 && size !== old) {
        fail(
          "Can't stretch " + dimName(t, j) + " to " + size + ": only size-1 dimensions can be stretched.",
          np(lib) ? "operands could not be broadcast together with remapped shapes [original->remapped]: " + plain(t.shape) + " and requested shape " + plain(target) : "The expanded size of the tensor (" + size + ") must match the existing size (" + old + ") at non-singleton dimension " + i + ".  Target sizes: [" + target.join(", ") + "].  Tensor sizes: [" + t.shape.join(", ") + "]",
          lib
        );
      }
      shape.push(size);
      dims.push(t.dims[j]);
      strides.push(old === 1 && size !== 1 ? 0 : t.strides[j]);
    });
    const grown = shape.filter((n, i) => i < lead || (t.shape[i - lead] === 1 && n !== 1)).length;
    if (grown) ctx.note("Stretched without copying: every copy points at the same memory. Writing into the result would change all copies, so use .clone() (or .repeat()) first if you need to write.");
    return TS.linkBroadcast(derive(t, shape, dims, view(t) ? strides : null, what), t);
  }
  M.expand = (ctx, t, call) => {
    if (np(t.lib)) fail("NumPy arrays don't have .expand(). Use np.broadcast_to(a, shape).", "'numpy.ndarray' object has no attribute 'expand'", "numpy");
    const s = sizes(ctx, "size" in call.kwargs ? [call.kwargs.size] : call.args, call.nodes);
    const out = expandTo(ctx, t, s.sizes, t.lib, ".expand()");
    nameDims(out, s.names);
    return out;
  };
  M.expand_as = (ctx, t, call) => expandTo(ctx, t, call.args[0].shape, t.lib, ".expand_as()");
  M.broadcast_to = (ctx, t, call) => {
    const s = sizes(ctx, [call.args[0]], call.nodes);
    return expandTo(ctx, t, s.sizes, t.lib, "broadcast_to()");
  };
  both("broadcast_to");

  // repeat (PyTorch) and tile copy whole blocks; NumPy's repeat repeats each element.
  function tile(ctx, t, reps, what) {
    const nd = Math.max(t.shape.length, reps.length);
    const shape = Array(nd - t.shape.length).fill(1).concat(t.shape);
    const dims = Array(nd - t.shape.length).fill(0).map(() => dim("", true)).concat(t.dims);
    const r = Array(nd - reps.length).fill(1).concat(reps);
    const out = tensor(shape.map((n, i) => n * r[i]), dims, t.lib);
    const lead = nd - t.shape.length;
    TS.link(out, t, (o) => t.shape.map((n, i) => o[i + lead] % n));
    const changed = r.map((x, i) => (x !== 1 ? i : -1)).filter((i) => i >= 0);
    if (changed.length) ctx.note("Copies the whole " + kindOf(t.lib) + " like tiles: " + changed.map((i) => (out.dims[i].label || "dim " + i) + " × " + r[i]).join(", ") + ". This really copies the data (unlike expand).");
    return out;
  }
  M.repeat = (ctx, t, call) => {
    if (np(t.lib)) return npRepeat(ctx, t, call.args[0], call.args[1] === undefined ? call.kwargs.axis : call.args[1]);
    const s = sizes(ctx, call.args, call.nodes);
    if (s.sizes.length < t.shape.length) fail(".repeat() needs a count for every dimension (" + t.shape.length + "); use 1 to leave one alone.", "Number of dimensions of repeat dims can not be smaller than number of dimensions of tensor", "torch");
    return tile(ctx, t, s.sizes, "repeat");
  };
  M.tile = (ctx, t, call) => tile(ctx, t, sizes(ctx, call.args, call.nodes).sizes, "tile");
  both("tile");
  function npRepeat(ctx, t, reps, axis) {
    // Which source position a repeated position comes from.
    const source = (p) => {
      if (!Array.isArray(reps)) return Math.floor(p / reps);
      let acc = 0;
      for (let e = 0; e < reps.length; e++) {
        acc += reps[e];
        if (p < acc) return e;
      }
      return reps.length - 1;
    };
    if (axis === null || axis === undefined) {
      const n = Array.isArray(reps) ? reps.reduce((a, b) => a + b, 0) : numel(t.shape) * reps;
      ctx.note("No axis given, so the array is flattened first, then each element is repeated" + (Array.isArray(reps) ? "" : " " + reps + " times") + ".");
      const flatOut = tensor([n], [dim("")], t.lib);
      return Number.isNaN(n) ? flatOut : TS.link(flatOut, t, (o) => TS.unravel(source(o[0]), t.shape));
    }
    const d = normDim(axis, t.shape.length, t.lib);
    const shape = t.shape.slice();
    if (Array.isArray(reps)) {
      if (reps.length !== t.shape[d]) fail("A list of repeats needs one count per element of " + dimName(t, d) + ".", "", t.lib);
      shape[d] = reps.reduce((a, b) => a + b, 0);
    } else shape[d] = t.shape[d] * reps;
    ctx.note("Repeats each element " + (Array.isArray(reps) ? "the listed number of times" : reps + " times") + " in place along " + dimName(t, d) + " (a a b b, not a b a b). " + (np(t.lib) ? "For whole copies, use np.tile." : "For whole copies, use .repeat()."));
    const outR = tensor(shape, t.dims, t.lib);
    return Number.isNaN(shape[d]) ? outR : TS.link(outR, t, (o) => o.map((v, i) => (i === d ? source(v) : v)));
  }
  FN["np.repeat"] = (ctx, call) => {
    const a = args(ctx, call, [["a"], ["repeats"], ["axis"]], "repeat");
    return npRepeat(ctx, asTensor(a.a, "numpy"), a.repeats, a.axis);
  };
  M.repeat_interleave = (ctx, t, call) => {
    const a = args(ctx, call, [["repeats"], ["dim"]], "repeat_interleave");
    if (isTensor(a.repeats) && a.repeats.shape.length) fail("Repeat counts in a tensor come from the data, which this tool doesn't have. Use a whole number.", "", "torch");
    return npRepeat(ctx, t, isTensor(a.repeats) ? NaN : a.repeats, a.dim);
  };
  FN["torch.repeat_interleave"] = viaMethod("repeat_interleave", "torch");

  M.contiguous = (ctx, t) => {
    if (np(t.lib)) fail("NumPy arrays don't have .contiguous(). Use np.ascontiguousarray(a).", "'numpy.ndarray' object has no attribute 'contiguous'", "numpy");
    ctx.note(TS.isContiguous(t) ? "Already in order in memory, so nothing changes." : "Copies the data into the current order, so .view() works again.");
    return TS.linkSame(tensor(t.shape, t.dims, t.lib), t);
  };
  M.narrow = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"], ["start"], ["length"]], "narrow");
    const d = normDim(a.dim, t.shape.length, t.lib);
    const start = a.start < 0 ? a.start + t.shape[d] : a.start;
    if (start < 0 || start + a.length > t.shape[d]) fail("narrow(" + a.dim + ", " + a.start + ", " + a.length + ") goes past the end of " + dimName(t, d) + ".", "start (" + a.start + ") + length (" + a.length + ") exceeds dimension size (" + t.shape[d] + ").", "torch");
    const shape = t.shape.slice();
    shape[d] = a.length;
    return TS.link(derive(t, shape, t.dims, t.strides, ".narrow()"), t, (o) => o.map((v, i) => (i === d ? v + start : v)));
  };
  FN["torch.narrow"] = viaMethod("narrow", "torch");
  M.select = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"], ["index"]], "select");
    const d = normDim(a.dim, t.shape.length, t.lib);
    checkIndex(t, d, a.index);
    return keepOnly(t, (i) => i !== d, ".select()", () => (a.index < 0 ? a.index + t.shape[d] : a.index));
  };
  FN["torch.select"] = viaMethod("select", "torch");
  M.index_select = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"], ["index"]], "index_select");
    const d = normDim(a.dim, t.shape.length, t.lib);
    if (!isTensor(a.index) || a.index.shape.length > 1) fail("index_select needs a 1D tensor of indices.", "", "torch");
    const shape = t.shape.slice();
    shape[d] = a.index.shape[0] || 1;
    // Which row is picked depends on the index values: tracked as the whole of dim d.
    const out = TS.dep(tensor(shape, t.dims, t.lib), t, (idx) => idx.map((v, i) => (i === d ? TS.ALL(t.shape[d]) : v)), true);
    return TS.link(out, a.index, (idx) => (a.index.shape.length ? [idx[d]] : []));
  };
  FN["torch.index_select"] = viaMethod("index_select", "torch");
  M.gather = (ctx, t, call) => {
    const a = args(ctx, call, [["dim"], ["index"]], "gather");
    const d = normDim(a.dim, t.shape.length, t.lib);
    if (!isTensor(a.index) || a.index.shape.length !== t.shape.length) fail("gather's index needs the same number of dimensions as the input (" + t.shape.length + ").", "Index tensor must have the same number of dimensions as input tensor", "torch");
    ctx.note("The result has the index's shape, " + shapeText(a.index.shape) + ".");
    const out = TS.dep(tensor(a.index.shape, a.index.dims, t.lib), t, (idx) => idx.map((v, i) => (i === d ? TS.ALL(t.shape[d]) : Math.min(v, t.shape[i] - 1))), true);
    return TS.linkSame(out, a.index);
  };
  FN["torch.gather"] = viaMethod("gather", "torch");

  // ---------- Indexing ----------

  function checkIndex(t, d, i) {
    const n = t.shape[d];
    if (i < -n || i >= n) {
      fail(
        "Index " + i + " is past the end of " + dimName(t, d) + " (valid: " + (n ? -n + " to " + (n - 1) : "none, it's empty") + ").",
        np(t.lib) ? "index " + i + " is out of bounds for axis " + d + " with size " + n : "index " + i + " is out of bounds for dimension " + d + " with size " + n,
        t.lib
      );
    }
  }
  // Python's slice length for a, b, step on a dimension of size n.
  function sliceLength(a, b, c, n) {
    if (c > 0) {
      let s = a === null ? 0 : a < 0 ? Math.max(0, a + n) : Math.min(a, n);
      let e = b === null ? n : b < 0 ? Math.max(0, b + n) : Math.min(b, n);
      return Math.max(0, Math.ceil((e - s) / c));
    }
    let s = a === null ? n - 1 : a < 0 ? Math.max(-1, a + n) : Math.min(a, n - 1);
    let e = b === null ? -1 : b < 0 ? Math.max(-1, b + n) : Math.min(b, n - 1);
    return Math.max(0, Math.ceil((s - e) / -c));
  }
  // x[items]: ints, slices, None, ..., and one or more integer arrays (advanced indexing).
  TS.index = function (ctx, t, items) {
    const lib = t.lib, nd = t.shape.length;
    const isAdv = (v) => isTensor(v) || (Array.isArray(v) && v.list);
    for (const v of items) {
      if (isTensor(v) && v.bool) fail("A True/False mask picks however many values are True, which depends on the data this tool doesn't have. The result is 1D: (number of Trues" + (v.shape.length < nd ? ", " + t.shape.slice(v.shape.length).join(", ") : "") + ").", "", lib);
      if (typeof v === "boolean" || (Array.isArray(v) && v.list && v.some((x) => typeof x === "boolean"))) fail("Indexing with True/False values isn't supported: the result size depends on the data.", "", lib);
    }
    const consumes = (v) => (v === null || v === "..." ? 0 : isTensor(v) && v.bool ? v.shape.length : 1);
    const used = items.reduce((s, v) => s + consumes(v), 0);
    if (items.filter((v) => v === "...").length > 1) fail("Only one ... is allowed in an index.", np(lib) ? "an index can only have a single ellipsis ('...')" : "", lib);
    if (used > nd) fail("Too many indices: " + used + " for a " + nd + "D " + kindOf(lib) + ".", np(lib) ? "too many indices for array: array is " + nd + "-dimensional, but " + used + " were indexed" : "too many indices for tensor of dimension " + nd, lib);
    // Expand ... and pad with full slices.
    const full = { kind: "slice", a: null, b: null, c: null };
    const pos = items.indexOf("...");
    let list = pos >= 0 ? [...items.slice(0, pos), ...Array(nd - used).fill(full), ...items.slice(pos + 1)] : [...items, ...Array(nd - used).fill(full)];
    const shape = [], dims = [], strides = [], notes = [];
    const adv = [];
    const reads = []; // { out, d, start, step } | { d, fixed } | { out, d, values }
    let d = 0;
    list.forEach((v, k) => {
      if (v === null) {
        shape.push(1);
        dims.push(dim("", true));
        strides.push(1);
        notes.push("None adds a size-1 dimension");
        return;
      }
      if (typeof v === "number") {
        if (Number.isNaN(v)) fail("That index comes from the data, which this tool doesn't have.", "", lib);
        checkIndex(t, d, v);
        reads.push({ d, fixed: v < 0 ? v + t.shape[d] : v });
        notes.push("[" + v + "] picks one from " + dimName(t, d) + ", so it's gone");
        d++;
        return;
      }
      if (v && v.kind === "slice") {
        const c = v.c === null ? 1 : v.c;
        if (c === 0) fail("A slice step can't be 0.", "slice step cannot be zero", lib);
        if (c < 0 && !np(lib)) fail("PyTorch slices can't step backwards. Use .flip(dim) instead.", "step must be greater than zero", "torch");
        const n = sliceLength(v.a, v.b, c, t.shape[d]);
        if (n !== t.shape[d]) notes.push("the slice keeps " + n + " of " + dimName(t, d));
        if (n === 0) ctx.warn("This slice is empty: " + dimName(t, d) + " becomes 0.");
        const size = t.shape[d];
        const start = c > 0 ? (v.a === null ? 0 : v.a < 0 ? Math.max(0, v.a + size) : Math.min(v.a, size)) : v.a === null ? size - 1 : v.a < 0 ? v.a + size : Math.min(v.a, size - 1);
        reads.push({ out: shape.length, d, start, step: c });
        shape.push(n);
        dims.push(t.dims[d]);
        strides.push(t.strides[d] * c);
        d++;
        return;
      }
      if (isAdv(v)) {
        const it = isTensor(v) ? v : asTensor(v, lib);
        if (Array.isArray(v)) v.flat(Infinity).forEach((i) => typeof i === "number" && checkIndex(t, d, i));
        adv.push({ at: shape.length, k, it, d });
        if (Array.isArray(v) && v.every((x) => typeof x === "number")) reads.push({ out: shape.length, d, values: v.map((x) => (x < 0 ? x + t.shape[d] : x)) });
        notes.push("the list of indices replaces " + dimName(t, d) + " with its own shape " + shapeText(it.shape));
        shape.push(null);
        dims.push(null);
        strides.push(0);
        d++;
        return;
      }
      fail("Can't index with " + show(v) + ".", "", lib);
    });
    if (notes.length) ctx.note(notes.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".");
    const readFrom = (o) => {
      const r = new Array(nd).fill(0);
      for (const x of reads) r[x.d] = x.fixed !== undefined ? x.fixed : x.values ? x.values[o[x.out]] : x.start + o[x.out] * x.step;
      return r;
    };
    if (!adv.length) return TS.link(derive(t, shape, dims, view(t) ? strides : null, "slicing"), t, readFrom);
    // One list of plain numbers: the result keeps the same positions, so it can be followed too.
    const simple = adv.length === 1 && reads.some((x) => x.values);
    // Integer arrays: their shapes broadcast together; the result goes where the
    // first one was if they're next to each other, otherwise to the front.
    const b = adv.length > 1 ? TS.broadcast(adv.map((x) => x.it), lib) : adv[0].it;
    const together = adv.every((x, i) => !i || x.k === adv[i - 1].k + 1);
    const keep = (arr) => arr.filter((_, i) => !adv.some((x) => x.at === i));
    const at = together ? adv[0].at : 0;
    if (adv.length > 1) ctx.note(together ? "The index lists broadcast together to " + shapeText(b.shape) + "." : "The index lists aren't next to each other, so their shape " + shapeText(b.shape) + " moves to the front (NumPy and PyTorch both do this).");
    const restShape = keep(shape), restDims = keep(dims);
    restShape.splice(at, 0, ...b.shape);
    restDims.splice(at, 0, ...b.dims);
    ctx.note("Indexing with a list makes a copy.");
    const result = tensor(restShape, restDims, lib);
    return simple ? TS.link(result, t, readFrom) : result;
  };

  // ---------- Joining and splitting ----------

  function tensorList(v, lib, what) {
    if (isTensor(v)) fail(what + " takes a list of tensors in brackets: " + what + "([a, b]).", "", lib);
    if (!Array.isArray(v) || !v.length) fail(what + " needs a non-empty list of " + kindOf(lib) + "s.", "", lib);
    return v.map((x) => asTensor(x, lib, what));
  }
  function concat(ctx, ts, d, lib) {
    if (d === null) {
      ctx.note("axis=None flattens every array, then joins them end to end.");
      return tensor([ts.reduce((s, t) => s + numel(t.shape), 0)], [dim("")], lib);
    }
    const nd = ts[0].shape.length;
    if (!nd) fail("0D tensors (single numbers) can't be joined along a dimension; use stack to make a 1D tensor.", np(lib) ? "zero-dimensional arrays cannot be concatenated" : "zero-dimensional tensor (at position 0) cannot be concatenated", lib);
    ts.forEach((t, i) => {
      if (t.shape.length !== nd) {
        fail(
          "Everything joined must have the same number of dimensions, but #0 is " + nd + "D " + shapeText(ts[0].shape) + " and #" + i + " is " + t.shape.length + "D " + shapeText(t.shape) + ". Add or remove a size-1 dimension first (unsqueeze / squeeze).",
          np(lib) ? "all the input arrays must have same number of dimensions, but the array at index 0 has " + nd + " dimension(s) and the array at index " + i + " has " + t.shape.length + " dimension(s)" : "Tensors must have same number of dimensions: got " + nd + " and " + t.shape.length,
          lib
        );
      }
    });
    const k = normDim(d, nd, lib);
    ts.forEach((t, i) => t.shape.forEach((n, j) => {
      if (j === k || n === ts[0].shape[j]) return;
      fail(
        "Joining along " + dimName(ts[0], k) + " needs every other dimension to match, but at dim " + j + " #0 has " + ts[0].shape[j] + " and #" + i + " has " + n + ".",
        np(lib) ? "all the input array dimensions except for the concatenation axis must match exactly, but along dimension " + j + ", the array at index 0 has size " + ts[0].shape[j] + " and the array at index " + i + " has size " + n : "Sizes of tensors must match except in dimension " + k + ". Expected size " + ts[0].shape[j] + " but got size " + n + " for tensor number " + i + " in the list.",
        lib
      );
    }));
    const shape = ts[0].shape.slice();
    shape[k] = ts.reduce((s, t) => s + t.shape[k], 0);
    ctx.note("Joined end to end along " + dimName(ts[0], k) + ": " + ts.map((t) => t.shape[k]).join(" + ") + " = " + shape[k] + ". No new dimension is added (that's stack).");
    const joined = tensor(shape, ts[0].dims, lib);
    let offset = 0;
    ts.forEach((t) => {
      const from = offset, len = t.shape[k];
      TS.link(joined, t, (o) => (o[k] >= from && o[k] < from + len ? o.map((v, i) => (i === k ? v - from : v)) : null), true);
      offset += len;
    });
    return joined;
  }
  const catFn = (lib) => (ctx, call) => {
    const a = args(ctx, call, [["tensors"], [np(lib) ? "axis" : "dim", 0, ["dim", "axis"]]], np(lib) ? "concatenate" : "cat");
    return concat(ctx, tensorList(a.tensors, lib, np(lib) ? "np.concatenate" : "torch.cat"), np(lib) ? a.axis : a.dim, lib);
  };
  for (const n of ["cat", "concat", "concatenate"]) FN["torch." + n] = catFn("torch");
  for (const n of ["concatenate", "concat"]) FN["np." + n] = catFn("numpy");
  function stack(ctx, ts, d, lib) {
    ts.forEach((t, i) => {
      if (same(t.shape, ts[0].shape)) return;
      fail("stack needs every " + kindOf(lib) + " to have exactly the same shape, but #0 is " + shapeText(ts[0].shape) + " and #" + i + " is " + shapeText(t.shape) + ".", np(lib) ? "all input arrays must have the same shape" : "stack expects each tensor to be equal size, but got [" + ts[0].shape.join(", ") + "] at entry 0 and [" + t.shape.join(", ") + "] at entry " + i, lib);
    });
    const k = normDim(d, ts[0].shape.length, lib, 1);
    const shape = ts[0].shape.slice(), dims = ts[0].dims.slice();
    shape.splice(k, 0, ts.length);
    dims.splice(k, 0, dim("", ts.length === 1));
    ctx.note("Adds a new dimension of size " + ts.length + " (one slot per " + kindOf(lib) + ") at position " + k + ". To join along an existing dimension instead, use " + (np(lib) ? "np.concatenate" : "torch.cat") + ".");
    const stacked = tensor(shape, dims, lib);
    ts.forEach((t, n) => TS.link(stacked, t, (o) => (o[k] === n ? o.filter((_, i) => i !== k) : null), true));
    return stacked;
  }
  const stackFn = (lib) => (ctx, call) => {
    const a = args(ctx, call, [["tensors"], [np(lib) ? "axis" : "dim", 0, ["dim", "axis"]]], "stack");
    return stack(ctx, tensorList(a.tensors, lib, np(lib) ? "np.stack" : "torch.stack"), np(lib) ? a.axis : a.dim, lib);
  };
  FN["torch.stack"] = stackFn("torch");
  FN["np.stack"] = stackFn("numpy");
  // hstack / vstack / dstack first raise each input to at least 1, 2 or 3 dims.
  function atLeast(ctx, t, n) {
    if (t.shape.length >= n) return t;
    const one = () => dim("", true);
    if (n === 1) return tensor([1], [one()], t.lib);
    if (n === 2) return t.shape.length === 0 ? tensor([1, 1], [one(), one()], t.lib) : tensor([1, t.shape[0]], [one(), t.dims[0]], t.lib);
    if (t.shape.length === 0) return tensor([1, 1, 1], [one(), one(), one()], t.lib);
    if (t.shape.length === 1) return tensor([1, t.shape[0], 1], [one(), t.dims[0], one()], t.lib);
    return tensor([...t.shape, 1], [...t.dims, one()], t.lib);
  }
  for (const [n, min, axis] of [["hstack", 1, 1], ["vstack", 2, 0], ["row_stack", 2, 0], ["dstack", 3, 2]]) {
    const fn = (lib) => (ctx, call) => {
      const ts = tensorList(call.args[0], lib, n).map((t) => atLeast(ctx, t, min));
      if (min > 1 && call.args[0].some((t) => isTensor(t) && t.shape.length < min)) ctx.note(n + " first turns " + (min === 2 ? "1D (n,) into (1, n)" : "1D (n,) into (1, n, 1) and 2D (m, n) into (m, n, 1)") + ".");
      return concat(ctx, ts, n === "hstack" && ts[0].shape.length === 1 ? 0 : axis, lib);
    };
    FN["torch." + n] = fn("torch");
    FN["np." + n] = fn("numpy");
  }
  for (const n of ["atleast_1d", "atleast_2d", "atleast_3d"]) both(n, (ctx, call) => atLeast(ctx, asTensor(call.args[0], ctx.lib), Number(n[8])));

  function pieces(t, k, lens, by) {
    let offset = 0;
    return lens.map((n) => {
      const shape = t.shape.slice(), from = offset;
      shape[k] = n;
      offset += n;
      return TS.link(derive(t, shape, t.dims, view(t) ? t.strides : null, by), t, (o) => o.map((v, i) => (i === k ? v + from : v)));
    });
  }
  M.split = (ctx, t, call) => {
    if (np(t.lib)) fail("NumPy arrays don't have .split(). Use np.split(a, sections, axis=…).", "'numpy.ndarray' object has no attribute 'split'", "numpy");
    const a = args(ctx, call, [["split_size_or_sections", null, ["split_size"]], ["dim", 0]], "split");
    const k = normDim(a.dim, t.shape.length, t.lib), n = t.shape[k], s = a.split_size_or_sections;
    let lens = [];
    if (Array.isArray(s)) {
      const sum = s.reduce((x, y) => x + y, 0);
      if (sum !== n) fail("The sizes " + show(s) + " add up to " + sum + ", but " + dimName(t, k) + " has " + n + ".", "split_with_sizes expects split_sizes to sum exactly to " + n + " (input tensor's size at dimension " + k + "), but got split_sizes=[" + s.join(", ") + "]", "torch");
      lens = s.slice();
      ctx.note("Cut " + dimName(t, k) + " into pieces of " + s.join(", ") + ".");
    } else {
      if (!isInt(s) || s <= 0) fail("split needs a positive piece size or a list of sizes.", "", "torch");
      for (let i = 0; i < n; i += s) lens.push(Math.min(s, n - i));
      ctx.note("Cut " + dimName(t, k) + " into pieces of " + s + ": that's " + lens.length + " piece" + (lens.length === 1 ? "" : "s") + (n % s ? ", the last one has only " + (n % s) : "") + ". Note: the number is a size, not a count (that's chunk).");
    }
    return pieces(t, k, lens, ".split()");
  };
  FN["torch.split"] = viaMethod("split", "torch");
  M.chunk = (ctx, t, call) => {
    const a = args(ctx, call, [["chunks"], ["dim", 0]], "chunk");
    const k = normDim(a.dim, t.shape.length, t.lib), n = t.shape[k];
    if (!isInt(a.chunks) || a.chunks <= 0) fail("chunk needs a positive number of chunks.", "chunk expects `chunks` to be greater than 0, got: " + a.chunks, "torch");
    const size = Math.ceil(n / a.chunks), lens = [];
    for (let i = 0; i < n; i += size) lens.push(Math.min(size, n - i));
    if (lens.length !== a.chunks) ctx.warn("Asked for " + a.chunks + " chunks but got " + lens.length + ": chunk uses pieces of ⌈" + n + " ÷ " + a.chunks + "⌉ = " + size + " and can return fewer. torch.tensor_split always returns exactly " + a.chunks + ".");
    else ctx.note("Cut " + dimName(t, k) + " into " + lens.length + " chunks of " + (n % size ? "up to " : "") + size + ".");
    return pieces(t, k, lens, ".chunk()");
  };
  FN["torch.chunk"] = viaMethod("chunk", "torch");
  M.unbind = (ctx, t, call) => {
    const a = args(ctx, call, [["dim", 0]], "unbind");
    const k = normDim(a.dim, t.shape.length, t.lib);
    ctx.note("Splits along " + dimName(t, k) + " into " + t.shape[k] + " separate tensors, each without that dimension.");
    return Array.from({ length: t.shape[k] }, (_, piece) => keepOnly(t, (i) => i !== k, ".unbind()", () => piece));
  };
  FN["torch.unbind"] = viaMethod("unbind", "torch");
  for (const n of ["split", "array_split"]) {
    FN["np." + n] = (ctx, call) => {
      const a = args(ctx, call, [["ary"], ["indices_or_sections"], ["axis", 0]], n);
      const t = asTensor(a.ary, "numpy"), k = normDim(a.axis, t.shape.length, "numpy"), len = t.shape[k], s = a.indices_or_sections;
      let lens = [];
      if (Array.isArray(s)) {
        let prev = 0;
        for (const i of [...s, len]) {
          const at = Math.min(Math.max(i < 0 ? i + len : i, prev), len);
          lens.push(at - prev);
          prev = at;
        }
        ctx.note("Cut " + dimName(t, k) + " at positions " + s.join(", ") + ".");
      } else if (n === "split") {
        if (len % s) fail(dimName(t, k) + " can't be cut into " + s + " equal parts. Use np.array_split for unequal parts.", "array split does not result in an equal division", "numpy");
        lens = Array(s).fill(len / s);
        ctx.note("Cut " + dimName(t, k) + " into " + s + " equal parts of " + len / s + ". Note: in NumPy the number is a count of parts (in torch.split it's a size).");
      } else {
        const base = Math.floor(len / s), extra = len % s;
        lens = Array.from({ length: s }, (_, i) => base + (i < extra ? 1 : 0));
        ctx.note("Cut " + dimName(t, k) + " into " + s + " parts: " + lens.join(", ") + ".");
      }
      return pieces(t, k, lens);
    };
  }

  // ---------- Matrices ----------

  const matmul = (TS.matmul = function (ctx, a, b, what) {
    const lib = a.lib;
    if (b.lib !== lib) elementwise(ctx, [a, b]); // raises the mixing error
    if (!a.shape.length || !b.shape.length) fail("Matrix multiplication needs at least 1 dimension on each side; one side is a single number (0D). Use * for that.", np(lib) ? "matmul: Input operand " + (a.shape.length ? 1 : 0) + " does not have enough dimensions (has 0, gufunc core with signature (n?,k),(k,m?)->(n?,m?) requires 1)" : "both arguments to matmul need to be at least 1D, but they are " + a.shape.length + "D and " + b.shape.length + "D", lib);
    const one = () => dim("", true);
    const A = a.shape.length === 1 ? { shape: [1, a.shape[0]], dims: [one(), a.dims[0]] } : a;
    const B = b.shape.length === 1 ? { shape: [b.shape[0], 1], dims: [b.dims[0], one()] } : b;
    const n = A.shape[A.shape.length - 2], k1 = A.shape[A.shape.length - 1], k2 = B.shape[B.shape.length - 2], p = B.shape[B.shape.length - 1];
    if (a.shape.length === 1) ctx.note("The left side is 1D, so it's treated as one row (1, " + k1 + ") and that 1 is dropped again afterwards.");
    if (b.shape.length === 1) ctx.note("The right side is 1D, so it's treated as one column (" + k2 + ", 1) and that 1 is dropped again afterwards.");
    if (k1 !== k2) {
      fail(
        "The inner sizes don't match: the left's last dimension is " + k1 + ", but the right's " + (b.shape.length === 1 ? "only" : "second-to-last") + " dimension is " + k2 + ". For A @ B, A's columns must equal B's rows. Maybe transpose one side (.mT)?",
        np(lib) ? "matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size " + k2 + " is different from " + k1 + ")" : a.shape.length === 2 && b.shape.length === 2 ? "mat1 and mat2 shapes cannot be multiplied (" + n + "x" + k1 + " and " + k2 + "x" + p + ")" : "",
        lib
      );
    }
    const ba = { shape: A.shape.slice(0, -2), dims: A.dims.slice(0, -2) }, bb = { shape: B.shape.slice(0, -2), dims: B.dims.slice(0, -2) };
    let batch;
    try {
      batch = TS.broadcast([ba, bb], lib);
    } catch (e) {
      fail("The batch dimensions (everything before the last two) don't broadcast: " + shapeText(ba.shape) + " and " + shapeText(bb.shape) + ". Each must match or be 1, lined up from the right.", "", lib);
    }
    if (ba.shape.length + bb.shape.length) {
      if (!same(ba.shape, bb.shape)) ctx.note("Batch dimensions " + shapeText(ba.shape) + " and " + shapeText(bb.shape) + " broadcast to " + shapeText(batch.shape) + ": one matrix product per batch entry.");
      else ctx.note("One " + n + "×" + k1 + " @ " + k2 + "×" + p + " product for each of the " + numel(batch.shape) + " batch entries " + shapeText(batch.shape) + ".");
    }
    const shape = [...batch.shape], dims = [...batch.dims];
    if (a.shape.length > 1) {
      shape.push(n);
      dims.push(A.dims[A.dims.length - 2]);
    }
    if (b.shape.length > 1) {
      shape.push(p);
      dims.push(B.dims[B.dims.length - 1]);
    }
    ctx.note("The shared size " + k1 + " is multiplied pairwise and summed, so it disappears.");
    // out[…, i, j] is fed by row i of a and column j of b (the whole shared size).
    const out = tensor(shape, dims, lib), nb = batch.shape.length;
    const aB = Math.max(a.shape.length - 2, 0), bB = Math.max(b.shape.length - 2, 0);
    TS.dep(out, a, (idx) => [...TS.alignBatch(idx, a, aB, nb - aB), ...(a.shape.length > 1 ? [idx[nb]] : []), TS.ALL(k1)]);
    TS.dep(out, b, (idx) => [...TS.alignBatch(idx, b, bB, nb - bB), TS.ALL(k2), ...(b.shape.length > 1 ? [idx[idx.length - 1]] : [])]);
    return out;
  });
  both("matmul", (ctx, call) => matmul(ctx, asTensor(call.args[0], ctx.lib), asTensor(call.args[1], ctx.lib), "matmul"));
  M.matmul = (ctx, t, call) => matmul(ctx, t, asTensor(call.args[0], t.lib), "matmul");
  function needDims(t, n, what, real) {
    if (t.shape.length !== n) fail(what + " only takes " + n + "D " + kindOf(t.lib) + "s; this one is " + t.shape.length + "D " + shapeText(t.shape) + ". " + (n === 2 ? "For batches, use @ (torch.matmul)." : n === 3 ? "For other shapes, use @ (torch.matmul)." : ""), real || "", t.lib);
  }
  M.mm = (ctx, t, call) => {
    const b = call.args[0];
    needDims(t, 2, "torch.mm", "self must be a matrix");
    needDims(b, 2, "torch.mm", "mat2 must be a matrix");
    return matmul(ctx, t, b, "mm");
  };
  FN["torch.mm"] = viaMethod("mm", "torch");
  M.bmm = (ctx, t, call) => {
    const b = call.args[0];
    needDims(t, 3, "torch.bmm", "batch1 must be a 3D tensor");
    needDims(b, 3, "torch.bmm", "batch2 must be a 3D tensor");
    if (t.shape[0] !== b.shape[0]) fail("bmm doesn't broadcast: both batches must be the same size, but they are " + t.shape[0] + " and " + b.shape[0] + ". Use @ (torch.matmul) to broadcast.", "", "torch");
    return matmul(ctx, t, b, "bmm");
  };
  FN["torch.bmm"] = viaMethod("bmm", "torch");
  M.mv = (ctx, t, call) => {
    needDims(t, 2, "torch.mv");
    needDims(call.args[0], 1, "torch.mv's vector");
    return matmul(ctx, t, call.args[0], "mv");
  };
  FN["torch.mv"] = viaMethod("mv", "torch");
  M.dot = (ctx, t, call) => (np(t.lib) ? npDot(ctx, t, asTensor(call.args[0], "numpy")) : torchDot(ctx, t, call.args[0]));
  function torchDot(ctx, a, b) {
    if (a.shape.length !== 1 || b.shape.length !== 1) fail("torch.dot only takes two 1D tensors. For matrices use @ (torch.matmul).", "1D tensors expected, but got " + a.shape.length + "D and " + b.shape.length + "D tensors", "torch");
    if (a.shape[0] !== b.shape[0]) fail("torch.dot needs equal lengths; got " + a.shape[0] + " and " + b.shape[0] + ".", "inconsistent tensor size, expected tensor [" + a.shape[0] + "] and src [" + b.shape[0] + "] to have the same number of elements, but got " + a.shape[0] + " and " + b.shape[0] + " elements respectively", "torch");
    ctx.note("Multiplies pairwise and sums: one number (0D).");
    return TS.depAll(TS.depAll(tensor([], [], "torch"), a), b);
  }
  FN["torch.dot"] = FN["torch.inner"] = (ctx, call) => torchDot(ctx, call.args[0], call.args[1]);
  function npDot(ctx, a, b) {
    if (!a.shape.length || !b.shape.length) {
      ctx.note("With a single number, np.dot is plain multiplication.");
      return elementwise(ctx, [a, b]);
    }
    const ka = a.shape[a.shape.length - 1];
    const kbAt = b.shape.length === 1 ? 0 : b.shape.length - 2, kb = b.shape[kbAt];
    if (ka !== kb) fail("The sizes being summed don't match: a's last dimension is " + ka + " but b's " + (b.shape.length === 1 ? "only" : "second-to-last") + " is " + kb + ".", "shapes " + plain(a.shape) + " and " + plain(b.shape) + " not aligned: " + ka + " (dim " + (a.shape.length - 1) + ") != " + kb + " (dim " + kbAt + ")", "numpy");
    if (b.shape.length === 1) {
      ctx.note("Sums a's last dimension against b.");
      const mv = TS.dep(tensor(a.shape.slice(0, -1), a.dims.slice(0, -1), "numpy"), a, (idx) => [...idx, TS.ALL(ka)]);
      return TS.depAll(mv, b);
    }
    if (a.shape.length > 2 || b.shape.length > 2) ctx.warn("np.dot on 3D+ arrays is NOT batched matrix multiplication: it pairs every matrix in a with every matrix in b, so both sets of batch dimensions appear. For one product per batch entry, use a @ b (np.matmul).");
    ctx.note("The shared size " + ka + " is multiplied pairwise and summed, so it disappears.");
    const out = tensor([...a.shape.slice(0, -1), ...b.shape.slice(0, -2), b.shape[b.shape.length - 1]], [...a.dims.slice(0, -1), ...b.dims.slice(0, -2), b.dims[b.dims.length - 1]], "numpy");
    const na = a.shape.length - 1, nbb = b.shape.length - 2;
    TS.dep(out, a, (idx) => [...idx.slice(0, na), TS.ALL(ka)]);
    return TS.dep(out, b, (idx) => [...idx.slice(na, na + nbb), TS.ALL(kb), idx[idx.length - 1]]);
  }
  FN["np.dot"] = (ctx, call) => npDot(ctx, asTensor(call.args[0], "numpy"), asTensor(call.args[1], "numpy"));
  both("outer", (ctx, call) => {
    let [a, b] = call.args.map((x) => asTensor(x, ctx.lib));
    if (np(ctx.lib)) {
      if (a.shape.length !== 1 || b.shape.length !== 1) ctx.note("np.outer flattens both inputs first.");
    } else if (a.shape.length !== 1 || b.shape.length !== 1) fail("torch.outer takes two 1D tensors.", "outer: Expected 1-D argument self, but got " + a.shape.length + "-D", "torch");
    const n = numel(a.shape), m = numel(b.shape);
    ctx.note("Every element of the first times every element of the second: " + n + " × " + m + ".");
    const out = tensor([n, m], [a.shape.length === 1 ? a.dims[0] : dim(""), b.shape.length === 1 ? b.dims[0] : dim("")], ctx.lib);
    // One element of each: exact, so it can be followed by color too.
    TS.link(out, a, (idx) => TS.unravel(idx[0], a.shape));
    return TS.link(out, b, (idx) => TS.unravel(idx[1], b.shape));
  });
  FN["torch.ger"] = FN["torch.outer"];

  // einsum("bij,bjk->bik", a, b): each letter is a dimension; letters missing from the output are summed.
  both("einsum", (ctx, call) => {
    const lib = ctx.lib;
    if (typeof call.args[0] !== "string") fail("einsum's first argument is the equation as text, like \"ij,jk->ik\".", "", lib);
    const eq = call.args[0].replace(/\s+/g, "");
    let ops = call.args.slice(1);
    if (ops.length === 1 && Array.isArray(ops[0])) ops = ops[0];
    ops = ops.map((o) => asTensor(o, lib, "einsum"));
    const [lhs, rhs] = eq.split("->");
    const terms = lhs.split(",");
    if (terms.length !== ops.length) fail("The equation has " + terms.length + " input" + (terms.length === 1 ? "" : "s") + " but " + ops.length + " " + kindOf(lib) + (ops.length === 1 ? " was" : "s were") + " given.", np(lib) ? "" : "einsum(): " + (ops.length > terms.length ? "more" : "fewer") + " operands were provided than specified in the equation", lib);
    const sizesOf = {}, dimOf = {}, ellipses = [];
    const parse = (term) => {
      if (!/^[a-zA-Z]*(\.\.\.)?[a-zA-Z]*$/.test(term)) fail("Can't read the einsum term \"" + term + "\": use letters, and at most one ... per term.", "", lib);
      return term;
    };
    terms.forEach((term, i) => {
      const t = ops[i];
      parse(term);
      const [before, after] = term.includes("...") ? term.split("...") : [term, null];
      const letters = after === null ? before : before + after;
      const nEll = t.shape.length - letters.length;
      if (after === null ? nEll !== 0 : nEll < 0) {
        fail("“" + term + "” names " + letters.length + " dimension" + (letters.length === 1 ? "" : "s") + ", but " + kindOf(lib) + " #" + i + " has " + t.shape.length + " " + shapeText(t.shape) + ".", np(lib) ? "" : "einsum(): the number of subscripts in the equation (" + letters.length + ") does not match the number of dimensions (" + t.shape.length + ") for operand " + i + (after === null ? " and no ellipsis was given" : ""), lib);
      }
      const positions = after === null ? [...before].map((c, j) => [c, j]) : [...[...before].map((c, j) => [c, j]), ...[...after].map((c, j) => [c, before.length + nEll + j])];
      for (const [c, j] of positions) {
        const n = t.shape[j];
        if (c in sizesOf && sizesOf[c] !== n && sizesOf[c] !== 1 && n !== 1) {
          fail("The letter " + c + " has size " + sizesOf[c] + " in one place and " + n + " in another; a letter must mean the same size everywhere.", np(lib) ? "operands could not be broadcast together with remapped shapes" : "einsum(): operands do not broadcast with remapped shapes (original->remapped)", lib);
        }
        if (!(c in sizesOf) || sizesOf[c] === 1) {
          sizesOf[c] = n;
          dimOf[c] = t.dims[j];
        }
      }
      if (after !== null) ellipses.push({ shape: t.shape.slice(before.length, before.length + nEll), dims: t.dims.slice(before.length, before.length + nEll) });
    });
    const ell = ellipses.length ? TS.broadcast(ellipses, lib) : { shape: [], dims: [] };
    let out = rhs;
    if (out === undefined) {
      // Implicit output: letters used once, in alphabetical order.
      const count = {};
      for (const c of lhs.replace(/[.,]/g, "")) count[c] = (count[c] || 0) + 1;
      out = (ellipses.length ? "..." : "") + Object.keys(count).filter((c) => count[c] === 1).sort().join("");
      ctx.note("No “->” given, so the output is the letters that appear once, in alphabetical order: " + (out || "nothing (one number)") + ".");
    }
    const shape = [], dims = [];
    const outLetters = out.replace("...", "");
    const outAt = {};
    let ellAt = -1;
    for (const part of out.split(/(\.\.\.)/)) {
      if (part === "...") {
        ellAt = shape.length;
        shape.push(...ell.shape);
        dims.push(...ell.dims);
        continue;
      }
      for (const c of part) {
        if (!(c in sizesOf)) fail("The output letter " + c + " doesn't appear in any input.", np(lib) ? "einstein sum subscripts string included output subscript '" + c + "' which never appeared in an input" : "", lib);
        if (outLetters.indexOf(c) !== outLetters.lastIndexOf(c)) fail("The output letter " + c + " appears twice.", "", lib);
        outAt[c] = shape.length;
        shape.push(sizesOf[c]);
        dims.push(dimOf[c]);
      }
    }
    const summed = Object.keys(sizesOf).filter((c) => !outLetters.includes(c));
    const result = tensor(shape, dims, lib);
    terms.forEach((term, i) => {
      const t = ops[i];
      const [before, after] = term.includes("...") ? term.split("...") : [term, null];
      const nEll = after === null ? 0 : t.shape.length - before.length - after.length;
      const letterAt = [...before, ...Array(nEll).fill("."), ...(after || "")];
      // A summed letter twice in one term (a trace, "ii->") only uses the diagonal: the box overestimates.
      const approx = summed.some((c) => term.indexOf(c) !== term.lastIndexOf(c));
      TS.dep(result, t, (idx) => letterAt.map((c, j) => {
        if (t.shape[j] === 1) return 0;
        if (c === ".") return ellAt < 0 ? TS.ALL(t.shape[j]) : idx[ellAt + ell.shape.length - nEll + (j - before.length)];
        return c in outAt ? idx[outAt[c]] : TS.ALL(t.shape[j]);
      }), approx);
    });
    ctx.note(Object.keys(sizesOf).map((c) => c + " = " + sizesOf[c]).join(", ") + ". " + (summed.length ? "Summed over " + summed.join(", ") + " (missing from the output)." : "Nothing is summed: every letter is in the output."));
    return result;
  });

  // ---------- Linear algebra ----------

  function squareCheck(t, what) {
    const lib = t.lib;
    if (t.shape.length < 2) fail(what + " needs a square matrix (or a batch of them); this is " + t.shape.length + "D.", np(lib) ? t.shape.length + "-dimensional array given. Array must be at least two-dimensional" : "", lib);
    const r = t.shape[t.shape.length - 2], c = t.shape[t.shape.length - 1];
    if (r !== c) fail(what + " needs square matrices (the last two sizes equal), but these are " + r + " × " + c + ".", np(lib) ? "Last 2 dimensions of the array must be square" : "linalg." + what.replace(/.*\./, "") + ": A must be batches of square matrices, but they are " + r + " by " + c + " matrices", lib);
  }
  const inv = (lib, what) => (ctx, call) => {
    const t = asTensor(call.args[0], lib);
    squareCheck(t, what);
    if (t.shape.length > 2) ctx.note("Inverts each of the " + numel(t.shape.slice(0, -2)) + " matrices in the batch separately.");
    const nd = t.shape.length;
    return TS.depAlong(tensor(t.shape, t.dims, lib), t, [nd - 2, nd - 1]);
  };
  const det = (lib, what) => (ctx, call) => {
    const t = asTensor(call.args[0], lib);
    squareCheck(t, what);
    ctx.note("One number per matrix, so the last two dimensions are gone.");
    return TS.dep(tensor(t.shape.slice(0, -2), t.dims.slice(0, -2), lib), t, (idx) => [...idx, TS.ALL(t.shape[t.shape.length - 2]), TS.ALL(t.shape[t.shape.length - 1])]);
  };
  FN["torch.linalg.inv"] = FN["torch.inverse"] = inv("torch", "torch.linalg.inv");
  FN["np.linalg.inv"] = inv("numpy", "np.linalg.inv");
  FN["torch.linalg.det"] = FN["torch.det"] = det("torch", "torch.linalg.det");
  FN["np.linalg.det"] = det("numpy", "np.linalg.det");
  M.inverse = (ctx, t) => inv("torch", "inverse")(ctx, { args: [t] });
  M.det = (ctx, t) => det("torch", "det")(ctx, { args: [t] });

  // NumPy arrays have far fewer methods than tensors; the rest are np.* functions.
  TS.NUMPY_METHODS = new Set(["all", "any", "argmax", "argmin", "argsort", "astype", "clip", "copy", "cumprod", "cumsum", "dot", "flatten", "max", "mean", "min", "prod", "ravel", "repeat", "reshape", "round", "sort", "squeeze", "std", "sum", "swapaxes", "transpose", "var", "view", "fill", "conj"]);
  // What to use instead, for methods that exist in only one library.
  TS.ONLY_TORCH = {
    unsqueeze: "np.expand_dims(a, axis) or a[None]", permute: ".transpose(axes): in NumPy that reorders all axes", view: ".reshape()",
    expand: "np.broadcast_to(a, shape)", expand_as: "np.broadcast_to(a, b.shape)", contiguous: "np.ascontiguousarray(a)", size: ".shape (and .size is the element count in NumPy)",
    dim: ".ndim", numel: ".size", split: "np.split(a, sections, axis)", chunk: "np.array_split(a, n, axis)", unbind: "list(a) or np.split", mm: "a @ b", bmm: "a @ b",
    softmax: "scipy.special.softmax, or np.exp(a) / np.exp(a).sum(axis, keepdims=True)", relu: "np.maximum(a, 0)", flip: "np.flip(a, axis)", t: ".T",
    repeat_interleave: "np.repeat(a, n, axis)", unflatten: ".reshape()", narrow: "slicing: a[:, start:start + length]", masked_fill: "np.where(mask, value, a)",
    cuda: "nothing: NumPy runs on the CPU", detach: "nothing: NumPy has no gradients", float: ".astype(np.float32)", long: ".astype(np.int64)", to: ".astype()"
  };
  TS.ONLY_NUMPY = { astype: ".to(dtype), or .float() / .long()", copy: ".clone()", ptp: ".amax() - .amin()" };
})();
