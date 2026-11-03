// Fitness Log page: switching views, settings, backup and export.
// Views are drawn by day.js and calendar.js; data lives in data.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const Fit = window.Fit;
  const $ = (id) => document.getElementById(id);

  let view = "day";

  Fit.show = function (next) {
    view = next;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === view)));
    for (const v of ["day", "calendar", "progress", "settings"]) $("view-" + v).hidden = v !== view;
    if (view === "day") Fit.renderDay();
    else if (view === "calendar") Fit.renderCalendar();
    else if (view === "progress") Fit.renderProgress();
    else renderSettings();
  };

  // After any change: show if saving failed, and redraw the current view.
  Fit.onChange = function () {
    $("save-error").hidden = Fit.saveOk;
    Fit.show(view);
  };

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => Fit.show(t.dataset.view)));

  // ---------- Settings ----------

  function renderSettings() {
    $("unit-distance").value = Fit.state.units.distance;
    $("unit-weight").value = Fit.state.units.weight;
    $("target").value = Fit.state.target || "";
    const has = Fit.state.workouts.length + Fit.state.foods.length > 0;
    ["backup", "csv-workouts", "csv-foods", "delete-all"].forEach((id) => ($(id).disabled = !has));
  }

  $("unit-distance").addEventListener("change", (e) => {
    Fit.state.units.distance = e.target.value;
    Fit.save();
  });
  $("unit-weight").addEventListener("change", (e) => {
    Fit.state.units.weight = e.target.value;
    Fit.save();
  });
  $("target").addEventListener("change", (e) => {
    const n = Number(e.target.value);
    Fit.state.target = n > 0 && n <= 20000 ? Math.round(n) : 0;
    e.target.value = Fit.state.target || "";
    Fit.save();
  });

  function status(text) {
    $("data-status").textContent = text;
  }

  function download(blob, name) {
    const link = el("a", { download: name });
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  // Quotes a CSV cell, and stops spreadsheet apps from running it as a formula.
  function cell(v) {
    let s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) {
    return new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  }

  $("backup").addEventListener("click", () => Fit.store.exportFile(Fit.state));

  $("csv-workouts").addEventListener("click", () => {
    const u = Fit.state.units;
    const rows = [["Date", "Type", "Done or planned", "Minutes", "Distance (" + u.distance + ")", "Effort", "Exercises", "Notes"]];
    for (const w of Fit.state.workouts.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([w.date, w.type, w.planned ? "planned" : "done", w.minutes || "", w.distance || "", w.effort,
        w.exercises.map((x) => x.name + (x.sets ? " " + x.sets + "x" + x.reps : "") + (x.weight ? " @" + x.weight + u.weight : "")).join("; "), w.notes]);
    }
    download(csv(rows), "workouts-" + Fit.today() + ".csv");
  });

  $("csv-foods").addEventListener("click", () => {
    const rows = [["Date", "Meal", "Food", "Amount", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)"]];
    for (const f of Fit.state.foods.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      // Quick-added entries usually have calories only: leave the nutrients blank rather than "0".
      const known = f.protein + f.carbs + f.fat > 0;
      const g = (n) => (known ? n.toFixed(1) : "");
      rows.push([f.date, f.meal, f.name, f.amount, Math.round(f.kcal), g(f.protein), g(f.carbs), g(f.fat)]);
    }
    download(csv(rows), "food-diary-" + Fit.today() + ".csv");
  });

  $("restore").addEventListener("click", () => $("restore-file").click());
  $("restore-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let data;
    try {
      data = Fit.clean(await Fit.store.importFile(file));
    } catch (error) {
      return status(error.message);
    }
    // Merge by id: entries in the backup replace the same ones here; nothing else is removed.
    const merge = (mine, theirs) => {
      const byId = new Map(mine.map((x) => [x.id, x]));
      for (const x of theirs) byId.set(x.id, x);
      return [...byId.values()];
    };
    const ok = confirm("Restore " + data.workouts.length + " workouts and " + data.foods.length + " food entries from this backup?\n\nEntries already here are kept; ones that are also in the backup are replaced by the backup's version.");
    if (!ok) return;
    Fit.state.workouts = merge(Fit.state.workouts, data.workouts);
    Fit.state.foods = merge(Fit.state.foods, data.foods);
    Fit.onChange();
    status("Restored.");
  });

  $("delete-all").addEventListener("click", () => {
    if (!confirm("Delete all " + Fit.state.workouts.length + " workouts and " + Fit.state.foods.length + " food entries from this browser? Download a backup first if you might want them back.")) return;
    Fit.state.workouts = [];
    Fit.state.foods = [];
    Fit.onChange();
    status("Everything was deleted.");
  });

  // Another tab changed the log: reload it, so this tab never saves over it.
  window.addEventListener("storage", (e) => {
    if (e.key !== Fit.store.key) return;
    Object.assign(Fit.state, Fit.clean(Fit.store.load({})));
    Fit.show(view);
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  Fit.show("day");
})();
