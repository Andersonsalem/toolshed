// Offer math. Text in, numbers out: no page access here.
//
// Assumptions (also listed on the page):
//   - No raises. Bonus counted at the expected amount.
//   - Signing bonus is spread over the years being compared.
//   - Equity counted at its stated value, vesting evenly (cliffs ignored).
//   - Tax: one flat rate on salary, bonus, signing bonus and equity.
//     Retirement contributions and other benefits are not taxed.
(function () {
  "use strict";
  const NS = (window.OfferCompare = window.OfferCompare || {});

  const FIELDS = Object.fromEntries(NS.SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const WEEKS_PER_YEAR = 52;
  const WORKDAYS_PER_WEEK = 5;

  // "85,000" -> 85000, "85k" -> 85000, "1.2m" -> 1200000, "" -> null, junk -> NaN.
  function parseNumber(raw) {
    const s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/[\s,'_$€£¥₹]/g, "");
    if (!s) return null;
    const match = s.match(/^(-?\d*\.?\d+)([km])?$/);
    if (!match) return NaN;
    const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : 1;
    return parseFloat(match[1]) * multiplier;
  }

  // Returns { value, percent } with value null when empty, or { error } when it can't be read.
  function parseField(key, raw) {
    const field = FIELDS[key];
    if (field.type === "text" || field.type === "textarea") return { value: raw || "" };
    const text = String(raw == null ? "" : raw).trim();
    const percent = text.endsWith("%");
    if (percent && field.type !== "moneyOrPercent" && field.type !== "percent") return { error: true };
    const value = parseNumber(percent ? text.slice(0, -1) : text);
    if (Number.isNaN(value) || (value !== null && value < 0)) return { error: true };
    if (field.type === "percent" && value !== null && value > 100) return { error: true };
    return { value, percent };
  }

  // Every input of one offer, read and checked. errors: keys that couldn't be read.
  function readOffer(values) {
    const read = {};
    const errors = [];
    for (const key of Object.keys(FIELDS)) {
      const parsed = parseField(key, values[key]);
      if (parsed.error) errors.push(key);
      read[key] = parsed.error ? { value: null } : parsed;
    }
    return { read, errors };
  }

  // years: how many years to average over (1 = first year).
  function compute(values, years) {
    const { read, errors } = readOffer(values);
    const num = (key) => (read[key].value === null ? FIELDS[key].fallback ?? 0 : read[key].value);
    const base = read.base.value;
    if (base === null || base <= 0) return { complete: false, errors };

    const ofBase = (key) => (read[key].percent ? (base * num(key)) / 100 : num(key));
    const vestYears = Math.max(1, num("vestYears"));

    const parts = {
      base,
      bonus: ofBase("bonus"),
      signing: num("signing") / years,
      equity: (num("equity") * Math.min(years, vestYears)) / vestYears / years,
      benefits: ofBase("match") + num("benefits")
    };
    const total = parts.base + parts.bonus + parts.signing + parts.equity + parts.benefits;
    const taxed = parts.base + parts.bonus + parts.signing + parts.equity;

    const hasTax = read.taxRate.value !== null;
    const tax = hasTax ? (taxed * read.taxRate.value) / 100 : null;
    const afterTax = hasTax ? total - tax : null;
    const living = read.livingCosts.value !== null ? read.livingCosts.value * 12 : null;
    const leftOver = afterTax !== null && living !== null ? afterTax - living : null;

    const weeks = WEEKS_PER_YEAR - num("pto") / WORKDAYS_PER_WEEK;
    const hours = weeks * (num("hours") + num("commute"));
    const perHour = hours > 0 ? total / hours : null;

    return {
      complete: true,
      errors,
      parts,
      total,
      totalWithoutEquity: total - parts.equity,
      tax,
      afterTax,
      living,
      leftOver,
      perHour,
      equityShare: total ? parts.equity / total : 0
    };
  }

  NS.parseField = parseField;
  NS.compute = compute;
})();
