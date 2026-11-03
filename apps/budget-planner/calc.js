// Budget math. Values in, numbers out: no page access here.
//
// Assumptions (also shown on the page):
//   - Amounts are converted to a monthly figure from how often they happen.
//   - Runway: savings shrink by spending minus the income that would continue.
//     No interest is earned on savings, and prices don't change.
//   - Debts: interest is charged monthly at the yearly rate / 12, and payments
//     are made at the end of each month. Fees and rate changes aren't modelled.
(function () {
  "use strict";
  const NS = (window.Budget = window.Budget || {});

  NS.FREQUENCIES = [
    { id: "month", label: "per month", perMonth: 1 },
    { id: "week", label: "per week", perMonth: 52 / 12 },
    { id: "2weeks", label: "every 2 weeks", perMonth: 26 / 12 },
    { id: "quarter", label: "per quarter", perMonth: 1 / 3 },
    { id: "year", label: "per year", perMonth: 1 / 12 }
  ];
  const PER_MONTH = Object.fromEntries(NS.FREQUENCIES.map((f) => [f.id, f.perMonth]));

  NS.CATEGORIES = [
    "Housing", "Utilities", "Groceries", "Transport", "Insurance", "Health", "Phone & internet",
    "Subscriptions", "Eating out", "Shopping", "Entertainment", "Children", "Pets", "Gifts & giving",
    "Travel", "Education", "Other"
  ];

  const MAX_MONTHS = 600; // 50 years: anything longer is treated as "never"

  // "1,250.50" -> 1250.5, "2k" -> 2000, "" -> null, junk or negative -> NaN.
  NS.parseAmount = function (raw) {
    const s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/[\s,'_$€£¥₹]/g, "");
    if (!s) return null;
    const m = s.match(/^(\d*\.?\d+)(k|m)?$/);
    if (!m) return NaN;
    return parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  };

  const num = (raw) => {
    const v = NS.parseAmount(raw);
    return Number.isFinite(v) ? v : 0;
  };

  NS.monthly = (item) => num(item.amount) * (PER_MONTH[item.every] || 1);

  NS.summarize = function (state) {
    const sum = (list) => list.reduce((total, item) => total + NS.monthly(item), 0);
    const income = sum(state.income);
    const kept = sum(state.income.filter((i) => i.continues));
    const expenses = sum(state.expenses);
    const essentials = sum(state.expenses.filter((e) => e.essential));
    const debtMinimums = state.debts.reduce((total, d) => total + (num(d.balance) > 0 ? num(d.minimum) : 0), 0);
    const spending = expenses + debtMinimums;
    return {
      income,
      kept,
      expenses,
      essentials,
      debtMinimums,
      spending,
      leftOver: income - spending,
      savingsRate: income > 0 ? (income - spending) / income : null
    };
  };

  // How long savings last if only "continues" income comes in.
  // Returns { burn (per month), months (Infinity if they don't shrink), balances: [...] }.
  NS.runway = function (state, essentialsOnly) {
    const s = NS.summarize(state);
    const start = num(state.savings) + num(state.extraCash);
    const burn = (essentialsOnly ? s.essentials : s.expenses) + s.debtMinimums - s.kept;
    const months = burn > 0 ? start / burn : Infinity;
    const length = Number.isFinite(months) ? Math.min(Math.ceil(months) + 1, 120) : 24;
    const balances = Array.from({ length: length + 1 }, (_, m) => Math.max(0, start - burn * m));
    return { start, burn, months, balances };
  };

  // Pays debts down month by month. method: "avalanche" (highest rate first)
  // or "snowball" (smallest balance first). Extra money goes to the target
  // debt; when one is paid off, its payment rolls on to the next.
  NS.payoff = function (state, method) {
    const debts = state.debts
      .map((d) => ({ name: d.name || "Debt", balance: num(d.balance), rate: num(d.rate), minimum: num(d.minimum), month: null }))
      .filter((d) => d.balance > 0);
    if (!debts.length) return null;

    const budget = debts.reduce((t, d) => t + d.minimum, 0) + num(state.debtExtra);
    let interest = 0;
    let month = 0;
    while (debts.some((d) => d.balance > 0.005) && month < MAX_MONTHS) {
      month += 1;
      for (const d of debts) {
        if (d.balance <= 0.005) continue;
        const charge = (d.balance * d.rate) / 100 / 12;
        d.balance += charge;
        interest += charge;
      }
      let available = budget;
      for (const d of debts) {
        if (d.balance <= 0.005) continue;
        const pay = Math.min(d.minimum, d.balance, available);
        d.balance -= pay;
        available -= pay;
      }
      const order = debts
        .filter((d) => d.balance > 0.005)
        .sort((a, b) => (method === "snowball" ? a.balance - b.balance : b.rate - a.rate || a.balance - b.balance));
      for (const d of order) {
        if (available <= 0) break;
        const pay = Math.min(d.balance, available);
        d.balance -= pay;
        available -= pay;
      }
      for (const d of debts) if (d.balance <= 0.005 && d.month === null) d.month = month;
    }
    const finished = debts.every((d) => d.month !== null);
    return { finished, months: finished ? month : null, interest, debts: debts.map((d) => ({ name: d.name, month: d.month })) };
  };

  // Months from this month to the target month (inclusive of the target month).
  function monthsUntil(target, today) {
    const m = String(target || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return (Number(m[1]) - today.getFullYear()) * 12 + (Number(m[2]) - 1 - today.getMonth()) + 1;
  }

  NS.goals = function (state, today) {
    return state.goals.map((g) => {
      const target = num(g.target);
      const saved = num(g.saved);
      const left = Math.max(0, target - saved);
      const months = monthsUntil(g.by, today || new Date());
      // perMonth is null until there's both a target and a future date.
      return {
        id: g.id,
        name: g.name || "Goal",
        left,
        months,
        perMonth: target > 0 && months !== null && months > 0 ? left / months : null,
        done: target > 0 && left === 0,
        passed: months !== null && months <= 0 && left > 0
      };
    });
  };

  // Moves through whole months on the 1st, then sets the day: going from
  // 31 October by 6 months must give 30 April, not roll over into May.
  NS.addMonths = function (date, months) {
    const whole = Math.floor(months);
    const d = new Date(date.getFullYear(), date.getMonth() + whole, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(date.getDate(), lastDay));
    d.setDate(d.getDate() + Math.round((months - whole) * 30));
    return d;
  };
})();
