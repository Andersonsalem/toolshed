// The Calendar and Progress views. Data and totals are in data.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const Fit = window.Fit;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString();

  // ---------- Calendar ----------

  let month = Fit.today().slice(0, 7); // "YYYY-MM"

  function shiftMonth(by) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + by, 1);
    month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    Fit.renderCalendar();
  }

  Fit.renderCalendar = function () {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    const today = Fit.today();

    const byDay = new Map();
    for (const w of Fit.state.workouts) if (w.date.startsWith(month)) (byDay.get(w.date) || byDay.set(w.date, { w: [], kcal: 0 }).get(w.date)).w.push(w);
    for (const f of Fit.state.foods) if (f.date.startsWith(month)) (byDay.get(f.date) || byDay.set(f.date, { w: [], kcal: 0 }).get(f.date)).kcal += f.kcal;

    const names = [];
    for (let i = 0; i < 7; i++) names.push(el("div", { class: "cal__dow", text: new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }) }));
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el("div", { class: "cal__day cal__day--empty" }));
    let doneCount = 0, minutes = 0;
    for (let d = 1; d <= days; d++) {
      const date = month + "-" + String(d).padStart(2, "0");
      const info = byDay.get(date) || { w: [], kcal: 0 };
      const done = info.w.filter((w) => !w.planned);
      const planned = info.w.filter((w) => w.planned);
      doneCount += done.length;
      minutes += done.reduce((t, w) => t + w.minutes, 0);
      const label = [
        new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
        done.length ? done.map((w) => w.type).join(", ") : "",
        planned.length ? "planned: " + planned.map((w) => w.type).join(", ") : "",
        info.kcal ? fmt(info.kcal) + " kcal logged" : ""
      ].filter(Boolean).join(". ");
      const cell = el("button", { class: "cal__day" + (date === today ? " is-today" : "") + (date === Fit.day ? " is-selected" : ""), type: "button", "aria-label": label }, [
        el("span", { class: "cal__num", text: String(d) }),
        el("span", { class: "cal__marks", "aria-hidden": "true" }, [
          ...done.slice(0, 3).map((w) => el("span", { class: "dot", title: w.type })),
          ...planned.slice(0, 3).map((w) => el("span", { class: "dot dot--planned", title: w.type + " (planned)" }))
        ]),
        info.kcal ? el("span", { class: "cal__kcal", "aria-hidden": "true", text: fmt(info.kcal) }) : null
      ]);
      cell.addEventListener("click", () => Fit.openDay(date));
      cells.push(cell);
    }

    const prev = el("button", { class: "button button--small button--ghost", type: "button", "aria-label": "Previous month", text: "‹" });
    prev.addEventListener("click", () => shiftMonth(-1));
    const next = el("button", { class: "button button--small button--ghost", type: "button", "aria-label": "Next month", text: "›" });
    next.addEventListener("click", () => shiftMonth(1));

    $("view-calendar").replaceChildren(el("div", { class: "card" }, [
      el("div", { class: "cal-head" }, [
        prev,
        el("h2", { text: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
        next
      ]),
      el("p", { class: "muted small", text: doneCount + (doneCount === 1 ? " workout" : " workouts") + ", " + fmt(minutes) + " minutes this month." }),
      el("div", { class: "cal" }, names.concat(cells)),
      el("ul", { class: "legend" }, [
        el("li", {}, [el("span", { class: "dot" }), "Workout done"]),
        el("li", {}, [el("span", { class: "dot dot--planned" }), "Planned"]),
        el("li", {}, [el("span", { class: "cal__kcal", text: "1,850" }), "Calories logged"])
      ]),
      el("p", { class: "muted small", text: "Choose a day to see or add to it." })
    ]));
  };

  // ---------- Progress ----------

  Fit.renderProgress = function () {
    const weeks = Fit.weeks(8);
    const max = Math.max(60, ...weeks.map((w) => w.minutes));
    const label = (w) => Fit.parse(w.start).toLocaleDateString(undefined, { day: "numeric", month: "short" });

    const bars = weeks.map((w) => {
      const fill = el("span", { class: "bar__fill" });
      fill.style.height = (w.minutes / max) * 100 + "%";
      return el("div", { class: "bar", title: "Week of " + label(w) + ": " + fmt(w.minutes) + " minutes" }, [
        el("span", { class: "bar__value", text: w.minutes ? fmt(w.minutes) : "" }),
        el("div", { class: "bar__track" }, [fill]),
        el("span", { class: "bar__label", text: label(w) })
      ]);
    });

    const rows = weeks.slice().reverse().map((w) => el("tr", {}, [
      el("th", { scope: "row", text: label(w) + " – " + Fit.parse(w.end).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }),
      el("td", { text: String(w.sessions) }),
      el("td", { text: fmt(w.minutes) }),
      el("td", { text: w.kcalDays ? fmt(w.kcal / w.kcalDays) + " (" + w.kcalDays + (w.kcalDays === 1 ? " day" : " days") + ")" : "–" })
    ]));

    $("view-progress").replaceChildren(
      el("div", { class: "card" }, [
        el("h2", { class: "card-title", text: "Workout minutes, last 8 weeks" }),
        el("div", { class: "bars", role: "img", "aria-label": "Workout minutes per week for the last 8 weeks; the table below has the numbers." }, bars),
        el("p", { class: "muted small", text: "Only workouts marked as done count, not planned ones." })
      ]),
      el("div", { class: "card" }, [
        el("h2", { class: "card-title", text: "Week by week" }),
        el("div", { class: "table-wrap" }, [
          el("table", { class: "weeks" }, [
            el("thead", {}, [el("tr", {}, ["Week", "Workouts", "Minutes", "Average calories a day"].map((h) => el("th", { scope: "col", text: h })))]),
            el("tbody", {}, rows)
          ])
        ]),
        el("p", { class: "muted small", text: "Calories are averaged over the days you logged food, so a week with gaps isn't dragged down." })
      ])
    );
  };
})();
