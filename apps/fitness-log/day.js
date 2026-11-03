// The Day view: one day's workouts and food. Data and totals are in data.js.
// Fit.renderDay() draws it; Fit.day is the date shown.
(function () {
  "use strict";
  const { el } = window.UI;
  const Fit = window.Fit;
  const $ = (id) => document.getElementById(id);

  Fit.day = Fit.today();
  const fmt = (n, digits) => Number(n).toLocaleString(undefined, { maximumFractionDigits: digits || 0 });

  function changed() {
    Fit.save();
    if (Fit.onChange) Fit.onChange();
  }

  const button = (text, onClick, kind, attrs) => {
    const b = el("button", { class: "button button--small " + (kind === undefined ? "button--ghost" : kind), type: "button", text, ...(attrs || {}) });
    b.addEventListener("click", onClick);
    return b;
  };
  const field = (label, input, cls) => {
    const id = "f-" + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return el("div", { class: "field " + (cls || "") }, [el("label", { for: id, text: label }), input]);
  };

  // ---------- Date bar ----------

  function dateBar() {
    const d = Fit.parse(Fit.day);
    const label = Fit.day === Fit.today() ? "Today" : Fit.day === Fit.addDays(Fit.today(), -1) ? "Yesterday" : Fit.day === Fit.addDays(Fit.today(), 1) ? "Tomorrow" : "";
    const picker = el("input", { type: "date", "aria-label": "Choose a day" });
    picker.value = Fit.day;
    picker.addEventListener("change", () => {
      if (picker.value) Fit.openDay(picker.value);
    });
    return el("div", { class: "date-bar" }, [
      button("‹", () => Fit.openDay(Fit.addDays(Fit.day, -1)), undefined, { "aria-label": "Previous day" }),
      el("div", { class: "date-bar__title" }, [
        el("h2", { text: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) }),
        label ? el("span", { class: "muted small", text: label }) : null
      ]),
      picker,
      button("›", () => Fit.openDay(Fit.addDays(Fit.day, 1)), undefined, { "aria-label": "Next day" }),
      Fit.day !== Fit.today() ? button("Today", () => Fit.openDay(Fit.today())) : null
    ]);
  }

  // ---------- Workouts ----------

  function workoutSummary(w) {
    const u = Fit.state.units;
    const bits = [];
    if (w.minutes) bits.push(fmt(w.minutes) + " min");
    if (w.distance) bits.push(fmt(w.distance, 2) + " " + u.distance);
    bits.push(Fit.EFFORTS.find((e) => e[0] === w.effort)[1].toLowerCase());
    return bits.join(" · ");
  }

  function workoutItem(w) {
    const u = Fit.state.units;
    const actions = [];
    if (w.planned) {
      actions.push(button("Mark as done", () => {
        w.planned = false;
        changed();
      }, ""));
    }
    actions.push(button("Edit", () => openWorkoutForm(w)));
    actions.push(button("Delete", () => {
      if (!confirm("Delete this " + w.type.toLowerCase() + "?")) return;
      Fit.state.workouts = Fit.state.workouts.filter((x) => x !== w);
      changed();
    }, "button--danger"));
    return el("li", { class: "workout" + (w.planned ? " workout--planned" : "") }, [
      el("div", { class: "workout__head" }, [
        el("strong", { text: w.type }),
        w.planned ? el("span", { class: "badge", text: "Planned" }) : null,
        el("span", { class: "muted small", text: workoutSummary(w) })
      ]),
      w.exercises.length
        ? el("ul", { class: "exercises" }, w.exercises.map((x) =>
            el("li", { text: x.name + (x.sets ? ": " + x.sets + " × " + (x.reps || "?") : "") + (x.weight ? " @ " + fmt(x.weight, 1) + " " + u.weight : "") })))
        : null,
      w.notes ? el("p", { class: "workout__notes", text: w.notes }) : null,
      el("div", { class: "row-actions" }, actions)
    ]);
  }

  let editing = null; // the workout being edited, or "new"

  function openWorkoutForm(w) {
    editing = w || "new";
    Fit.renderDay();
    const first = document.querySelector("#workout-form select, #workout-form input");
    if (first) first.focus();
  }

  function workoutForm() {
    const w = editing === "new" ? null : editing;
    const u = Fit.state.units;
    const type = el("select", {}, Fit.WORKOUT_TYPES.map((t) => el("option", { value: t, text: t })));
    type.value = w ? w.type : "Run";
    const minutes = el("input", { type: "number", min: "0", max: "1440", step: "1", inputmode: "numeric" });
    minutes.value = w && w.minutes ? w.minutes : "";
    const distance = el("input", { type: "number", min: "0", max: "1000", step: "0.01", inputmode: "decimal" });
    distance.value = w && w.distance ? w.distance : "";
    const effort = el("select", {}, Fit.EFFORTS.map(([v, t]) => el("option", { value: v, text: t })));
    effort.value = w ? w.effort : "moderate";
    const planned = el("input", { type: "checkbox", id: "w-planned" });
    planned.checked = w ? w.planned : Fit.day > Fit.today();
    const notes = el("textarea", { rows: "2", maxlength: "1000" });
    notes.value = w ? w.notes : "";

    // Exercises: shown for strength workouts (or whenever there already are some).
    const exercises = (w ? w.exercises : []).map((x) => ({ ...x }));
    const exBox = el("div", { class: "ex-box" });
    function renderExercises() {
      const show = type.value === "Strength" || exercises.length;
      exBox.hidden = !show;
      if (!show) return;
      exBox.replaceChildren(
        el("p", { class: "ex-title", text: "Exercises" }),
        ...exercises.map((x, i) => {
          const input = (key, attrs, label) => {
            const inp = el("input", { ...attrs, "aria-label": label + " for exercise " + (i + 1) });
            inp.value = x[key] || "";
            inp.addEventListener("input", () => (x[key] = attrs.type === "number" ? Number(inp.value) || 0 : inp.value));
            return inp;
          };
          const remove = button("✕", () => {
            exercises.splice(i, 1);
            renderExercises();
          }, undefined, { "aria-label": "Remove exercise " + (i + 1) });
          return el("div", { class: "ex-row" }, [
            input("name", { placeholder: "e.g. Squat", maxlength: "80" }, "Name"),
            input("sets", { type: "number", min: "0", max: "100", placeholder: "Sets", inputmode: "numeric" }, "Sets"),
            input("reps", { type: "number", min: "0", max: "1000", placeholder: "Reps", inputmode: "numeric" }, "Reps"),
            input("weight", { type: "number", min: "0", max: "2000", step: "0.5", placeholder: u.weight, inputmode: "decimal" }, "Weight in " + u.weight),
            remove
          ]);
        }),
        button("Add exercise", () => {
          exercises.push({ name: "", sets: 3, reps: 10, weight: 0 });
          renderExercises();
          const rows = exBox.querySelectorAll(".ex-row input");
          if (rows.length) rows[rows.length - 4].focus();
        })
      );
    }
    type.addEventListener("change", renderExercises);
    renderExercises();

    const message = el("p", { class: "small is-error", role: "alert" });
    const form = el("form", { id: "workout-form", class: "workout-form" }, [
      el("div", { class: "form-grid" }, [
        field("Type", type),
        field("Minutes", minutes),
        field("Distance (" + u.distance + ")", distance),
        field("How hard", effort)
      ]),
      el("div", { class: "check-row" }, [planned, el("label", { for: "w-planned", text: "Planned (not done yet)" })]),
      exBox,
      field("Notes", notes, "wide"),
      message,
      el("div", { class: "row-actions" }, [
        el("button", { class: "button", type: "submit", text: w ? "Save changes" : "Add workout" }),
        button("Cancel", () => {
          editing = null;
          Fit.renderDay();
        })
      ])
    ]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const entry = Fit.cleanWorkout({
        id: w ? w.id : Fit.newId(),
        date: Fit.day,
        type: type.value,
        minutes: Number(minutes.value) || 0,
        distance: Number(distance.value) || 0,
        effort: effort.value,
        planned: planned.checked,
        notes: notes.value.trim(),
        exercises
      });
      if (!entry.minutes && !entry.distance && !entry.exercises.length && !entry.planned) {
        message.textContent = "Add how long it took, a distance, or some exercises.";
        return;
      }
      if (w) Object.assign(w, entry);
      else Fit.state.workouts.push(entry);
      editing = null;
      changed();
    });
    return form;
  }

  function workoutsCard() {
    const list = Fit.state.workouts.filter((w) => w.date === Fit.day);
    const week = Fit.weeks(1)[0];
    return el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [
        el("h3", { class: "card-title", text: "Workouts" }),
        el("span", { class: "muted small", text: "This week: " + week.sessions + (week.sessions === 1 ? " workout" : " workouts") + ", " + fmt(week.minutes) + " min" })
      ]),
      list.length ? el("ul", { class: "workouts" }, list.map(workoutItem)) : el("p", { class: "muted small", text: "Nothing logged for this day." }),
      editing ? workoutForm() : button(Fit.day > Fit.today() ? "Plan a workout" : "Add a workout", () => openWorkoutForm(null), "")
    ]);
  }

  // ---------- Food ----------

  let foodList = null; // loaded USDA list
  let foodError = "";
  const pick = { meal: null, query: "", chosen: null, portion: "g", quantity: "", quick: false };

  function defaultMeal() {
    const h = new Date().getHours();
    return h < 11 ? "Breakfast" : h < 15 ? "Lunch" : h < 21 ? "Dinner" : "Snacks";
  }

  // Grams for the chosen amount: a portion ("1 medium") × count, or plain grams.
  function grams() {
    const q = Number(pick.quantity);
    if (!(q > 0)) return 0;
    if (pick.portion === "g") return q;
    const p = pick.chosen.portions[Number(pick.portion)];
    return p ? p[1] * q : 0;
  }

  function amountText() {
    const q = Number(pick.quantity);
    if (pick.portion === "g") return fmt(q, 1) + " g";
    const p = pick.chosen.portions[Number(pick.portion)];
    return (q === 1 ? "" : fmt(q, 2) + " × ") + p[0] + " (" + fmt(grams(), 0) + " g)";
  }

  function addEntry(entry) {
    Fit.state.foods.push(Fit.cleanFood({ id: Fit.newId(), date: Fit.day, ...entry }));
    pick.chosen = null;
    pick.query = "";
    pick.quick = false;
    changed();
  }

  function foodForm() {
    const meal = el("select", { "aria-label": "Meal" }, Fit.MEALS.map((m) => el("option", { value: m, text: m })));
    meal.value = pick.meal || defaultMeal();
    meal.addEventListener("change", () => (pick.meal = meal.value));

    const parts = [el("div", { class: "food-top" }, [el("span", { class: "small", text: "Add to" }), meal])];

    if (pick.quick) {
      const name = el("input", { maxlength: "200", placeholder: "e.g. Burrito from the corner place" });
      const kcal = el("input", { type: "number", min: "0", max: "20000", inputmode: "numeric" });
      const protein = el("input", { type: "number", min: "0", max: "2000", step: "0.1", inputmode: "decimal", placeholder: "optional" });
      const msg = el("p", { class: "small is-error", role: "alert" });
      const form = el("form", { class: "quick" }, [
        el("div", { class: "form-grid" }, [field("What", name, "wide"), field("Calories", kcal), field("Protein (g)", protein)]),
        msg,
        el("div", { class: "row-actions" }, [
          el("button", { class: "button", type: "submit", text: "Add" }),
          button("Back to the food list", () => {
            pick.quick = false;
            Fit.renderDay();
          })
        ])
      ]);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!name.value.trim()) return (msg.textContent = "Say what it was.");
        if (kcal.value === "") return (msg.textContent = "Add the calories (an estimate is fine).");
        addEntry({ meal: meal.value, name: name.value.trim(), amount: "", kcal: Number(kcal.value), protein: Number(protein.value) || 0 });
      });
      parts.push(form);
      return el("div", { class: "food-form" }, parts);
    }

    const search = el("input", { type: "search", placeholder: "Search foods, e.g. banana, oats, chicken breast", "aria-label": "Search foods", autocomplete: "off" });
    search.value = pick.query;
    const results = el("ul", { class: "food-results" });
    const showResults = () => {
      results.replaceChildren();
      if (!foodList || pick.chosen) return;
      const found = Fit.searchFoods(foodList, pick.query, 12);
      if (pick.query.trim() && !found.length) {
        results.append(el("li", { class: "muted small", text: "Nothing found. Try a simpler word, or add it by hand below." }));
      }
      for (const f of found) {
        const b = el("button", { type: "button" }, [el("span", { text: f.name }), el("span", { class: "muted", text: fmt(f.kcal) + " kcal / 100 g" })]);
        b.addEventListener("click", () => {
          pick.chosen = f;
          pick.portion = f.portions.length ? "0" : "g";
          pick.quantity = f.portions.length ? "1" : "100";
          Fit.renderDay();
        });
        results.append(el("li", {}, [b]));
      }
    };
    let timer;
    search.addEventListener("input", () => {
      pick.query = search.value;
      clearTimeout(timer);
      timer = setTimeout(showResults, 120);
    });

    if (!foodList && foodError) {
      parts.push(el("p", { class: "small is-error", text: foodError }), button("Try again", () => {
        foodError = "";
        Fit.renderDay();
      }));
    } else if (!foodList) {
      parts.push(el("p", { class: "muted small", text: "Loading the food list…" }));
      Fit.loadFoods().then((list) => {
        foodList = list;
        Fit.renderDay();
      }).catch((e) => {
        foodError = e.message;
        Fit.renderDay();
      });
    } else if (pick.chosen) {
      const f = pick.chosen;
      const portion = el("select", { "aria-label": "Amount" }, [
        ...f.portions.map((p, i) => el("option", { value: String(i), text: p[0] + " (" + fmt(p[1], 1) + " g)" })),
        el("option", { value: "g", text: "grams" })
      ]);
      portion.value = pick.portion;
      const qty = el("input", { type: "number", min: "0", step: "any", inputmode: "decimal", "aria-label": "How many" });
      qty.value = pick.quantity;
      const preview = el("p", { class: "small" });
      const add = el("button", { class: "button", type: "button", text: "Add" });
      const update = () => {
        pick.portion = portion.value;
        pick.quantity = qty.value;
        const g = grams();
        add.disabled = !g;
        preview.textContent = g
          ? amountText() + ": " + fmt((f.kcal * g) / 100) + " kcal · protein " + fmt((f.protein * g) / 100, 1) + " g · carbs " + fmt((f.carbs * g) / 100, 1) + " g · fat " + fmt((f.fat * g) / 100, 1) + " g"
          : "Enter an amount.";
      };
      portion.addEventListener("change", () => {
        if (portion.value === "g" && Number(qty.value) < 5) qty.value = "100";
        if (portion.value !== "g" && Number(qty.value) > 20) qty.value = "1";
        update();
      });
      qty.addEventListener("input", update);
      add.addEventListener("click", () => {
        const g = grams();
        if (!g) return;
        addEntry({ meal: meal.value, name: f.name, amount: amountText(), kcal: Math.round((f.kcal * g) / 100), protein: (f.protein * g) / 100, carbs: (f.carbs * g) / 100, fat: (f.fat * g) / 100 });
      });
      update();
      parts.push(el("div", { class: "chosen" }, [
        el("p", {}, [el("strong", { text: f.name })]),
        el("div", { class: "amount-row" }, [qty, portion]),
        preview,
        el("div", { class: "row-actions" }, [add, button("Choose a different food", () => {
          pick.chosen = null;
          Fit.renderDay();
        })])
      ]));
    } else {
      parts.push(search, results);
      showResults();
    }

    if (!pick.chosen) {
      parts.push(el("p", { class: "small" }, [button("Add something not on the list", () => {
        pick.quick = true;
        Fit.renderDay();
      }, "link-button")]));
      // Recent foods: one tap adds the same amount again.
      const seen = new Set();
      const recent = [];
      for (let i = Fit.state.foods.length - 1; i >= 0 && recent.length < 8; i--) {
        const f = Fit.state.foods[i];
        const key = f.name + "|" + f.amount;
        if (seen.has(key)) continue;
        seen.add(key);
        recent.push(f);
      }
      if (recent.length) {
        parts.push(el("div", { class: "recent" }, [
          el("p", { class: "small muted", text: "Add again:" }),
          ...recent.map((f) => button(f.name.split(",")[0] + (f.amount ? " · " + f.amount.replace(/\s*\(.*\)$/, "") : "") + " · " + fmt(f.kcal) + " kcal", () => {
            addEntry({ meal: meal.value, name: f.name, amount: f.amount, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
          }, "chip-button"))
        ]));
      }
    }
    return el("div", { class: "food-form" }, parts);
  }

  function foodCard() {
    const entries = Fit.state.foods.filter((f) => f.date === Fit.day);
    const t = Fit.dayTotals(Fit.day);
    const target = Fit.state.target;
    const meals = Fit.MEALS.map((meal) => {
      const items = entries.filter((f) => f.meal === meal);
      if (!items.length) return null;
      const sum = items.reduce((s, f) => s + f.kcal, 0);
      return el("div", { class: "meal" }, [
        el("div", { class: "meal__head" }, [el("strong", { text: meal }), el("span", { class: "muted small", text: fmt(sum) + " kcal" })]),
        el("ul", { class: "entries" }, items.map((f) => {
          const remove = el("button", { class: "icon-button", type: "button", "aria-label": "Remove " + f.name, title: "Remove", text: "✕" });
          remove.addEventListener("click", () => {
            Fit.state.foods = Fit.state.foods.filter((x) => x !== f);
            changed();
          });
          return el("li", {}, [
            el("span", { class: "entry__name" }, [f.name, f.amount ? el("span", { class: "muted small", text: " · " + f.amount }) : null]),
            el("span", { class: "entry__kcal", text: fmt(f.kcal) + " kcal" }),
            remove
          ]);
        }))
      ]);
    }).filter(Boolean);

    const totals = el("div", { class: "totals" }, [
      el("p", { class: "totals__kcal" }, [el("strong", { text: fmt(t.kcal) }), target ? " of " + fmt(target) + " kcal" : " kcal"]),
      el("p", { class: "muted small", text: "Protein " + fmt(t.protein) + " g · carbs " + fmt(t.carbs) + " g · fat " + fmt(t.fat) + " g" })
    ]);
    if (target) {
      // A plain progress bar: no colour change or warning past the number.
      const fill = el("span");
      fill.style.width = Math.min(100, (t.kcal / target) * 100) + "%";
      totals.append(el("div", { class: "meter", "aria-hidden": "true" }, [fill]));
    }

    return el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [el("h3", { class: "card-title", text: "Food" })]),
      totals,
      meals.length ? el("div", { class: "meals" }, meals) : el("p", { class: "muted small", text: "Nothing logged for this day." }),
      foodForm()
    ]);
  }

  Fit.renderDay = function () {
    $("view-day").replaceChildren(dateBar(), el("div", { class: "day-grid" }, [workoutsCard(), foodCard()]));
  };

  Fit.openDay = function (date) {
    Fit.day = date;
    editing = null;
    pick.chosen = null;
    pick.quick = false;
    Fit.show("day");
  };
})();
