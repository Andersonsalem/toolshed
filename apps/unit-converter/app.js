// Unit Converter page. Units and maths are in units.js.
// Saves the last kind of unit, the units picked for each kind, and the amount.
(function () {
  "use strict";
  const { el } = window.UI;
  const U = window.Units;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("unit-converter", 1);

  // Starting pairs: the conversions people look up most.
  const DEFAULTS = {
    length: ["in", "cm"], mass: ["lb", "kg"], temperature: ["f", "c"], volume: ["cup", "ml"], area: ["ft2", "m2"],
    speed: ["mph", "kmh"], time: ["h", "min"], data: ["GB", "GiB"], energy: ["kcal", "kJ"], pressure: ["psi", "bar"],
    power: ["hp", "kW"], fuel: ["mpg", "l100"], angle: ["deg", "rad"]
  };

  function clean(raw) {
    raw = raw || {};
    const pairs = {};
    for (const cat of U.CATEGORIES) {
      const p = raw.pairs && raw.pairs[cat.id];
      pairs[cat.id] = Array.isArray(p) && p.length === 2 && p.every((id) => U.unit(cat, id)) ? p : DEFAULTS[cat.id];
    }
    return {
      cat: U.category(raw.cat) ? raw.cat : "length",
      pairs,
      value: typeof raw.value === "string" ? raw.value.slice(0, 60) : "1"
    };
  }
  const s = clean(store.load({}));
  // A link like #temperature opens that kind.
  if (U.category(location.hash.slice(1))) s.cat = location.hash.slice(1);
  const save = () => store.save(s);

  const cat = () => U.category(s.cat);
  const from = () => U.unit(cat(), s.pairs[s.cat][0]);
  const to = () => U.unit(cat(), s.pairs[s.cat][1]);
  const label = (u) => u.name + " (" + u.symbol + ")";

  // ---------- Kinds ----------

  const catButtons = U.CATEGORIES.map((c) => {
    const b = el("button", { type: "button", class: "cat", text: c.name.replace(" (and cooking)", "") });
    b.addEventListener("click", () => {
      s.cat = c.id;
      // "5 ft 11 in" belongs to Length; keep just its number in the new kind.
      const parsed = U.parse($("value").value);
      if (parsed.cat && parsed.cat !== c.id) {
        $("value").value = String(Number(parsed.value.toPrecision(10)));
        s.value = $("value").value;
      }
      history.replaceState(null, "", "#" + c.id);
      save();
      fillUnits();
      update();
    });
    return [c.id, b];
  });
  $("cats").append(...catButtons.map((x) => x[1]));

  function fillUnits() {
    catButtons.forEach(([id, b]) => b.setAttribute("aria-current", String(id === s.cat)));
    for (const which of ["from", "to"]) {
      const groups = new Map();
      for (const u of cat().units) {
        if (!groups.has(u.group)) groups.set(u.group, []);
        groups.get(u.group).push(el("option", { value: u.id, text: label(u) }));
      }
      const children = [];
      for (const [name, options] of groups) children.push(...(name ? [el("optgroup", { label: name }, options)] : options));
      $(which).replaceChildren(...children);
    }
    $("from").value = from().id;
    $("to").value = to().id;
    const note = cat().note;
    $("note").textContent = note || "";
    $("note").hidden = !note;
  }

  // ---------- Converting ----------

  let current = null; // the result, for copying

  // typed: the change came from the amount box, so "5 ft 11 in" may pick its kind of unit.
  function update(typed) {
    const parsed = U.parse($("value").value);
    $("error").hidden = !parsed.error;
    $("error").textContent = parsed.error || "";
    current = null;
    if (parsed.error) {
      $("result").textContent = "";
      $("extra").textContent = "";
      $("explain").textContent = "";
      $("copy").hidden = true;
      return renderAll(null);
    }
    // "5 ft 11 in" and the like pick their own unit.
    if (typed && parsed.cat && parsed.cat !== s.cat && !(parsed.cat === "speed" && !parsed.unit)) {
      s.cat = parsed.cat;
      history.replaceState(null, "", "#" + s.cat);
      fillUnits();
    }
    if (typed && parsed.unit && parsed.cat === s.cat && from().id !== parsed.unit) {
      s.pairs[s.cat] = [parsed.unit, s.pairs[s.cat][1] === parsed.unit ? DEFAULTS[s.cat][1] : s.pairs[s.cat][1]];
      fillUnits();
    }
    const value = parsed.value;
    const result = U.convert(value, from(), to());
    current = U.format(result);
    $("result").replaceChildren(
      el("span", { class: "muted", text: U.format(value) + " " + from().symbol + " = " }),
      el("strong", { text: current + " " + to().symbol })
    );
    $("copy").hidden = !Number.isFinite(result);
    const extras = [U.extra(cat(), from(), value), U.extra(cat(), to(), result)].filter(Boolean);
    $("extra").textContent = extras.length ? [...new Set(extras)].join("  ·  ") : "";
    $("explain").textContent = Number.isFinite(result) ? U.explain(cat(), from(), to()) : "That amount can't be converted (for example, 0 mpg would mean infinite fuel use).";
    renderAll(value);
  }

  function renderAll(value) {
    if (value === null) return $("all").replaceChildren();
    $("all").replaceChildren(...cat().units.map((u) => {
      const v = U.convert(value, from(), u);
      const tr = el("tr", { class: u.id === to().id ? "is-to" : u.id === from().id ? "is-from" : "" }, [
        el("th", { scope: "row", text: u.name }),
        // An overview: 7 significant digits keep it readable; the result above has full precision.
        el("td", { class: "num", text: U.format(v, 7) }),
        el("td", { class: "sym", text: u.symbol })
      ]);
      tr.addEventListener("click", () => {
        if (u.id === from().id) return;
        s.pairs[s.cat] = [from().id, u.id];
        save();
        fillUnits();
        update();
      });
      tr.title = "Convert to " + u.name;
      return tr;
    }));
  }

  $("value").addEventListener("input", () => {
    s.value = $("value").value;
    save();
    update(true);
  });
  $("from").addEventListener("change", () => {
    s.pairs[s.cat] = [$("from").value, s.pairs[s.cat][1]];
    save();
    update();
  });
  $("to").addEventListener("change", () => {
    s.pairs[s.cat] = [s.pairs[s.cat][0], $("to").value];
    save();
    update();
  });
  $("swap").addEventListener("click", () => {
    // Swapping also carries the result over, so 10 km → 6.2 mi becomes 6.2 mi → 10 km.
    if (current !== null && Number.isFinite(U.convert(U.parse($("value").value).value, from(), to()))) {
      const v = U.convert(U.parse($("value").value).value, from(), to());
      $("value").value = String(Number(v.toPrecision(10)));
      s.value = $("value").value;
    }
    s.pairs[s.cat] = [s.pairs[s.cat][1], s.pairs[s.cat][0]];
    save();
    fillUnits();
    update();
  });
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(current);
      $("copy").textContent = "Copied";
      setTimeout(() => ($("copy").textContent = "Copy"), 1500);
    } catch (e) {
      $("copy").textContent = "Couldn't copy";
    }
  });

  // ---------- Finding a unit ----------

  const index = U.searchIndex();
  let matches = [];
  let active = 0;
  function showMatches() {
    const q = $("find").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const list = $("find-list");
    if (!q) {
      list.hidden = true;
      return;
    }
    const words = q.split(/\s+/);
    matches = index
      .filter((x) => words.every((w) => x.text.includes(w)))
      .sort((a, b) => Number(!(a.unit.symbol.toLowerCase() === q || a.unit.name.startsWith(q))) - Number(!(b.unit.symbol.toLowerCase() === q || b.unit.name.startsWith(q))))
      .slice(0, 8);
    active = 0;
    list.hidden = false;
    if (!matches.length) return list.replaceChildren(el("li", { class: "none muted", text: "No unit by that name here." }));
    list.replaceChildren(...matches.map((m, i) => {
      const li = el("li", { role: "option", class: i === active ? "is-active" : "" }, [el("strong", { text: label(m.unit) }), el("span", { class: "muted", text: m.cat.name })]);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(m);
      });
      return li;
    }));
  }
  function choose(m) {
    s.cat = m.cat.id;
    const pair = s.pairs[s.cat];
    s.pairs[s.cat] = [m.unit.id, pair[1] !== m.unit.id ? pair[1] : pair[0]];
    if (s.pairs[s.cat][0] === s.pairs[s.cat][1]) s.pairs[s.cat][1] = cat().units.find((u) => u.id !== m.unit.id).id;
    $("find").value = "";
    $("find-list").hidden = true;
    history.replaceState(null, "", "#" + s.cat);
    save();
    fillUnits();
    update();
    $("value").focus();
  }
  $("find").addEventListener("input", showMatches);
  $("find").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!matches.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      [...$("find-list").children].forEach((li, i) => li.classList.toggle("is-active", i === active));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === "Escape") $("find-list").hidden = true;
  });
  $("find").addEventListener("blur", () => ($("find-list").hidden = true));

  $("value").value = s.value;
  fillUnits();
  update();
})();
