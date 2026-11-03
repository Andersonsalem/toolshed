// What people enter for each offer, grouped into sections, in display order.
// calc.js reads values by key. Types:
//   text, textarea       free text
//   money                an amount ("85000", "85,000", "85k")
//   moneyOrPercent       an amount, or a percent of base salary ("10%")
//   percent              a percent ("28" or "28%")
//   number               a plain number (hours, days, years)
// "fallback" is what the calculation uses when the box is left empty.
(window.OfferCompare = window.OfferCompare || {}).SECTIONS = [
  {
    title: "Pay",
    open: true,
    fields: [
      { key: "base", label: "Base salary per year", type: "money", placeholder: "e.g. 95000 or 95k" },
      { key: "bonus", label: "Expected bonus per year", type: "moneyOrPercent", placeholder: "e.g. 8000 or 10%", hint: "An amount, or a percent of base." },
      { key: "signing", label: "Signing bonus (one time)", type: "money", placeholder: "e.g. 10000" }
    ]
  },
  {
    title: "Equity and benefits",
    open: false,
    fields: [
      { key: "equity", label: "Equity grant, total value", type: "money", placeholder: "e.g. 120000", hint: "What it's said to be worth today, for the whole grant." },
      { key: "vestYears", label: "Vesting period (years)", type: "number", placeholder: "4", fallback: 4 },
      { key: "match", label: "Retirement contribution per year", type: "moneyOrPercent", placeholder: "e.g. 4%", hint: "What the employer adds. An amount, or a percent of base." },
      { key: "benefits", label: "Other benefits per year", type: "money", placeholder: "e.g. 2000", hint: "Stipends, allowances, lower health costs…" }
    ]
  },
  {
    title: "Your situation",
    open: false,
    fields: [
      { key: "taxRate", label: "Estimated tax rate", type: "percent", placeholder: "e.g. 28%", hint: "Your overall rate on this income in this location. An official tax calculator for the location can tell you." },
      { key: "livingCosts", label: "Living costs per month", type: "money", placeholder: "e.g. 2500", hint: "Rent and other costs if you lived where this job is." },
      { key: "hours", label: "Work hours per week", type: "number", placeholder: "40", fallback: 40 },
      { key: "commute", label: "Commute hours per week", type: "number", placeholder: "0", fallback: 0 },
      { key: "pto", label: "Paid days off per year", type: "number", placeholder: "e.g. 25", fallback: 0 }
    ]
  },
  {
    title: "Notes",
    open: false,
    fields: [{ key: "notes", label: "Notes", type: "textarea", placeholder: "Remote policy, growth, team, anything else…" }]
  }
];
