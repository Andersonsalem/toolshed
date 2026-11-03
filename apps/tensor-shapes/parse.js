// Reads the small part of Python that tensor code uses: assignments, calls,
// method chains, indexing, tuples, lists and arithmetic. No page layout here.
//
//   TS.parse(code) -> [{ line, text, comment, targets: [names] | null, expr }] or throws TS.Error
//
// Expressions become plain objects: { t: "num" | "str" | "name" | "const" | "tuple" |
// "list" | "attr" | "call" | "index" | "slice" | "bin" | "neg", ... }.
(function () {
  "use strict";
  const TS = (window.TS = window.TS || {});

  // An error the person should see, with the line it's on.
  TS.Error = class extends Error {
    constructor(message, line) {
      super(message);
      this.line = line;
    }
  };

  const OPS = ["...", "**", "//", "==", "!=", "<=", ">=", "<", ">", "(", ")", "[", "]", "{", "}", ",", ":", ".", "=", "@", "+", "-", "*", "/", "%"];

  function tokenize(src, line) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\\") {
        i++;
        continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        const m = src.slice(i).match(/^(\d[\d_]*\.?\d*|\.\d+)(e[-+]?\d+)?j?/i);
        out.push({ k: "num", v: Number(m[0].replace(/_/g, "")), raw: m[0] });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = src.slice(i).match(/^[A-Za-z_]\w*/);
        out.push({ k: "name", v: m[0] });
        i += m[0].length;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = src.indexOf(c, i + 1);
        if (end < 0) throw new TS.Error("A text in quotes isn't closed.", line);
        out.push({ k: "str", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new TS.Error("Unexpected character “" + c + "”.", line);
      out.push({ k: "op", v: op });
      i += op.length;
    }
    out.push({ k: "end" });
    return out;
  }

  function parser(tokens, line) {
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => tokens[p].k === "op" && tokens[p].v === v;
    const eat = (v) => {
      if (!isOp(v)) throw new TS.Error("Expected “" + v + "” " + where(), line);
      p++;
    };
    const where = () => (peek().k === "end" ? "at the end of the line." : "before “" + (peek().v === undefined ? "" : peek().v) + "”.");

    // Comparisons (x > 0) give a tensor of the same shape, so they sit at the lowest level.
    function expr() {
      let left = arith();
      while (["==", "!=", "<=", ">=", "<", ">"].some(isOp)) {
        const op = tokens[p++].v;
        left = { t: "bin", op, l: left, r: arith() };
      }
      return left;
    }
    function arith() {
      let left = term();
      while (isOp("+") || isOp("-")) {
        const op = tokens[p++].v;
        left = { t: "bin", op, l: left, r: term() };
      }
      return left;
    }
    function term() {
      let left = unary();
      while (isOp("*") || isOp("/") || isOp("//") || isOp("%") || isOp("@")) {
        const op = tokens[p++].v;
        left = { t: "bin", op, l: left, r: unary() };
      }
      return left;
    }
    function unary() {
      if (isOp("-")) {
        p++;
        return { t: "neg", x: unary() };
      }
      if (isOp("+")) {
        p++;
        return unary();
      }
      const base = postfix();
      if (isOp("**")) {
        p++;
        return { t: "bin", op: "**", l: base, r: unary() };
      }
      return base;
    }
    function postfix() {
      let node = atom();
      for (;;) {
        if (isOp(".")) {
          p++;
          if (peek().k !== "name") throw new TS.Error("Expected a name after “.” " + where(), line);
          node = { t: "attr", obj: node, name: tokens[p++].v };
        } else if (isOp("(")) {
          p++;
          const args = [], kwargs = {};
          while (!isOp(")")) {
            if (peek().k === "name" && tokens[p + 1].k === "op" && tokens[p + 1].v === "=") {
              const key = tokens[p].v;
              p += 2;
              kwargs[key] = expr();
            } else {
              if (isOp("*")) throw new TS.Error("Unpacking with * isn't supported; write the sizes out.", line);
              args.push(expr());
            }
            if (!isOp(")")) eat(",");
          }
          p++;
          node = { t: "call", fn: node, args, kwargs };
        } else if (isOp("[")) {
          p++;
          const items = [];
          while (!isOp("]")) {
            items.push(subscript());
            if (!isOp("]")) eat(",");
          }
          p++;
          node = { t: "index", obj: node, items };
        } else return node;
      }
    }
    function subscript() {
      if (isOp("...")) {
        p++;
        return { t: "const", v: "..." };
      }
      let a = null;
      if (!isOp(":")) {
        a = expr();
        if (!isOp(":")) return a;
      }
      p++; // ":"
      const b = isOp(":") || isOp(",") || isOp("]") ? null : expr();
      let c = null;
      if (isOp(":")) {
        p++;
        c = isOp(",") || isOp("]") ? null : expr();
      }
      return { t: "slice", a, b, c };
    }
    function sequence(close) {
      const items = [];
      let comma = false;
      while (!isOp(close)) {
        items.push(expr());
        if (isOp(",")) {
          p++;
          comma = true;
        } else break;
      }
      eat(close);
      return { items, comma };
    }
    function atom() {
      const tok = peek();
      if (tok.k === "num") {
        p++;
        return { t: "num", v: tok.v, raw: tok.raw };
      }
      if (tok.k === "str") {
        p++;
        return { t: "str", v: tok.v };
      }
      if (tok.k === "name") {
        p++;
        if (tok.v === "None") return { t: "const", v: null };
        if (tok.v === "True") return { t: "const", v: true };
        if (tok.v === "False") return { t: "const", v: false };
        return { t: "name", v: tok.v };
      }
      if (isOp("...")) {
        p++;
        return { t: "const", v: "..." };
      }
      if (isOp("(")) {
        p++;
        const s = sequence(")");
        return s.items.length === 1 && !s.comma ? s.items[0] : { t: "tuple", items: s.items };
      }
      if (isOp("[")) {
        p++;
        return { t: "list", items: sequence("]").items };
      }
      throw new TS.Error("Unexpected " + (tok.k === "end" ? "end of the line." : "“" + tok.v + "”."), line);
    }

    // Statement: "a = expr", "a, b = expr", "self.fc = expr", "x += expr" or just "expr".
    let targets = null, augment = null;
    let q = p;
    const names = [];
    const opAt = (i, v) => tokens[i].k === "op" && tokens[i].v === v;
    while (tokens[q].k === "name") {
      let name = tokens[q++].v;
      while (opAt(q, ".") && tokens[q + 1].k === "name") {
        name += "." + tokens[q + 1].v;
        q += 2;
      }
      names.push(name);
      if (opAt(q, ",")) q++;
      else break;
    }
    if (names.length && opAt(q, "=")) {
      targets = names;
      p = q + 1;
    } else if (names.length === 1 && ["+", "-", "*", "/", "@"].some((v) => opAt(q, v)) && opAt(q + 1, "=")) {
      targets = names;
      augment = tokens[q].v;
      p = q + 2;
    }
    let e = expr();
    // "B, C = 8, 3" and "return x, y": a tuple without brackets.
    if (isOp(",")) {
      const items = [e];
      while (isOp(",")) {
        p++;
        if (peek().k === "end") break;
        items.push(expr());
      }
      e = { t: "tuple", items };
    }
    if (augment) {
      const path = names[0].split(".");
      let target = { t: "name", v: path[0] };
      for (const part of path.slice(1)) target = { t: "attr", obj: target, name: part };
      e = { t: "bin", op: augment, l: target, r: e };
    }
    if (peek().k !== "end") throw new TS.Error("Unexpected “" + peek().v + "” " + "after the expression.", line);
    return { targets, expr: e };
  }

  // Joins lines inside open brackets, strips comments, skips imports and blank lines.
  TS.parse = function (code) {
    const rawLines = code.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let buf = "", start = 0, depth = 0, comment = "";
    rawLines.forEach((raw, i) => {
      let text = raw;
      // A comment outside quotes ends the code part.
      let inStr = null;
      for (let j = 0; j < text.length; j++) {
        const ch = text[j];
        if (inStr) {
          if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'") inStr = ch;
        else if (ch === "#") {
          if (!buf) comment = text.slice(j + 1).trim();
          else comment = comment || text.slice(j + 1).trim();
          text = text.slice(0, j);
          break;
        }
      }
      if (!buf) start = i + 1;
      buf += (buf ? " " : "") + text.trim();
      for (const ch of text) {
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth--;
      }
      if (depth > 0 && i < rawLines.length - 1) return;
      let stmt = buf.trim();
      const note = comment;
      buf = "";
      depth = 0;
      comment = "";
      // A pasted nn.Module works: class/def lines are skipped, "return x" is read as "x".
      if (!stmt || /^(import|from)\s/.test(stmt) || /^(class|def)\s/.test(stmt) || /^super\(/.test(stmt) || /^@/.test(stmt) || stmt === "pass") return;
      if (/^return\b/.test(stmt)) stmt = stmt.replace(/^return\s*/, "");
      if (!stmt) return;
      if (/^(for|while|if|elif|else|with|try|except|finally|lambda|assert|raise)\b/.test(stmt)) {
        throw new TS.Error("Only straight-line code works here, one operation after another: no for, if, while or with. Write a loop out as separate lines.", start);
      }
      const parsed = parser(tokenize(stmt, start), start);
      out.push({ line: start, text: stmt, comment: note, targets: parsed.targets, expr: parsed.expr });
    });
    return out;
  };
})();
