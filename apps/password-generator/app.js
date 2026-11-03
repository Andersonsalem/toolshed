// Password Generator page: options, results, copying and the strength panel.
// The generating and the maths are in generator.js. Only settings are saved, never results.
(function () {
  "use strict";
  const { el } = window.UI;
  const P = window.Passwords;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("password-generator", 1);
  const COUNT = 5;
  const MODES = ["password", "passphrase", "pin"];

  const clampInt = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

  function clean(raw) {
    raw = raw || {};
    return {
      mode: MODES.includes(raw.mode) ? raw.mode : "password",
      length: clampInt(raw.length, P.MIN_LENGTH, P.MAX_LENGTH, 16),
      allowLong: bool(raw.allowLong, false),
      lower: bool(raw.lower, true),
      upper: bool(raw.upper, true),
      digits: bool(raw.digits, true),
      symbols: bool(raw.symbols, true),
      symbolChars: typeof raw.symbolChars === "string" ? raw.symbolChars.slice(0, 40) : P.DEFAULT_SYMBOLS,
      eachKind: bool(raw.eachKind, true),
      avoidLookalikes: bool(raw.avoidLookalikes, false),
      words: clampInt(raw.words, P.MIN_WORDS, P.MAX_WORDS, 5),
      separator: P.SEPARATORS.some((s) => s[0] === raw.separator) ? raw.separator : "-",
      capitalize: bool(raw.capitalize, false),
      number: bool(raw.number, false),
      pinLength: clampInt(raw.pinLength, P.MIN_PIN, P.MAX_PIN, 6)
    };
  }

  const s = clean(store.load({}));
  // A link like #passphrase opens that tab.
  if (MODES.includes(location.hash.slice(1))) s.mode = location.hash.slice(1);

  // ---------- Options ----------

  const checks = { lower: "lower", upper: "upper", digits: "digits", symbols: "symbols", "each-kind": "eachKind", "avoid-lookalikes": "avoidLookalikes", "allow-long": "allowLong", capitalize: "capitalize", number: "number" };
  for (const [value, label] of P.SEPARATORS) $("separator").append(el("option", { value, text: label }));

  function fillForm() {
    for (const [id, key] of Object.entries(checks)) $(id).checked = s[key];
    if (!s.allowLong && s.length > 64) s.length = 64;
    $("length").max = s.allowLong ? P.MAX_LENGTH : 64;
    $("length").value = s.length;
    $("symbol-chars").value = s.symbolChars;
    $("words").value = s.words;
    $("separator").value = s.separator;
    $("pin-length").value = s.pinLength;
  }

  function readForm() {
    for (const [id, key] of Object.entries(checks)) s[key] = $(id).checked;
    s.length = Number($("length").value);
    s.symbolChars = $("symbol-chars").value;
    s.words = Number($("words").value);
    s.separator = $("separator").value;
    s.pinLength = Number($("pin-length").value);
  }

  $("options").addEventListener("submit", (e) => e.preventDefault());
  $("options").addEventListener("input", (e) => {
    readForm();
    if (e.target.id === "allow-long") fillForm();
    update(true);
  });
  $("symbol-reset").addEventListener("click", () => {
    s.symbolChars = P.DEFAULT_SYMBOLS;
    fillForm();
    update(true);
  });
  $("again").addEventListener("click", () => update(true));

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      s.mode = t.dataset.mode;
      history.replaceState(null, "", "#" + s.mode);
      update(true);
    })
  );

  // ---------- Results ----------

  // Digits and symbols get their own colour so long passwords are easier to read out or type.
  function showSecret(text) {
    const code = el("code", { class: "secret" });
    for (const c of text) {
      const kind = /[0-9]/.test(c) ? "ch-digit" : /[A-Za-z]/.test(c) ? "" : c === " " ? "" : "ch-symbol";
      code.append(kind ? el("span", { class: kind, text: c }) : c);
    }
    return code;
  }

  async function copy(text, code, button) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // Older browsers or blocked clipboard: select the text and use the old copy command.
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        ok = document.execCommand("copy");
      } catch (e2) {
        ok = false;
      }
    }
    $("copy-status").textContent = ok ? "Copied." : "Couldn't copy automatically: the text is selected, so press Ctrl+C (or ⌘+C).";
    if (ok) {
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    }
  }

  function makeOne() {
    if (s.mode === "passphrase") return P.passphrase(s);
    if (s.mode === "pin") return P.pin(s.pinLength);
    return P.password(s);
  }

  function bitsNow() {
    if (s.mode === "passphrase") return P.passphraseBits(s);
    if (s.mode === "pin") return P.pinBits(s.pinLength);
    return P.passwordBits(s);
  }

  function renderStrength(bits) {
    if (!bits) return $("strength").replaceChildren();
    const level = P.level(bits);
    const rounded = Math.floor(bits);
    const parts = [
      el("p", { class: "strength__head" }, [
        el("span", { class: "level level--" + level.id, text: level.text }),
        el("span", { class: "muted", text: " about " + rounded + " bits" })
      ]),
      el("table", { class: "guess" }, [
        el("caption", { class: "muted small", text: "Rough time to guess one of these if a site's password database is stolen:" }),
        el("tbody", {}, P.guessTimes(bits).map((a) => el("tr", {}, [
          el("th", { scope: "row" }, [a.label, el("span", { class: "muted small", text: a.detail })]),
          el("td", { text: P.formatDuration(a.seconds) })
        ])))
      ]),
      s.mode === "pin"
        ? el("p", { class: "muted small", text: "PINs are short on purpose: they're safe because the phone or card locks after a few wrong tries, not because they're hard to guess. Don't use one as a password." })
        : null
    ];
    $("strength").replaceChildren(...parts.filter(Boolean));
  }

  function update(save) {
    if (save) store.save(s);
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.mode === s.mode)));
    document.querySelectorAll("[data-for]").forEach((d) => (d.hidden = d.dataset.for !== s.mode));
    $("length-out").textContent = s.length;
    $("words-out").textContent = s.words;
    $("pin-length-out").textContent = s.pinLength;
    $("symbol-field").hidden = !s.symbols;
    $("copy-status").textContent = "";

    const empty = s.mode === "password" && !P.groups(s).length;
    $("empty").hidden = !empty;
    $("again").disabled = empty;
    const items = [];
    if (!empty) {
      for (let i = 0; i < COUNT; i++) {
        const text = makeOne();
        const code = showSecret(text);
        const button = el("button", { class: "button button--small button--ghost", type: "button", text: "Copy", "aria-label": "Copy " + (i + 1) });
        button.addEventListener("click", () => copy(text, code, button));
        items.push(el("li", {}, [code, button]));
      }
    }
    $("list").replaceChildren(...items);
    renderStrength(empty ? 0 : bitsNow());
  }

  fillForm();
  update(false);
})();
