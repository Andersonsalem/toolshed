// "Fill in spending from bank statements": read statements (statements.js),
// let the person check every transaction, then add monthly averages per
// category to the budget. Statements stay in this tab: never uploaded or saved.
(function () {
  "use strict";
  const { el } = window.UI;
  const B = window.Budget;
  const $ = (id) => document.getElementById(id);

  const TRANSFERS = "Transfers (not spending)";
  const INCOME = "Income";
  const ALL_CATEGORIES = B.CATEGORIES.concat([TRANSFERS, INCOME]);
  const ESSENTIAL = new Set(["Housing", "Utilities", "Groceries", "Insurance", "Health", "Transport", "Phone & internet", "Children"]);
  const SHOW_ROWS = 500;
  const DAYS_PER_MONTH = 30.44;

  let txs = []; // { date, yearHint, text, amount, sure, include, category, file }
  let notes = [];
  let dateOrder = null; // "dmy" | "mdy"
  let monthsOverride = "";
  let filter = "all";
  let addIncome = false;
  let busy = false;

  const money = (v) => B.app.money(v);
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const localeOrder = () => (/^en-(US|PH)|^en$/.test(navigator.language || "") ? "mdy" : "dmy");

  // ---------- Reading files ----------

  async function addFiles(files) {
    if (busy) return;
    busy = true;
    notes = [];
    render(true);
    for (const file of files) {
      try {
        const result = await B.readStatement(file);
        for (const t of result.transactions) {
          const category = t.amount > 0 ? (B.categorize(t.text) === TRANSFERS ? TRANSFERS : INCOME) : B.categorize(t.text);
          txs.push({ ...t, file: file.name, category, include: true });
        }
        notes.push({ text: "Read " + plural(result.transactions.length, "transaction") + " from “" + file.name + "”" + (result.kind === "pdf" ? " (PDF: check them carefully)." : ".") });
        for (const n of result.notes) notes.push({ text: n });
      } catch (error) {
        notes.push({ text: error.message, error: true });
      }
    }
    const guessed = B.guessDateOrder(txs.map((t) => t.date));
    dateOrder = guessed || dateOrder || localeOrder();
    notes.ambiguous = !guessed;
    busy = false;
    render(true);
  }

  // ---------- Working out the numbers ----------

  function dateOf(t) {
    return B.parseDate(t.date, dateOrder, t.yearHint);
  }

  function coverage() {
    const dates = txs.filter((t) => t.include).map(dateOf).filter(Boolean).map((d) => d.getTime());
    if (!dates.length) return null;
    const first = new Date(Math.min(...dates));
    const last = new Date(Math.max(...dates));
    const days = Math.round((last - first) / 86400000) + 1;
    return { first, last, months: Math.max(1, Math.round((days / DAYS_PER_MONTH) * 10) / 10) };
  }

  function monthsUsed() {
    const typed = parseFloat(monthsOverride);
    if (typed > 0) return typed;
    const c = coverage();
    return c ? c.months : 1;
  }

  function totals() {
    const months = monthsUsed();
    const byCategory = new Map();
    let income = 0;
    let incomeCount = 0;
    for (const t of txs) {
      if (!t.include || t.category === TRANSFERS) continue;
      if (t.category === INCOME) {
        if (t.amount > 0) {
          income += t.amount;
          incomeCount += 1;
        }
        continue;
      }
      if (t.amount >= 0) continue; // refunds into a spending category are ignored
      const entry = byCategory.get(t.category) || { total: 0, count: 0 };
      entry.total += -t.amount;
      entry.count += 1;
      byCategory.set(t.category, entry);
    }
    return {
      months,
      categories: [...byCategory].map(([category, v]) => ({ category, perMonth: v.total / months, count: v.count })).sort((a, b) => b.perMonth - a.perMonth),
      income: income / months,
      incomeCount
    };
  }

  // ---------- Rendering ----------

  function render(rebuildTable) {
    const body = $("statements-body");
    const fileInput = el("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.pdf", multiple: "", hidden: "" });
    fileInput.addEventListener("change", () => {
      const files = [...fileInput.files];
      fileInput.value = "";
      if (files.length) addFiles(files);
    });
    const choose = el("button", { class: "button button--small", type: "button", text: txs.length ? "Add more statements" : "Choose statements" });
    choose.addEventListener("click", () => fileInput.click());
    const clear = el("button", { class: "button button--small button--ghost", type: "button", text: "Remove all statements" });
    clear.addEventListener("click", () => {
      txs = [];
      notes = [];
      monthsOverride = "";
      render(true);
    });

    const parts = [
      el("p", { class: "small", text: "Add statements from your bank or card as CSV, Excel or PDF. Two or three months gives a better average. They're read in this tab and never uploaded or saved: only the monthly totals you add are kept." }),
      el("p", { class: "small muted", text: "CSV or Excel downloads from your bank are the most accurate. PDFs are read on a best-effort basis, and scanned PDFs can't be read at all." }),
      el("div", { class: "st-actions" }, [choose, fileInput, txs.length ? clear : null, busy ? el("span", { class: "small muted", text: "Reading…" }) : null])
    ];
    if (notes.length) {
      parts.push(el("ul", { class: "st-notes" }, notes.map((n) => el("li", { class: n.error ? "is-error" : "", text: n.text }))));
    }

    if (txs.length) parts.push(...reviewParts(rebuildTable));
    body.replaceChildren(...parts);
  }

  let tableBox = null;
  let totalsBox = null;

  function reviewParts(rebuildTable) {
    const parts = [];
    if (notes.ambiguous) {
      const order = el("select", { "aria-label": "How dates are written" }, [
        el("option", { value: "dmy", text: "Day first (31/12)" }),
        el("option", { value: "mdy", text: "Month first (12/31)" })
      ]);
      order.value = dateOrder;
      order.addEventListener("change", () => {
        dateOrder = order.value;
        render(true);
      });
      parts.push(el("div", { class: "st-actions" }, [el("span", { class: "small", text: "Dates in these files are written:" }), order]));
    }

    const swap = el("button", { class: "button button--small button--ghost", type: "button", text: "Swap in and out" });
    swap.title = "For statements that show spending as positive numbers, like many credit cards";
    swap.addEventListener("click", () => {
      for (const t of txs) {
        t.amount = -t.amount;
        if (t.category === INCOME && t.amount < 0) t.category = B.categorize(t.text);
        else if (t.amount > 0 && t.category !== TRANSFERS) t.category = INCOME;
      }
      render(true);
    });
    const show = el("select", { "aria-label": "Show" }, [
      el("option", { value: "all", text: "Show all" }),
      el("option", { value: "out", text: "Money out" }),
      el("option", { value: "in", text: "Money in" }),
      el("option", { value: "check", text: "Directions to check" })
    ]);
    show.value = filter;
    show.addEventListener("change", () => {
      filter = show.value;
      renderTable();
    });
    parts.push(el("div", { class: "st-actions" }, [show, swap]));

    tableBox = el("div");
    totalsBox = el("div");
    renderTable();
    renderTotals();
    parts.push(tableBox, totalsBox);
    return parts;
  }

  function renderTable() {
    const shown = txs.filter((t) =>
      filter === "all" || (filter === "out" && t.amount < 0) || (filter === "in" && t.amount > 0) || (filter === "check" && !t.sure)
    );
    const rows = shown.slice(0, SHOW_ROWS).map((t) => {
      const include = el("input", { type: "checkbox", "aria-label": "Use this transaction" });
      include.checked = t.include;
      const direction = el("select", { "aria-label": "Money in or out" }, [
        el("option", { value: "out", text: "Out" }),
        el("option", { value: "in", text: "In" })
      ]);
      direction.value = t.amount < 0 ? "out" : "in";
      const category = el("select", { "aria-label": "Category" }, ALL_CATEGORIES.map((c) => el("option", { value: c, text: c })));
      category.value = t.category;
      const amountCell = el("td", { class: "num", text: money(Math.abs(t.amount)) });
      const row = el("tr", { class: (t.include ? "" : "is-off ") + (t.sure ? "" : "is-unsure") }, [
        el("td", {}, [include]),
        el("td", { text: formatDate(t) }),
        el("td", { class: "desc", text: t.text, title: t.file }),
        amountCell,
        el("td", {}, [direction]),
        el("td", {}, [category])
      ]);
      include.addEventListener("change", () => {
        t.include = include.checked;
        row.classList.toggle("is-off", !t.include);
        renderTotals();
      });
      direction.addEventListener("change", () => {
        t.amount = direction.value === "out" ? -Math.abs(t.amount) : Math.abs(t.amount);
        t.sure = true;
        row.classList.remove("is-unsure");
        if (t.amount > 0 && t.category !== TRANSFERS) t.category = INCOME;
        if (t.amount < 0 && t.category === INCOME) t.category = B.categorize(t.text);
        category.value = t.category;
        renderTotals();
      });
      category.addEventListener("change", () => {
        t.category = category.value;
        renderTotals();
      });
      return row;
    });
    // filter(Boolean): replaceChildren would print a null as the word "null".
    tableBox.replaceChildren(...[
      el("div", { class: "st-table-wrap" }, [
        el("table", { class: "st-table" }, [
          el("thead", {}, [el("tr", {}, ["Use", "Date", "Description", "Amount", "In/out", "Category"].map((h) => el("th", { scope: "col", text: h })))]),
          el("tbody", {}, rows)
        ])
      ]),
      shown.length > SHOW_ROWS ? el("p", { class: "small muted", text: "Showing the first " + SHOW_ROWS + " of " + shown.length + ". Totals use all of them." }) : null,
      shown.length ? null : el("p", { class: "small muted", text: "Nothing to show with this filter." })
    ].filter(Boolean));
  }

  function formatDate(t) {
    const d = dateOf(t);
    return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : t.date;
  }

  function renderTotals() {
    const c = coverage();
    const t = totals();
    const unsure = txs.filter((x) => x.include && !x.sure).length;

    const months = el("input", { inputmode: "decimal", placeholder: c ? String(c.months) : "1", "aria-label": "Months the statements cover" });
    months.value = monthsOverride;
    months.style.width = "90px";
    months.addEventListener("change", () => {
      monthsOverride = months.value;
      renderTotals();
    });

    const add = el("button", { class: "button", type: "button", text: "Add to my budget" });
    add.disabled = !t.categories.length && !(addIncome && t.income > 0);
    add.addEventListener("click", () => {
      const note = (count) => "From your statements: average of " + plural(count, "transaction") + " over " + t.months + " months.";
      const expenses = t.categories.map((x) => ({
        name: x.category + " (from statements)",
        amount: String(Math.round(x.perMonth)),
        every: "month",
        category: B.CATEGORIES.includes(x.category) ? x.category : "Other",
        essential: ESSENTIAL.has(x.category),
        source: "statements",
        note: note(x.count)
      }));
      const income = addIncome && t.income > 0
        ? { name: "Money in (from statements)", amount: String(Math.round(t.income)), every: "month", continues: false, source: "statements", note: note(t.incomeCount) }
        : null;
      B.app.replaceStatementLines(expenses, income);
      status.textContent = "Added " + expenses.length + " spending lines" + (income ? " and your income" : "") + ". Lines added from statements before were replaced.";
      document.getElementById("spending").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const incomeBox = el("input", { type: "checkbox", id: "st-income" });
    incomeBox.checked = addIncome;
    incomeBox.addEventListener("change", () => {
      addIncome = incomeBox.checked;
      renderTotals();
    });
    const status = el("p", { class: "small", role: "status" });

    totalsBox.replaceChildren(...[
      el("p", { class: "small" }, [
        c ? "From " + c.first.toLocaleDateString() + " to " + c.last.toLocaleDateString() + ", about " + c.months + " months. " : "",
        "Use ",
        months,
        " months for the averages. If the statements have gaps (say, January and April only), type the number of months they really cover."
      ]),
      unsure ? el("p", { class: "small is-error", text: plural(unsure, "transaction") + (unsure === 1 ? " has" : " have") + " a guessed direction (shown in red). Check them with the In/out column." }) : null,
      t.categories.length
        ? el("div", { class: "st-totals" }, t.categories.map((x) => el("div", { class: "result" }, [
            el("p", { class: "result__label", text: x.category }),
            el("p", { class: "result__value", text: money(x.perMonth) }),
            el("p", { class: "result__detail", text: "a month, from " + plural(x.count, "transaction") })
          ])))
        : el("p", { class: "small muted", text: "No spending selected yet." }),
      el("div", { class: "st-actions" }, [
        incomeBox,
        el("label", { for: "st-income", class: "small", text: "Also add money coming in as income (" + money(t.income) + " a month). Check it isn't money moved between your own accounts." })
      ]),
      el("div", { class: "st-actions" }, [add]),
      status
    ].filter(Boolean));
  }

  render(true);
})();
