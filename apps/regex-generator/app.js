// Regex Generator page: the start box, the block editor, the regex, the test box and the explanation.
// Turning blocks into a regex is rx.js; ready-made patterns are presets.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const $ = (id) => document.getElementById(id);

  const APP_ID = "regex-generator";
  const store = Store.open(APP_ID, 1);
  if (!Store.available()) $("storage-warning").hidden = false;

  const KINDS = {
    text: "Exact text",
    class: "A kind of character",
    set: "One of these characters",
    words: "One of these words",
    anchor: "A position",
    group: "Group",
    or: "Either / or",
    look: "Followed by / preceded by",
    backref: "Same text as a group",
    raw: "Regex by hand"
  };
  const DEFAULTS = {
    text: () => ({ text: "" }),
    class: () => ({ cls: "digit" }),
    set: () => ({ chars: "", negate: false }),
    words: () => ({ words: [] }),
    anchor: () => ({ at: "wordEdge" }),
    group: () => ({ capture: "number", name: "", children: [] }),
    or: () => ({ options: [[], []] }),
    look: () => ({ dir: "ahead", negate: false, children: [] }),
    backref: () => ({ ref: "" }),
    raw: () => ({ source: "" })
  };
  const CONTAINERS = ["group", "or", "look"];
  const MAX_DEPTH = 5; // containers inside containers, at most this deep
  const MAX_BLOCKS = 300;
  const MAX_COUNT = 1000;
  const MAX_TEST = 100000; // characters of test text
  const MODES = ["greedy", "lazy", "possessive"];

  // ---------- Saved state, checked so a broken save can't break the page ----------

  function cleanQ(q, kind) {
    const once = { min: 1, max: 1, mode: "greedy" };
    if (!q || typeof q !== "object" || !RX.quantifiable({ kind })) return once;
    const num = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_COUNT) : null);
    const min = num(q.min) === null ? 1 : num(q.min);
    let max = q.max === null ? null : num(q.max);
    if (max === null && q.max !== null) max = min;
    if (max !== null && max < min) max = min;
    if (max === 0) return once;
    return { min, max, mode: MODES.includes(q.mode) ? q.mode : "greedy" };
  }
  function cleanBlocks(list, depth, seen, count) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const raw of list) {
      if (count.n >= MAX_BLOCKS) break;
      if (!raw || typeof raw !== "object" || !KINDS[raw.kind]) continue;
      count.n++;
      const b = Object.assign({ kind: raw.kind }, DEFAULTS[raw.kind]());
      b.id = typeof raw.id === "string" && !seen.has(raw.id) ? raw.id : RX.newId();
      seen.add(b.id);
      b.q = cleanQ(raw.q, raw.kind);
      const str = (v, d) => (typeof v === "string" ? v.slice(0, 2000) : d);
      switch (b.kind) {
        case "text": b.text = str(raw.text, ""); break;
        case "class": b.cls = RX.CLASSES[raw.cls] ? raw.cls : "digit"; break;
        case "set": b.chars = str(raw.chars, ""); b.negate = raw.negate === true; break;
        case "words": b.words = Array.isArray(raw.words) ? raw.words.filter((w) => typeof w === "string").slice(0, 200) : []; break;
        case "anchor": b.at = RX.ANCHORS[raw.at] ? raw.at : "wordEdge"; break;
        case "group":
          b.capture = ["none", "number", "name", "atomic"].includes(raw.capture) ? raw.capture : "number";
          b.name = str(raw.name, "");
          b.children = depth < MAX_DEPTH ? cleanBlocks(raw.children, depth + 1, seen, count) : [];
          break;
        case "or":
          b.options = depth < MAX_DEPTH && Array.isArray(raw.options) ? raw.options.slice(0, 50).map((o) => cleanBlocks(o, depth + 1, seen, count)) : [[], []];
          if (!b.options.length) b.options = [[]];
          break;
        case "look":
          b.dir = raw.dir === "behind" ? "behind" : "ahead";
          b.negate = raw.negate === true;
          b.children = depth < MAX_DEPTH ? cleanBlocks(raw.children, depth + 1, seen, count) : [];
          break;
        case "backref": b.ref = str(raw.ref, ""); break;
        case "raw": b.source = str(raw.source, ""); break;
      }
      out.push(b);
    }
    return out;
  }
  function defaultState() {
    const p = PRESETS[1]; // the date
    return { blocks: p.make(), flavor: "js", opts: { ignoreCase: false, wholeWord: false, wholeText: false }, example: "2026-10-31", test: p.test };
  }
  function loadState() {
    const s = store.load(null);
    if (!s || typeof s !== "object" || !Array.isArray(s.blocks)) return defaultState();
    const o = s.opts && typeof s.opts === "object" ? s.opts : {};
    return {
      blocks: cleanBlocks(s.blocks, 0, new Set(), { n: 0 }),
      flavor: RX.FLAVORS[s.flavor] ? s.flavor : "js",
      opts: { ignoreCase: o.ignoreCase === true, wholeWord: o.wholeWord === true, wholeText: o.wholeText === true },
      example: typeof s.example === "string" ? s.example.slice(0, 500) : "",
      test: typeof s.test === "string" ? s.test.slice(0, MAX_TEST) : ""
    };
  }
  const state = loadState();
  let undo = null; // { blocks, what } for one step back after a big change
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(state), 300);
  };
  const remember = (what) => {
    undo = { blocks: JSON.parse(JSON.stringify(state.blocks)), what };
  };

  // ---------- Finding blocks ----------

  // Where block id lives: { list, index, depth }.
  function locate(id, list, depth) {
    list = list || state.blocks;
    depth = depth || 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { list, index: i, depth };
      for (const seq of RX.childSeqs(list[i])) {
        const f = locate(id, seq, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  const countBlocks = () => {
    let n = 0;
    RX.walk(state.blocks, () => n++);
    return n;
  };

  // ---------- Page skeleton ----------

  const root = $("app");
  const exampleInput = el("input", { id: "example", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "for example: 2026-10-31, sam@example.com, INV-0042" });
  exampleInput.value = state.example;
  const makeBtn = el("button", { class: "button", type: "button", text: "Make blocks" });
  const presetRow = el("div", { class: "presets" }, PRESETS.map((p, i) => el("button", { class: "chip", type: "button", "data-preset": String(i), text: p.name })));
  const undoBox = el("p", { class: "undo small", hidden: "" });
  const blocksBox = el("div", { id: "blocks", class: "blocks" });
  const flavorSelect = el("select", { id: "flavor" }, Object.entries(RX.FLAVORS).map(([k, f]) => el("option", { value: k, text: f.name })));
  flavorSelect.value = state.flavor;
  const check = (key, label) => {
    const box = el("input", { type: "checkbox", "data-opt": key });
    box.checked = state.opts[key];
    return el("label", { class: "check" }, [box, " " + label]);
  };
  const patternBox = el("pre", { class: "rx", id: "pattern", "aria-live": "polite" });
  const flagsLine = el("p", { class: "small muted flags" });
  const codeBox = el("pre", { class: "code", id: "code" });
  const notesBox = el("ul", { class: "rx-notes small" });
  const testInput = el("textarea", { id: "test", spellcheck: "false", rows: "5", maxlength: String(MAX_TEST) });
  testInput.value = state.test;
  const testStatus = el("p", { class: "small test-status", "aria-live": "polite" });
  const hitsBox = el("div", { class: "hits" });
  const groupsBox = el("div", { class: "groups" });
  const explainBox = el("div", { class: "explain" });

  const copyBtn = (label, get) => {
    const b = el("button", { class: "button button--small button--ghost", type: "button", text: label });
    b.addEventListener("click", () => copy(get(), b, label));
    return b;
  };

  root.replaceChildren(
    el("section", { class: "card start" }, [
      el("h2", { class: "card-title", text: "1. Start from an example" }),
      el("label", { for: "example", text: "An example of what you want to find" }),
      el("div", { class: "start__row" }, [exampleInput, makeBtn]),
      el("p", { class: "small muted", text: "Digits, letters and spaces become blocks you can change; everything else stays exact text. Then loosen or tighten any block below." }),
      el("p", { class: "small presets__label", text: "Or start from a common pattern:" }),
      presetRow,
      undoBox
    ]),
    el("div", { class: "work" }, [
      el("section", { class: "card", "aria-labelledby": "blocks-title" }, [
        el("div", { class: "card-head" }, [
          el("h2", { class: "card-title", id: "blocks-title", text: "2. Adjust the blocks" }),
          (() => {
            const b = el("button", { class: "button button--small button--ghost", type: "button", text: "Clear all" });
            b.addEventListener("click", () => {
              if (!state.blocks.length) return;
              remember("cleared the blocks");
              state.blocks = [];
              changed(true);
            });
            return b;
          })()
        ]),
        el("p", { class: "small muted", text: "Blocks match one after another. Change what a block is, how many times it repeats, or put blocks inside a group." }),
        blocksBox
      ]),
      el("div", { class: "side" }, [
        el("section", { class: "card", "aria-labelledby": "rx-title" }, [
          el("h2", { class: "card-title", id: "rx-title", text: "3. Your regex" }),
          el("div", { class: "rx-opts" }, [
            el("div", { class: "rx-opts__lang" }, [el("label", { for: "flavor", text: "Language" }), flavorSelect]),
            el("div", { class: "rx-opts__checks" }, [check("ignoreCase", "Ignore upper/lowercase"), check("wholeWord", "Whole words only"), check("wholeText", "Must be the whole text")])
          ]),
          patternBox,
          flagsLine,
          el("div", { class: "row-btns" }, [copyBtn("Copy regex", () => lastRes.pattern)]),
          el("p", { class: "small code-label", text: "As code:" }),
          codeBox,
          el("div", { class: "row-btns" }, [copyBtn("Copy code", () => RX.code(lastRes, state.flavor))]),
          notesBox
        ]),
        el("section", { class: "card", "aria-labelledby": "test-title" }, [
          el("h2", { class: "card-title", id: "test-title", text: "4. Try it" }),
          el("label", { for: "test", text: "Text to search" }),
          testInput,
          testStatus,
          hitsBox,
          groupsBox
        ])
      ])
    ]),
    el("section", { class: "card", "aria-labelledby": "explain-title" }, [
      el("h2", { class: "card-title", id: "explain-title", text: "What it means" }),
      explainBox
    ])
  );

  // ---------- Start box ----------

  makeBtn.addEventListener("click", fromExample);
  exampleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fromExample();
  });
  exampleInput.addEventListener("input", () => {
    state.example = exampleInput.value;
    save();
  });
  function fromExample() {
    const text = exampleInput.value;
    if (!text) {
      exampleInput.focus();
      return;
    }
    if (state.blocks.length) remember("replaced the blocks");
    state.blocks = RX.fromExample(text.slice(0, 500));
    // Try it on the example itself: put it first in the test text, unless it's already there.
    if (!state.test.includes(text)) {
      state.test = (text + (state.test ? "\n" + state.test : "")).slice(0, MAX_TEST);
      testInput.value = state.test;
    }
    changed(true);
  }
  presetRow.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const p = PRESETS[Number(b.dataset.preset)];
    if (state.blocks.length) remember("replaced the blocks with " + p.name);
    state.blocks = p.make();
    state.test = p.test;
    testInput.value = p.test;
    changed(true);
  });
  function showUndo() {
    if (!undo) {
      undoBox.hidden = true;
      return;
    }
    const b = el("button", { class: "button button--small button--ghost", type: "button", text: "Undo" });
    b.addEventListener("click", () => {
      state.blocks = undo.blocks;
      undo = null;
      changed(true);
    });
    undoBox.replaceChildren("You " + undo.what + ". ", b);
    undoBox.hidden = false;
  }

  // ---------- Block editor ----------

  let colors = new Map();
  let groupList = []; // capture groups in the chosen language: [{ id, number, name }]

  function renderBlocks() {
    // Rebuilding loses focus: remember which control had it, and give it back.
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.k : null;
    const sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
    colors = new Map();
    let n = 0;
    RX.walk(state.blocks, (b) => colors.set(b.id, n++ % RX.COLORS));
    blocksBox.replaceChildren(seqView(state.blocks, 0, "root"));
    focusKey(key, sel);
    showUndo();
  }
  function focusKey(key, sel) {
    if (!key) return;
    const again = blocksBox.querySelector('[data-k="' + CSS.escape(key) + '"]');
    if (!again) return;
    again.focus({ preventScroll: true });
    if (sel && typeof again.setSelectionRange === "function") {
      try {
        again.setSelectionRange(sel[0], sel[1]);
      } catch (_) {
        /* number inputs have no selection */
      }
    }
  }

  function seqView(list, depth, key) {
    const rows = list.map((b, i) => blockView(b, list, i, depth));
    if (!list.length) rows.push(el("p", { class: "small muted seq__empty", text: depth ? "Empty: add a block here." : "No blocks yet. Make them from an example above, or add one." }));
    rows.push(addSelect(list, depth, key));
    return el("div", { class: "seq" + (depth ? " seq--inner" : "") }, rows);
  }
  function addSelect(list, depth, key) {
    const s = el("select", { class: "add", "data-k": key + ":add", "aria-label": "Add a block" }, [
      el("option", { value: "", text: "+ Add a block…" }),
      ...Object.entries(KINDS).filter(([k]) => depth < MAX_DEPTH || !CONTAINERS.includes(k)).map(([k, label]) => el("option", { value: k, text: label }))
    ]);
    s.addEventListener("change", () => {
      const kind = s.value;
      if (!kind) return;
      if (countBlocks() >= MAX_BLOCKS) {
        s.value = "";
        alert("That's the most blocks this page handles (" + MAX_BLOCKS + ").");
        return;
      }
      const b = RX.block(kind, DEFAULTS[kind]());
      if (kind === "backref" && groupList.length) b.ref = groupList[0].id;
      list.push(b);
      changed(true, b.id + ":" + firstField(kind));
    });
    return s;
  }
  const firstField = (kind) => ({ text: "text", class: "cls", set: "chars", words: "words", anchor: "at", group: "capture", or: "kind", look: "look", backref: "ref", raw: "source" })[kind];

  function blockView(b, list, i, depth) {
    const k = (f) => b.id + ":" + f;
    const kindSel = el("select", { class: "blk__kind", "data-k": k("kind"), "aria-label": "Kind of block" }, Object.entries(KINDS).filter(([kk]) => kk === b.kind || depth < MAX_DEPTH || !CONTAINERS.includes(kk)).map(([kk, label]) => el("option", { value: kk, text: label })));
    kindSel.value = b.kind;
    kindSel.addEventListener("change", () => {
      remember("changed a block's kind");
      list[i] = convert(b, kindSel.value);
      changed(true, k("kind"));
    });
    const btn = (f, text, label, fn, disabled) => {
      const x = el("button", { class: "blk__btn", type: "button", "data-k": k(f), "aria-label": label, title: label, text });
      if (disabled) x.disabled = true;
      x.addEventListener("click", fn);
      return x;
    };
    const tools = el("div", { class: "blk__tools" }, [
      btn("up", "↑", "Move up", () => {
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        changed(true, k("up"));
      }, i === 0),
      btn("down", "↓", "Move down", () => {
        [list[i + 1], list[i]] = [list[i], list[i + 1]];
        changed(true, k("down"));
      }, i === list.length - 1),
      depth < MAX_DEPTH ? btn("wrap", "( )", "Put this block in a group", () => {
        const g = RX.block("group", { capture: "none", name: "", children: [b] });
        list[i] = g;
        changed(true, g.id + ":capture");
      }) : null,
      btn("copy", "⧉", "Duplicate", () => {
        if (countBlocks() >= MAX_BLOCKS) return;
        list.splice(i + 1, 0, RX.clone([b])[0]);
        changed(true, k("copy"));
      }),
      btn("del", "✕", "Remove", () => {
        remember("removed a block");
        list.splice(i, 1);
        const next = list[i] || list[i - 1];
        changed(true, next ? next.id + ":kind" : null);
      })
    ]);
    const parts = [
      el("div", { class: "blk__line" }, [kindSel, ...fields(b, k), RX.quantifiable(b) ? howMany(b, k) : null]),
      tools,
      el("p", { class: "blk__sum small", "data-sum": b.id })
    ];
    if (b.kind === "group" || b.kind === "look") parts.push(seqView(b.children, depth + 1, b.id));
    if (b.kind === "or") {
      b.options.forEach((opt, oi) => {
        const rm = b.options.length > 1 ? btn("rmopt" + oi, "✕", "Remove option " + (oi + 1), () => {
          remember("removed an option");
          b.options.splice(oi, 1);
          changed(true, k("addopt"));
        }) : null;
        parts.push(el("div", { class: "opt" }, [el("div", { class: "opt__head small" }, [el("strong", { text: oi ? "or option " + (oi + 1) : "Option 1" }), rm]), seqView(opt, depth + 1, b.id + "#" + oi)]));
      });
      parts.push(btn("addopt", "+ Add another option", "Add another option", () => {
        b.options.push([]);
        changed(true, b.id + "#" + (b.options.length - 1) + ":add");
      }));
    }
    return el("div", { class: "blk c" + colors.get(b.id), "data-id": b.id }, parts);
  }

  // Changing a block's kind keeps what it can: the repeat, the text, the blocks inside.
  function convert(b, kind) {
    const n = Object.assign({ id: b.id, kind, q: RX.quantifiable({ kind }) ? b.q : { min: 1, max: 1, mode: "greedy" } }, DEFAULTS[kind]());
    const inner = b.children || (b.options ? b.options.flat() : null);
    const text = b.kind === "text" ? b.text : b.kind === "words" ? b.words.join("") : b.kind === "set" ? b.chars : "";
    if (inner && (kind === "group" || kind === "look")) n.children = inner;
    if (inner && kind === "or") n.options = b.options || [inner, []];
    // A plain block turned into a group, a check or an either/or goes inside it.
    if (!inner && CONTAINERS.includes(kind)) {
      const keep = Object.assign({}, b, { id: RX.newId(), q: kind === "look" ? b.q : { min: 1, max: 1, mode: "greedy" } });
      if (kind === "or") n.options = [[keep], []];
      else n.children = [keep];
    }
    if (kind === "text") n.text = b.kind === "words" ? b.words[0] || "" : text;
    if (kind === "words" && text) n.words = [text];
    if (kind === "set" && text) n.chars = text;
    if (kind === "raw") n.source = RX.compile([b], state.flavor).pattern;
    if (kind === "backref" && groupList.length) n.ref = groupList[0].id;
    return n;
  }

  // Inputs that change the regex as you type; selects that rebuild the editor.
  const textInput = (b, key, field, attrs, read) => {
    const { parse, ...rest } = attrs;
    const x = el("input", Object.assign({ type: "text", "data-k": key, autocomplete: "off", spellcheck: "false" }, rest));
    x.value = read ? read(b[field]) : b[field];
    x.addEventListener("input", () => {
      b[field] = parse ? parse(x.value) : x.value;
      changed(false);
    });
    return x;
  };
  const select = (key, label, options, value, onChange) => {
    const s = el("select", { "data-k": key, "aria-label": label }, options.map(([v, t]) => el("option", { value: v, text: t })));
    s.value = value;
    s.addEventListener("change", () => {
      onChange(s.value);
      changed(true, key);
    });
    return s;
  };
  const field = (label, control, wide) => {
    control.setAttribute("aria-label", label);
    control.setAttribute("title", label);
    control.classList.add("fld");
    if (wide) control.classList.add("fld--wide");
    return control;
  };

  function fields(b, k) {
    switch (b.kind) {
      case "text":
        return [field("Text", textInput(b, k("text"), "text", { class: "mono", placeholder: "exact text, spaces count" }), true)];
      case "class":
        return [field("Character", select(k("cls"), "Character", Object.entries(RX.CLASSES).map(([v, c]) => [v, c.label]), b.cls, (v) => (b.cls = v)), true)];
      case "set": {
        const neg = el("input", { type: "checkbox", "data-k": k("negate") });
        neg.checked = b.negate;
        neg.addEventListener("change", () => {
          b.negate = neg.checked;
          changed(true, k("negate"));
        });
        return [
          field("Characters (a-z means a to z)", textInput(b, k("chars"), "chars", { class: "mono", placeholder: "for example: a-z0-9_" }), true),
          el("label", { class: "check" }, [neg, " Anything except these"])
        ];
      }
      case "words":
        return [field("Words, separated by commas", textInput(b, k("words"), "words", { class: "mono", placeholder: "cat, dog, bird", parse: (v) => v.split(",").map((w) => w.trim()).filter(Boolean) }, (ws) => ws.join(", ")), true)];
      case "anchor":
        return [field("Position", select(k("at"), "Position", Object.entries(RX.ANCHORS).map(([v, a]) => [v, a.label]), b.at, (v) => (b.at = v)), true)];
      case "group": {
        const out = [field("Kind of group", select(k("capture"), "Kind of group", [["none", "Just keep together"], ["number", "Remember it (numbered)"], ["name", "Remember it with a name"], ["atomic", "Keep together, never retry (atomic)"]], b.capture, (v) => {
          b.capture = v;
          if (v === "name" && !b.name) b.name = "part" + (groupList.length + 1);
        }))];
        if (b.capture === "name") out.push(field("Name (letters, digits, _)", textInput(b, k("name"), "name", { class: "mono", maxlength: "32" })));
        return out;
      }
      case "look":
        return [field("Check", select(k("look"), "Check", [["ahead|", "Only if followed by"], ["ahead|not", "Only if NOT followed by"], ["behind|", "Only if preceded by"], ["behind|not", "Only if NOT preceded by"]], b.dir + "|" + (b.negate ? "not" : ""), (v) => {
          b.dir = v.split("|")[0];
          b.negate = v.endsWith("not");
        }), true)];
      case "backref": {
        if (!groupList.length) return [el("p", { class: "small muted fld--wide blk__msg", text: "Make a group that remembers its text first (a Group block set to “Remember it”), then pick it here." })];
        const opts = groupList.map((g) => [g.id, "group " + g.number + (g.name ? " “" + g.name + "”" : "")]);
        if (!groupList.some((g) => g.id === b.ref)) opts.unshift([b.ref, "(pick a group)"]);
        return [field("The same text as", select(k("ref"), "Group", opts, b.ref, (v) => (b.ref = v)), true)];
      }
      case "raw":
        return [field("Regex", textInput(b, k("source"), "source", { class: "mono", placeholder: "for example: \\d+(?:\\.\\d+)?" }), true)];
    }
    return [];
  }

  // How many times: a plain choice, numbers only when needed, and greedy/lazy/possessive for repeats that vary.
  function howMany(b, k) {
    const q = b.q;
    const choice = q.min === 1 && q.max === 1 ? "once" : q.min === 0 && q.max === 1 ? "opt" : q.min === 1 && q.max === null ? "plus" : q.min === 0 && q.max === null ? "star" : q.min === q.max ? "exact" : q.max === null ? "least" : "range";
    const set = (min, max) => {
      q.min = min;
      q.max = max;
    };
    const how = select(k("how"), "How many", [["once", "Once"], ["opt", "Optional (0 or 1)"], ["plus", "1 or more"], ["star", "Any number (0 or more)"], ["exact", "Exactly…"], ["range", "Between…"], ["least", "At least…"]], choice, (v) => {
      const m = Math.max(q.min, 2);
      ({ once: () => set(1, 1), opt: () => set(0, 1), plus: () => set(1, null), star: () => set(0, null), exact: () => set(m, m), range: () => set(q.min, Math.max(q.max || 0, q.min + 1, 2)), least: () => set(Math.max(q.min, 1), null) })[v]();
    });
    const num = (f, label) => {
      const x = el("input", { type: "number", min: f === "max" ? "1" : "0", max: String(MAX_COUNT), step: "1", class: "num", "data-k": k(f), "aria-label": label });
      x.value = String(q[f]);
      x.addEventListener("input", () => {
        const v = Number(x.value);
        if (!Number.isInteger(v) || v < 0 || v > MAX_COUNT || x.value === "") return;
        if (choice === "exact") set(v || 1, v || 1);
        else q[f] = v;
        if (q.max !== null && q.max < q.min) return; // fixed when they leave the box
        changed(false);
      });
      x.addEventListener("change", () => {
        const fixed = cleanQ(q, b.kind);
        Object.assign(q, fixed);
        changed(true);
      });
      return x;
    };
    const row = [how];
    if (choice === "exact") row.push(num("min", "Exactly how many"));
    if (choice === "least") row.push(num("min", "At least how many"));
    if (choice === "range") row.push(num("min", "From"), el("span", { class: "small", text: "to" }), num("max", "To"));
    if (q.min !== q.max) {
      row.push(select(k("mode"), "How to repeat", [["greedy", "as many as possible"], ["lazy", "as few as possible"], ["possessive", "as many, never give back"]], q.mode, (v) => (q.mode = v)));
    }
    return el("div", { class: "how" }, row);
  }

  // ---------- Output: regex, code, notes, explanation ----------

  let lastRes = null;
  function renderOutput() {
    const res = RX.compile(state.blocks, state.flavor, state.opts);
    lastRes = res;
    groupList = res.groups;
    patternBox.replaceChildren(...(res.pattern ? res.parts.map((p) => el("span", { class: p.color < 0 ? "rx__p rx__p--opt" : "rx__p c" + p.color, text: p.text })) : [el("span", { class: "muted", text: "(empty: add a block)" })]));
    const f = res.flags;
    const flagWords = [f.i && "ignore case (i)", f.m && "multiline (m), so ^ and $ work at every line", f.u && "unicode (u)"].filter(Boolean);
    flagsLine.textContent = flagWords.length ? "Flags it needs: " + flagWords.join(" · ") + ". The code below sets them." : "";
    flagsLine.hidden = !flagWords.length;
    codeBox.textContent = RX.code(res, state.flavor);
    const notes = res.notes;
    notesBox.replaceChildren(...notes.map((n) => el("li", { text: n })));
    notesBox.hidden = !notes.length;
    // The summary line on each block, and the explanation.
    const tree = RX.explain(state.blocks, res.groups);
    const byId = new Map();
    const index = (list) => list.forEach((e) => {
      byId.set(e.id, e.text);
      index(e.children);
    });
    index(tree);
    for (const p of blocksBox.querySelectorAll("[data-sum]")) p.textContent = byId.get(p.dataset.sum) || "";
    renderExplain(tree, res);
  }
  function renderExplain(tree, res) {
    if (!state.blocks.length) {
      explainBox.replaceChildren(el("p", { class: "muted", text: "Add blocks to see what each part means." }));
      return;
    }
    const piece = (id) => {
      const s = res.spans.get(id);
      if (!s) return "";
      const t = res.pattern.slice(s[0], s[1]);
      return t.length > 48 ? t.slice(0, 46) + "…" : t;
    };
    const list = (items) => el("ol", { class: "ex" }, items.map((e) => {
      const isOpt = e.id.includes("#");
      const code = isOpt ? "" : piece(e.id);
      return el("li", { class: "ex__item c" + e.color }, [
        code ? el("code", { class: "ex__code", text: code }) : null,
        el("span", { class: "ex__text", text: e.text }),
        e.children.length ? list(e.children) : null
      ]);
    }));
    const extra = [];
    if (state.opts.ignoreCase) extra.push("Uppercase and lowercase letters count as the same.");
    if (state.opts.wholeWord) extra.push("The match must start and end at the edge of a word (\\b).");
    if (state.opts.wholeText) extra.push("The match must be the whole text, from start to end; otherwise it can be anywhere in the text.");
    explainBox.replaceChildren(el("p", { text: "It finds, in this order:" }), list(tree));
    if (extra.length) explainBox.append(el("ul", { class: "small ex__extra" }, extra.map((t) => el("li", { text: t }))));
  }

  // ---------- Test box: runs in a worker, so a pattern that takes forever can be stopped ----------

  const WORKER_SRC = [
    "onmessage = function (e) {",
    "  var d = e.data, re;",
    "  try { re = new RegExp(d.p, d.f); } catch (err) { postMessage({ error: String(err.message) }); return; }",
    "  var out = [], m, more = false;",
    "  while ((m = re.exec(d.text))) {",
    "    if (out.length >= d.max) { more = true; break; }",
    "    out.push({ i: m.index, s: m[0], g: m.slice(1) });",
    "    if (m[0] === '') re.lastIndex += d.f.indexOf('u') >= 0 && d.text.codePointAt(m.index) > 0xffff ? 2 : 1;",
    "  }",
    "  postMessage({ out: out, more: more });",
    "};"
  ].join("\n");
  const MAX_MATCHES = 500;
  const TIMEOUT = 1500;
  let worker = null, workerUrl = null, testTimer = 0, killTimer = 0, runId = 0;
  function getWorker() {
    if (worker) return worker;
    try {
      workerUrl = workerUrl || URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
    } catch (_) {
      worker = null;
    }
    return worker;
  }
  function scheduleTest() {
    clearTimeout(testTimer);
    testTimer = setTimeout(runTest, 200);
  }
  function runTest() {
    const js = RX.compile(state.blocks, "js", state.opts);
    const text = state.test;
    const f = "g" + (js.flags.i ? "i" : "") + (js.flags.m ? "m" : "") + (js.flags.u ? "u" : "");
    const id = ++runId;
    const show = (r) => id === runId && showTest(r, js, text);
    if (!js.pattern) return show({ out: [], more: false, empty: true });
    if (!text) return show({ out: [], more: false, noText: true });
    const w = getWorker();
    if (!w) {
      // No workers here: run it directly, on a shorter text.
      try {
        const re = new RegExp(js.pattern, f), out = [];
        let m;
        const t = text.slice(0, 5000);
        while ((m = re.exec(t)) && out.length < MAX_MATCHES) {
          out.push({ i: m.index, s: m[0], g: m.slice(1) });
          if (m[0] === "") re.lastIndex++;
        }
        return show({ out, more: !!m, cut: text.length > 5000 });
      } catch (err) {
        return show({ error: err.message });
      }
    }
    clearTimeout(killTimer);
    w.onmessage = (e) => {
      clearTimeout(killTimer);
      show(e.data);
    };
    killTimer = setTimeout(() => {
      // Too slow: stop the worker; the next run makes a new one.
      w.terminate();
      worker = null;
      show({ slow: true });
    }, TIMEOUT);
    w.postMessage({ p: js.pattern, f, text, max: MAX_MATCHES });
  }
  function showTest(r, js, text) {
    hitsBox.replaceChildren();
    groupsBox.replaceChildren();
    testStatus.className = "small test-status";
    if (r.error) {
      testStatus.classList.add("test-status--bad");
      testStatus.textContent = "The browser can't run this regex: " + r.error.replace(/\.?$/, ".") + (lastRes.notes.length ? " See the notes above." : " Check any “Regex by hand” blocks.");
      return;
    }
    if (r.slow) {
      testStatus.classList.add("test-status--bad");
      testStatus.textContent = "This regex took too long on this text, so the test was stopped. A repeat inside a repeat (like a group of “1 or more” repeated “1 or more”) can make it try too many ways. Try fewer nested repeats, or “never give back”.";
      return;
    }
    if (r.empty) return void (testStatus.textContent = "Add blocks to test them.");
    if (r.noText) return void (testStatus.textContent = "Type some text above to try the regex on it.");
    const n = r.out.length;
    testStatus.textContent = (n ? n + (r.more ? "+" : "") + " match" + (n === 1 ? "" : "es") : "No matches") + (state.flavor !== "js" ? " (tested with the JavaScript version)." : ".") + (r.cut ? " Only the first 5,000 characters were searched." : "");
    if (!n) return;
    // The text with each match marked.
    const bits = [];
    let at = 0;
    r.out.forEach((m, i) => {
      if (m.i > at) bits.push(text.slice(at, m.i));
      bits.push(el("mark", { class: "hit hit--" + (i % 2 ? "b" : "a") + (m.s ? "" : " hit--empty"), title: "Match " + (i + 1), text: m.s }));
      at = m.i + m.s.length;
    });
    bits.push(text.slice(at));
    hitsBox.replaceChildren(...bits);
    // What each group remembered: columns named in the chosen language, values from the JavaScript run.
    const jsNum = new Map(js.groups.map((g) => [g.id, g.number]));
    const cols = lastRes.groups.filter((g) => jsNum.has(g.id));
    const rows = r.out.slice(0, 50);
    if (!cols.length) return;
    const cell = (v) => el("td", { class: v === undefined || v === null ? "muted" : "mono", text: v === undefined || v === null ? "—" : v === "" ? "(empty)" : v });
    groupsBox.replaceChildren(
      el("p", { class: "small", text: "What each group remembered" + (r.out.length > 50 ? " (first 50 matches)" : "") + ":" }),
      el("div", { class: "table-wrap" }, [el("table", { class: "gtable small" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "Match" }), ...cols.map((g) => el("th", { text: "group " + g.number + (g.name ? " " + g.name : "") }))])]),
        el("tbody", {}, rows.map((m) => el("tr", {}, [cell(m.s), ...cols.map((g) => cell(m.g[jsNum.get(g.id) - 1]))])))
      ])])
    );
  }

  testInput.addEventListener("input", () => {
    state.test = testInput.value;
    save();
    scheduleTest();
  });
  flavorSelect.addEventListener("change", () => {
    state.flavor = flavorSelect.value;
    changed(true);
  });
  root.addEventListener("change", (e) => {
    const o = e.target.dataset && e.target.dataset.opt;
    if (!o) return;
    state.opts[o] = e.target.checked;
    changed(false);
  });

  // ---------- Copy ----------

  function copy(text, button, label) {
    const done = (ok) => {
      button.textContent = ok ? "Copied" : "Select and copy it by hand";
      setTimeout(() => (button.textContent = label), 1500);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else {
      const t = el("textarea", { class: "visually-hidden" });
      t.value = text;
      document.body.append(t);
      t.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {
        ok = false;
      }
      t.remove();
      done(ok);
    }
  }

  // ---------- Everything after a change ----------

  // rebuild: redraw the block editor (a block was added, moved or changed kind). focus: the control to focus after.
  function changed(rebuild, focus) {
    // Groups first, so a new “same text as” block can list them.
    groupList = RX.compile(state.blocks, state.flavor, state.opts).groups;
    if (rebuild) {
      renderBlocks();
      if (focus) focusKey(focus);
    }
    renderOutput();
    scheduleTest();
    save();
  }

  changed(true);
})();
