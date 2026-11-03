// Einsum Explainer page. The notation and the maths are in einsum.js.
// Saves the equation and the size of each letter. A link like #eq=ij,jk->ik opens that equation.
(function () {
  "use strict";
  const { el } = window.UI;
  const E = window.Einsum;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("einsum", 1);
  const DEFAULT_SIZES = [2, 3, 4, 2, 3, 2];

  const saved = store.load({});
  const s = {
    eq: typeof saved.eq === "string" ? saved.eq.slice(0, 60) : "ij,jk->ik",
    sizes: saved.sizes && typeof saved.sizes === "object" ? saved.sizes : {}
  };
  const fromHash = location.hash.match(/^#eq=(.{1,80})$/);
  if (fromHash) {
    try {
      s.eq = decodeURIComponent(fromHash[1]);
    } catch (e) {
      /* a broken link: keep the saved equation */
    }
  }
  const save = () => store.save({ eq: s.eq, sizes: s.sizes });

  let p = null, values = null, valuesKey = "", out = null, pick = {}, focusPick = false;
  const colorOf = (c) => "l" + (p.letters.indexOf(c) % 6);
  const letterChip = (c) => el("span", { class: "letter " + colorOf(c), text: c });
  const flatIndex = (index, shape) => index.reduce((acc, v, k) => acc * shape[k] + v, 0);

  function sizeOf(c, i) {
    const n = Number(s.sizes[c]);
    return Number.isInteger(n) && n >= 1 && n <= E.MAX_SIZE ? n : DEFAULT_SIZES[i % DEFAULT_SIZES.length];
  }

  // ---------- Grids ----------

  // One input or the output, drawn as rows × columns (and slices for a third letter).
  function grid(title, term, vals, opts) {
    const shape = E.shapeOf(term, p.sizesNow);
    const cell = (index) => {
      const i = flatIndex(index, shape);
      const v = vals[i];
      const cls = "cell" + (opts.hits && opts.hits.has(i) ? " is-hit" : "") + (opts.picked === i ? " is-pick" : "");
      if (!opts.output) return el("td", { class: cls, text: String(v) });
      const b = el("button", { type: "button", class: cls, "data-i": String(i), "aria-label": "out[" + index.join(", ") + "] = " + v, "aria-pressed": String(opts.picked === i), text: String(v) });
      b.addEventListener("click", () => {
        pick = {};
        [...p.output].forEach((c, k) => (pick[c] = index[k]));
        focusPick = true;
        render();
      });
      return el("td", {}, [b]);
    };
    const table = (rowsLetter, colsLetter, prefix) => {
      const rows = rowsLetter ? p.sizesNow[rowsLetter] : 1, cols = colsLetter ? p.sizesNow[colsLetter] : 1;
      const head = colsLetter
        ? el("thead", {}, [el("tr", {}, [el("th", { class: "corner" }, rowsLetter ? [letterChip(rowsLetter), " \\ ", letterChip(colsLetter)] : [letterChip(colsLetter)]), ...Array.from({ length: cols }, (_, k) => el("th", { scope: "col", class: "ix " + colorOf(colsLetter), text: String(k) }))])])
        : null;
      const body = el("tbody", {}, Array.from({ length: rows }, (_, r) => el("tr", {}, [
        rowsLetter ? el("th", { scope: "row", class: "ix " + colorOf(rowsLetter), text: String(r) }) : colsLetter ? el("th", { class: "ix" }) : null,
        ...Array.from({ length: cols }, (_, k) => cell([...prefix, ...(rowsLetter ? [r] : []), ...(colsLetter ? [k] : [])]))
      ])));
      return el("table", { class: "nums" }, [head, body]);
    };
    const parts = [];
    if (term.length <= 2) parts.push(table(term.length === 2 ? term[0] : null, term.length ? term[term.length - 1] : null, []));
    else {
      // One row of slices for each value of the letters before the slice letter (b, h… in bhqd).
      const pre = [...term.slice(0, -2)];
      const outer = pre.slice(0, -1), last = pre[pre.length - 1];
      const rows = [];
      const walk = (k, vals) => {
        if (k < outer.length) {
          for (let v = 0; v < p.sizesNow[outer[k]]; v++) walk(k + 1, [...vals, v]);
          return;
        }
        rows.push(el("div", { class: "slices" }, Array.from({ length: p.sizesNow[last] }, (_, v) => {
          const at = [...vals, v];
          const title = pre.flatMap((c, k) => [k ? ", " : "", letterChip(c), " = " + at[k]]);
          return el("div", { class: "slice" }, [el("p", { class: "slice__title" }, title), table(term[term.length - 2], term[term.length - 1], at)]);
        })));
      };
      walk(0, []);
      if (rows.length === 1) parts.push(...rows[0].childNodes);
      else return el("figure", { class: "operand" + (opts.output ? " operand--out" : "") }, [caption(), el("div", { class: "slice-rows" }, rows)]);
    }
    return el("figure", { class: "operand" + (opts.output ? " operand--out" : "") }, [caption(), el("div", { class: "slices" }, parts)]);
    function caption() {
      const label = term.length ? [title, "[", ...[...term].flatMap((c, k) => (k ? [", ", letterChip(c)] : [letterChip(c)])), "]"] : [title];
      return el("figcaption", {}, [el("strong", {}, label), el("span", { class: "muted small", text: "  shape (" + shape.join(", ") + (shape.length === 1 ? "," : "") + ")" })]);
    }
  }

  // ---------- Explaining one entry ----------

  function explainPick() {
    const terms = E.terms(p, p.sizesNow, values, pick);
    const outIdx = [...p.output].map((c) => pick[c]);
    const outShape = E.shapeOf(p.output, p.sizesNow);
    const target = p.output.length ? "out[" + outIdx.join(", ") + "]" : "out";
    const total = out[p.output.length ? flatIndex(outIdx, outShape) : 0];
    const show = terms.length > 8 ? [...terms.slice(0, 3), null, terms[terms.length - 1]] : terms;
    const sym = show.map((t) => (t ? t.factors.map((f) => E.NAMES[f.input] + "[" + f.index.join(", ") + "]").join(" · ") : "…")).join(" + ");
    const num = show.map((t) => (t ? t.factors.map((f) => f.value).join(" · ") : "…")).join(" + ");
    const summed = p.letters.filter((c) => !p.output.includes(c));
    const lines = [el("p", { class: "pick__sym" }, [el("strong", { text: target }), " = " + sym])];
    if (num !== String(total)) lines.push(el("p", { class: "pick__num" }, ["= " + num + " = ", el("strong", { text: String(total) })]));
    else lines.push(el("p", { class: "pick__num" }, ["= ", el("strong", { text: String(total) })]));
    lines.push(el("p", { class: "muted small", text: summed.length
      ? terms.length + " product" + (terms.length === 1 ? "" : "s") + " added up: one for each value of " + summed.join(" and ") + ". The highlighted entries are the ones used."
      : p.inputs.length > 1 ? "Nothing is added up here (every letter is in the output), so each result is a single product." : "Nothing is added up or multiplied: each entry is copied from one place." }));
    return { lines, terms };
  }

  // ---------- Drawing everything ----------

  function render() {
    p = E.parse(s.eq);
    $("eq-error").hidden = !p.error;
    $("eq-error").textContent = p.error || "";
    const clear = () => {
      $("explain").hidden = true;
      $("grids").replaceChildren();
      $("pick").replaceChildren();
      $("loops").textContent = "";
      $("sizes").replaceChildren();
    };
    if (p.error) return clear();

    p.sizesNow = {};
    p.letters.forEach((c, i) => (p.sizesNow[c] = sizeOf(c, i)));
    $("sizes").replaceChildren(el("span", { class: "muted small", text: "Sizes:" }), ...p.letters.map((c, i) => {
      const input = el("input", { type: "number", min: "1", max: String(E.MAX_SIZE), step: "1", value: String(p.sizesNow[c]), "aria-label": "Size of " + c, class: "size-input" });
      input.addEventListener("change", () => {
        const n = Math.round(Number(input.value));
        s.sizes[c] = Math.min(E.MAX_SIZE, Math.max(1, Number.isFinite(n) ? n : 1));
        save();
        render();
      });
      return el("label", { class: "size" }, [letterChip(c), input]);
    }));
    const big = [...p.inputs, p.output].find((t) => E.shapeOf(t, p.sizesNow).reduce((a, b) => a * b, 1) > E.MAX_CELLS);
    if (big !== undefined || E.work(p, p.sizesNow) > E.MAX_WORK) {
      $("eq-error").hidden = false;
      $("eq-error").textContent = big !== undefined ? "One of the grids would have more than " + E.MAX_CELLS + " entries, too many to draw. Make some sizes smaller." : "That's too many combinations to show. Make some sizes smaller.";
      $("grids").replaceChildren();
      $("pick").replaceChildren();
      $("explain").hidden = true;
      return;
    }

    // Keep the numbers while the shapes stay the same.
    const key = p.inputs.map((t) => E.shapeOf(t, p.sizesNow).join("x")).join(",") + "|" + p.inputs.join(",");
    if (key !== valuesKey) {
      values = E.random(p, p.sizesNow);
      valuesKey = key;
    }
    out = E.compute(p, p.sizesNow, values);
    if (!p.output.split("").every((c) => Number.isInteger(pick[c]) && pick[c] < p.sizesNow[c])) {
      pick = {};
      for (const c of p.output) pick[c] = 0;
    }

    // The formula, in symbols and words.
    const summed = p.letters.filter((c) => !p.output.includes(c));
    const ix = (term) => (term.length ? ["[", ...[...term].flatMap((c, k) => (k ? [", ", letterChip(c)] : [letterChip(c)])), "]"] : []);
    const product = p.inputs.flatMap((t, n) => [n ? " · " : "", E.NAMES[n], ...ix(t)]);
    $("formula").replaceChildren(
      el("strong", {}, ["out", ...ix(p.output)]),
      " = ",
      ...(summed.length ? ["sum over ", ...summed.flatMap((c, k) => (k ? [", ", letterChip(c)] : [letterChip(c)])), " of "] : []),
      ...product,
      p.explicit ? "" : el("span", { class: "muted small", text: "   (no arrow, so the output is " + (p.output || "nothing") + ": the letters used once, in alphabetical order)" })
    );
    const known = E.recognize(p);
    $("same").hidden = !known;
    if (known) {
      $("same").replaceChildren(
        el("strong", { text: known.name + ". " }),
        "Same as ",
        el("code", { text: known.numpy }),
        ...(known.torch !== known.numpy ? [" in NumPy, ", el("code", { text: known.torch }), " in PyTorch"] : [])
      );
    }
    $("roles").replaceChildren(...E.roles(p).map((r) => el("li", {}, [letterChip(r.letter), el("span", { class: "muted", text: " (size " + p.sizesNow[r.letter] + ") " }), r.text + "."])));
    showRecipe();
    $("explain").hidden = false;

    // The grids, with the picked entry and what it's made of.
    const ex = explainPick();
    const outShape = E.shapeOf(p.output, p.sizesNow);
    const pickedFlat = p.output.length ? flatIndex([...p.output].map((c) => pick[c]), outShape) : 0;
    const hits = p.inputs.map((t, n) => new Set(ex.terms.map((term) => flatIndex(term.factors[n].index, E.shapeOf(t, p.sizesNow)))));
    const figs = [];
    // Each sign travels with the grid after it, so they wrap together.
    const group = (sign, fig) => el("div", { class: "group" }, [sign ? el("span", { class: "op", "aria-hidden": "true", text: sign }) : null, fig]);
    p.inputs.forEach((t, n) => figs.push(group(n ? "·" : "", grid(E.NAMES[n], t, values[n], { hits: hits[n] }))));
    figs.push(group("→", grid("out", p.output, out, { output: true, picked: pickedFlat })));
    $("grids").replaceChildren(...figs);
    $("pick").replaceChildren(el("p", { class: "muted small", text: "Click any entry of out to see how it's made." }), ...ex.lines);
    if (focusPick) {
      const b = $("grids").querySelector('button[data-i="' + pickedFlat + '"]');
      if (b) b.focus();
      focusPick = false;
    }

    $("loops").textContent = E.loops(p, p.sizesNow);
    const args = p.inputs.map((_, n) => E.NAMES[n]).join(", ");
    $("code-np").textContent = 'np.einsum("' + s.eq.replace(/\s+/g, "") + '", ' + args + ")";
    $("code-torch").textContent = 'torch.einsum("' + s.eq.replace(/\s+/g, "") + '", ' + args + ")";
  }

  function showRecipe() {
    const box = $("recipe");
    const r = E.recipe(p, p.sizesNow);
    if (!r) {
      box.hidden = p.inputs.length < 3;
      // Three inputs: einsum works through them two at a time.
      if (!box.hidden) box.replaceChildren(el("p", { class: "small", text: "With three inputs, einsum combines them two at a time (A with B, then that result with C), and each pair works like the two-input recipe. See lesson 8." }));
      return;
    }
    const chips = (ls) => (ls.length ? ls.flatMap((c, k) => (k ? [" ", letterChip(c)] : [letterChip(c)])) : [el("span", { class: "muted", text: "none" })]);
    const g = r.groups;
    const rows = [
      ["Batch", "in A, B and the output: a separate product for each", g.batch],
      ["Rows", "only in A, kept", g.rows],
      ["Columns", "only in B, kept", g.cols],
      ["Contracted", "in A and B, not in the output: multiplied, then added up", g.contracted]
    ];
    if (g.sumA.length) rows.push(["Added up in A first", "only in A, not in the output", g.sumA]);
    if (g.sumB.length) rows.push(["Added up in B first", "only in B, not in the output", g.sumB]);
    const dims = (ls, n) => (ls.length > 1 ? n + " (" + ls.map((c) => p.sizesNow[c]).join("·") + ")" : String(n));
    const each = g.batch.length ? "For each of the " + r.batch + " combinations of " + g.batch.join(", ") + ", it" : "It";
    const sentence = each + " multiplies a " + dims(g.rows, r.M) + " × " + dims(g.contracted, r.K) + " matrix from A by a " + dims(g.contracted, r.K) + " × " + dims(g.cols, r.N) + " matrix from B." + (r.reorder ? " Then the axes are put in the order " + p.output + "." : "");
    box.replaceChildren(
      el("p", { class: "recipe__title" }, [el("strong", { text: "As a matrix multiplication. " }), "Any two-input einsum is one, once its letters are sorted into groups (several letters in a group act like one long axis):"]),
      el("ul", { class: "recipe__groups small" }, rows.map(([name, what, ls]) => el("li", {}, [el("strong", { text: name + ": " }), ...chips(ls), el("span", { class: "muted", text: "  " + what })]))),
      el("p", { class: "small", text: sentence }),
      el("details", { class: "recipe__code" }, [
        el("summary", { class: "small", text: "The same thing with transpose, reshape and @" }),
        el("pre", { text: "# NumPy\n" + r.numpy + "\n\n# PyTorch\n" + r.torch })
      ])
    );
    box.hidden = false;
  }

  function setEquation(eq) {
    s.eq = eq;
    $("eq").value = eq;
    history.replaceState(null, "", "#eq=" + encodeURIComponent(eq));
    save();
    render();
  }

  $("eq").value = s.eq;
  $("eq").addEventListener("input", () => {
    s.eq = $("eq").value.slice(0, 60);
    history.replaceState(null, "", "#eq=" + encodeURIComponent(s.eq));
    save();
    render();
  });
  $("shuffle").addEventListener("click", () => {
    valuesKey = "";
    render();
  });
  // "Try it" buttons in the tutorial.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-eq]");
    if (!b) return;
    setEquation(b.getAttribute("data-eq"));
    $("eq").scrollIntoView({ behavior: "smooth", block: "center" });
    $("eq").focus({ preventScroll: true });
  });

  // ---------- Cheat sheet ----------

  const CHEAT = ["ij->ji", "ij->i", "ij->j", "ij->", "ii->i", "ii->", "i,i->", "i,i->i", "i,j->ij", "ij,j->i", "ij,jk->ik", "ij,kj->ik", "ji,jk->ik", "ij,ij->ij", "ij,ij->", "ij,ij->i", "bij,bjk->bik", "bij,bkj->bik", "bij,jk->bik", "bhqd,bhkd->bhqk", "bhqk,bhkd->bhqd", "bhqd->bqhd", "abcd,cdef->abef", "i,ij,j->", "ij,jk,kl->il"];
  $("cheat").replaceChildren(...CHEAT.map((eq) => {
    const known = E.recognize(E.parse(eq));
    return el("tr", {}, [
      el("td", {}, [el("code", { text: eq })]),
      el("td", { text: known ? known.name : "" }),
      el("td", {}, known ? [el("code", { text: known.numpy }), known.torch !== known.numpy ? [el("br"), el("code", { text: known.torch }), el("span", { class: "muted small", text: " (PyTorch)" })] : ""].flat() : []),
      el("td", {}, [el("button", { type: "button", class: "button button--small button--ghost", "data-eq": eq, "aria-label": "Try " + eq, text: "Try" })])
    ]);
  }));

  render();
})();
