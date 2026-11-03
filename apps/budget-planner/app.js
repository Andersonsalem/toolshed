// Budget & Runway Planner page: editable lists in, summaries out. Math is in calc.js.
// Exposes Budget.app for import.js (statements) to add spending lines.
(function () {
  "use strict";
  const { el } = window.UI;
  const B = window.Budget;

  const APP_ID = "budget-planner";
  const store = Store.open(APP_ID, 1);
  const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "INR", "SGD", "JPY", "BRL", "MXN", "ZAR"];
  const MAX_ROWS = 200;

  const $ = (id) => document.getElementById(id);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // What each list's rows hold. type: text | money | percent | every | category | check | month
  const LISTS = {
    income: {
      fields: [
        { key: "name", label: "What", type: "text", placeholder: "e.g. Salary" },
        { key: "amount", label: "Amount (after tax)", type: "money" },
        { key: "every", label: "How often", type: "every" },
        { key: "continues", label: "Keeps coming if I lose my job", type: "check" }
      ],
      blank: () => ({ name: "", amount: "", every: "month", continues: false }),
      empty: "No income added yet."
    },
    expenses: {
      fields: [
        { key: "name", label: "What", type: "text", placeholder: "e.g. Rent" },
        { key: "amount", label: "Amount", type: "money" },
        { key: "every", label: "How often", type: "every" },
        { key: "category", label: "Category", type: "category" },
        { key: "essential", label: "Essential", type: "check" }
      ],
      blank: () => ({ name: "", amount: "", every: "month", category: "Other", essential: false }),
      empty: "No spending added yet. Add it here, or fill it in from bank statements above."
    },
    debts: {
      fields: [
        { key: "name", label: "Debt", type: "text", placeholder: "e.g. Credit card" },
        { key: "balance", label: "Balance owed", type: "money" },
        { key: "rate", label: "Interest % a year", type: "percent" },
        { key: "minimum", label: "Minimum a month", type: "money" }
      ],
      blank: () => ({ name: "", balance: "", rate: "", minimum: "" }),
      empty: "No debts added."
    },
    goals: {
      fields: [
        { key: "name", label: "Goal", type: "text", placeholder: "e.g. Emergency fund" },
        { key: "target", label: "Target amount", type: "money" },
        { key: "saved", label: "Saved so far", type: "money" },
        { key: "by", label: "By", type: "month" }
      ],
      blank: () => ({ name: "", target: "", saved: "", by: "" }),
      empty: "No goals added."
    }
  };

  // ---------- State ----------

  function cleanItem(listName, raw) {
    const item = { id: typeof raw.id === "string" ? raw.id : newId() };
    for (const f of LISTS[listName].fields) {
      const v = raw[f.key];
      if (f.type === "check") item[f.key] = v === true;
      else if (f.type === "every") item[f.key] = B.FREQUENCIES.some((x) => x.id === v) ? v : "month";
      else if (f.type === "category") item[f.key] = B.CATEGORIES.includes(v) ? v : "Other";
      else item[f.key] = typeof v === "string" ? v.slice(0, 200) : "";
    }
    if (raw.source === "statements") {
      item.source = "statements";
      item.note = typeof raw.note === "string" ? raw.note.slice(0, 200) : "";
    }
    return item;
  }

  function cleanState(raw) {
    raw = raw || {};
    const state = {
      currency: CURRENCIES.includes(raw.currency) ? raw.currency : "USD",
      savings: typeof raw.savings === "string" ? raw.savings : "",
      extraCash: typeof raw.extraCash === "string" ? raw.extraCash : "",
      debtExtra: typeof raw.debtExtra === "string" ? raw.debtExtra : ""
    };
    for (const name of Object.keys(LISTS)) {
      state[name] = (Array.isArray(raw[name]) ? raw[name] : []).filter((x) => x && typeof x === "object").slice(0, MAX_ROWS).map((x) => cleanItem(name, x));
    }
    return state;
  }

  let state = cleanState(store.load(null));

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(state), 300);
  }
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    store.save(state);
  });

  // ---------- Formatting ----------

  function money(value) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
    } catch (e) {
      return Math.round(value).toLocaleString();
    }
  }

  function monthName(date) {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function duration(months) {
    if (!Number.isFinite(months)) return "Doesn't run out";
    if (months < 1) return "Less than a month";
    if (months < 24) return (Math.floor(months * 10) / 10).toString().replace(/\.0$/, "") + " months";
    const years = Math.floor(months / 12);
    const rest = Math.floor(months % 12);
    return years + " years" + (rest ? ", " + rest + " months" : "");
  }

  const isBad = (raw, type) => {
    if (type === "percent") {
      const v = B.parseAmount(String(raw || "").replace("%", ""));
      return Number.isNaN(v) || v > 100;
    }
    return Number.isNaN(B.parseAmount(raw));
  };

  // ---------- Lists ----------

  function cell(listName, item, field) {
    const id = listName + "-" + item.id + "-" + field.key;
    let input;
    if (field.type === "every") {
      input = el("select", { id }, B.FREQUENCIES.map((f) => el("option", { value: f.id, text: f.label })));
      input.value = item[field.key];
    } else if (field.type === "category") {
      input = el("select", { id }, B.CATEGORIES.map((c) => el("option", { value: c, text: c })));
      input.value = item[field.key];
    } else if (field.type === "check") {
      input = el("input", { id, type: "checkbox" });
      input.checked = item[field.key];
    } else if (field.type === "month") {
      input = el("input", { id, type: "month" });
      input.value = item[field.key];
    } else {
      input = el("input", { id, autocomplete: "off", maxlength: "200" });
      if (field.type !== "text") input.inputMode = "decimal";
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = item[field.key];
    }

    const update = () => {
      item[field.key] = field.type === "check" ? input.checked : input.value;
      if (field.type === "money" || field.type === "percent") input.setAttribute("aria-invalid", String(isBad(input.value, field.type)));
      save();
      renderResults();
    };
    input.addEventListener(field.type === "check" || input.tagName === "SELECT" ? "change" : "input", update);
    if (field.type === "money" || field.type === "percent") input.setAttribute("aria-invalid", String(isBad(item[field.key], field.type)));

    const label = el("label", { for: id, text: field.label });
    if (field.type === "check") return el("div", { class: "cell cell--check" }, [input, label]);
    return el("div", { class: "cell" + (field.key === "name" ? " cell--name" : "") }, [label, input]);
  }

  function renderList(listName) {
    const list = state[listName];
    const box = $("list-" + listName);
    if (!list.length) {
      box.replaceChildren(el("p", { class: "rows-empty", text: LISTS[listName].empty }));
      return;
    }
    box.replaceChildren(
      ...list.map((item) => {
        const remove = el("button", { class: "row__remove", type: "button", "aria-label": "Remove " + (item.name || "this row"), title: "Remove", text: "✕" });
        remove.addEventListener("click", () => {
          state[listName] = state[listName].filter((x) => x !== item);
          save();
          renderList(listName);
          renderResults();
        });
        return el("div", { class: "row row--" + listName }, [
          ...LISTS[listName].fields.map((f) => cell(listName, item, f)),
          remove,
          item.source === "statements" && item.note ? el("p", { class: "row__note", text: item.note }) : null
        ]);
      })
    );
  }

  function renderLists() {
    for (const name of Object.keys(LISTS)) renderList(name);
  }

  // ---------- Results ----------

  function stat(label, value, detail, mood) {
    return el("div", { class: "card stat" + (mood ? " stat--" + mood : "") }, [
      el("p", { class: "stat__label", text: label }),
      el("p", { class: "stat__value", text: value }),
      detail ? el("p", { class: "stat__detail", text: detail }) : null
    ]);
  }

  function result(label, value, detail, pick) {
    return el("div", { class: "result" + (pick ? " result--pick" : "") }, [
      el("p", { class: "result__label", text: label }),
      el("p", { class: "result__value", text: value }),
      detail ? el("p", { class: "result__detail", text: detail }) : null
    ]);
  }

  function renderResults() {
    const s = B.summarize(state);
    const all = B.runway(state, false);
    const essential = B.runway(state, true);
    const today = new Date();

    $("summary").replaceChildren(
      stat("Money in", money(s.income), "per month"),
      stat("Money out", money(s.spending), s.debtMinimums ? "per month, with debt minimums" : "per month"),
      stat(
        "Left over",
        money(s.leftOver),
        s.savingsRate === null ? "per month" : "per month, " + Math.round(s.savingsRate * 100) + "% of income",
        s.income || s.spending ? (s.leftOver < 0 ? "bad" : "good") : ""
      ),
      stat(
        "Runway",
        all.start > 0 || all.burn > 0 ? duration(all.months) : "–",
        all.start > 0 || all.burn > 0 ? "essentials only: " + duration(essential.months).toLowerCase() : "add savings below"
      )
    );

    $("income-total").textContent = state.income.length ? money(s.income) + " a month" : "";
    $("expenses-total").textContent = state.expenses.length ? money(s.expenses) + " a month" + (s.essentials ? " (" + money(s.essentials) + " essential)" : "") : "";
    renderCategories();
    renderRunway(all, essential, today);
    renderPayoff(today);
    renderGoals(s, today);
  }

  // The donut groups categories so it never has more than six slices, and
  // each group always keeps its own color (--group-1 … --group-6 in app.css).
  // The per-category list below it shows every category on its own.
  const GROUPS = [
    { name: "Home", categories: ["Housing", "Utilities", "Phone & internet"] },
    { name: "Food", categories: ["Groceries", "Eating out"] },
    { name: "Getting around", categories: ["Transport", "Travel"] },
    { name: "Bills & health", categories: ["Insurance", "Health", "Subscriptions", "Education"] },
    { name: "Debt payments", categories: [] }, // the minimums from the Debts section
    { name: "Everything else", categories: null } // any category not listed above
  ];

  function renderDonut(categoryTotals, debtMinimums) {
    const listed = new Set(GROUPS.flatMap((g) => g.categories || []));
    const groups = GROUPS.map((g, i) => {
      const parts = g.name === "Debt payments"
        ? (debtMinimums > 0 ? [["Minimum payments", debtMinimums]] : [])
        : [...categoryTotals].filter(([c, v]) => v > 0 && (g.categories ? g.categories.includes(c) : !listed.has(c))).sort((a, b) => b[1] - a[1]);
      return { name: g.name, color: "var(--group-" + (i + 1) + ")", parts, total: parts.reduce((t, [, v]) => t + v, 0) };
    }).filter((g) => g.total > 0);
    const total = groups.reduce((t, g) => t + g.total, 0);
    const box = $("donut");
    if (!total) return box.replaceChildren();

    const pct = (v) => {
      const p = (v / total) * 100;
      return p > 0 && p < 1 ? "<1%" : Math.round(p) + "%";
    };
    const svgEl = (tag, attrs, text) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text) n.textContent = text;
      return n;
    };

    // Each slice is a stretch of one ring's outline, starting at 12 o'clock,
    // with a 2px gap between slices.
    const R = 74;
    const C = 2 * Math.PI * R;
    const GAP = groups.length > 1 ? 2 : 0;
    const svg = svgEl("svg", {
      viewBox: "0 0 200 200",
      role: "img",
      "aria-label": "Spending per month by group: " + groups.map((g) => g.name + " " + pct(g.total)).join(", ")
    });
    let start = 0;
    const segments = groups.map((g, i) => {
      const length = (g.total / total) * C;
      const seg = svgEl("circle", {
        class: "seg",
        cx: 100, cy: 100, r: R,
        stroke: g.color,
        "stroke-dasharray": Math.max(0, length - GAP) + " " + C,
        "stroke-dashoffset": String(-start),
        transform: "rotate(-90 100 100)",
        "data-index": String(i)
      });
      start += length;
      return seg;
    });
    svg.append(...segments,
      svgEl("text", { class: "donut__total", x: 100, y: 100, "text-anchor": "middle" }, money(total)),
      svgEl("text", { class: "donut__sub", x: 100, y: 120, "text-anchor": "middle" }, "a month")
    );

    const legendItems = groups.map((g, i) =>
      el("li", { "data-index": String(i) }, [
        el("span", { class: "swatch", style: "background: " + g.color, "aria-hidden": "true" }),
        el("span", { text: g.name }),
        el("span", { class: "amount", text: money(g.total) }),
        el("span", { class: "pct", text: pct(g.total) })
      ])
    );

    const tip = el("div", { class: "donut-tip", hidden: "" });
    // Hovering a slice or its legend line highlights both and shows what's inside.
    const focus = (index, event) => {
      box.classList.toggle("is-focus", index !== null);
      segments.forEach((s, i) => s.classList.toggle("is-on", i === index));
      legendItems.forEach((li, i) => li.classList.toggle("is-on", i === index));
      if (index === null || !event) return (tip.hidden = true);
      const g = groups[index];
      tip.replaceChildren(
        el("p", {}, [el("strong", { text: g.name }), " · " + money(g.total) + " (" + pct(g.total) + ")"]),
        el("ul", {}, g.parts.map(([name, v]) => el("li", {}, [el("span", { text: name }), el("span", { text: money(v) })])))
      );
      tip.hidden = false;
      const area = box.getBoundingClientRect();
      tip.style.left = Math.min(event.clientX - area.left + 14, area.width - tip.offsetWidth) + "px";
      tip.style.top = event.clientY - area.top + 14 + "px";
    };
    segments.forEach((s, i) => {
      s.addEventListener("pointermove", (e) => focus(i, e));
      s.addEventListener("pointerleave", () => focus(null));
    });
    legendItems.forEach((li, i) => {
      li.addEventListener("pointerenter", () => focus(i, null));
      li.addEventListener("pointerleave", () => focus(null));
    });

    box.replaceChildren(
      el("h3", { text: "Where the money goes, per month" }),
      el("div", {}, [svg]),
      el("ul", { class: "donut-legend" }, legendItems),
      tip
    );
  }

  function renderCategories() {
    const totals = new Map();
    for (const e of state.expenses) totals.set(e.category, (totals.get(e.category) || 0) + B.monthly(e));
    renderDonut(totals, B.summarize(state).debtMinimums);
    const rows = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (rows.length < 2) return $("categories").replaceChildren();
    const max = rows[0][1];
    $("categories").replaceChildren(
      el("h3", { text: "Each category, per month" }),
      ...rows.map(([name, value]) => {
        const fill = el("span");
        fill.style.width = (value / max) * 100 + "%";
        return el("div", { class: "cat-row" }, [el("span", { text: name }), el("div", { class: "cat-bar", "aria-hidden": "true" }, [fill]), el("span", { text: money(value) })]);
      })
    );
  }

  function renderRunway(all, essential, today) {
    const box = $("runway");
    if (all.start <= 0 && all.burn <= 0) {
      box.replaceChildren(el("p", { class: "result-note muted", text: "Add your savings and spending to see how long they'd last." }));
      return;
    }
    const card = (label, r, pick) => {
      if (!Number.isFinite(r.months)) {
        return result(label, "Doesn't run out", "Income that keeps coming covers this spending.", pick);
      }
      return result(label, duration(r.months), "until about " + monthName(B.addMonths(today, r.months)) + ", using " + money(r.burn) + " a month", pick);
    };
    box.replaceChildren(
      el("div", { class: "results" }, [card("Keeping all spending", all), card("Cutting to essentials", essential, true)]),
      chart(all, essential)
    );
  }

  // A small line chart of savings over time for both cases.
  function chart(all, essential) {
    const W = 600, H = 200, L = 64, R = 10, T = 10, Bm = 26;
    const months = Math.max(all.balances.length, essential.balances.length) - 1;
    const top = Math.max(all.start, 1);
    const x = (m) => L + (m / Math.max(months, 1)) * (W - L - R);
    const y = (v) => T + (1 - v / top) * (H - T - Bm);
    const line = (balances, cls) => {
      const points = balances.map((v, m) => x(m).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", points);
      p.setAttribute("class", cls);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke-width", "2.5");
      return p;
    };
    const svgEl = (tag, attrs, text) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text) n.textContent = text;
      return n;
    };
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Savings over the next " + months + " months: all spending vs essentials only" });
    svg.append(
      svgEl("line", { class: "axis", x1: L, y1: y(0), x2: W - R, y2: y(0) }),
      svgEl("line", { class: "axis", x1: L, y1: T, x2: L, y2: y(0) }),
      svgEl("text", { class: "tick", x: L - 6, y: y(top) + 4, "text-anchor": "end" }, money(top)),
      svgEl("text", { class: "tick", x: L - 6, y: y(0) + 4, "text-anchor": "end" }, money(0))
    );
    const step = months <= 12 ? 3 : months <= 36 ? 6 : 12;
    for (let m = step; m <= months; m += step) svg.append(svgEl("text", { class: "tick", x: x(m), y: H - 6, "text-anchor": "middle" }, m + " mo"));
    svg.append(line(all.balances, "line-all"), line(essential.balances, "line-essential"));
    return el("div", { class: "chart" }, [
      svg,
      el("ul", { class: "legend" }, [
        el("li", {}, [el("span", { class: "swatch", style: "background: var(--danger)" }), "All spending"]),
        el("li", {}, [el("span", { class: "swatch", style: "background: var(--accent)" }), "Essentials only"])
      ])
    ]);
  }

  function renderPayoff(today) {
    const box = $("payoff");
    const owed = state.debts.reduce((t, d) => t + (B.parseAmount(d.balance) || 0), 0);
    $("debts-total").textContent = owed ? money(owed) + " owed" : "";
    const avalanche = B.payoff(state, "avalanche");
    const snowball = B.payoff(state, "snowball");
    if (!avalanche) return box.replaceChildren();

    if (!avalanche.finished) {
      const stuck = avalanche.debts.filter((d) => d.month === null).map((d) => d.name).join(", ");
      box.replaceChildren(el("p", { class: "result-note is-error", text:
        "At these payments, " + stuck + " never gets paid off: the payments don't cover the interest. Raise the minimum or add extra each month." }));
      return;
    }
    const card = (label, plan, pick) =>
      result(label, "Debt-free in " + duration(plan.months).toLowerCase(), "by " + monthName(B.addMonths(today, plan.months)) + ", " + money(plan.interest) + " in interest", pick);
    const cheaper = snowball.interest - avalanche.interest;
    const best = cheaper >= 1 ? avalanche : snowball;
    box.replaceChildren(
      el("div", { class: "results" }, [
        card("Highest interest first", avalanche, best === avalanche),
        card("Smallest balance first", snowball, best === snowball && cheaper < 1)
      ]),
      el("p", { class: "result-note", text: cheaper >= 1
        ? "Paying the highest interest first saves " + money(cheaper) + ". Smallest first costs more, but clears debts sooner, which some people find easier to stick with."
        : "Both orders cost about the same here." }),
      el("p", { class: "result-note muted", text: "Order paid off (" + (best === avalanche ? "highest interest first" : "smallest balance first") + "): " +
        best.debts.slice().sort((a, b) => a.month - b.month).map((d) => d.name + " in " + monthName(B.addMonths(today, d.month))).join(", ") + "." })
    );
  }

  function renderGoals(s, today) {
    const goals = B.goals(state, today);
    if (!goals.length) return $("goal-results").replaceChildren();
    let total = 0;
    const items = goals.map((g) => {
      let text;
      if (g.done) text = "Done";
      else if (g.passed) text = "The date has passed";
      else if (g.perMonth === null) text = "Add a target and a date";
      else {
        total += g.perMonth;
        text = money(g.perMonth) + " a month for " + g.months + (g.months === 1 ? " month" : " months");
      }
      return el("li", {}, [el("span", { text: g.name }), el("span", { text })]);
    });
    const verdict = total > 0
      ? "Your goals need " + money(total) + " a month. You have " + money(s.leftOver) + " left over each month" +
        (s.leftOver >= total ? ", which covers it." : s.leftOver > 0 ? ", so you're " + money(total - s.leftOver) + " a month short." : ".")
      : "";
    $("goal-results").replaceChildren(...[el("ul", { class: "goal-list" }, items), verdict ? el("p", { class: "result-note", text: verdict }) : null].filter(Boolean));
  }

  function renderAll() {
    $("currency").value = state.currency;
    $("savings").value = state.savings;
    $("extra-cash").value = state.extraCash;
    $("debt-extra").value = state.debtExtra;
    renderLists();
    renderResults();
  }

  // ---------- Controls ----------

  for (const code of CURRENCIES) $("currency").append(el("option", { value: code, text: code }));
  $("currency").addEventListener("change", (e) => {
    state.currency = e.target.value;
    save();
    renderResults();
  });

  for (const [id, key] of [["savings", "savings"], ["extra-cash", "extraCash"], ["debt-extra", "debtExtra"]]) {
    $(id).addEventListener("input", (e) => {
      state[key] = e.target.value;
      e.target.setAttribute("aria-invalid", String(isBad(e.target.value)));
      save();
      renderResults();
    });
  }

  document.querySelectorAll("[data-add]").forEach((button) =>
    button.addEventListener("click", () => {
      const name = button.dataset.add;
      if (state[name].length >= MAX_ROWS) return;
      state[name].push({ id: newId(), ...LISTS[name].blank() });
      save();
      renderList(name);
      renderResults();
      const inputs = $("list-" + name).querySelectorAll(".cell--name input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    })
  );

  const hasData = () => Object.keys(LISTS).some((n) => state[n].length) || state.savings || state.extraCash;

  $("example").addEventListener("click", () => {
    if (hasData() && !confirm("Replace your budget with the example? What you've entered will be lost.")) return;
    const ym = (add) => {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() + add, 1);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    };
    state = cleanState({
      currency: state.currency,
      savings: "12000",
      extraCash: "3000",
      debtExtra: "150",
      income: [
        { name: "Salary", amount: "4200", every: "month", continues: false },
        { name: "Partner's part-time pay", amount: "900", every: "month", continues: true }
      ],
      expenses: [
        { name: "Rent", amount: "1500", every: "month", category: "Housing", essential: true },
        { name: "Groceries", amount: "110", every: "week", category: "Groceries", essential: true },
        { name: "Electricity and water", amount: "140", every: "month", category: "Utilities", essential: true },
        { name: "Phone and internet", amount: "90", every: "month", category: "Phone & internet", essential: true },
        { name: "Car insurance", amount: "1300", every: "year", category: "Insurance", essential: true },
        { name: "Fuel", amount: "160", every: "month", category: "Transport", essential: true },
        { name: "Streaming", amount: "35", every: "month", category: "Subscriptions", essential: false },
        { name: "Eating out", amount: "250", every: "month", category: "Eating out", essential: false },
        { name: "Gym", amount: "40", every: "month", category: "Health", essential: false },
        { name: "Shopping", amount: "200", every: "month", category: "Shopping", essential: false }
      ],
      debts: [
        { name: "Credit card", balance: "3500", rate: "22.9", minimum: "90" },
        { name: "Car loan", balance: "8000", rate: "6.5", minimum: "240" }
      ],
      goals: [
        { name: "Emergency fund", target: "18000", saved: "12000", by: ym(12) },
        { name: "Holiday", target: "2000", saved: "300", by: ym(8) }
      ]
    });
    save();
    renderAll();
  });

  $("clear").addEventListener("click", () => {
    if (!confirm("Clear your whole budget? Download a backup first if you might want it back.")) return;
    state = cleanState({ currency: state.currency });
    save();
    renderAll();
  });

  $("export").addEventListener("click", () => store.exportFile(state));
  $("import-backup").addEventListener("click", () => $("import-backup-file").click());
  $("import-backup-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = await store.importFile(file);
      if (hasData() && !confirm("Replace your current budget with this backup?")) return;
      state = cleanState(data);
      save();
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  renderAll();

  // For import.js: replace earlier statement lines with new ones.
  B.app = {
    money,
    replaceStatementLines(expenses, income) {
      state.expenses = state.expenses.filter((e) => e.source !== "statements").concat(expenses.map((e) => cleanItem("expenses", e)));
      if (income) state.income = state.income.filter((i) => i.source !== "statements").concat([cleanItem("income", income)]);
      save();
      renderAll();
    }
  };
})();
