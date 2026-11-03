// Einsum notation: reading equations, what each letter does, and computing
// small examples with real numbers. No page layout here.
//
//   Einsum.parse("ij,jk->ik") -> { inputs: ["ij", "jk"], output: "ik", explicit, letters } or { error }
//   Einsum.roles(p)           -> [{ letter, kept, inputs: [n], repeated: bool, role, text }]
//   Einsum.compute(p, sizes, values) -> flat output values
//   Einsum.terms(p, sizes, values, outIndex) -> the products that add up to one output entry
//   Einsum.recognize(p)       -> { name, numpy, torch } for well-known patterns, or null
//   Einsum.recipe(p, sizes)   -> any two-input equation as one batched matrix multiplication, or null
(function () {
  "use strict";
  const E = (window.Einsum = {});
  E.NAMES = ["A", "B", "C"];
  E.MAX_INPUTS = 3;
  E.MAX_DIMS = 5; // per input and for the output; more than 2 letters are drawn as slices
  E.MAX_CELLS = 400; // entries in one drawn input or output
  E.MAX_SIZE = 6;
  E.MAX_WORK = 50000; // loop steps in total

  const unique = (s) => [...new Set(s)];

  E.parse = function (raw) {
    const eq = String(raw).replace(/\s+/g, "");
    if (!eq) return { error: "Type an equation, like ij,jk->ik." };
    if (eq.includes("...")) return { error: "The drawing can't show “...” because it stands for any number of dimensions. Write the letters out (bij,bjk->bik instead of ...ij,...jk->...ik). The tutorial below explains “...”." };
    const bad = eq.replace("->", "").match(/[^A-Za-z,]/);
    if (bad) return { error: "“" + bad[0] + "” can't be used. An equation is letters, commas between inputs, and an optional -> before the output." };
    if ((eq.match(/->/g) || []).length > 1) return { error: "Only one -> is allowed." };
    const arrow = eq.indexOf("->");
    const lhs = arrow < 0 ? eq : eq.slice(0, arrow);
    const inputs = lhs.split(",");
    if (inputs.some((s) => !s)) return { error: "Each input needs at least one letter. Check for a stray comma." };
    if (inputs.length > E.MAX_INPUTS) return { error: "This page draws up to " + E.MAX_INPUTS + " inputs. einsum itself takes more." };
    const big = inputs.findIndex((s) => s.length > E.MAX_DIMS);
    if (big >= 0) return { error: "Input " + E.NAMES[big] + " has " + inputs[big].length + " letters; this page draws up to " + E.MAX_DIMS + " per input (einsum itself takes more)." };
    const letters = unique(inputs.join(""));
    let output;
    if (arrow >= 0) {
      output = eq.slice(arrow + 2);
      const missing = [...output].find((c) => !letters.includes(c));
      if (missing) return { error: "The output letter " + missing + " isn't in any input. Every output letter has to come from an input." };
      const twice = [...output].find((c, i) => output.indexOf(c) !== i);
      if (twice) return { error: "The output has " + twice + " twice. Each output letter can appear only once." };
    } else {
      // No arrow: the letters used exactly once, in alphabetical order.
      const count = {};
      for (const c of inputs.join("")) count[c] = (count[c] || 0) + 1;
      output = letters.filter((c) => count[c] === 1).sort().join("");
    }
    if (output.length > E.MAX_DIMS) return { error: "The output has " + output.length + " letters; this page draws up to " + E.MAX_DIMS + "." };
    return { inputs, output, explicit: arrow >= 0, letters, text: inputs.join(",") + "->" + output };
  };

  E.roles = function (p) {
    return p.letters.map((letter) => {
      const ins = p.inputs.map((s, n) => (s.includes(letter) ? n : -1)).filter((n) => n >= 0);
      const repeated = p.inputs.some((s) => s.indexOf(letter) !== s.lastIndexOf(letter));
      const kept = p.output.includes(letter);
      const names = ins.map((n) => E.NAMES[n]).join(" and ");
      let role, text;
      if (repeated) {
        role = "diagonal";
        text = "appears twice in one input, so only entries where both positions are equal are used (the diagonal)" + (kept ? ", and it's kept" : ", then added up");
      } else if (kept && ins.length > 1) {
        role = "batch";
        text = "in " + names + " and the output: entries with the same " + letter + " are paired up, and each " + letter + " gets its own result";
      } else if (kept) {
        role = "kept";
        text = "kept: carried through from " + names + " to the output";
      } else if (ins.length > 1) {
        role = "contracted";
        text = "in " + names + " but not the output: matching entries are multiplied, then added up over " + letter;
      } else {
        role = "summed";
        text = "not in the output: added up over " + letter;
      }
      return { letter, kept, inputs: ins, repeated, role, text };
    });
  };

  const shapeOf = (term, sizes) => [...term].map((c) => sizes[c]);
  const flat = (term, sizes, assign) => [...term].reduce((acc, c) => acc * sizes[c] + assign[c], 0);
  E.shapeOf = shapeOf;

  // Visits every combination of values for the given letters.
  function each(letters, sizes, fn) {
    const assign = {};
    const go = (k) => {
      if (k === letters.length) return fn(assign);
      for (let v = 0; v < sizes[letters[k]]; v++) {
        assign[letters[k]] = v;
        go(k + 1);
      }
    };
    go(0);
  }
  E.work = (p, sizes) => p.letters.reduce((acc, c) => acc * sizes[c], 1);

  E.compute = function (p, sizes, values) {
    const outSize = shapeOf(p.output, sizes).reduce((a, b) => a * b, 1);
    const out = new Array(outSize).fill(0);
    each(p.letters, sizes, (assign) => {
      let prod = 1;
      p.inputs.forEach((term, n) => (prod *= values[n][flat(term, sizes, assign)]));
      out[flat(p.output, sizes, assign)] += prod;
    });
    return out;
  };

  // outIndex: { letter: value } for the output letters.
  E.terms = function (p, sizes, values, outIndex) {
    const summed = p.letters.filter((c) => !p.output.includes(c));
    const list = [];
    each(summed, sizes, (inner) => {
      const assign = Object.assign({}, outIndex, inner);
      const factors = p.inputs.map((term, n) => ({ input: n, index: [...term].map((c) => assign[c]), value: values[n][flat(term, sizes, assign)] }));
      list.push({ factors, product: factors.reduce((acc, f) => acc * f.value, 1) });
    });
    return list;
  };

  E.random = function (p, sizes) {
    return p.inputs.map((term) => Array.from({ length: shapeOf(term, sizes).reduce((a, b) => a * b, 1) }, () => Math.floor(Math.random() * 5)));
  };

  // Python-style loops that do the same thing.
  E.loops = function (p, sizes) {
    const summed = p.letters.filter((c) => !p.output.includes(c));
    const ix = (term) => "[" + [...term].join(", ") + "]";
    const lines = [p.output.length ? "out = zeros(" + shapeOf(p.output, sizes).join(", ") + (p.output.length === 1 ? "," : "") + ")" : "out = 0"];
    let pad = "";
    for (const c of [...p.output, ...summed]) {
      lines.push(pad + "for " + c + " in range(" + sizes[c] + "):" + (p.output.includes(c) ? "" : "   # summed"));
      pad += "    ";
    }
    const target = p.output.length ? "out" + ix(p.output) : "out";
    lines.push(pad + target + " += " + p.inputs.map((t, n) => E.NAMES[n] + ix(t)).join(" * "));
    return lines.join("\n");
  };

  // Well-known patterns, written with letters in order of first appearance.
  const PATTERNS = {
    "a->a": ["Copy (nothing changes)", "A", "A"],
    "a->": ["Sum of all entries", "A.sum()", "A.sum()"],
    "ab->ab": ["Copy (nothing changes)", "A", "A"],
    "ab->ba": ["Transpose", "A.T", "A.T"],
    "ab->": ["Sum of all entries", "A.sum()", "A.sum()"],
    "ab->a": ["Sum of each row", "A.sum(axis=1)", "A.sum(dim=1)"],
    "ab->b": ["Sum of each column", "A.sum(axis=0)", "A.sum(dim=0)"],
    "aa->": ["Trace (sum of the diagonal)", "np.trace(A)", "torch.trace(A)"],
    "aa->a": ["Diagonal", "np.diag(A)", "torch.diagonal(A)"],
    "a,a->": ["Dot product", "np.dot(A, B)", "torch.dot(A, B)"],
    "a,a->a": ["Element by element product", "A * B", "A * B"],
    "a,b->ab": ["Outer product", "np.outer(A, B)", "torch.outer(A, B)"],
    "ab,b->a": ["Matrix times vector", "A @ B", "A @ B"],
    "a,ab->b": ["Vector times matrix", "A @ B", "A @ B"],
    "ab,bc->ac": ["Matrix multiplication", "A @ B", "A @ B"],
    "ab,cb->ac": ["Matrix multiplication with B transposed", "A @ B.T", "A @ B.T"],
    "ab,ac->bc": ["Matrix multiplication with A transposed", "A.T @ B", "A.T @ B"],
    "ab,bc->ca": ["Matrix multiplication, result transposed", "(A @ B).T", "(A @ B).T"],
    "ab,ab->ab": ["Element by element product", "A * B", "A * B"],
    "ab,ab->": ["Sum of the element by element product", "(A * B).sum()", "(A * B).sum()"],
    "ab,ab->a": ["Dot product of each row with the matching row", "(A * B).sum(axis=1)", "(A * B).sum(dim=1)"],
    "ab,b->ab": ["Scale each column (broadcasting)", "A * B", "A * B"],
    "ab,a->ab": ["Scale each row (broadcasting)", "A * B[:, None]", "A * B[:, None]"],
    "abc->acb": ["Swap the last two axes", "A.swapaxes(1, 2)", "A.transpose(1, 2)"],
    "abc->cba": ["Reverse the axes", "A.T", "A.permute(2, 1, 0)"],
    "abc->a": ["Sum over the last two axes", "A.sum(axis=(1, 2))", "A.sum(dim=(1, 2))"],
    "abc,acd->abd": ["Batched matrix multiplication", "A @ B", "torch.bmm(A, B)"],
    "abc,adc->abd": ["Batched A @ Bᵀ (like attention scores)", "A @ B.swapaxes(1, 2)", "A @ B.transpose(1, 2)"],
    "abc,c->ab": ["Each matrix in the batch times a vector", "A @ B", "A @ B"],
    "abc,cd->abd": ["Every matrix in the batch times one matrix", "A @ B", "A @ B"],
    "a,ab,b->": ["Bilinear form: aᵀ M b", "A @ B @ C", "A @ B @ C"],
    "ab,bc,cd->ad": ["Chain of three matrix products", "A @ B @ C", "A @ B @ C"],
    "abc,acd->bd": ["Batched products, then added over the batch", "(A @ B).sum(axis=0)", "(A @ B).sum(dim=0)"],
    "abcd,abed->abce": ["Attention scores: Q @ Kᵀ for each batch and head", "A @ B.swapaxes(-1, -2)", "A @ B.transpose(-1, -2)"],
    "abcd,abde->abce": ["Matrix multiplication for each batch and head (attention weights @ V)", "A @ B", "A @ B"],
    "abcd,cdef->abef": ["Contract A's last two axes with B's first two", "np.tensordot(A, B, axes=2)", "torch.tensordot(A, B, dims=2)"],
    "abcd->acbd": ["Swap the middle two axes (split or merge attention heads)", "A.transpose(0, 2, 1, 3)", "A.permute(0, 2, 1, 3)"]
  };
  // Every two-input einsum is a batched matrix multiplication once the letters are sorted:
  //   batch       in A, B and the output     -> one separate product for each
  //   rows        only in A, kept            -> the rows of A's matrix
  //   cols        only in B, kept            -> the columns of B's matrix
  //   contracted  in A and B, not kept       -> multiplied, then added up (the inner axis)
  //   sumA / sumB only in one input, not kept -> added up inside that input first
  // Several letters in one group act like one long axis. steps: what the code does, so it can be tested.
  E.recipe = function (p, sizes) {
    if (p.inputs.length !== 2) return null;
    const [a, b] = p.inputs;
    if ([a, b].some((t) => new Set(t).size !== t.length)) return null; // a diagonal isn't a matrix product
    const g = { batch: [], rows: [], cols: [], contracted: [], sumA: [], sumB: [] };
    for (const c of p.letters) {
      const kept = p.output.includes(c);
      if (a.includes(c) && b.includes(c)) g[kept ? "batch" : "contracted"].push(c);
      else if (a.includes(c)) g[kept ? "rows" : "sumA"].push(c);
      else g[kept ? "cols" : "sumB"].push(c);
    }
    const size = (ls) => ls.reduce((n, c) => n * sizes[c], 1);
    const prep = (term, sum, order, two) => {
      const rest = [...term].filter((c) => !sum.includes(c));
      const shape = [...(g.batch.length ? [size(g.batch)] : []), size(two[0]), size(two[1])];
      return { sum: sum.map((c) => term.indexOf(c)), perm: order.map((c) => rest.indexOf(c)), shape };
    };
    const stepA = prep(a, g.sumA, [...g.batch, ...g.rows, ...g.contracted], [g.rows, g.contracted]);
    const stepB = prep(b, g.sumB, [...g.batch, ...g.contracted, ...g.cols], [g.contracted, g.cols]);
    const mid = [...g.batch, ...g.rows, ...g.cols];
    const steps = { a: stepA, b: stepB, shape: mid.map((c) => sizes[c]), perm: [...p.output].map((c) => mid.indexOf(c)) };
    const isId = (perm) => perm.every((v, i) => v === i);
    const tuple = (xs) => "(" + xs.join(", ") + (xs.length === 1 ? ",)" : ")");
    const code = (torch) => {
      const line = (name, st) => {
        let x = name;
        if (st.sum.length) x += ".sum(" + (torch ? "dim=" : "axis=") + (st.sum.length === 1 ? st.sum[0] : tuple(st.sum)) + ")";
        if (!isId(st.perm)) x += (torch ? ".permute" : ".transpose") + "(" + st.perm.join(", ") + ")";
        return name + "2 = " + x + ".reshape(" + st.shape.join(", ") + ")";
      };
      const last = "out = (A2 @ B2).reshape(" + (steps.shape.length ? steps.shape.join(", ") : "()") + ")" + (isId(steps.perm) ? "" : (torch ? ".permute" : ".transpose") + "(" + steps.perm.join(", ") + ")");
      return [line("A", stepA), line("B", stepB), last].join("\n");
    };
    return { groups: g, M: size(g.rows), K: size(g.contracted), N: size(g.cols), batch: size(g.batch), reorder: !isId(steps.perm), steps, numpy: code(false), torch: code(true) };
  };

  E.recognize = function (p) {
    const map = {};
    p.letters.forEach((c, i) => (map[c] = "abcdefghij"[i]));
    const key = p.inputs.map((s) => [...s].map((c) => map[c]).join("")).join(",") + "->" + [...p.output].map((c) => map[c]).join("");
    const hit = PATTERNS[key];
    return hit ? { name: hit[0], numpy: hit[1], torch: hit[2] } : null;
  };
})();
