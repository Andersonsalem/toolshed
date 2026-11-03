// Offer Comparator page: offer cards in, comparison out. Math lives in calc.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const OC = window.OfferCompare;

  const APP_ID = "offer-compare";
  const store = Store.open(APP_ID, 1);

  const MAX_OFFERS = 5;
  const MAX_YEARS = 5;
  const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "INR", "SGD", "JPY", "BRL", "MXN", "ZAR"];
  const FIELD_KEYS = ["name"].concat(OC.SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));

  // Parts of total pay, in chart and table order.
  const PARTS = [
    { key: "base", label: "Base salary" },
    { key: "bonus", label: "Bonus" },
    { key: "signing", label: "Signing bonus" },
    { key: "equity", label: "Equity" },
    { key: "benefits", label: "Retirement and benefits" }
  ];

  const EXAMPLE = [
    { name: "Startup (example)", base: "110k", equity: "280k", vestYears: "4", benefits: "1000", taxRate: "30%", livingCosts: "3200", hours: "45", pto: "15" },
    { name: "Enterprise (example)", base: "125k", bonus: "10%", signing: "15k", equity: "40k", vestYears: "4", match: "4%", benefits: "2000", taxRate: "30%", livingCosts: "2600", hours: "40", commute: "5", pto: "25" }
  ];

  const $ = (id) => document.getElementById(id);

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function blankOffer() {
    return { id: newId(), values: {} };
  }

  // ---------- State ----------

  function cleanState(raw) {
    const offers = (Array.isArray(raw && raw.offers) ? raw.offers : [])
      .filter((o) => o && typeof o === "object")
      .slice(0, MAX_OFFERS)
      .map((o) => {
        const values = {};
        for (const key of FIELD_KEYS) {
          if (o.values && typeof o.values[key] === "string") values[key] = o.values[key].slice(0, 5000);
        }
        return { id: typeof o.id === "string" ? o.id : newId(), values };
      });
    while (offers.length < 2) offers.push(blankOffer());
    return {
      currency: CURRENCIES.includes(raw && raw.currency) ? raw.currency : "USD",
      years: Number.isInteger(raw && raw.years) && raw.years >= 1 && raw.years <= MAX_YEARS ? raw.years : 1,
      offers
    };
  }

  let state = cleanState(store.load(null));

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(state), 300);
  }

  function offerName(offer, index) {
    return (offer.values.name || "").trim() || "Offer " + String.fromCharCode(65 + index);
  }

  // ---------- Formatting ----------

  function money(value, cents) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: state.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: cents ? 2 : 0
      }).format(value);
    } catch (e) {
      return Math.round(value).toLocaleString();
    }
  }

  // ---------- Offer cards ----------

  function fieldInput(offer, field) {
    const id = offer.id + "-" + field.key;
    const attrs = { id, name: field.key, autocomplete: "off" };
    if (field.placeholder) attrs.placeholder = field.placeholder;
    let input;
    if (field.type === "textarea") {
      input = el("textarea", attrs);
    } else {
      if (field.type !== "text") attrs.inputmode = "decimal";
      input = el("input", attrs);
    }
    input.value = offer.values[field.key] || "";

    const error = el("small", { class: "field-error", id: id + "-error", hidden: "" });
    const check = () => {
      const bad = !!OC.parseField(field.key, input.value).error;
      input.setAttribute("aria-invalid", bad ? "true" : "false");
      error.hidden = !bad;
      error.textContent = bad ? errorText(field) : "";
      if (bad) input.setAttribute("aria-describedby", error.id);
      else input.removeAttribute("aria-describedby");
    };
    input.addEventListener("input", () => {
      offer.values[field.key] = input.value;
      check();
      save();
      renderResults();
    });
    check();

    return el("div", {}, [
      el("label", { for: id, text: field.label }),
      input,
      field.hint ? el("small", { text: field.hint }) : null,
      error
    ]);
  }

  function errorText(field) {
    if (field.type === "percent") return "Use a percent between 0 and 100, like 28 or 28%.";
    if (field.type === "moneyOrPercent") return "Use an amount like 8000 or 8k, or a percent like 10%.";
    if (field.type === "number") return "Use a number, like 40.";
    return "Use an amount, like 95000 or 95k.";
  }

  function offerCard(offer, index) {
    const nameInput = el("input", {
      class: "offer__name",
      "aria-label": "Name of offer " + (index + 1),
      placeholder: "Offer " + String.fromCharCode(65 + index),
      maxlength: "80"
    });
    nameInput.value = offer.values.name || "";
    nameInput.addEventListener("input", () => {
      offer.values.name = nameInput.value;
      save();
      renderResults();
    });

    const remove = el("button", { class: "offer__remove", type: "button", "aria-label": "Remove " + offerName(offer, index), title: "Remove this offer", text: "✕" });
    remove.addEventListener("click", () => removeOffer(offer, index));
    remove.disabled = state.offers.length <= 1;

    const sections = OC.SECTIONS.map((section) => {
      const fields = el("div", { class: "offer-fields" }, section.fields.map((f) => fieldInput(offer, f)));
      if (section.open) {
        return el("div", { class: "offer-section" }, [el("h3", { class: "offer-section__title", text: section.title }), fields]);
      }
      const details = el("details", { class: "offer-section" }, [el("summary", { text: section.title }), fields]);
      // Open sections that already have something in them, so nothing is hidden.
      if (section.fields.some((f) => (offer.values[f.key] || "").trim())) details.open = true;
      return details;
    });

    return el("article", { class: "card offer", "aria-label": offerName(offer, index) }, [
      el("div", { class: "offer__head" }, [nameInput, remove]),
      ...sections
    ]);
  }

  function renderOffers() {
    $("offers").replaceChildren(...state.offers.map(offerCard));
    $("add-offer").hidden = state.offers.length >= MAX_OFFERS;
  }

  function removeOffer(offer, index) {
    const hasData = Object.values(offer.values).some((v) => (v || "").trim());
    if (hasData && !confirm("Remove " + offerName(offer, index) + "?")) return;
    state.offers = state.offers.filter((o) => o !== offer);
    save();
    renderOffers();
    renderResults();
  }

  // ---------- Results ----------

  // Index of the highest value, or -1 if fewer than two offers have one or they tie.
  function bestIndex(values) {
    const present = values.map((v, i) => [v, i]).filter(([v]) => v !== null && v !== undefined);
    if (present.length < 2) return -1;
    present.sort((a, b) => b[0] - a[0]);
    return present[0][0] - present[1][0] >= 1 ? present[0][1] : -1;
  }

  function renderResults() {
    const results = state.offers.map((offer, i) => ({ name: offerName(offer, i), r: OC.compute(offer.values, state.years) }));
    const complete = results.filter((x) => x.r.complete);

    $("results-hint").textContent =
      complete.length === 0
        ? "Enter a base salary for at least one offer to see the comparison."
        : complete.length === 1
          ? "Add a base salary to another offer to compare them."
          : "";
    $("results-hint").hidden = complete.length >= 2;
    $("breakdown").hidden = complete.length === 0;
    $("table-wrap").hidden = complete.length === 0;

    renderInsights(complete);
    if (complete.length) {
      renderBars(complete);
      renderTable(results);
    }
  }

  function renderInsights(complete) {
    const items = [];
    if (complete.length >= 2) {
      const ranked = (get) => complete.filter((x) => get(x.r) !== null).sort((a, b) => get(b.r) - get(a.r));
      const lead = (list, get) => {
        if (list.length < 2) return null;
        const gap = get(list[0].r) - get(list[1].r);
        return gap >= 1 ? { top: list[0], next: list[1], gap } : null;
      };
      const period = state.years === 1 ? "in the first year" : "per year on average";

      const total = lead(ranked((r) => r.total), (r) => r.total);
      if (total) {
        items.push({ text: total.top.name + " pays the most in total: " + money(total.gap) + " more than " + total.next.name + " " + period + "." });
      } else {
        items.push({ text: "The top offers pay about the same in total." });
      }

      const noEquity = lead(ranked((r) => r.totalWithoutEquity), (r) => r.totalWithoutEquity);
      if (total && noEquity && noEquity.top !== total.top) {
        items.push({
          warning: true,
          text:
            total.top.name + " is only ahead because of equity. Without it, " + noEquity.top.name + " pays " +
            money(noEquity.gap) + " more per year. Equity isn't cash: its value can change, and private company equity can end up worth nothing."
        });
      }

      const left = lead(ranked((r) => r.leftOver), (r) => r.leftOver);
      if (left && (!total || left.top !== total.top)) {
        items.push({ text: "After tax and living costs, " + left.top.name + " leaves you the most: " + money(left.gap) + " more per year than " + left.next.name + "." });
      }

      const hourly = lead(ranked((r) => r.perHour), (r) => r.perHour);
      if (hourly && (!total || hourly.top !== total.top)) {
        items.push({ text: "Counting work hours, commute and days off, " + hourly.top.name + " pays the most per hour of your time." });
      }
    }
    $("insights").replaceChildren(...items.map((i) => el("li", { class: i.warning ? "is-warning" : "", text: i.text })));
  }

  function renderBars(complete) {
    const max = Math.max(...complete.map((x) => x.r.total));
    const used = PARTS.filter((p) => complete.some((x) => x.r.parts[p.key] > 0));
    $("legend").replaceChildren(
      ...used.map((p) => el("li", {}, [el("span", { class: "swatch seg-" + p.key, "aria-hidden": "true" }), p.label]))
    );
    $("bars").replaceChildren(
      ...complete.map((x) => {
        const segments = used
          .filter((p) => x.r.parts[p.key] > 0)
          .map((p) => {
            const span = el("span", { class: "seg-" + p.key, title: p.label + ": " + money(x.r.parts[p.key]) });
            span.style.width = (x.r.parts[p.key] / max) * 100 + "%";
            return span;
          });
        const description = used.filter((p) => x.r.parts[p.key] > 0).map((p) => p.label + " " + money(x.r.parts[p.key])).join(", ");
        return el("div", { class: "bar-row" }, [
          el("p", {}, [el("span", { text: x.name }), el("span", { text: money(x.r.total) })]),
          el("div", { class: "bar", role: "img", "aria-label": x.name + ": " + description }, segments)
        ]);
      })
    );
  }

  function renderTable(results) {
    const years = state.years;
    const any = (get) => results.some((x) => x.r.complete && get(x.r));
    const rows = [
      ...PARTS.map((p) => ({
        label: p.label,
        note: p.key === "signing" && years > 1 ? "spread over " + years + " years" : p.key === "equity" ? "the part that vests, per year" : "",
        get: (r) => r.parts[p.key],
        show: p.key === "base" || any((r) => r.parts[p.key] > 0)
      })),
      { label: "Total pay", get: (r) => r.total, total: true, best: true, show: true },
      { label: "Total without equity", get: (r) => r.totalWithoutEquity, best: true, show: any((r) => r.parts.equity > 0) },
      { label: "Estimated tax", get: (r) => r.tax, minus: true, show: any((r) => r.tax !== null) },
      { label: "After tax", get: (r) => r.afterTax, total: true, best: true, show: any((r) => r.afterTax !== null) },
      { label: "Living costs", get: (r) => r.living, minus: true, show: any((r) => r.living !== null) },
      { label: "Left over", note: "after tax and living costs", get: (r) => r.leftOver, total: true, best: true, show: any((r) => r.leftOver !== null) },
      { label: "Total pay per hour of your time", note: "including commute", get: (r) => r.perHour, cents: true, best: true, show: any((r) => r.perHour !== null) }
    ].filter((row) => row.show);

    $("table-head").replaceChildren(
      el("th", { scope: "col", text: years === 1 ? "First year" : "Per year, " + years + "-year average" }),
      ...results.map((x) => el("th", { scope: "col" }, [x.name, x.r.complete ? null : el("small", { text: "needs a base salary" })]))
    );

    $("table-body").replaceChildren(
      ...rows.map((row) => {
        const values = results.map((x) => (x.r.complete ? row.get(x.r) : null));
        const best = row.best ? bestIndex(values) : -1;
        return el("tr", { class: (row.total ? "is-total " : "") + (row.minus ? "is-minus" : "") }, [
          el("th", { scope: "row" }, [row.label, row.note ? el("span", { class: "row-note", text: row.note }) : null]),
          ...values.map((v, i) =>
            el("td", { class: i === best ? "is-best" : "" }, [
              v === null || v === undefined ? "–" : (row.minus ? "−" : "") + money(v, row.cents),
              i === best ? el("span", { class: "best-mark", text: "Highest" }) : null
            ])
          )
        ]);
      })
    );
  }

  // ---------- Controls ----------

  for (const code of CURRENCIES) $("currency").append(el("option", { value: code, text: code }));
  for (let y = 1; y <= MAX_YEARS; y++) {
    $("years").append(el("option", { value: String(y), text: y === 1 ? "First year" : "Average of first " + y + " years" }));
  }

  $("currency").addEventListener("change", (e) => {
    state.currency = e.target.value;
    save();
    renderResults();
  });
  $("years").addEventListener("change", (e) => {
    state.years = Number(e.target.value);
    save();
    renderResults();
  });

  $("add-offer").addEventListener("click", () => {
    if (state.offers.length >= MAX_OFFERS) return;
    state.offers.push(blankOffer());
    save();
    renderOffers();
    renderResults();
    const cards = $("offers").querySelectorAll(".offer__name");
    cards[cards.length - 1].focus();
  });

  function hasAnyData() {
    return state.offers.some((o) => Object.values(o.values).some((v) => (v || "").trim()));
  }

  $("example").addEventListener("click", () => {
    if (hasAnyData() && !confirm("Replace your offers with the example? What you've entered will be lost.")) return;
    state.offers = EXAMPLE.map((values) => ({ id: newId(), values: { ...values } }));
    save();
    renderOffers();
    renderResults();
  });

  $("clear").addEventListener("click", () => {
    if (hasAnyData() && !confirm("Clear all offers? This can't be undone.")) return;
    state.offers = [blankOffer(), blankOffer()];
    save();
    renderOffers();
    renderResults();
  });

  // Save straight away if the page is closed during the short save delay.
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    store.save(state);
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  $("currency").value = state.currency;
  $("years").value = String(state.years);
  renderOffers();
  renderResults();
})();
