// Weather Planner page: pick a place, read the forecast, find good times.
// Data and planner math are in weather.js; network limits in shared/net.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const W = window.Weather;

  const APP_ID = "weather-planner";
  const store = Store.open(APP_ID, 1);
  const MAX_PLACES = 8;
  const CUSTOM = "custom";

  const $ = (id) => document.getElementById(id);

  // ---------- State ----------

  function defaultUnits() {
    const lang = navigator.language || "";
    return { temp: /^en-US|^en-LR|^my/.test(lang) ? "F" : "C", wind: /^en-(US|GB|LR)/.test(lang) ? "mph" : "kmh" };
  }

  function cleanPlace(p) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
    return { label: String(p.label || "Saved place").slice(0, 120), lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 };
  }

  function cleanCriteria(c, fallback) {
    const n = (v, d) => (Number.isFinite(v) ? v : d);
    c = c || {};
    return {
      min: n(c.min, fallback.min),
      max: n(c.max, fallback.max),
      rainChance: Math.min(100, Math.max(0, n(c.rainChance, fallback.rainChance))),
      wind: Math.max(0, n(c.wind, fallback.wind)),
      daylight: typeof c.daylight === "boolean" ? c.daylight : fallback.daylight,
      hours: Math.min(12, Math.max(1, Math.round(n(c.hours, fallback.hours))))
    };
  }

  const saved = store.load({}) || {};
  const state = {
    places: (Array.isArray(saved.places) ? saved.places : []).map(cleanPlace).filter(Boolean).slice(0, MAX_PLACES),
    current: cleanPlace(saved.current),
    units: saved.units && ["C", "F"].includes(saved.units.temp) && ["kmh", "mph"].includes(saved.units.wind) ? saved.units : defaultUnits(),
    activity: W.ACTIVITIES.some((a) => a.id === saved.activity) || saved.activity === CUSTOM ? saved.activity : "run"
  };
  state.criteria = cleanCriteria(saved.criteria, W.ACTIVITIES.find((a) => a.id === state.activity) || W.ACTIVITIES[0]);

  const save = () => store.save(state);
  let data = null; // the forecast currently shown

  // ---------- Formatting ----------

  // Open-Meteo gives times as the place's own wall-clock time ("2026-10-31T14:00").
  function wall(time) {
    const [d, t] = time.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [h, min] = (t || "00:00").split(":").map(Number);
    return new Date(y, m - 1, day, h, min);
  }
  const clock = (time) => wall(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const weekday = (date, style) => wall(date + "T12:00").toLocaleDateString(undefined, { weekday: style || "long" });
  const dayMonth = (date) => wall(date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  function dayName(date, index) {
    if (index === 0) return "Today";
    if (index === 1) return "Tomorrow";
    return weekday(date);
  }

  const deg = (c) => Math.round(W.temp(c, state.units)) + "°";
  const speed = (kmh) => Math.round(W.speed(kmh, state.units)) + (state.units.wind === "mph" ? " mph" : " km/h");

  // ---------- Messages ----------

  function whereMessage(text, isError) {
    $("where-message").textContent = text;
    $("where-message").className = "small" + (isError ? " is-error" : " muted");
    $("where-message").hidden = !text;
  }
  function forecastMessage(text) {
    $("forecast-message").textContent = text;
    $("forecast-message").hidden = !text;
  }

  // ---------- Places ----------

  function samePlace(a, b) {
    return a && b && a.lat === b.lat && a.lon === b.lon;
  }

  function choose(place) {
    state.current = place;
    state.places = [place].concat(state.places.filter((p) => !samePlace(p, place))).slice(0, MAX_PLACES);
    save();
    $("results").hidden = true;
    renderPlaces();
    load();
  }

  function renderPlaces() {
    $("places").replaceChildren(
      ...state.places.map((p) => {
        const go = el("button", { class: "place__go", type: "button", text: p.label });
        go.addEventListener("click", () => choose(p));
        const remove = el("button", { class: "place__remove", type: "button", "aria-label": "Forget " + p.label, title: "Forget this place", text: "✕" });
        remove.addEventListener("click", () => {
          state.places = state.places.filter((x) => x !== p);
          save();
          renderPlaces();
        });
        return el("span", { class: "place" + (samePlace(p, state.current) ? " is-current" : "") }, [go, remove]);
      })
    );
  }

  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("search").value.trim();
    if (text.length < 2) return whereMessage("Type at least two letters of a place name.", true);
    whereMessage("Searching…");
    let results;
    try {
      results = await W.search(text);
    } catch (error) {
      return whereMessage(error.message, true);
    }
    if (!results.length) return whereMessage("No places found for “" + text + "”. Check the spelling, or try a nearby larger town.", true);
    whereMessage("");
    $("results").hidden = false;
    $("results").replaceChildren(
      ...results.map((r) => {
        const label = [r.name, r.region, r.country].filter(Boolean).join(", ");
        const b = el("button", { type: "button" }, [el("strong", { text: r.name }), el("span", { class: "muted", text: " " + [r.region, r.country].filter(Boolean).join(", ") })]);
        b.addEventListener("click", () => choose({ label: r.name + (r.country ? ", " + r.country : ""), lat: r.lat, lon: r.lon, full: label }));
        return el("li", {}, [b]);
      })
    );
  });

  $("locate").addEventListener("click", () => {
    if (!navigator.geolocation) return whereMessage("This browser can't share your location. Search for your town instead.", true);
    whereMessage("Asking your browser for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        whereMessage("");
        // Rounded to about 1 km before anything is sent.
        choose(cleanPlace({ label: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude }));
      },
      (err) => whereMessage(err.code === 1 ? "Location access was declined. You can search for your town instead." : "Your location couldn't be found. Search for your town instead.", true),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    );
  });

  // ---------- Forecast ----------

  async function load() {
    if (!state.current) return;
    forecastMessage("Getting the forecast for " + state.current.label + "…");
    try {
      data = await W.forecast(state.current.lat, state.current.lon);
    } catch (error) {
      data = null;
      $("forecast").hidden = true;
      return forecastMessage(error.message);
    }
    forecastMessage("");
    $("forecast").hidden = false;
    render();
  }

  function render() {
    if (!data) return;
    renderNow();
    renderDays();
    renderPlan();
  }

  function renderNow() {
    const n = data.now;
    const d = W.describe(n.code, n.day);
    $("now-title").textContent = state.current.label;
    $("updated").textContent = "Local time there: " + clock(n.time || data.hours[data.nowIndex].time) + (data.timezone ? " (" + data.timezone + ")" : "");
    $("now").replaceChildren(
      el("span", { class: "now__icon", "aria-hidden": "true", text: d.icon }),
      el("span", { class: "now__temp", text: deg(n.temp) }),
      el("div", { class: "now__text" }, [
        el("p", { text: d.text }),
        el("p", { text: "Feels like " + deg(n.feels) + " · Wind " + speed(n.wind) + " · Chance of rain " + n.rainChance + "%" })
      ])
    );
    const next = data.hours.slice(data.nowIndex, data.nowIndex + 24);
    $("hours").replaceChildren(
      ...next.map((h, i) => {
        const dsc = W.describe(h.code, h.day);
        return el("div", { class: "hour", title: dsc.text + ", feels like " + deg(h.feels) + ", wind " + speed(h.wind) }, [
          el("span", { text: i === 0 ? "Now" : clock(h.time) }),
          el("span", { class: "hour__icon", role: "img", "aria-label": dsc.text, text: dsc.icon }),
          el("span", { class: "hour__temp", text: deg(h.temp) }),
          el("span", { class: "hour__rain", text: h.rainChance + "% rain" })
        ]);
      })
    );
  }

  function renderDays() {
    $("days").replaceChildren(
      ...data.days.map((d, i) => {
        const dsc = W.describe(d.code, true);
        const detail = [
          dsc.text,
          "rain " + d.rainChance + "%" + (d.rain >= 0.1 ? " (" + d.rain.toFixed(1) + " mm)" : ""),
          "wind up to " + speed(d.wind),
          d.uv >= 6 ? "UV " + Math.round(d.uv) + ", high" : ""
        ].filter(Boolean).join(" · ");
        return el("li", { class: "day" }, [
          el("span", { class: "day__name", text: dayName(d.date, i) }),
          el("span", { class: "day__icon", role: "img", "aria-label": dsc.text, text: dsc.icon }),
          el("span", { class: "day__detail", text: detail }),
          el("span", { class: "day__temps" }, [el("strong", { text: deg(d.max) }), el("span", { class: "muted", text: deg(d.min) })])
        ]);
      })
    );
  }

  // ---------- Planner ----------

  function renderCriteria() {
    const c = state.criteria;
    const t = (v) => Math.round(W.temp(v, state.units));
    $("c-min").value = t(c.min);
    $("c-max").value = t(c.max);
    $("c-rain").value = c.rainChance;
    $("c-wind").value = Math.round(W.speed(c.wind, state.units));
    $("c-hours").value = c.hours;
    $("c-daylight").checked = c.daylight;
    document.querySelectorAll(".unit-t").forEach((n) => (n.textContent = "°" + state.units.temp));
    document.querySelectorAll(".unit-w").forEach((n) => (n.textContent = state.units.wind === "mph" ? "mph" : "km/h"));
    $("activity").value = state.activity;
  }

  function slotText(slot) {
    const hs = data.hours.slice(slot.start, slot.end);
    const first = hs[0];
    const endTime = data.hours[slot.end] ? data.hours[slot.end].time : null;
    const date = first.time.slice(0, 10);
    const dayIndex = data.days.findIndex((d) => d.date === date);
    const when = dayName(date, dayIndex) + (dayIndex > 1 ? " " + dayMonth(date) : "") + ", " + clock(first.time) + (endTime ? "–" + clock(endTime) : "");
    const feels = hs.map((h) => h.feels);
    const lo = Math.min(...feels), hi = Math.max(...feels);
    const detail = "Feels like " + (Math.round(W.temp(lo, state.units)) === Math.round(W.temp(hi, state.units)) ? deg(lo) : deg(lo) + "–" + deg(hi)) +
      " · rain chance up to " + Math.max(...hs.map((h) => h.rainChance)) + "% · wind up to " + speed(Math.max(...hs.map((h) => h.wind)));
    return { when, detail, far: dayIndex >= 3 };
  }

  const REASON_TEXT = { cold: "too cold", hot: "too hot", rain: "too likely to rain", wind: "too windy" };

  function renderPlan() {
    const a = state.criteria;
    const { slots, ok, reasons } = W.windows(data.hours, a, data.nowIndex, 5);

    if (slots.length) {
      $("slots").replaceChildren(
        el("ol", { class: "slots" }, slots.map((s, i) => {
          const t = slotText(s);
          return el("li", { class: "slot" + (i === 0 ? " slot--best" : "") }, [
            el("p", { class: "slot__when", text: t.when }),
            el("p", { class: "slot__detail", text: t.detail + (t.far ? " · a few days out, so check again closer to the time" : "") })
          ]);
        }))
      );
    } else {
      const top = Object.entries(reasons).sort((x, y) => y[1] - x[1]).slice(0, 2);
      $("slots").replaceChildren(
        el("p", { class: "plan-note", text:
          "Nothing fits in the next 7 days." +
          (top.length ? " Most hours are " + top.map(([k, n]) => REASON_TEXT[k] + " (" + n + " hours)").join(" or ") + "." : "") +
          " Try loosening the conditions above, or fewer hours." })
      );
    }
    renderGrid(ok, slots);
  }

  function renderGrid(ok, slots) {
    const inSlot = new Set();
    for (const s of slots) for (let i = s.start; i < s.end; i++) inSlot.add(i);
    const cells = [el("span")];
    for (let h = 0; h < 24; h++) cells.push(el("span", { class: "hour-label", text: h % 6 === 0 ? String(h) : "" }));
    data.days.forEach((d, di) => {
      cells.push(el("span", { class: "label", text: weekday(d.date, "short") }));
      for (let h = 0; h < 24; h++) {
        const index = di * 24 + h;
        const hour = data.hours[index];
        if (!hour) {
          cells.push(el("span"));
          continue;
        }
        const problem = W.problem(hour, state.criteria);
        const past = index < data.nowIndex;
        const kind = problem === "dark" ? "dark" : ok[index] || (!past && !problem) ? "good" : "bad";
        const label = weekday(d.date, "short") + " " + clock(hour.time) + ": feels like " + deg(hour.feels) + ", rain " + hour.rainChance + "%, wind " + speed(hour.wind) +
          (past ? " (past)" : problem ? ", " + (REASON_TEXT[problem] || "dark") : ", suits");
        cells.push(el("span", { class: "cell cell--" + kind + (past ? " cell--past" : "") + (inSlot.has(index) ? " cell--slot" : ""), title: label }));
      }
    });
    $("grid").replaceChildren(
      el("div", { class: "week-grid", role: "img", "aria-label": "Hours that suit over the next 7 days. The list above gives the best times as text." }, cells),
      el("ul", { class: "grid-legend" }, [
        el("li", {}, [el("span", { class: "cell cell--good" }), "Suits"]),
        el("li", {}, [el("span", { class: "cell" }), "Doesn't suit"]),
        state.criteria.daylight ? el("li", {}, [el("span", { class: "cell cell--dark" }), "Dark"]) : null,
        el("li", {}, [el("span", { class: "cell cell--good cell--slot" }), "Best times above"])
      ])
    );
  }

  // ---------- Controls ----------

  $("activity").replaceChildren(
    ...W.ACTIVITIES.map((a) => el("option", { value: a.id, text: a.name })),
    el("option", { value: CUSTOM, text: "Something else (my own conditions)" })
  );
  $("activity").addEventListener("change", (e) => {
    state.activity = e.target.value;
    const preset = W.ACTIVITIES.find((a) => a.id === state.activity);
    if (preset) state.criteria = cleanCriteria(preset, preset);
    save();
    renderCriteria();
    if (data) renderPlan();
  });

  // Typed values are converted back to °C and km/h for storing.
  const criteriaInputs = {
    "c-min": (v) => (state.criteria.min = W.tempBack(v, state.units)),
    "c-max": (v) => (state.criteria.max = W.tempBack(v, state.units)),
    "c-rain": (v) => (state.criteria.rainChance = Math.min(100, Math.max(0, v))),
    "c-wind": (v) => (state.criteria.wind = Math.max(0, W.speedBack(v, state.units))),
    "c-hours": (v) => (state.criteria.hours = Math.min(12, Math.max(1, Math.round(v))))
  };
  for (const [id, apply] of Object.entries(criteriaInputs)) {
    $(id).addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      apply(v);
      state.activity = CUSTOM;
      $("activity").value = CUSTOM;
      save();
      if (data) renderPlan();
    });
  }
  $("c-daylight").addEventListener("change", (e) => {
    state.criteria.daylight = e.target.checked;
    state.activity = CUSTOM;
    $("activity").value = CUSTOM;
    save();
    if (data) renderPlan();
  });

  $("unit-temp").addEventListener("change", (e) => {
    state.units.temp = e.target.value;
    save();
    renderCriteria();
    render();
  });
  $("unit-wind").addEventListener("change", (e) => {
    state.units.wind = e.target.value;
    save();
    renderCriteria();
    render();
  });

  Net.tidy(24 * 60);
  $("unit-temp").value = state.units.temp;
  $("unit-wind").value = state.units.wind;
  renderCriteria();
  renderPlaces();
  if (state.current) load();
})();
