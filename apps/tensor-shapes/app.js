// Tensor Shape Visualizer page. Parsing is in parse.js, shape rules in ops.js and
// layers.js, running in eval.js, drawing in draw.js.
// Saves the code in the editor. A link can carry code in its #code=… part.
(function () {
  "use strict";
  const { el } = window.UI;
  const TS = window.TS;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("tensor-shapes", 1);
  const MAX_CODE = 50000;

  const EXAMPLES = [
    {
      name: "CNN",
      code: `import torch
import torch.nn as nn
import torch.nn.functional as F

x = torch.randn(8, 3, 32, 32)  # B C H W

conv1 = nn.Conv2d(3, 16, kernel_size=3, padding=1)
conv2 = nn.Conv2d(16, 32, kernel_size=3, padding=1)
pool = nn.MaxPool2d(2)
fc = nn.Linear(32 * 8 * 8, 10)

x = pool(F.relu(conv1(x)))
x = pool(F.relu(conv2(x)))
x = x.flatten(1)
logits = fc(x)  # (8, 10)
`
    },
    {
      name: "Attention heads",
      code: `import torch
import torch.nn as nn

B, T, C = 2, 10, 512
heads = 8
x = torch.randn(B, T, C)

qkv = nn.Linear(C, 3 * C)(x)
q, k, v = qkv.chunk(3, dim=-1)

# Split into heads: (B, T, C) -> (B, heads, T, C // heads)
q = q.view(B, T, heads, C // heads).transpose(1, 2)
k = k.view(B, T, heads, C // heads).transpose(1, 2)
v = v.view(B, T, heads, C // heads).transpose(1, 2)

scores = q @ k.transpose(-2, -1) / (C // heads) ** 0.5
weights = scores.softmax(dim=-1)
out = weights @ v

# Join the heads again. .view() here would fail: try it.
out = out.transpose(1, 2).reshape(B, T, C)
`
    },
    {
      name: "Matmul & broadcasting",
      code: `import torch

A = torch.randn(10, 3, 4)   # a batch of 10 matrices, each 3 by 4
W = torch.randn(4, 5)       # one 4 by 5 matrix
out = A @ W                 # (10, 3, 5)

v = torch.randn(4)
A @ v                       # (10, 3)

bias = torch.randn(5)
out + bias                  # (10, 3, 5)

p = torch.randn(32, 1, 7)
q = torch.randn(1, 6, 7)
diff = p - q                # (32, 6, 7)

torch.einsum("bij,jk->bik", A, W)
`
    },
    {
      name: "NumPy",
      code: `import numpy as np

a = np.zeros((3, 4))
b = np.arange(4)
a + b                          # (3, 4)

col = np.arange(3)
a + col[:, None]               # (3, 4)

a.sum(axis=0)                  # (4,)
a.sum(axis=0, keepdims=True)   # (1, 4)

m = np.random.randn(2, 3, 4)
m.T                            # (4, 3, 2)
np.swapaxes(m, -1, -2)         # (2, 4, 3)

np.repeat(b, 2)                # (8,)
np.tile(b, 2)                  # (8,)
np.stack([b, b])               # (2, 4)
np.concatenate([b, b])         # (8,)
`
    },
    {
      name: "Join & split",
      code: `import torch

a = torch.randn(4, 3)
b = torch.randn(4, 3)
torch.cat([a, b])              # (8, 3)
torch.cat([a, b], dim=1)       # (4, 6)
torch.stack([a, b])            # (2, 4, 3)

x = torch.randn(10, 6)
x.chunk(3, dim=1)
x.split(4)
values, indices = x.max(dim=1)
x.mean(dim=0, keepdim=True)    # (1, 6)
x[:, None, :].shape
`
    },
    {
      name: "Error: view",
      code: `import torch

x = torch.randn(8, 3, 32, 32)  # B C H W
x = x.permute(0, 2, 3, 1)      # B H W C
x = x.view(8, -1)
`
    },
    {
      name: "Error: Linear size",
      code: `import torch
import torch.nn as nn

x = torch.randn(8, 3, 32, 32)
conv = nn.Conv2d(3, 16, kernel_size=3)
fc = nn.Linear(16 * 32 * 32, 10)

x = conv(x)
x = x.flatten(1)
logits = fc(x)
`
    }
  ];

  // ---------- Saving and links ----------

  const saved = store.load({});
  let mine = typeof saved.code === "string" ? saved.code : EXAMPLES[0].code;
  let fromLink = false;
  let beforeExample = null;
  const save = () => {
    if (!fromLink) store.save({ code: $("code").value.slice(0, MAX_CODE) });
  };
  if (!Store.available()) $("storage-warning").hidden = false;

  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode(s) {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function readLink() {
    const m = location.hash.match(/^#code=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      return decode(m[1]).slice(0, MAX_CODE);
    } catch (e) {
      return null;
    }
  }
  function showLinkNote() {
    $("link-note").replaceChildren(
      "This code came from a link. Your own code is still saved and won't be replaced unless you edit this. ",
      (() => {
        const b = el("button", { type: "button", class: "button button--small button--ghost", text: "Back to my code" });
        b.addEventListener("click", () => {
          fromLink = false;
          history.replaceState(null, "", location.pathname);
          $("link-note").hidden = true;
          $("code").value = mine;
          update();
        });
        return b;
      })()
    );
    $("link-note").hidden = false;
  }

  $("copy-link").addEventListener("click", async () => {
    const code = $("code").value;
    const url = location.origin + location.pathname + "#code=" + encode(code);
    const button = $("copy-link");
    if (url.length > 8000) {
      button.textContent = "Too long for a link";
      setTimeout(() => (button.textContent = "Copy link"), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "Link copied";
    } catch (e) {
      button.textContent = "Couldn't copy";
    }
    setTimeout(() => (button.textContent = "Copy link"), 1800);
  });

  // ---------- Examples ----------

  $("examples").append(
    ...EXAMPLES.map((ex) => {
      const b = el("button", { type: "button", class: "chip", text: ex.name });
      b.addEventListener("click", () => {
        const current = $("code").value;
        // Keep the person's own code so one click can bring it back.
        if (current.trim() && !EXAMPLES.some((e) => e.code === current)) beforeExample = current;
        $("code").value = ex.code;
        $("restore").hidden = !beforeExample;
        edited();
      });
      return b;
    })
  );
  $("restore-button").addEventListener("click", () => {
    $("code").value = beforeExample;
    beforeExample = null;
    $("restore").hidden = true;
    edited();
  });

  // ---------- Showing the steps ----------

  const dimChip = (t, i) => {
    const d = t.dims[i];
    const named = d.label && d.label !== String(t.shape[i]);
    return el("span", { class: "dim " + (d.color < 0 ? "dn" : "d" + d.color) }, [named ? el("b", { text: d.label }) : null, (named ? " " : "") + t.shape[i].toLocaleString("en-US")]);
  };
  function shapeChips(t) {
    const parts = ["("];
    t.shape.forEach((_, i) => {
      if (i) parts.push(", ");
      parts.push(dimChip(t, i));
    });
    if (t.shape.length === 1) parts.push(",");
    parts.push(")");
    return el("span", { class: "shape" }, parts);
  }
  function figure(t, caption, paint) {
    // While tracing, the trace's highlights replace the follow colors.
    const marks = traced ? marksFor(t) : null;
    const pic = TS.draw(t, $("steps").clientWidth, marks ? undefined : paint, marks);
    const holder = el("div", { class: "fig__pic" });
    holder.innerHTML = pic.svg; // built by draw.js with every label escaped
    const at = made.get(t);
    if (at && t.shape.every((n) => n > 0)) {
      // Click a cell to trace that element; Enter traces the first element.
      const name = t.name || "this result";
      Object.assign(holder.dataset, { at: at.key + "#" + at.out });
      holder.classList.add("fig__pic--pick");
      holder.setAttribute("tabindex", "0");
      holder.setAttribute("role", "button");
      holder.setAttribute("aria-label", "Trace an element of " + name + ": click a cell, or press Enter for the first element");
      holder.addEventListener("click", (e) => {
        const box = holder.querySelector("svg").getBoundingClientRect();
        const idx = pic.pick(((e.clientX - box.left) * pic.width) / box.width, ((e.clientY - box.top) * pic.height) / box.height);
        if (idx) startTrace(at, idx, holder);
      });
      holder.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        startTrace(at, t.shape.map(() => 0), holder, true);
      });
    }
    return el("figure", { class: "fig" }, [
      holder,
      el("figcaption", {}, [
        el("span", { class: "fig__name", text: caption || t.name || "result" }),
        " ",
        shapeChips(t),
        t.layoutBy && t.lib !== "numpy" ? el("span", { class: "fig__mem", text: "Not contiguous in memory (after " + t.layoutBy + ")" }) : null,
        pic.note ? el("span", { class: "fig__mem", text: pic.note }) : null,
        pic.hidden ? el("span", { class: "fig__mem", text: pic.hidden.toLocaleString("en-US") + " highlighted element" + (pic.hidden === 1 ? " is" : "s are") + " in boxes not drawn (behind the …)." }) : null
      ])
    ]);
  }
  // paintOf(t): how to color an output while following elements, or undefined.
  function outputsRow(outs, paintOf) {
    if (outs.length === 1) return [figure(outs[0], "", paintOf && paintOf(outs[0]))];
    const sameShape = outs.every((t) => TS.sameShape(t.shape, outs[0].shape));
    // Pieces look alike, but their elements don't: show them one by one when following.
    if (sameShape && !paintOf && !traced) return [figure(outs[0], outs.length + " pieces, each")];
    const shown = outs.slice(0, 4).map((t, i) => figure(t, t.name || "piece " + i, paintOf && paintOf(t)));
    if (outs.length > 4) shown.push(el("p", { class: "muted small", text: "and " + (outs.length - 4) + " more" }));
    return shown;
  }

  // ---------- Following elements: color an input by one dimension, see where each lands ----------

  const following = new Map(); // "line:step:code" -> { input, dim }, for this visit only
  const sourceOf = (out, t) => (out.src || []).find((s) => s.t === t && !s.mixes);
  const followable = (step) => step.inputs.map((t, n) => (step.outputs.some((o) => sourceOf(o, t)) ? n : -1)).filter((n) => n >= 0);
  // What to call an input in the follow chips and legend.
  const inputName = (step, n) => step.inputs[n].name || (step.inputs.length > 1 ? "input " + (n + 1) : "the input");
  const swatch = (v, n) => el("span", { class: "swatch", style: "background:" + TS.indexColor(v, n), "aria-hidden": "true" });
  function followChoice(step, key) {
    const f = following.get(key);
    const t = f && step.inputs[f.input];
    return t && f.dim < t.shape.length && t.shape[f.dim] > 1 && followable(step).includes(f.input) ? f : null;
  }
  function followRow(step, key, f, redraw) {
    const ins = followable(step);
    const chips = [];
    ins.forEach((n) => {
      const t = step.inputs[n];
      t.shape.forEach((size, i) => {
        if (size < 2) return;
        const on = !!f && f.input === n && f.dim === i;
        const chip = el("button", { type: "button", class: "chip chip--dim", "aria-pressed": on ? "true" : "false" }, [step.inputs.length > 1 ? inputName(step, n) + " " : null, dimChip(t, i)]);
        chip.addEventListener("click", () => {
          if (on) following.delete(key);
          else following.set(key, { input: n, dim: i });
          redraw();
        });
        chips.push(chip);
      });
    });
    if (!chips.length) return null;
    return el("div", { class: "step__follow small" }, [el("span", { class: "muted", text: f ? "Colored by:" : "Where do the elements go? Color by:" }), ...chips]);
  }
  function legend(step, f) {
    const t = step.inputs[f.input], n = t.shape[f.dim];
    // Up to 8 values get a swatch each; more read as a ramp from first to last.
    const ramp = () => {
      const stops = Array.from({ length: 9 }, (_, k) => TS.indexColor((k * (n - 1)) / 8, n));
      return el("span", { class: "legend__ramp", style: "background:linear-gradient(to right," + stops.join(",") + ")", "aria-hidden": "true" });
    };
    const scale = n <= 8
      ? Array.from({ length: n }, (_, v) => el("span", { class: "legend__item" }, [swatch(v, n), String(v)]))
      : [el("span", { class: "legend__item" }, ["0 ", ramp(), " " + (n - 1).toLocaleString("en-US")])];
    const others = step.inputs.map((x, k) => (x === t ? null : inputName(step, k))).filter(Boolean);
    const what = t.dims[f.dim].label || "dimension " + f.dim + " (size " + n + ")";
    const partial = step.outputs.some((o) => (sourceOf(o, t) || {}).partial);
    const name = inputName(step, f.input);
    return el("div", { class: "step__legend small" }, [
      el("p", {}, [
        "Each element of " + name + " is colored by its index along " + what + ": ",
        ...scale
      ]),
      !others.length ? null
        : partial ? el("p", { class: "muted", text: "Uncolored parts of the result come from " + others.join(" and ") + "." })
        : el("p", { class: "muted", text: "Each element of the result combines one element from each input; its color shows which element of " + name + " it used." })
    ]);
  }

  // ---------- Tracing: click an element, see what feeds it and what it feeds, at every step ----------

  let trace = null; // { key, out, idx }: the clicked element, found again after each edit
  let traced = null; // { target, idx, res } for the current run, or null
  let made = new Map(); // tensor -> { key, out, line } of the step that made it
  const marksFor = (t) => {
    if (t === traced.target) return [{ cls: "target", set: new Set([TS.ravel(traced.idx, t.shape)]) }];
    const m = [], b = traced.res.back.get(t), w = traced.res.wide.get(t), f = traced.res.fwd.get(t);
    if (b || w) m.push({ cls: "back", set: b, boxes: w });
    if (f) m.push({ cls: "fwd", set: f });
    return m;
  };
  const traceSize = (t) => {
    let n = (traced.res.back.get(t) || traced.res.fwd.get(t) || new Set()).size;
    for (const box of traced.res.wide.get(t) || []) n += box.reduce((a, e) => a * (typeof e === "number" ? 1 : e[1] - e[0] + 1), 1);
    return n;
  };
  // Unnamed results go by their code: "k.transpose(-2, -1)".
  const nameOf = (t) => t.name || (made.has(t) ? made.get(t).label : "a result");

  function startTrace(at, idx, from, keyboard) {
    // Keep the clicked drawing where it was on screen, though the page above it changes.
    const before = from.getBoundingClientRect().top;
    trace = { key: at.key, out: at.out, idx };
    update();
    const again = [...document.querySelectorAll(".fig__pic")].filter((h) => h.dataset.at === from.dataset.at);
    const same = again.sort((a, b) => Math.abs(a.getBoundingClientRect().top - before) - Math.abs(b.getBoundingClientRect().top - before))[0];
    if (same) window.scrollBy(0, same.getBoundingClientRect().top - before);
    if (keyboard) {
      const first = document.querySelector(".trace input");
      if (first) first.focus({ preventScroll: true });
    }
  }
  function resolveTrace(r) {
    made = new Map();
    const all = [];
    r.lines.forEach((line) => line.steps.forEach((st, i) => {
      st.inputs.forEach((t) => !all.includes(t) && all.push(t));
      st.outputs.forEach((o, k) => {
        if (!made.has(o)) made.set(o, { key: line.line + ":" + i + ":" + st.label, out: k, line: line.line, label: st.label });
        if (!all.includes(o)) all.push(o);
      });
    }));
    traced = null;
    if (!trace) return;
    const target = [...made.entries()].find(([, w]) => w.key === trace.key && w.out === trace.out);
    // The element is gone (the line changed, or the shape shrank): stop tracing.
    if (!target || target[0].shape.length !== trace.idx.length || trace.idx.some((v, i) => v >= target[0].shape[i])) {
      trace = null;
      return;
    }
    traced = { target: target[0], idx: trace.idx, res: TS.trace(all, target[0], trace.idx) };
  }
  const markSwatch = (cls) => el("span", { class: "swatch swatch--" + cls, "aria-hidden": "true" });
  function traceBar(hasSteps) {
    if (!traced) {
      return hasSteps ? el("p", { class: "trace-hint small muted", text: "Tip: click any cell of a drawing to trace that element: what feeds into it, and what it feeds, at every step." }) : null;
    }
    const t = traced.target;
    const inputs = t.shape.map((n, i) => {
      const input = el("input", { type: "number", min: "0", max: String(n - 1), step: "1", value: String(traced.idx[i]), class: "trace__i", "aria-label": "Index along " + (t.dims[i].label || "dimension " + i) + " (0 to " + (n - 1) + ")" });
      input.addEventListener("change", () => {
        const v = Math.round(Number(input.value));
        trace.idx[i] = Number.isFinite(v) ? Math.min(n - 1, Math.max(0, v)) : 0;
        update();
        const again = document.querySelectorAll(".trace input")[i];
        if (again) again.focus({ preventScroll: true });
      });
      return input;
    });
    const indexRow = ["Tracing ", el("strong", { class: "trace__name", text: nameOf(t) }), " ["];
    inputs.forEach((inp, i) => indexRow.push(i ? ", " : "", inp));
    indexRow.push("]");
    const clear = el("button", { type: "button", class: "chip", text: "Stop tracing" });
    clear.addEventListener("click", () => {
      trace = null;
      update();
    });
    // Who feeds it, who it feeds: in the order the code made them.
    const list = (map, extra) => [...new Set([...map.keys(), ...(extra ? extra.keys() : [])])].filter((x) => x !== t && made.has(x)).sort((a, b) => a.uid - b.uid)
      .map((x) => nameOf(x) + " " + traceSize(x).toLocaleString("en-US") + " of " + TS.numel(x.shape).toLocaleString("en-US"));
    const fedBy = list(traced.res.back, traced.res.wide), feeds = list(traced.res.fwd);
    const notes = [];
    if (traced.res.stops.length) notes.push("The trace stops at " + traced.res.stops.map((x) => (made.has(x) ? "line " + made.get(x).line : "a step")).join(", ") + ": this tool doesn't know how elements move in that operation.");
    if (traced.res.approx) notes.push("Some steps pick elements by their values (index_select, gather, embeddings) or skip positions (dilation, rolling): there the highlight covers every element that could be used.");
    if (traced.res.capped) notes.push("Too many elements to follow everything: the trace stopped early.");
    return el("section", { class: "trace", "aria-label": "Trace" }, [
      el("div", { class: "trace__head" }, [el("p", { class: "trace__index" }, indexRow), clear]),
      el("p", { class: "trace__legend small" }, [
        el("span", { class: "legend__item" }, [markSwatch("target"), "this element"]),
        el("span", { class: "legend__item" }, [markSwatch("back"), "feeds into it"]),
        el("span", { class: "legend__item" }, [markSwatch("fwd"), "it feeds"])
      ]),
      // The counts, folded away on small screens so the bar stays short.
      el("details", Object.assign({ class: "trace__sum small" }, innerWidth >= 700 ? { open: "" } : {}), [
        el("summary", { text: "Fed by " + fedBy.length + " result" + (fedBy.length === 1 ? "" : "s") + ", feeds " + feeds.length }),
        el("p", { text: fedBy.length ? "Fed by: " + fedBy.join(" · ") + "." : "Nothing earlier feeds it (it's made here)." }),
        el("p", { text: feeds.length ? "Feeds: " + feeds.join(" · ") + "." : "Nothing later uses it." })
      ]),
      el("p", { class: "trace__note small muted", text: "On a box, a highlighted cell means that element or any behind it along the depth." }),
      notes.length ? el("ul", { class: "trace__notes small" }, notes.map((n) => el("li", { text: n }))) : null
    ]);
  }

  function stepView(step, key) {
    // relu, dropout, softmax…: nothing to draw again, just say the shape stays. While tracing, draw it if it has highlights.
    const lit = traced && step.outputs.some((o) => marksFor(o).length);
    const unchanged = !lit && step.inputs.length === 1 && step.outputs.length === 1 && TS.sameShape(step.inputs[0].shape, step.outputs[0].shape) && step.inputs[0].dims.every((d, i) => d === step.outputs[0].dims[i]);
    if (unchanged) {
      return el("div", { class: "step step--same" }, [
        el("p", { class: "step__label" }, [el("code", { text: step.label }), step.layer && !step.label.startsWith(step.layer) ? el("span", { class: "muted small", text: "  " + step.layer }) : null]),
        el("p", { class: "step__from small" }, ["Same shape: ", el("span", { class: "fig__name", text: step.outputs[0].name || "result" }), " ", shapeChips(step.outputs[0])]),
        step.notes.length ? el("ul", { class: "step__notes small" }, step.notes.map((n) => el("li", { text: n }))) : null,
        step.warns.length ? el("ul", { class: "step__warns small" }, step.warns.map((n) => el("li", { text: n }))) : null
      ]);
    }
    const f = traced ? null : followChoice(step, key);
    const followed = f && step.inputs[f.input];
    const n = f && followed.shape[f.dim];
    const paintIn = (t) => (t === followed ? (idx) => TS.indexColor(idx[f.dim], n) : undefined);
    const paintOut = f
      ? (o) => {
          // All links to the followed input: torch.cat([y, y]) uses it twice.
          const links = (o.src || []).filter((s) => s.t === followed && !s.mixes);
          return links.length ? (idx) => {
            for (const s of links) {
              const at = s.map(idx);
              if (at) return TS.indexColor(at[f.dim], n);
            }
            return null;
          } : undefined;
        }
      : undefined;
    const figs = [];
    // One input is normally named in a line above; when following, it's drawn so the colors can be compared.
    if (step.inputs.length > 1 || f) {
      step.inputs.forEach((t, i) => {
        if (i) figs.push(el("span", { class: "fig__op", "aria-hidden": "true", text: "and" }));
        figs.push(figure(t, "", paintIn(t)));
      });
      figs.push(el("span", { class: "fig__op", "aria-hidden": "true", text: "→" }));
    }
    figs.push(...outputsRow(step.outputs, paintOut));
    const from = step.inputs.length === 1 && !f ? el("p", { class: "step__from small" }, ["from ", el("span", { class: "fig__name", text: step.inputs[0].name || "the result above" }), " ", shapeChips(step.inputs[0])]) : null;
    const view = el("div", { class: "step" }, [
      el("p", { class: "step__label" }, [el("code", { text: step.label }), step.layer && !step.label.startsWith(step.layer) ? el("span", { class: "muted small", text: "  " + step.layer }) : null]),
      from,
      traced ? null : followRow(step, key, f, () => {
        const fresh = stepView(step, key);
        view.replaceWith(fresh);
        const pressed = fresh.querySelector('[aria-pressed="true"]') || fresh.querySelector(".chip--dim");
        if (pressed) pressed.focus();
      }),
      el("div", { class: "figs" }, figs),
      f ? legend(step, f) : null,
      step.notes.length ? el("ul", { class: "step__notes small" }, step.notes.map((n) => el("li", { text: n }))) : null,
      step.warns.length ? el("ul", { class: "step__warns small" }, step.warns.map((n) => el("li", { text: n }))) : null
    ]);
    return view;
  }
  function errorView(error, text) {
    return el("div", { class: "error-box", role: "alert" }, [
      el("p", { class: "error-box__title", text: "This line fails" + (error.line ? " (line " + error.line + ")" : "") }),
      text ? el("pre", { class: "error-box__code", text }) : null,
      el("p", { text: error.message }),
      error.real ? el("p", { class: "error-box__real small", text: error.real }) : null
    ]);
  }
  function lineView(line, error) {
    const quiet = !line.steps.length && !error;
    return el("article", { class: "line" + (quiet ? " line--quiet" : "") + (error ? " line--error" : "") }, [
      el("p", { class: "line__head" }, [el("span", { class: "line__no", text: String(line.line) }), el("code", { class: "line__code", text: line.text })]),
      line.value !== null ? el("p", { class: "line__value" }, [el("span", { class: "muted", text: "→ " }), el("code", { text: line.value })]) : null,
      ...line.printed.map((p) => el("p", { class: "line__value" }, [el("span", { class: "muted", text: "printed: " }), el("code", { text: p })])),
      // The key includes the step's code, so a choice doesn't carry over to a different line.
      ...line.steps.map((step, i) => stepView(step, line.line + ":" + i + ":" + step.label)),
      error ? errorView(error, "") : null
    ]);
  }

  function update() {
    const code = $("code").value;
    const r = TS.run(code);
    resolveTrace(r);
    const views = r.lines.map((line, i) => lineView(line, r.error && i === r.lines.length - 1 && r.error.line === line.line ? r.error : null));
    if (r.error && !(r.lines.length && r.lines[r.lines.length - 1].line === r.error.line)) {
      views.push(errorView(r.error, (code.replace(/\r\n?/g, "\n").split("\n")[r.error.line - 1] || "").trim()));
    }
    if (!views.length) views.push(el("p", { class: "muted empty", text: "Write or paste some code, or pick an example. Start by making a tensor, like x = torch.randn(8, 3, 32, 32)." }));
    const bar = traceBar(r.lines.some((l) => l.steps.length));
    $("steps").replaceChildren(...(bar ? [bar] : []), ...views);
  }

  let timer = 0;
  function edited() {
    if (fromLink) {
      fromLink = false;
      history.replaceState(null, "", location.pathname);
      $("link-note").hidden = true;
    }
    mine = $("code").value;
    save();
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }
  $("code").addEventListener("input", edited);
  // Drawings are sized to the room there is.
  let lastWidth = 0;
  window.addEventListener("resize", () => {
    const w = $("steps").clientWidth;
    if (Math.abs(w - lastWidth) < 40) return;
    lastWidth = w;
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  });

  const linked = readLink();
  if (linked !== null) {
    fromLink = true;
    $("code").value = linked;
    showLinkNote();
  } else $("code").value = mine;
  update();
})();
