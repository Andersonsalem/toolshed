// Regex blocks: a pattern written as plain-language blocks, turned into a regular
// expression for each language, with an explanation. No page layout here.
//
//   RX.compile(blocks, flavor, opts) -> {
//     pattern   the regex text for that language
//     parts     [{ text, color }] the same text in colored pieces (color: the block's color number, or -1)
//     flags     { i, m, u } which flags it needs
//     groups    [{ id, number, name }] the capture groups the person made, in order
//     notes     [text] what to know about this language (unsupported features and their fallbacks)
//     spans     Map(block id -> [start, end]) where each block is in the pattern
//   }
//   RX.code(result, flavor) -> a line of code for that language, with the right escaping
//   RX.explain(blocks) -> [{ id, color, text, children }] plain-language sentences
//   RX.fromExample(text) -> blocks that match that example
//
// A block: { id, kind, q: { min, max, mode } , ...kind fields }
//   text    { text }                         exact text
//   class   { cls }                          a digit, a letter… (see CLASSES)
//   set     { chars, negate }                one of these characters ("a-z_" has a range)
//   words   { words: [] }                    one of these words
//   anchor  { at }                           a position (see ANCHORS)
//   group   { capture, name, children }      capture: "none" | "number" | "name" | "atomic"
//   or      { options: [children, …] }       either this sequence or that one
//   look    { dir, negate, children }        dir: "ahead" | "behind"
//   backref { ref }                          the same text a capture group matched (ref: its id)
//   raw     { source }                       regex written by hand
// q: how many times. max: null = no limit. mode: "greedy" | "lazy" | "possessive".
(function () {
  "use strict";
  const RX = (window.RX = {});
  RX.COLORS = 6;

  RX.FLAVORS = {
    js: { name: "JavaScript", named: "(?<", backName: (n) => "\\k<" + n + ">", look: true, lookbehind: "any", atomic: false, possessive: false, prop: "u", textAnchors: false },
    python: { name: "Python", named: "(?P<", backName: (n) => "(?P=" + n + ")", look: true, lookbehind: "fixed", atomic: true, possessive: true, prop: false, textAnchors: "\\A|\\Z" },
    java: { name: "Java", named: "(?<", backName: (n) => "\\k<" + n + ">", look: true, lookbehind: "bounded", atomic: true, possessive: true, prop: true, textAnchors: "\\A|\\z" },
    dotnet: { name: "C# / .NET", named: "(?<", backName: (n) => "\\k<" + n + ">", look: true, lookbehind: "any", atomic: true, possessive: false, prop: true, textAnchors: "\\A|\\z" },
    pcre: { name: "PHP (PCRE)", named: "(?<", backName: (n) => "\\k<" + n + ">", look: true, lookbehind: "fixedish", atomic: true, possessive: true, prop: true, textAnchors: "\\A|\\z" },
    go: { name: "Go (RE2)", named: "(?P<", backName: null, look: false, lookbehind: "none", atomic: false, possessive: false, prop: true, textAnchors: "\\A|\\z" }
  };

  // One character from a kind. one/many: how the explanation names it.
  RX.CLASSES = {
    digit: { label: "Digit (0–9)", one: "a digit", many: "digits", re: "\\d" },
    letter: { label: "Letter (a–z, A–Z)", one: "a letter", many: "letters", re: "[a-zA-Z]" },
    lower: { label: "Lowercase letter", one: "a lowercase letter", many: "lowercase letters", re: "[a-z]" },
    upper: { label: "Uppercase letter", one: "an uppercase letter", many: "uppercase letters", re: "[A-Z]" },
    alnum: { label: "Letter or digit", one: "a letter or digit", many: "letters or digits", re: "[a-zA-Z0-9]" },
    word: { label: "Word character (letter, digit or _)", one: "a letter, digit or underscore", many: "letters, digits or underscores", re: "\\w" },
    space: { label: "Space, tab or line break", one: "a space, tab or line break", many: "spaces, tabs or line breaks", re: "\\s" },
    blank: { label: "Space or tab (not line breaks)", one: "a space or tab", many: "spaces or tabs", re: "[ \\t]" },
    notspace: { label: "Anything but a space", one: "a character that isn't a space, tab or line break", many: "characters that aren't spaces, tabs or line breaks", re: "\\S" },
    notdigit: { label: "Anything but a digit", one: "a character that isn't a digit", many: "characters that aren't digits", re: "\\D" },
    any: { label: "Any character except a line break", one: "any character except a line break", many: "characters (except line breaks)", re: "." },
    all: { label: "Any character at all", one: "any character (line breaks too)", many: "characters of any kind (line breaks too)", re: "[\\s\\S]" },
    uletter: { label: "Letter in any language (é, ж, 漢…)", one: "a letter in any language", many: "letters in any language", re: "\\p{L}", prop: true, py: "[^\\W\\d_]" },
    unumber: { label: "Digit in any script (٣, ३…)", one: "a digit in any script", many: "digits in any script", re: "\\p{Nd}", prop: true, py: "\\d" }
  };
  RX.ANCHORS = {
    textStart: { label: "Start of the text", text: "the start of the text" },
    textEnd: { label: "End of the text", text: "the end of the text" },
    lineStart: { label: "Start of a line", text: "the start of a line" },
    lineEnd: { label: "End of a line", text: "the end of a line" },
    wordEdge: { label: "Edge of a word", text: "the edge of a word (between a letter, digit or _ and anything else)" },
    notWordEdge: { label: "Not the edge of a word", text: "a place that isn't the edge of a word" }
  };

  const PY311 = "Python supports “never give back” (atomic groups and possessive repeats) from Python 3.11 on.";
  let nextId = 1;
  RX.newId = () => "b" + nextId++ + Math.random().toString(36).slice(2, 6);
  const ONCE = () => ({ min: 1, max: 1, mode: "greedy" });
  RX.block = (kind, fields) => Object.assign({ id: RX.newId(), kind, q: ONCE() }, fields || {});
  RX.quantifiable = (b) => !["anchor", "look"].includes(b.kind);
  // Every block, depth first, with its parent sequence.
  RX.walk = function (blocks, fn, depth) {
    for (const b of blocks) {
      fn(b, depth || 0);
      for (const seq of childSeqs(b)) RX.walk(seq, fn, (depth || 0) + 1);
    }
  };
  const childSeqs = (b) => (b.kind === "or" ? b.options : b.children ? [b.children] : []);
  RX.childSeqs = childSeqs;

  // ---------- Escaping ----------

  const escText = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  RX.escText = escText;
  // "a-z0-9_" -> ranges and single characters, each escaped for use inside [ ].
  function setItems(chars) {
    const cs = [...chars], items = [];
    const esc = (c) => (c === "\t" ? "\\t" : c === "\n" ? "\\n" : /[\]\\^\-[/]/.test(c) ? "\\" + c : c);
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[i + 2];
      if (cs[i + 1] === "-" && b !== undefined && /[a-zA-Z0-9]/.test(a) && /[a-zA-Z0-9]/.test(b) && a <= b && sameKind(a, b)) {
        items.push(esc(a) + "-" + esc(b));
        i += 2;
      } else items.push(esc(a));
    }
    return items;
  }
  const sameKind = (a, b) => (/\d/.test(a) && /\d/.test(b)) || (/[a-z]/.test(a) && /[a-z]/.test(b)) || (/[A-Z]/.test(a) && /[A-Z]/.test(b));
  RX.setItems = setItems;

  // ---------- How long a match can be (for lookbehind rules) ----------

  const INF = Infinity;
  function width(blocks) {
    let lo = 0, hi = 0;
    for (const b of blocks) {
      const [a, z] = widthOne(b);
      lo += a * b.q.min;
      hi += z === 0 ? 0 : b.q.max === null ? INF : z * b.q.max;
    }
    return [lo, hi];
  }
  function widthOne(b) {
    switch (b.kind) {
      case "text": return [b.text.length, b.text.length];
      case "class": case "set": return [1, 1];
      case "words": {
        const ls = b.words.map((w) => w.length);
        return ls.length ? [Math.min(...ls), Math.max(...ls)] : [0, 0];
      }
      case "anchor": case "look": return [0, 0];
      case "group": return width(b.children);
      case "or": {
        const ws = b.options.map(width);
        return ws.length ? [Math.min(...ws.map((w) => w[0])), Math.max(...ws.map((w) => w[1]))] : [0, 0];
      }
      default: return [0, INF]; // a backreference or hand-written regex: unknown
    }
  }

  // ---------- Compiling ----------

  function quant(q) {
    const { min, max } = q;
    if (min === 1 && max === 1) return "";
    let s = min === 0 && max === 1 ? "?" : min === 0 && max === null ? "*" : min === 1 && max === null ? "+" : max === null ? "{" + min + ",}" : min === max ? "{" + min + "}" : "{" + min + "," + max + "}";
    return s;
  }
  // Is s a single unit that a quantifier can follow without (?: )?
  function atomic(s) {
    if (/^\\[a-zA-Z]$/.test(s) || /^\\p\{[\w=]+\}$/.test(s) || /^\\.$/.test(s) || s.length === 1) return true;
    if (/^\[(?:\\.|[^\]\\])*\]$/.test(s)) return true;
    // ( … ) that closes at the very end
    if (s[0] === "(") {
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\") { i++; continue; }
        if (s[i] === "[") { while (i < s.length && s[i] !== "]") { if (s[i] === "\\") i++; i++; } continue; }
        if (s[i] === "(") depth++;
        else if (s[i] === ")" && --depth === 0) return i === s.length - 1;
      }
    }
    return false;
  }

  RX.compile = function (blocks, flavorKey, opts) {
    opts = opts || {};
    const F = RX.FLAVORS[flavorKey];
    // Pass 1 numbers the groups (a backreference may point forward); pass 2 writes the pattern.
    let numbers = new Map();
    let res = null;
    for (let pass = 0; pass < 2; pass++) {
      res = run(blocks, F, flavorKey, opts, numbers);
      numbers = res.numbersOut;
    }
    delete res.numbersOut;
    return res;
  };

  function run(blocks, F, flavorKey, opts, numbers) {
    const parts = [], notes = new Set(), groups = [], spans = new Map(), numbersOut = new Map();
    const flags = { i: !!opts.ignoreCase, m: false, u: false };
    let count = 0, pos = 0, colorN = 0;
    const colorOf = new Map();
    RX.walk(blocks, (b) => colorOf.set(b.id, colorN++ % RX.COLORS));
    // Line anchors need multiline mode; text anchors then need \A and \z (or a stand-in).
    RX.walk(blocks, (b) => {
      if (b.kind === "anchor" && (b.at === "lineStart" || b.at === "lineEnd")) flags.m = true;
    });
    const emit = (text, color) => {
      parts.push({ text, color });
      pos += text.length;
    };

    // Writes one block; returns nothing (text goes through emit).
    function one(b, next) {
      const color = colorOf.get(b.id);
      const start = pos;
      const q = b.q || ONCE();
      let quantified = RX.quantifiable(b) && !(q.min === 1 && q.max === 1);
      let mode = quantified && q.min !== q.max ? q.mode : "greedy";
      // Possessive where it isn't written directly: an atomic group around a greedy repeat.
      let wrapAtomic = false;
      if (mode === "possessive" && flavorKey === "python") notes.add(PY311);
      if (mode === "possessive" && !F.possessive) {
        if (F.atomic || flavorKey === "js") wrapAtomic = true;
        else notes.add(F.name + " can't stop a repeat from giving back characters (possessive), so this uses a normal repeat. The matches can differ in rare cases.");
        mode = "greedy";
      }
      const atomicOpen = () => {
        if (F.atomic) emit("(?>", color);
        else {
          // JavaScript has no atomic groups: (?=(X))\N matches the same way.
          count++;
          notes.add("JavaScript has no “never give back” syntax, so it's written (?=(…))\\N, which matches the same way but adds a hidden numbered group.");
          emit("(?:(?=(", color);
          return count;
        }
        return 0;
      };
      const atomicClose = (n) => emit(n ? "))\\" + n + ")" : ")", color);
      let wrapN = wrapAtomic ? atomicOpen() : 0;

      // The body, written to a scratch list first so we know whether it needs (?: ) for a repeat.
      const mark = parts.length;
      body(b, color);
      const bodyText = parts.slice(mark).map((p) => p.text).join("");
      if (bodyText === "") quantified = false;
      if (quantified && !atomic(bodyText)) {
        parts.splice(mark, 0, { text: "(?:", color });
        pos += 3;
        emit(")", color);
      }
      if (quantified) emit(quant(q) + (mode === "lazy" ? "?" : mode === "possessive" ? "+" : ""), color);
      if (wrapAtomic) atomicClose(wrapN);
      // A numbered backreference followed by a digit would read as a bigger number.
      if (b.kind === "backref" && !quantified && next && /^\d/.test(firstText(next))) {
        parts.splice(mark, 0, { text: "(?:", color });
        pos += 3;
        emit(")", color);
      }
      spans.set(b.id, [start, pos]);
    }
    function firstText(b) {
      return b.kind === "text" ? b.text : "";
    }
    function seq(list) {
      list.forEach((b, i) => one(b, list[i + 1]));
    }
    function body(b, color) {
      switch (b.kind) {
        case "text":
          if (!b.text) notes.add("An “exact text” block is empty, so it matches nothing (it's skipped).");
          emit(escText(b.text), color);
          return;
        case "class": {
          const c = RX.CLASSES[b.cls];
          if (c.prop && !F.prop) {
            if (F.prop === false && c.py) {
              emit(c.py, color);
              notes.add(F.name + " has no \\p{…} classes; " + c.one + " is written " + c.py + " (it works the same for normal text).");
              return;
            }
          }
          if (c.prop && F.prop === "u") flags.u = true;
          if ((flavorKey === "python" || flavorKey === "dotnet") && /\\[dDwW]/.test(c.re)) notes.add("In " + F.name + ", \\d and \\w also match digits and letters from other scripts (like ٣ or é).");
          emit(c.re, color);
          return;
        }
        case "set": {
          const items = setItems(b.chars || "");
          if (!items.length) {
            emit(b.negate ? "[\\s\\S]" : "(?!)", color);
            notes.add("A “one of these characters” block is empty, so it " + (b.negate ? "matches any character" : "can never match") + ".");
            return;
          }
          emit("[" + (b.negate ? "^" : "") + items.join("") + "]", color);
          return;
        }
        case "words": {
          const ws = b.words.filter((w) => w.length);
          if (!ws.length) {
            emit("(?!)", color);
            notes.add("A “one of these words” block has no words, so it can never match.");
            return;
          }
          // Longest first, so "cat" doesn't stop "category" from matching in full.
          const sorted = ws.slice().sort((a, z) => z.length - a.length);
          emit(sorted.length === 1 ? escText(sorted[0]) : "(?:" + sorted.map(escText).join("|") + ")", color);
          return;
        }
        case "anchor": {
          const textMode = flags.m;
          const [A, Z] = (F.textAnchors || "").split("|");
          const map = {
            lineStart: "^", lineEnd: "$", wordEdge: "\\b", notWordEdge: "\\B",
            textStart: !textMode ? "^" : A || "(?<![\\s\\S])",
            textEnd: !textMode ? "$" : Z || "(?![\\s\\S])"
          };
          emit(map[b.at], color);
          if (b.at === "textEnd" && !textMode && flavorKey !== "js" && flavorKey !== "go") notes.add("In " + F.name + ", $ at the end also matches just before a final line break. Use " + (Z || "\\z") + " instead if that matters.");
          return;
        }
        case "group": {
          if (b.capture === "atomic") {
            if (!F.atomic && flavorKey !== "js") {
              notes.add(F.name + " has no atomic groups, so this is a normal group. The matches can differ in rare cases.");
              emit("(?:", color);
              seq(b.children);
              emit(")", color);
              return;
            }
            let n = 0;
            if (flavorKey === "python") notes.add(PY311);
            if (F.atomic) emit("(?>", color);
            else {
              // JavaScript has no atomic groups: (?:(?=(X))\N) matches the same way.
              n = ++count;
              notes.add("JavaScript has no “never give back” syntax, so it's written (?=(…))\\N, which matches the same way but adds a hidden numbered group.");
              emit("(?:(?=(", color);
            }
            seq(b.children);
            emit(n ? "))\\" + n + ")" : ")", color);
            return;
          }
          if (b.capture === "none") {
            emit("(?:", color);
            seq(b.children);
            emit(")", color);
            return;
          }
          count++;
          const name = b.capture === "name" ? cleanName(b.name) : "";
          numbersOut.set(b.id, { number: count, name });
          groups.push({ id: b.id, number: count, name });
          emit(name ? F.named + name + ">" : "(", color);
          seq(b.children);
          emit(")", color);
          return;
        }
        case "or": {
          emit("(?:", color);
          b.options.forEach((opt, i) => {
            if (i) emit("|", color);
            seq(opt);
          });
          emit(")", color);
          return;
        }
        case "look": {
          if (!F.look) {
            notes.add(F.name + " doesn't support “followed by” / “preceded by” checks at all; this pattern won't work there. Pick another language, or remove those blocks.");
          } else if (b.dir === "behind") {
            const [lo, hi] = width(b.children);
            if (F.lookbehind === "fixedish" && lo !== hi) notes.add(F.name + " may reject a “preceded by” check whose length varies (" + lo + " to " + (hi === INF ? "unlimited" : hi) + " characters here); only recent PCRE2 versions allow it. Exact counts inside it work everywhere.");
            if (F.lookbehind === "fixed" && lo !== hi) notes.add(F.name + " needs “preceded by” to have a fixed length (it's " + lo + " to " + (hi === INF ? "unlimited" : hi) + " characters here). Use exact counts inside it.");
            if (F.lookbehind === "bounded" && hi === INF) notes.add(F.name + " needs “preceded by” to have a maximum length; replace “or more” repeats inside it with a range.");
          }
          emit("(?" + (b.dir === "behind" ? "<" : "") + (b.negate ? "!" : "="), color);
          seq(b.children);
          emit(")", color);
          return;
        }
        case "backref": {
          const g = numbers.get(b.ref);
          if (!F.backName) notes.add(F.name + " doesn't support “same text as group”; this pattern won't work there.");
          if (!g) {
            emit("(?!)", color);
            notes.add("A “same text as group” block points to a group that no longer exists, so it can never match.");
            return;
          }
          emit(g.name && F.backName ? F.backName(g.name) : "\\" + g.number, color);
          return;
        }
        case "raw":
          emit(/\|/.test(b.source) && !atomic(b.source) ? "(?:" + b.source + ")" : b.source, color);
          if (b.source) notes.add("Hand-written regex is used as it is; check it works in " + F.name + ".");
          return;
      }
    }

    seq(blocks);
    // Options that wrap everything.
    let pattern = parts.map((p) => p.text).join("");
    if (opts.wholeWord && pattern) {
      parts.unshift({ text: "\\b", color: -1 });
      parts.push({ text: "\\b", color: -1 });
    }
    if (opts.wholeText && pattern) {
      const [A, Z] = (F.textAnchors || "").split("|");
      const s = flags.m ? A || "(?<![\\s\\S])" : "^", e = flags.m ? Z || "(?![\\s\\S])" : "$";
      const needsGroup = /\|/.test(pattern) && !atomic(pattern);
      parts.unshift({ text: s + (needsGroup ? "(?:" : ""), color: -1 });
      parts.push({ text: (needsGroup ? ")" : "") + e, color: -1 });
    }
    // Shift spans for anything put in front.
    let shift = 0;
    for (const p of parts) {
      if (p.color !== -1) break;
      shift += p.text.length;
    }
    if (shift) for (const [k, [a, z]] of spans) spans.set(k, [a + shift, z + shift]);
    pattern = parts.map((p) => p.text).join("");
    return { pattern, parts, flags, groups, notes: [...notes], spans, numbersOut };
  }
  const cleanName = (n) => {
    const s = String(n || "").replace(/[^A-Za-z0-9_]/g, "");
    return /^[A-Za-z_]/.test(s) ? s : "g" + s;
  };
  RX.cleanName = cleanName;

  // ---------- A line of code for each language ----------

  RX.code = function (res, flavorKey) {
    const p = res.pattern, f = res.flags;
    switch (flavorKey) {
      case "js":
        return "const re = /" + p + "/g" + (f.i ? "i" : "") + (f.m ? "m" : "") + (f.u ? "u" : "") + ";";
      case "python": {
        const fl = [f.i && "re.IGNORECASE", f.m && "re.MULTILINE"].filter(Boolean).join(" | ");
        // A raw string keeps backslashes as they are; it can't end in a single backslash.
        const q = !p.includes('"') ? '"' : !p.includes("'") ? "'" : null;
        const lit = q && !/\\$/.test(p.replace(/\\\\/g, "")) ? "r" + q + p + q : '"' + p.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        return "pattern = re.compile(" + lit + (fl ? ", " + fl : "") + ")";
      }
      case "java": {
        const fl = [f.i && "Pattern.CASE_INSENSITIVE", f.m && "Pattern.MULTILINE"].filter(Boolean).join(" | ");
        return 'Pattern pattern = Pattern.compile("' + p.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' + (fl ? ", " + fl : "") + ");";
      }
      case "dotnet": {
        const fl = [f.i && "RegexOptions.IgnoreCase", f.m && "RegexOptions.Multiline"].filter(Boolean).join(" | ");
        return 'var regex = new Regex(@"' + p.replace(/"/g, '""') + '"' + (fl ? ", " + fl : "") + ");";
      }
      case "pcre": {
        const body = p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        return "preg_match_all('/" + body + "/" + (f.i ? "i" : "") + (f.m ? "m" : "") + "u', $text, $matches);";
      }
      case "go": {
        const inline = (f.i || f.m ? "(?" + (f.i ? "i" : "") + (f.m ? "m" : "") + ")" : "") + p;
        return "re := regexp.MustCompile(" + (inline.includes("`") ? '"' + inline.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : "`" + inline + "`") + ")";
      }
    }
    return p;
  };

  // ---------- Plain-language explanation ----------

  function times(q, one, many) {
    const { min, max, mode } = q;
    const tail = min === max ? "" : mode === "lazy" ? " (as few as possible)" : mode === "possessive" ? " (as many as possible, never giving any back)" : "";
    if (min === 1 && max === 1) return one;
    if (min === 0 && max === 1) return "optionally, " + one;
    if (max === null) return (min === 0 ? "any number of " : min === 1 ? "one or more " : min + " or more ") + many + (min === 0 ? " (or none)" : "") + tail;
    if (min === max) return min + " " + many;
    return min + " to " + max + " " + many + tail;
  }
  const quote = (s) => "“" + s.replace(/ /g, "␣").replace(/\t/g, "⇥").replace(/\n/g, "↵") + "”";
  RX.quote = quote;
  function sentence(b, groupsById) {
    const q = b.q || ONCE();
    switch (b.kind) {
      case "text": return times(q, "the text " + quote(b.text), "copies of " + quote(b.text));
      case "class": {
        const c = RX.CLASSES[b.cls];
        return times(q, c.one, c.many);
      }
      case "set": {
        const what = (b.negate ? "any character except " : "one of ") + RX.describeSet(b.chars || "");
        return times(q, what, "characters, each " + what);
      }
      case "words": return times(q, "one of the words " + b.words.filter(Boolean).map(quote).join(", "), "words, each one of " + b.words.filter(Boolean).map(quote).join(", "));
      case "anchor": return RX.ANCHORS[b.at].text + " (matches a position, not a character)";
      case "group": {
        const g = groupsById.get(b.id);
        const what = b.capture === "atomic" ? "together, and once matched never tried another way (atomic)" : b.capture === "none" ? "together, as one unit" : "together, and remembered as group " + (g ? g.number : "?") + (g && g.name ? " “" + g.name + "”" : "");
        return times(q, "all of this " + what + ":", "repeats of this " + what + ":");
      }
      case "or": return times(q, "either of these:", "repeats of either of these:");
      case "look": return (b.dir === "ahead" ? (b.negate ? "only if NOT followed by" : "only if followed by") : b.negate ? "only if NOT preceded by" : "only if preceded by") + " this (checked, but not part of the match):";
      case "backref": {
        const g = groupsById.get(b.ref);
        return times(q, g ? "the exact same text that group " + g.number + (g.name ? " “" + g.name + "”" : "") + " matched" : "a group that no longer exists", "copies of the text group " + (g ? g.number : "?") + " matched");
      }
      case "raw": return times(q, "your own regex: " + (b.source || "(empty)"), "repeats of your own regex " + (b.source || "(empty)"));
    }
    return "";
  }
  RX.describeSet = function (chars) {
    const items = setItems(chars).map((it) => it.replace(/^\\(.)/, "$1"));
    const said = items.map((it) => (/^.-.$/.test(it) ? it[0] + " to " + it[2] : it === " " ? "space" : it === "\\t" ? "tab" : "“" + it + "”"));
    return said.length > 1 ? said.slice(0, -1).join(", ") + " or " + said[said.length - 1] : said[0] || "nothing";
  };
  RX.explain = function (blocks, groups) {
    const byId = new Map((groups || []).map((g) => [g.id, g]));
    let n = 0;
    const colors = new Map();
    RX.walk(blocks, (b) => colors.set(b.id, n++ % RX.COLORS));
    const tree = (list) => list.map((b) => ({ id: b.id, color: colors.get(b.id), text: sentence(b, byId), children: b.kind === "or" ? b.options.map((o, i) => ({ id: b.id + "#" + i, color: colors.get(b.id), text: "option " + (i + 1) + (o.length ? ":" : ": nothing (this option matches empty text)"), children: tree(o) })) : b.children ? tree(b.children) : [] }));
    return tree(blocks);
  };

  // ---------- From an example ----------

  // "2026-10-31" -> 4 digits, "-", 2 digits, "-", 2 digits. Runs of the same kind become one block.
  RX.fromExample = function (text) {
    const blocks = [];
    const kind = (c) => (/\d/.test(c) ? "digit" : /[a-z]/.test(c) ? "lower" : /[A-Z]/.test(c) ? "upper" : /\p{L}/u.test(c) ? "uletter" : /[ \t]/.test(c) ? "blank" : /\s/.test(c) ? "space" : "other");
    const chars = [...String(text)];
    let i = 0;
    while (i < chars.length) {
      const k = kind(chars[i]);
      let j = i + 1;
      // Letters of mixed case stay one run (a word); "Hello" is letters.
      const letterish = (x) => x === "lower" || x === "upper" || x === "uletter";
      while (j < chars.length && (kind(chars[j]) === k || (letterish(k) && letterish(kind(chars[j]))))) j++;
      const run = chars.slice(i, j);
      const n = run.length;
      if (k === "other") blocks.push(RX.block("text", { text: run.join("") }));
      else if (k === "digit") blocks.push(RX.block("class", { cls: "digit", q: { min: n, max: n, mode: "greedy" } }));
      else if (k === "blank" || k === "space") blocks.push(RX.block("class", { cls: k, q: { min: 1, max: null, mode: "greedy" } }));
      else {
        const kinds = new Set(run.map(kind));
        const cls = kinds.size === 1 && kinds.has("upper") && n > 1 ? "upper" : kinds.has("uletter") ? "uletter" : kinds.size === 1 && kinds.has("lower") ? "lower" : "letter";
        // Words vary in length: one or more letters.
        blocks.push(RX.block("class", { cls, q: { min: 1, max: null, mode: "greedy" } }));
      }
      i = j;
    }
    return blocks;
  };

  // A copy of blocks with new ids (backreferences follow their groups).
  RX.clone = function (blocks) {
    const ids = new Map();
    const copy = (list) => list.map((b) => {
      const c = JSON.parse(JSON.stringify(Object.assign({}, b, { children: undefined, options: undefined })));
      c.id = RX.newId();
      ids.set(b.id, c.id);
      if (b.children) c.children = copy(b.children);
      if (b.options) c.options = b.options.map(copy);
      return c;
    });
    const out = copy(blocks);
    RX.walk(out, (b) => b.kind === "backref" && ids.has(b.ref) && (b.ref = ids.get(b.ref)));
    return out;
  };
})();
