// Fitness Log data: saved state, the food list, search and totals. No page layout here.
//
//   Fit.state, Fit.save()                 the person's log (browser storage only)
//   await Fit.loadFoods()                 the USDA food list (foods.json)
//   Fit.searchFoods(text)                 best matches first
//   Fit.dayTotals(date)                   { kcal, protein, carbs, fat }
//   Fit.weeks(count)                      recent weeks, newest last
(function () {
  "use strict";
  const Fit = (window.Fit = window.Fit || {});
  const base = new URL("./", document.currentScript.src).href;
  const store = Store.open("fitness-log", 1);

  Fit.WORKOUT_TYPES = ["Run", "Walk", "Cycling", "Swimming", "Strength", "Yoga or stretching", "Sports", "Other"];
  Fit.EFFORTS = [["easy", "Easy"], ["moderate", "Moderate"], ["hard", "Hard"]];
  Fit.MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
  Fit.MAX_ENTRIES = 20000;

  // ---------- Dates (local "YYYY-MM-DD") ----------

  Fit.iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  Fit.today = () => Fit.iso(new Date());
  Fit.parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  Fit.addDays = (s, n) => {
    const d = Fit.parse(s);
    d.setDate(d.getDate() + n);
    return Fit.iso(d);
  };
  // Weeks start on Monday.
  Fit.weekStart = (s) => {
    const d = Fit.parse(s);
    return Fit.addDays(s, -((d.getDay() + 6) % 7));
  };
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // ---------- State ----------

  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : 0;
  };
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  Fit.newId = id;

  function cleanWorkout(w) {
    if (!w || !isDate(w.date)) return null;
    return {
      id: str(w.id, 40) || id(),
      date: w.date,
      type: Fit.WORKOUT_TYPES.includes(w.type) ? w.type : "Other",
      minutes: num(w.minutes, 1440),
      distance: num(w.distance, 1000), // in the person's distance unit
      effort: Fit.EFFORTS.some((e) => e[0] === w.effort) ? w.effort : "moderate",
      notes: str(w.notes, 1000),
      planned: w.planned === true,
      exercises: (Array.isArray(w.exercises) ? w.exercises : []).slice(0, 40).map((x) => ({
        name: str(x && x.name, 80),
        sets: num(x && x.sets, 100),
        reps: num(x && x.reps, 1000),
        weight: num(x && x.weight, 2000)
      })).filter((x) => x.name)
    };
  }

  function cleanFood(f) {
    if (!f || !isDate(f.date) || !str(f.name, 200)) return null;
    return {
      id: str(f.id, 40) || id(),
      date: f.date,
      meal: Fit.MEALS.includes(f.meal) ? f.meal : "Snacks",
      name: str(f.name, 200),
      amount: str(f.amount, 80), // e.g. "1 medium (118 g)"
      kcal: num(f.kcal, 20000),
      protein: num(f.protein, 2000),
      carbs: num(f.carbs, 2000),
      fat: num(f.fat, 2000)
    };
  }

  Fit.clean = function (raw) {
    raw = raw || {};
    return {
      units: {
        distance: raw.units && raw.units.distance === "mi" ? "mi" : "km",
        weight: raw.units && raw.units.weight === "lb" ? "lb" : "kg"
      },
      target: num(raw.target, 20000) || 0, // optional daily calories the person chose; 0 = none
      workouts: (Array.isArray(raw.workouts) ? raw.workouts : []).map(cleanWorkout).filter(Boolean).slice(0, Fit.MAX_ENTRIES),
      foods: (Array.isArray(raw.foods) ? raw.foods : []).map(cleanFood).filter(Boolean).slice(0, Fit.MAX_ENTRIES)
    };
  };
  Fit.cleanWorkout = cleanWorkout;
  Fit.cleanFood = cleanFood;

  const usesMiles = /^en-(US|GB|LR)|^my/.test(navigator.language || "");
  Fit.state = Fit.clean(store.load({ units: { distance: usesMiles ? "mi" : "km", weight: /^en-US|^en-LR|^my/.test(navigator.language || "") ? "lb" : "kg" } }));
  Fit.store = store;
  Fit.saveOk = true;
  Fit.save = () => (Fit.saveOk = store.save(Fit.state));

  // ---------- Foods ----------

  let foods = null;
  Fit.loadFoods = function () {
    if (!foods) {
      foods = fetch(base + "foods.json").then((r) => {
        if (!r.ok) throw new Error("The food list couldn't be loaded. Reload the page to try again.");
        return r.json();
      }).then((list) => list.map(([name, kcal, protein, carbs, fat, portions]) => ({ name, lower: name.toLowerCase(), kcal, protein, carbs, fat, portions })));
      foods.catch(() => (foods = null));
    }
    return foods;
  };

  // Everyday versions of common foods. USDA gives them long names ("Milk, whole,
  // 3.25% milkfat…"), so without this they'd rank below oddities like sheep's milk.
  const COMMON = new Set([
    "Egg, whole, raw, fresh", "Egg, whole, cooked, hard-boiled", "Egg, whole, cooked, scrambled", "Egg, whole, cooked, fried",
    "Milk, whole, 3.25% milkfat, with added vitamin D", "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
    "Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D", "Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)",
    "Rice, white, long-grain, regular, enriched, cooked", "Rice, brown, long-grain, cooked",
    "Bread, white, commercially prepared (includes soft bread crumbs)", "Bread, whole-wheat, commercially prepared",
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted", "Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled",
    "Pasta, cooked, enriched, without added salt", "Potatoes, baked, flesh and skin, without salt", "Potatoes, boiled, cooked in skin, flesh, without salt",
    "Cheese, cheddar", "Yogurt, plain, whole milk", "Yogurt, Greek, plain, nonfat", "Butter, salted", "Oil, olive, salad or cooking",
    "Beverages, coffee, brewed, prepared with tap water", "Orange juice, raw", "Peanut butter, smooth style, with salt",
    "Fish, salmon, Atlantic, farmed, cooked, dry heat", "Fish, tuna, light, canned in water, drained solids",
    "Broccoli, raw", "Broccoli, cooked, boiled, drained, without salt", "Avocados, raw, all commercial varieties",
    "Tomatoes, red, ripe, raw, year round average", "Oranges, raw, all commercial varieties", "Bananas, raw", "Apples, raw, with skin",
    "Oats", "Sugars, granulated", "Beverages, carbonated, cola, regular", "Alcoholic beverage, beer, regular, all",
    "Alcoholic beverage, wine, table, red", "Alcoholic beverage, wine, table, white",
    "Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)", "Lentils, mature seeds, cooked, boiled, without salt"
  ]);

  // Every word typed must start a word in the name ("chick bre" finds "Chicken, breast").
  // Everyday foods first, then whole-word matches, then shorter (plainer) names.
  Fit.searchFoods = function (list, text, limit) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    // Built once per search, not once per food (there are ~7,800). Words are
    // letters and digits only, so they're safe inside a pattern.
    const starts = words.map((w) => new RegExp("(^|[^a-z0-9])" + w));
    // A whole-word match ("egg" in "Egg, whole") beats a word that only starts the same ("Eggnog").
    const wholes = words.map((w) => new RegExp("(^|[^a-z0-9])" + w + "(e?s)?([^a-z0-9]|$)"));
    const out = [];
    for (const f of list) {
      if (!words.every((w, i) => f.lower.includes(w) && starts[i].test(f.lower))) continue;
      const whole = wholes.reduce((n, re) => n + (re.test(f.lower) ? 1 : 0), 0);
      const score = (COMMON.has(f.name) ? -2000 : 0) + (f.lower.startsWith(words[0]) ? 0 : 1000) - whole * 100 + (/\braw\b/.test(f.lower) ? -5 : 0) + f.name.length;
      out.push([score, f]);
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, limit || 30).map((x) => x[1]);
  };

  // ---------- Totals ----------

  Fit.dayTotals = function (date) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    for (const f of Fit.state.foods) {
      if (f.date !== date) continue;
      t.kcal += f.kcal;
      t.protein += f.protein;
      t.carbs += f.carbs;
      t.fat += f.fat;
      t.count += 1;
    }
    return t;
  };

  // The last `count` weeks (Monday to Sunday), oldest first. Only workouts that
  // were done count, not planned ones; calories are averaged over days with entries.
  Fit.weeks = function (count) {
    const out = [];
    let start = Fit.weekStart(Fit.today());
    for (let i = 0; i < count; i++) {
      out.unshift({ start, end: Fit.addDays(start, 6), minutes: 0, sessions: 0, kcalDays: 0, kcal: 0 });
      start = Fit.addDays(start, -7);
    }
    const find = (date) => out.find((w) => date >= w.start && date <= w.end);
    for (const w of Fit.state.workouts) {
      const week = !w.planned && find(w.date);
      if (week) {
        week.minutes += w.minutes;
        week.sessions += 1;
      }
    }
    const days = new Map();
    for (const f of Fit.state.foods) days.set(f.date, (days.get(f.date) || 0) + f.kcal);
    for (const [date, kcal] of days) {
      const week = find(date);
      if (week) {
        week.kcal += kcal;
        week.kcalDays += 1;
      }
    }
    return out;
  };
})();
