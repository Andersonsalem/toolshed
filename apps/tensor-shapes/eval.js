// Runs parsed code on shapes only and records every step. No page layout here.
//
//   TS.run(code) -> { lines: [line], error: { message, real, line } | null }
//   line = { line, text, steps: [step], printed: [text], value: text | null }
//   step = { label, inputs: [tensor], outputs: [tensor], notes: [], warns: [] }
//
// Values: numbers, booleans, null, strings, arrays (tuples; .list for lists;
// .dims on shapes), tensors, and { kind: "mod" | "fn" | "method" | "layer" | ... }.
(function () {
  "use strict";
  const TS = window.TS;
  const { fail, isTensor, shapeText } = TS;

  const MODULES = { torch: "torch", np: "np", numpy: "np", nn: "torch.nn", F: "torch.nn.functional", math: "math" };
  const SUBMODULES = new Set(["torch.nn", "torch.nn.functional", "torch.linalg", "torch.random", "np.random", "np.linalg"]);
  const DTYPES = /^(float|float16|float32|float64|bfloat16|half|double|int|int8|int16|int32|int64|uint8|uint16|uint32|uint64|long|short|bool|bool_|complex64|complex128|cfloat|float_|int_)$/;
  const CONSTANTS = { "np.newaxis": null, "np.pi": Math.PI, "np.e": Math.E, "np.inf": Infinity, "np.nan": NaN, "math.pi": Math.PI, "math.e": Math.E, "math.inf": Infinity, "torch.pi": Math.PI, "torch.inf": Infinity };
  // Names people reach for that live elsewhere.
  const HINTS = {
    "torch.expand_dims": "In PyTorch it's x.unsqueeze(dim).", "np.unsqueeze": "In NumPy it's np.expand_dims(a, axis) or a[None].", "np.cat": "In NumPy it's np.concatenate([a, b], axis=0).",
    "np.permute": "In NumPy it's np.transpose(a, axes).", "torch.concatenate_": "", "np.view": "In NumPy it's a.reshape(...).", "torch.newaxis": "In PyTorch, use None: x[:, None].",
    "np.flatten": "In NumPy it's a.flatten() or a.ravel().", "torch.size": "Use x.shape or x.size().", "np.mm": "In NumPy it's a @ b.", "np.bmm": "In NumPy it's a @ b (it broadcasts batches).",
    "np.softmax": "NumPy has no softmax; scipy.special.softmax does, or write np.exp(a) / np.exp(a).sum(axis, keepdims=True).", "np.relu": "NumPy has no relu; use np.maximum(a, 0).", "np.sigmoid": "NumPy has no sigmoid; use 1 / (1 + np.exp(-a)).",
    "torch.nn.functional.flatten": "Use torch.flatten(x, 1) or x.flatten(1)."
  };
  const BUILTINS = new Set(["print", "len", "int", "float", "list", "tuple", "max", "min", "sum", "abs", "round", "type", "range", "str"]);

  // Code text for a step label. A chained call shows as "…" + the last part.
  function unparse(n) {
    switch (n.t) {
      case "num": return n.raw || String(n.v);
      case "str": return "'" + n.v + "'";
      case "name": return n.v;
      case "const": return n.v === null ? "None" : n.v === true ? "True" : n.v === false ? "False" : "...";
      case "tuple": return "(" + n.items.map(unparse).join(", ") + (n.items.length === 1 ? "," : "") + ")";
      case "list": return "[" + n.items.map(unparse).join(", ") + "]";
      case "attr": return unparse(n.obj) + "." + n.name;
      case "call": return unparse(n.fn) + "(" + [...n.args.map(unparse), ...Object.entries(n.kwargs).map(([k, v]) => k + "=" + unparse(v))].join(", ") + ")";
      case "index": return unparse(n.obj) + "[" + n.items.map(unparse).join(", ") + "]";
      case "slice": return (n.a ? unparse(n.a) : "") + ":" + (n.b ? unparse(n.b) : "") + (n.c ? ":" + unparse(n.c) : "");
      case "bin": return wrap(n.l, n.op) + " " + n.op + " " + wrap(n.r, n.op);
      case "neg": return "-" + unparse(n.x);
    }
    return "?";
  }
  const LEVEL = { "**": 4, "*": 3, "/": 3, "//": 3, "%": 3, "@": 3, "+": 2, "-": 2 };
  const wrap = (n, op) => (n.t === "bin" && (LEVEL[n.op] || 1) < (LEVEL[op] || 1) ? "(" + unparse(n) + ")" : unparse(n));
  // "x.reshape(2, -1).permute(1, 0)" → the second step reads "….permute(1, 0)".
  function shortLabel(n) {
    // Arguments computed by an earlier step show as "…": F.relu(…).
    const arg = (a) => (a.t === "call" || a.t === "bin" || a.t === "index" ? "…" : unparse(a));
    const argText = (c) => [...c.args.map(arg), ...Object.entries(c.kwargs).map(([k, v]) => k + "=" + arg(v))].join(", ");
    const chained = (o) => o && o.t !== "name" && !(o.t === "attr" && o.obj.t === "name" && /^(self|torch|np|nn|F)$/.test(o.obj.v));
    if (n.t === "call" && n.fn.t === "attr" && chained(n.fn.obj) && n.fn.obj.t !== "num") {
      return "…." + n.fn.name + "(" + argText(n) + ")";
    }
    if (n.t === "call") return unparse(n.fn) + "(" + argText(n) + ")";
    if (n.t === "index" && chained(n.obj)) return "…[" + n.items.map(unparse).join(", ") + "]";
    if (n.t === "attr" && chained(n.obj)) return "…." + n.name;
    return unparse(n);
  }

  // What print() and a bare expression show.
  function repr(v) {
    if (isTensor(v)) return (v.lib === "numpy" ? "array" : "tensor") + " of shape " + shapeText(v.shape);
    if (Array.isArray(v) && v.size) return v.size === "torch" ? "torch.Size([" + v.join(", ") + "])" : shapeText(v);
    if (Array.isArray(v)) return (v.list ? "[" : "(") + v.map(repr).join(", ") + (v.length === 1 && !v.list ? "," : "") + (v.list ? "]" : ")");
    if (typeof v === "number") return Number.isNaN(v) ? "(a number from the data)" : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    return TS.show(v);
  }
  TS.repr = repr;
  const shapeOf = (t) => Object.assign(t.shape.slice(), { size: t.lib, dims: t.dims.slice() });

  TS.run = function (code) {
    TS.resetColors();
    const out = { lines: [], error: null };
    const env = new Map();
    let current = null;

    function record(label, inputs, outputs, ctx, extra) {
      // A result made from tensors without a known element flow: a trace stops there.
      const ins = inputs.filter(isTensor);
      outputs.forEach((o) => {
        if (!o.src && !o.fresh && ins.length && !ins.includes(o)) o.untracked = true;
      });
      current.steps.push(Object.assign({ label, inputs: inputs.filter(isTensor), outputs, notes: ctx.notes, warns: ctx.warns }, extra || {}));
    }
    const newCtx = (lib) => {
      const ctx = { lib, notes: [], warns: [] };
      ctx.note = (s) => ctx.notes.push(s);
      ctx.warn = (s) => ctx.warns.push(s);
      return ctx;
    };
    const tensorsIn = (v) => (isTensor(v) ? [v] : Array.isArray(v) ? v.flatMap(tensorsIn) : []);

    function lookup(name) {
      if (env.has(name)) return env.get(name);
      if (name in MODULES) return { kind: "mod", path: MODULES[name], label: "the " + name + " module" };
      if (BUILTINS.has(name)) return { kind: "builtin", name, label: name + "()" };
      if (name === "self") return { kind: "self", label: "self" };
      return fail(
        name + " isn't defined. Lines run top to bottom, so it needs a line above, like " + name + " = torch.randn(8, 3, 32, 32)." +
          (/^(x|input|inputs|batch|img|images|tokens)$/.test(name) ? " If it's the input to forward(), add that line at the top." : ""),
        "name '" + name + "' is not defined",
        "python"
      );
    }

    function attr(node) {
      if (node.obj.t === "name" && node.obj.v === "self") return lookup("self." + node.name);
      const obj = ev(node.obj), name = node.name;
      if (obj && obj.kind === "mod") {
        const path = obj.path + "." + name;
        if (path in CONSTANTS) return CONSTANTS[path];
        if (DTYPES.test(name) && /^(torch|np)$/.test(obj.path)) return { kind: "dtype", label: path };
        if (TS.FN[path]) return { kind: "fn", path, label: path };
        if (SUBMODULES.has(path)) return { kind: "mod", path, label: path };
        if (/^math\.(prod|sqrt|ceil|floor)$/.test(path)) return { kind: "builtin", name: path, label: path };
        if (TS.UNSUPPORTED[name]) fail(TS.UNSUPPORTED[name] + " (nn." + name + ") aren't covered: they take and return several tensors with options that change the shapes. You can still check the reshapes around them, like splitting heads with view and transpose.", "", "torch");
        return fail("This tool doesn't know " + path.replace(/^torch\.nn\.functional\./, "F.").replace(/^torch\.nn\./, "nn.") + ". " + (HINTS[path] || "It may exist; this tool covers the common shape operations (see the list below the editor)."), "", path.startsWith("np") ? "numpy" : "torch");
      }
      if (isTensor(obj)) return tensorAttr(node, obj, name);
      if (obj && obj.kind === "layer") {
        if (!(name in obj.attrs)) fail(obj.type + " has no ." + name + " that this tool knows.", "", "torch");
        let v = obj.attrs[name];
        if (typeof v === "function") v = obj.attrs[name] = v();
        if (isTensor(v)) v.name = v.name || unparse(node);
        return v;
      }
      if (obj && obj.kind === "rng") return { kind: "fn", path: "np.rng." + name, label: "rng." + name };
      if (Array.isArray(obj) && obj.names && obj.names.includes(name)) return obj[obj.names.indexOf(name)];
      if (Array.isArray(obj) && obj.size && name === "numel") return { kind: "builtin", name: "numel", self: obj, label: "numel" };
      return fail(repr(obj) + " has no ." + name + "." + (Array.isArray(obj) && obj.length === 2 && isTensor(obj[0]) ? " It's a pair of tensors: take one with [0] or .values." : ""), "", "torch");
    }

    function tensorAttr(node, t, name) {
      const np = t.lib === "numpy";
      switch (name) {
        case "shape": return shapeOf(t);
        case "ndim": return t.shape.length;
        case "dtype": return { kind: "dtype", label: np ? "dtype" : "torch.dtype" };
        case "device": return "cpu";
        case "data": case "real": case "imag": return t;
        case "grad": return null;
        case "itemsize": case "nbytes": return NaN;
        case "T": case "mT": {
          const ctx = newCtx(t.lib);
          const r = name === "T" ? TS.attrT(ctx, t) : TS.attrMT(ctx, t);
          record(shortLabel(node), [t], [r], ctx);
          return r;
        }
        case "size":
          if (np) return t.shape.reduce((a, b) => a * b, 1);
          break;
      }
      if (np) {
        if (!TS.NUMPY_METHODS.has(name) && !/^(item|tolist|nonzero)$/.test(name)) {
          const hint = TS.ONLY_TORCH[name] ? "Use " + TS.ONLY_TORCH[name] + "." : TS.FN["np." + name] ? "Use np." + name + "(a)." : "";
          fail("NumPy arrays don't have ." + name + "(). " + hint, "'numpy.ndarray' object has no attribute '" + name + "'", "numpy");
        }
      } else if (TS.ONLY_NUMPY[name]) fail("PyTorch tensors don't have ." + name + "(). Use " + TS.ONLY_NUMPY[name] + ".", "'Tensor' object has no attribute '" + name + "'", "torch");
      if (TS.METHOD[name] || /^(size|dim|ndimension|numel|nelement|item|tolist|numpy|nonzero|unique)$/.test(name)) return { kind: "method", t, name, label: "." + name + "()" };
      const base = name.replace(/_$/, "");
      if (name.endsWith("_") && TS.METHOD[base]) return { kind: "method", t, name: base, inplace: true, label: "." + name + "()" };
      return fail("This tool doesn't know ." + name + (np ? " on NumPy arrays." : " on tensors."), "", t.lib);
    }

    function callArgs(node) {
      return {
        args: node.args.map(ev),
        kwargs: Object.fromEntries(Object.entries(node.kwargs).map(([k, v]) => [k, ev(v)])),
        nodes: node.args,
        kwnodes: node.kwargs
      };
    }

    function call(node) {
      const fn = ev(node.fn);
      const c = callArgs(node);
      const label = shortLabel(node);
      if (fn && fn.kind === "fn") {
        const ctx = newCtx(fn.path.startsWith("np") ? "numpy" : "torch");
        const r = TS.FN[fn.path](ctx, c);
        if (r && r.kind === "layer") r.code = unparse(node);
        if (tensorsIn(r).length) record(label, tensorsIn([c.args, Object.values(c.kwargs)]), tensorsIn(r), ctx);
        return r;
      }
      if (fn && fn.kind === "method") return method(node, fn, c, label);
      if (fn && fn.kind === "layer") return runLayer(fn, c.args, label, fn.code || "");
      if (fn && fn.kind === "builtin") return builtin(fn, c);
      if (Array.isArray(fn) && fn.size) fail(".shape isn't a method: write x.shape (no brackets), or x.size() in PyTorch.", "'" + (fn.size === "torch" ? "torch.Size" : "tuple") + "' object is not callable", fn.size);
      if (typeof fn === "number" && node.fn.t === "attr" && node.fn.name === "size") fail("In NumPy, .size is a number (how many elements), not a method. For the shape, use a.shape.", "'int' object is not callable", "numpy");
      return fail(repr(fn) + " can't be called like a function.", "", "torch");
    }

    function method(node, fn, c, label) {
      const t = fn.t, name = fn.name, ctx = newCtx(t.lib);
      switch (name) {
        case "size": {
          if (!c.args.length) return shapeOf(t);
          return t.shape[TS.normDim(c.args[0], t.shape.length, t.lib)];
        }
        case "dim": case "ndimension": return t.shape.length;
        case "numel": case "nelement": return t.shape.reduce((a, b) => a * b, 1);
        case "item":
          if (t.shape.reduce((a, b) => a * b, 1) !== 1) fail(".item() only works on a tensor with exactly one element; this one has " + t.shape.reduce((a, b) => a * b, 1) + ".", t.lib === "numpy" ? "can only convert an array of size 1 to a Python scalar" : "a Tensor with " + t.shape.reduce((a, b) => a * b, 1) + " elements cannot be converted to Scalar", t.lib);
          return NaN;
        case "tolist": return Object.assign([], { list: true, label: "a nested list of shape " + shapeText(t.shape) });
        case "nonzero": case "unique":
          return fail("." + name + "() returns a size that depends on the values, which this tool doesn't have.", "", t.lib);
        case "numpy": {
          const r = TS.linkSame(TS.tensor(t.shape, t.dims, "numpy"), t);
          ctx.note("Now a NumPy array; the shape stays " + shapeText(t.shape) + ".");
          record(label, [t], [r], ctx);
          return r;
        }
      }
      const r = TS.METHOD[name](ctx, t, c);
      if (fn.inplace) {
        if (!isTensor(r) || !TS.sameShape(r.shape, t.shape)) {
          fail("An in-place ." + name + "_() must keep the shape " + shapeText(t.shape) + ", but the result would be " + (isTensor(r) ? shapeText(r.shape) : "several tensors") + ". Use ." + name + "() and assign the result instead.", isTensor(r) ? "output with shape [" + t.shape.join(", ") + "] doesn't match the broadcast shape [" + r.shape.join(", ") + "]" : "", t.lib);
        }
        // The variable now holds the changed tensor. Earlier steps keep showing the old one.
        if (node.fn.obj.t === "name") env.set(node.fn.obj.v, Object.assign(r, { name: node.fn.obj.v }));
      }
      if (tensorsIn(r).length) record(label, [t, ...tensorsIn([c.args, Object.values(c.kwargs)])], tensorsIn(r), ctx);
      return r;
    }

    // A layer call. nn.Sequential runs each child as its own step.
    function runLayer(layer, inputs, label, code) {
      if (layer.noCall) fail("nn.ModuleList can't be called; call its layers one by one: layers[0](x).", "Module [ModuleList] is missing the required \"forward\" function", "torch");
      if (layer.children) {
        let x = inputs;
        layer.children.forEach((child, i) => {
          x = [runLayer(child, x, label.replace(/\(.*$/, "") + "[" + i + "]", child.code || child.type)];
        });
        return x[0];
      }
      const ctx = newCtx("torch");
      const r = layer.forward(ctx, inputs);
      record(label, tensorsIn(inputs), tensorsIn(r), ctx, { layer: code || layer.type });
      return r;
    }

    function builtin(fn, c) {
      const a = c.args[0];
      const n = (v) => (typeof v === "boolean" ? Number(v) : v);
      switch (fn.name) {
        case "print":
          current.printed.push(c.args.map((v) => (typeof v === "string" ? v : repr(v))).join(" "));
          return null;
        case "len":
          if (isTensor(a)) {
            if (!a.shape.length) fail("len() doesn't work on a 0D tensor (a single number).", a.lib === "numpy" ? "len() of unsized object" : "len() of a 0-d tensor", a.lib);
            return a.shape[0];
          }
          if (Array.isArray(a) || typeof a === "string") return a.length;
          if (a && a.children) return a.children.length;
          return fail("len() needs a tensor, a list or a shape.", "", "torch");
        case "int": return Math.trunc(n(a));
        case "float": case "abs": return fn.name === "abs" ? Math.abs(n(a)) : n(a);
        case "round": return Math.round(n(a));
        case "str": return repr(a);
        case "type": return { kind: "dtype", label: isTensor(a) ? (a.lib === "numpy" ? "numpy.ndarray" : "torch.Tensor") : typeof a };
        case "list": case "tuple": {
          if (isTensor(a)) {
            if (!a.shape.length) fail("A 0D tensor can't be turned into a list.", "", a.lib);
            const parts = Array.from({ length: a.shape[0] }, () => TS.tensor(a.shape.slice(1), a.dims.slice(1), a.lib));
            return fn.name === "list" ? Object.assign(parts, { list: true }) : parts;
          }
          const arr = Array.isArray(a) ? a.slice() : [];
          return fn.name === "list" ? Object.assign(arr, { list: true }) : arr;
        }
        case "max": case "min": case "sum": {
          const vals = (c.args.length === 1 && Array.isArray(a) ? a : c.args).map(n);
          if (vals.some((v) => typeof v !== "number")) fail(fn.name + "() here works on numbers; for tensors use torch." + fn.name + "(x) or x." + fn.name + "().", "", "torch");
          return fn.name === "sum" ? vals.reduce((x, y) => x + y, 0) : Math[fn.name](...vals);
        }
        case "range": return Object.assign(Array.from({ length: Math.max(0, Math.min(n(a), 10000)) }, (_, i) => i), { list: true });
        case "math.prod": return (Array.isArray(a) ? a : c.args).reduce((x, y) => x * y, 1);
        case "math.sqrt": return Math.sqrt(a);
        case "math.ceil": return Math.ceil(a);
        case "math.floor": return Math.floor(a);
        case "numel": return fn.self.reduce((x, y) => x * y, 1);
      }
      return null;
    }

    function index(node) {
      const obj = ev(node.obj);
      const items = node.items.map((it) => (it.t === "slice" ? { kind: "slice", a: it.a ? ev(it.a) : null, b: it.b ? ev(it.b) : null, c: it.c ? ev(it.c) : null } : ev(it)));
      if (isTensor(obj)) {
        // x[(0, 1)] is the same as x[0, 1].
        const flat = items.length === 1 && Array.isArray(items[0]) && !items[0].list && !items[0].size ? items[0] : items;
        const ctx = newCtx(obj.lib);
        const r = TS.index(ctx, obj, flat);
        record(shortLabel(node), [obj, ...tensorsIn(flat)], [r], ctx);
        return r;
      }
      if (obj && obj.kind === "method" && obj.name === "size") fail("In PyTorch, size is a method: write x.size(0) or x.shape[0], not x.size[0].", "'builtin_function_or_method' object is not subscriptable", "torch");
      const seq = Array.isArray(obj) ? obj : obj && obj.children ? obj.children : null;
      if (!seq) fail(repr(obj) + " can't be indexed with [ ].", "", "torch");
      if (items.length !== 1) fail("A shape or list takes one index here, like shape[0] or shape[1:].", "", "torch");
      const it = items[0];
      if (it && it.kind === "slice") {
        const len = seq.length, step = it.c === null ? 1 : it.c;
        const res = [];
        if (step > 0) {
          const s = it.a === null ? 0 : it.a < 0 ? Math.max(0, it.a + len) : Math.min(it.a, len);
          const e = it.b === null ? len : it.b < 0 ? Math.max(0, it.b + len) : Math.min(it.b, len);
          for (let i = s; i < e; i += step) res.push(i);
        } else {
          const s = it.a === null ? len - 1 : it.a < 0 ? it.a + len : Math.min(it.a, len - 1);
          const e = it.b === null ? -1 : it.b < 0 ? Math.max(-1, it.b + len) : it.b;
          for (let i = s; i > e; i += step) res.push(i);
        }
        const out = res.map((i) => seq[i]);
        if (seq.size) Object.assign(out, { size: seq.size, dims: res.map((i) => seq.dims[i]) });
        if (seq.list) out.list = true;
        if (obj.children) {
          const sub = Object.assign({}, obj, { children: out });
          return sub;
        }
        return out;
      }
      if (!TS.isInt(it)) fail("An index must be a whole number; got " + repr(it) + ".", "", "torch");
      const i = it < 0 ? it + seq.length : it;
      if (i < 0 || i >= seq.length) fail("Index " + it + " is out of range: there are only " + seq.length + " entries (0 to " + (seq.length - 1) + ").", (seq.size ? "tuple" : "list") + " index out of range", "python");
      return seq[i];
    }

    function arith(op, a, b) {
      a = typeof a === "boolean" ? Number(a) : a;
      b = typeof b === "boolean" ? Number(b) : b;
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "//": return Math.floor(a / b);
        case "%": return ((a % b) + b) % b;
        case "**": return a ** b;
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
      }
      return fail("Can't use " + op + " on numbers here.", "", "torch");
    }

    function bin(node) {
      const a = ev(node.l), b = ev(node.r), op = node.op;
      if (isTensor(a) || isTensor(b)) {
        if ((Array.isArray(a) && !a.list && !a.size) || (Array.isArray(b) && !b.list && !b.size)) {
          fail("One side is a tuple, not a tensor" + ((a && a.names) || (b && b.names) ? ": max/min/sort with a dim return (values, indices). Take the values with [0] or .values." : ". Did an operation return several tensors (like chunk or split)? Pick one with [0], or unpack them."), "", "torch");
        }
        const lib = (isTensor(a) ? a : b).lib, ctx = newCtx(lib);
        let r;
        if (op === "@") r = TS.matmul(ctx, TS.asTensor(a, lib), TS.asTensor(b, lib), "@");
        else {
          if (op === "*" && isTensor(a) && isTensor(b) && a.shape.length >= 2 && b.shape.length >= 2) ctx.note("* multiplies element by element (after broadcasting). For matrix multiplication, use @.");
          r = TS.elementwise(ctx, [a, b]);
          if (/^(==|!=|<|>|<=|>=)$/.test(op)) r.bool = true;
        }
        record(shortLabel(node), [a, b], [r], ctx);
        return r;
      }
      if (Array.isArray(a) && Array.isArray(b) && op === "+") {
        const r = a.concat(b);
        if (a.list) r.list = true;
        if (a.size || b.size) Object.assign(r, { size: a.size || b.size, dims: [...(a.dims || a.map(() => null)), ...(b.dims || b.map(() => null))] });
        return r;
      }
      if (Array.isArray(a) && typeof b === "number" && op === "*") {
        const r = [];
        for (let i = 0; i < b; i++) r.push(...a);
        return a.list ? Object.assign(r, { list: true }) : r;
      }
      if (["number", "boolean"].includes(typeof a) && ["number", "boolean"].includes(typeof b)) return arith(op, a, b);
      if (typeof a === "string" && typeof b === "string" && op === "+") return a + b;
      return fail("Can't use " + op + " between " + repr(a) + " and " + repr(b) + ".", "", "torch");
    }

    function ev(node) {
      switch (node.t) {
        case "num": case "str": case "const": return node.v;
        case "name": return lookup(node.v);
        case "tuple": return node.items.map(ev);
        case "list": return Object.assign(node.items.map(ev), { list: true });
        case "attr": return attr(node);
        case "call": return call(node);
        case "index": return index(node);
        case "bin": return bin(node);
        case "neg": {
          const v = ev(node.x);
          if (isTensor(v)) return TS.tensor(v.shape, v.dims, v.lib);
          if (typeof v === "number" || typeof v === "boolean") return -v;
          return fail("Can't negate " + repr(v) + ".", "", "torch");
        }
      }
      return fail("This tool can't run that part of the line.", "", "torch");
    }

    // A comment starting with a shape, "# (8, 3, 32)", is checked against the result.
    // A comment that is just names, "# B C H W" or "# shape: B, C, H, W", names the dims.
    function readComment(stmt, value) {
      if (!stmt.comment || !isTensor(value)) return;
      const nums = stmt.comment.match(/^\(\s*(\d+(?:\s*,\s*\d+)*)?\s*,?\s*\)/);
      if (nums) {
        const want = nums[1] ? nums[1].split(",").map(Number) : [];
        const ok = TS.sameShape(want, value.shape);
        const last = current.steps[current.steps.length - 1];
        if (last) (ok ? last.notes : last.warns).push(ok ? "Matches your comment: " + shapeText(want) + "." : "Your comment says " + shapeText(want) + ", but the shape is " + shapeText(value.shape) + ".");
        return;
      }
      const text = stmt.comment.replace(/^[A-Za-z ]{1,20}:\s*/, "");
      const words = text.split(/[\s,×()[\]]+/).filter(Boolean);
      if (!words.length || words.length !== value.shape.length) return;
      if (!words.every((w) => /^[A-Za-z_][\w']{0,11}$/.test(w))) return;
      words.forEach((w, i) => {
        const d = value.dims[i];
        if (!d.label || d.label === String(value.shape[i])) d.label = w;
      });
    }

    let statements;
    try {
      statements = TS.parse(code);
    } catch (e) {
      out.error = { message: e.message, real: "", line: e.line };
      return out;
    }
    for (const stmt of statements) {
      current = { line: stmt.line, text: stmt.text, steps: [], printed: [], value: null };
      out.lines.push(current);
      try {
        const v = ev(stmt.expr);
        if (stmt.targets) {
          if (stmt.targets.length === 1) assign(stmt.targets[0], v);
          else {
            let parts = v;
            if (isTensor(v)) {
              if (!v.shape.length) fail("A 0D tensor can't be unpacked.", "iteration over a 0-d tensor", v.lib);
              parts = Array.from({ length: v.shape[0] }, () => TS.tensor(v.shape.slice(1), v.dims.slice(1), v.lib));
            }
            if (!Array.isArray(parts)) fail("Can't unpack " + repr(v) + " into " + stmt.targets.length + " names.", "", "torch");
            if (parts.length !== stmt.targets.length) {
              fail("There are " + parts.length + " values on the right but " + stmt.targets.length + " names on the left.", parts.length > stmt.targets.length ? "too many values to unpack (expected " + stmt.targets.length + ")" : "not enough values to unpack (expected " + stmt.targets.length + ", got " + parts.length + ")", "python");
            }
            stmt.targets.forEach((name, i) => assign(name, parts[i]));
          }
        } else if (v !== null && v !== undefined && typeof v !== "string" && !(isTensor(v) || (Array.isArray(v) && v.length && v.every(isTensor)))) current.value = repr(v);
        readComment(stmt, stmt.targets && stmt.targets.length === 1 ? env.get(stmt.targets[0]) : v);
      } catch (e) {
        if (!(e instanceof TS.Error)) {
          console.error(e);
          out.error = { message: "Something went wrong inside this tool (not necessarily in your code): " + e.message + ". Please report it with the code that caused it.", real: "", line: stmt.line };
        } else out.error = { message: e.message, real: e.real || "", line: stmt.line };
        break;
      }
    }
    function assign(name, v) {
      env.set(name, v);
      if (isTensor(v) && !v.name) v.name = name;
      if (Array.isArray(v)) v.forEach((x, i) => isTensor(x) && !x.name && (x.name = name + "[" + i + "]"));
      if (v && v.kind === "layer") v.name = name;
    }
    return out;
  };
})();
