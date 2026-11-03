// Password, passphrase and PIN generation, and how strong the results are.
// No page layout here. Every random choice comes from crypto.getRandomValues,
// the browser's cryptographic random source (never Math.random).
//
//   Passwords.password(options) -> string     Passwords.passwordBits(options)
//   Passwords.passphrase(options) -> string   Passwords.passphraseBits(options)
//   Passwords.pin(length) -> string           Passwords.pinBits(length)
//   Passwords.guessTimes(bits)                rough time to guess, per attack
(function () {
  "use strict";
  const P = (window.Passwords = window.Passwords || {});

  // A random whole number from 0 to n - 1, with no bias: values from the top
  // of the range that would favour some numbers are thrown away and redrawn.
  const buffer = new Uint32Array(1);
  function randInt(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      crypto.getRandomValues(buffer);
      x = buffer[0];
    } while (x >= limit);
    return x % n;
  }
  const pick = (list) => list[randInt(list.length)];

  // log2 of a whole number of any size (BigInt), accurate to many decimals.
  function log2Big(n) {
    if (n <= 0n) return 0;
    const bits = n.toString(2);
    const top = Number("0b" + bits.slice(0, 53)) / 2 ** (Math.min(bits.length, 53) - 1);
    return bits.length - 1 + Math.log2(top);
  }

  // ---------- Passwords ----------

  P.SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?/~"
  };
  P.DEFAULT_SYMBOLS = P.SETS.symbols;
  // Characters that are easy to confuse with each other when read or typed by hand.
  P.LOOKALIKES = "Il1|O0o`'\"";
  P.MIN_LENGTH = 4;
  P.MAX_LENGTH = 128;

  // The character groups in use, after options. Each group is a list of unique characters.
  P.groups = function (o) {
    const seen = new Set();
    const out = [];
    for (const name of ["lower", "upper", "digits", "symbols"]) {
      if (!o[name]) continue;
      const source = name === "symbols" ? o.symbolChars : P.SETS[name];
      const chars = [...new Set(source || "")].filter((c) => c.trim() && !seen.has(c) && !(o.avoidLookalikes && P.LOOKALIKES.includes(c)));
      chars.forEach((c) => seen.add(c));
      if (chars.length) out.push(chars);
    }
    return out;
  };

  // "One of each" only applies when the password is long enough to fit one of each.
  const needsEach = (o, groups) => o.eachKind && groups.length > 1 && o.length >= groups.length;

  P.password = function (o) {
    const groups = P.groups(o);
    if (!groups.length) return "";
    const pool = groups.flat();
    // Draw whole passwords and keep the first that has every kind. Redrawing the
    // whole thing (instead of patching in a character) keeps every allowed
    // password equally likely, so the strength figure below stays exact.
    for (;;) {
      let s = "";
      for (let i = 0; i < o.length; i++) s += pick(pool);
      if (!needsEach(o, groups) || groups.every((g) => g.some((c) => s.includes(c)))) return s;
    }
  };

  // Exact count of possible passwords (inclusion-exclusion when every kind is required).
  P.passwordBits = function (o) {
    const groups = P.groups(o);
    if (!groups.length) return 0;
    const L = BigInt(o.length);
    const total = BigInt(groups.flat().length);
    if (!needsEach(o, groups)) return log2Big(total ** L);
    let count = 0n;
    for (let mask = 0; mask < 1 << groups.length; mask++) {
      let missing = 0;
      let k = 0;
      groups.forEach((g, i) => {
        if (mask & (1 << i)) {
          missing += g.length;
          k += 1;
        }
      });
      const term = (total - BigInt(missing)) ** L;
      count += k % 2 ? -term : term;
    }
    return log2Big(count);
  };

  // ---------- Passphrases ----------

  // The EFF list minus its 4 hyphenated words ("t-shirt"...), so a phrase joined
  // with dashes can't be read back two ways, which would make it weaker than shown.
  P.wordList = P.WORDS.filter((w) => !w.includes("-"));
  P.SEPARATORS = [[" ", "Spaces"], ["-", "Dashes ( - )"], [".", "Dots ( . )"], ["_", "Underscores ( _ )"]];
  P.MIN_WORDS = 3;
  P.MAX_WORDS = 12;

  P.passphrase = function (o) {
    const words = [];
    for (let i = 0; i < o.words; i++) {
      const w = pick(P.wordList);
      words.push(o.capitalize ? w[0].toUpperCase() + w.slice(1) : w);
    }
    // Some sites insist on a digit: add one random digit to the end of one random word.
    if (o.number) words[randInt(words.length)] += String(randInt(10));
    return words.join(o.separator);
  };

  // Capitals add nothing (every word gets one, so there's no secret in it);
  // the digit adds its value (10) times which word got it.
  P.passphraseBits = (o) => o.words * Math.log2(P.wordList.length) + (o.number ? Math.log2(10 * o.words) : 0);

  // ---------- PINs ----------

  P.MIN_PIN = 4;
  P.MAX_PIN = 12;
  P.pin = function (length) {
    let s = "";
    for (let i = 0; i < length; i++) s += String(randInt(10));
    return s;
  };
  P.pinBits = (length) => length * Math.log2(10);

  // ---------- How long to guess ----------

  // Rough guessing speeds against a stolen database of password hashes. Real
  // speeds vary by orders of magnitude, so these are only for comparison.
  P.ATTACKS = [
    { id: "slow", rate: 1e4, label: "Well-protected site", detail: "the site stored passwords with a slow hash such as bcrypt or Argon2; about 10,000 guesses a second" },
    { id: "fast", rate: 1e11, label: "Poorly protected site", detail: "a fast or outdated hash such as MD5, attacked with many graphics cards; about 100 billion guesses a second" }
  ];

  // On average an attacker finds a random password after trying half of all possibilities.
  P.guessTimes = (bits) => P.ATTACKS.map((a) => ({ ...a, seconds: 2 ** (bits - 1) / a.rate }));

  const YEAR = 365.25 * 24 * 3600;
  P.formatDuration = function (s) {
    if (s < 1) return "less than a second";
    const units = [["second", 1], ["minute", 60], ["hour", 3600], ["day", 86400], ["year", YEAR]];
    if (s < YEAR * 1000) {
      let [name, size] = units[0];
      for (const u of units) if (s >= u[1]) [name, size] = u;
      const n = Math.round(s / size);
      return n + " " + name + (n === 1 ? "" : "s");
    }
    const years = s / YEAR;
    if (years > 1.4e10) return "longer than the age of the universe";
    for (const [word, size] of [["billion", 1e9], ["million", 1e6], ["thousand", 1e3]]) {
      if (years >= size) return Math.round(years / size) + " " + word + " years";
    }
  };

  // Plain-language level. Thresholds follow common guidance: under ~50 bits is
  // within reach of a determined attacker; 70+ is out of reach for the foreseeable future.
  P.level = function (bits) {
    if (bits < 30) return { id: "low", text: "Weak if someone can guess freely; fine where wrong tries lock you out, like a phone or bank card" };
    if (bits < 50) return { id: "low", text: "Weak for an online account" };
    if (bits < 70) return { id: "ok", text: "Fine for most accounts" };
    return { id: "high", text: "Strong" };
  };
})();
