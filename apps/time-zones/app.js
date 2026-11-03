// Time Zone Planner page: places, the hour grid, best times and sharing.
// Time maths is in tz.js, meeting logic in planner.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const TZ = window.TZ;
  const P = window.Planner;
  const $ = (id) => document.getElementById(id);
  const store = Store.open("time-zones", 1);
  const MAX_PLACES = 12;
  const LENGTHS = [30, 60, 90, 120];

  // ---------- Saved settings ----------

  function cleanPlace(p) {
    if (!p || typeof p.zone !== "string" || !TZ.valid(p.zone)) return null;
    const start = Math.round(Number(p.start));
    const end = Math.round(Number(p.end));
    const ok = start >= 0 && start <= 23 && end >= 1 && end <= 24 && end > start;
    return {
      label: (typeof p.label === "string" && p.label.trim() ? p.label.trim() : p.zone).slice(0, 60),
      zone: p.zone,
      start: ok ? start : 9,
      end: ok ? end : 17,
      days: P.WORKDAYS[p.days] ? p.days : P.defaultDays(p.zone)
    };
  }
  function clean(raw) {
    raw = raw || {};
    const places = (Array.isArray(raw.places) ? raw.places : []).map(cleanPlace).filter(Boolean).slice(0, MAX_PLACES);
    if (!places.length) {
      const here = TZ.localPlace();
      places.push(cleanPlace({ label: here.label + " (you)", zone: here.zone }));
    }
    const hour12Default = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 === true;
    return {
      places,
      length: LENGTHS.includes(Number(raw.length)) ? Number(raw.length) : 60,
      hour12: typeof raw.hour12 === "boolean" ? raw.hour12 : hour12Default
    };
  }

  let s = clean(store.load({}));
  let shared = false; // viewing someone's link: don't overwrite the person's own list
  const save = () => {
    if (!shared) store.save(s);
  };

  // What's on screen, not saved: the date and the start time (minutes after
  // midnight in the first place's time zone).
  const ref = () => s.places[0];
  let date = TZ.dateOf(Date.now(), ref().zone);
  let startMinutes = null; // null = pick the first good time

  // ---------- Shared links ----------
  // #p=London~Europe/London~9~17~mon-fri;...&d=2026-11-03&t=900&l=60

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get("p")) return false;
    const places = h.get("p").split(";").map((x) => {
      const [label, zone, start, end, days] = x.split("~");
      return cleanPlace({ label, zone, start, end, days });
    }).filter(Boolean).slice(0, MAX_PLACES);
    if (!places.length) return false;
    s = clean({ places, length: h.get("l"), hour12: s.hour12 });
    if (/^\d{4}-\d{2}-\d{2}$/.test(h.get("d") || "")) date = h.get("d");
    const t = Number(h.get("t"));
    if (Number.isInteger(t) && t >= 0 && t < 1440) startMinutes = t;
    return true;
  }

  function shareLink() {
    const p = s.places.map((x) => [x.label.replace(/[~;]/g, " "), x.zone, x.start, x.end, x.days].join("~")).join(";");
    const q = new URLSearchParams({ p, d: date, t: String(startMinutes), l: String(s.length) });
    return location.origin + location.pathname + "#" + q.toString();
  }

  if (readHash()) {
    shared = true;
    $("shared-note").hidden = false;
  }
  $("keep-shared").addEventListener("click", () => {
    shared = false;
    save();
    $("shared-note").hidden = true;
    history.replaceState(null, "", location.pathname);
  });
  $("leave-shared").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    location.reload();
  });

  // ---------- Controls ----------

  $("date").addEventListener("change", () => {
    if ($("date").value) date = $("date").value;
    render();
  });
  $("prev-day").addEventListener("click", () => {
    date = TZ.addDays(date, -1);
    render();
  });
  $("next-day").addEventListener("click", () => {
    date = TZ.addDays(date, 1);
    render();
  });
  $("today").addEventListener("click", () => {
    date = TZ.dateOf(Date.now(), ref().zone);
    render();
  });
  $("length").addEventListener("change", () => {
    s.length = Number($("length").value);
    save();
    render();
  });
  $("hour12").addEventListener("change", () => {
    s.hour12 = $("hour12").checked;
    save();
    render();
  });
  $("start").addEventListener("change", () => {
    startMinutes = Number($("start").value);
    render();
  });

  // ---------- Drawing ----------

  let slots = [];

  // Minutes after midnight on the shown day, in the first place's zone.
  const refMinutes = (t) => {
    const p = TZ.parts(t, ref().zone);
    const sameDay = TZ.dateOf(t, ref().zone) === date;
    return sameDay ? p.hour * 60 + p.minute : null;
  };

  function hourLabel(p) {
    let h = p.hour;
    let suffix = "";
    if (s.hour12) {
      suffix = h < 12 ? "a" : "p";
      h = h % 12 || 12;
    }
    return h + (p.minute ? ":" + String(p.minute).padStart(2, "0") : "") + suffix;
  }

  function diffLabel(minutes) {
    if (!minutes) return "same time";
    const sign = minutes > 0 ? "+" : "−";
    const a = Math.abs(minutes);
    return sign + Math.floor(a / 60) + (a % 60 ? ":" + String(a % 60).padStart(2, "0") : "") + " h";
  }

  function startInstant() {
    const slot = slots.find((t) => refMinutes(t) === startMinutes);
    return slot !== undefined ? slot : null;
  }

  function renderGrid(start) {
    const now = Date.now();
    const end = start === null ? null : start + s.length * 60000;
    const refOffset = TZ.offset(start === null ? slots[0] : start, ref().zone);
    const rows = s.places.map((place, row) => {
      const at = start === null ? slots[0] : start;
      const offset = TZ.offset(at, place.zone);
      const head = el("th", { scope: "row", class: "place" }, [
        el("span", { class: "place__name", text: place.label }),
        el("span", { class: "place__now", text: P.formatTime(now, place.zone, s.hour12) + " now" }),
        el("span", { class: "place__meta muted", text: row === 0 ? TZ.offsetLabel(offset) : diffLabel(offset - refOffset) })
      ]);
      let prevDay = null;
      const cells = slots.map((t, i) => {
        const k = P.kind(t, place);
        const p = k.parts;
        const classes = ["k-" + k.kind];
        if (start !== null && t >= start && t < end) classes.push("is-picked");
        if (now >= t && now < t + 3600000) classes.push("is-now");
        // Where the local date changes, show the new day instead of the hour.
        const newDay = prevDay !== null && p.day !== prevDay;
        prevDay = p.day;
        if (newDay) classes.push("is-newday");
        const text = newDay ? new Intl.DateTimeFormat(undefined, { timeZone: place.zone, weekday: "short" }).format(t) : hourLabel(p);
        const title = place.label + ": " + P.formatDay(t, place.zone) + ", " + P.formatTime(t, place.zone, s.hour12) +
          (k.kind === "work" ? " (working hours)" : k.kind === "edge" ? (k.weekend ? " (weekend)" : " (outside working hours)") : " (night)");
        return el("td", { class: classes.join(" "), "data-i": String(i), title }, [text]);
      });
      return el("tr", {}, [head, ...cells]);
    });
    const table = el("table", { class: "hours" }, [el("tbody", {}, rows)]);
    table.addEventListener("click", (e) => {
      const td = e.target.closest("td[data-i]");
      if (!td) return;
      startMinutes = refMinutes(slots[Number(td.dataset.i)]);
      render();
    });
    $("grid-wrap").replaceChildren(table);
  }

  // On narrow screens the grid scrolls sideways: bring the chosen time into view.
  function showPicked() {
    const wrap = $("grid-wrap");
    const cell = wrap.querySelector("td.is-picked");
    const head = wrap.querySelector("th.place");
    if (!cell || !head) return;
    const visibleFrom = wrap.scrollLeft + head.offsetWidth;
    const visibleTo = wrap.scrollLeft + wrap.clientWidth;
    if (cell.offsetLeft < visibleFrom || cell.offsetLeft + cell.offsetWidth > visibleTo) {
      wrap.scrollLeft = Math.max(0, cell.offsetLeft - head.offsetWidth - cell.offsetWidth);
    }
  }

  function renderStartSelect(start) {
    $("start").replaceChildren(...slots.map((t) => {
      const m = refMinutes(t);
      return el("option", { value: String(m), text: P.formatTime(t, ref().zone, s.hour12) + " in " + ref().label });
    }));
    if (start !== null) $("start").value = String(startMinutes);
  }

  function renderMeeting(start) {
    if (start === null) return $("meeting").replaceChildren();
    $("meeting").replaceChildren(...s.places.map((place) => {
      const fits = P.fits(start, s.length, place);
      const awake = P.awake(start, s.length, place);
      return el("li", { class: fits ? "" : awake ? "is-edge" : "is-night" }, [
        el("strong", { text: place.label }),
        el("span", { text: P.span(start, s.length, place.zone, s.hour12) }),
        fits ? null : el("span", { class: "flag", text: awake ? (P.kind(start, place).weekend ? "weekend" : "outside working hours") : "night time" })
      ]);
    }));
  }

  function renderBest() {
    if (s.places.length < 2) {
      $("best-summary").textContent = "Add at least one more place to find a time that suits everyone.";
      return $("best").replaceChildren();
    }
    const r = P.best(slots, s.places, s.length);
    const fmtRange = (x) => {
      const a = P.formatTime(x.from, ref().zone, s.hour12);
      const b = P.formatTime(x.to, ref().zone, s.hour12);
      return x.from === x.to ? "Starting at " + a : "Starting " + a + " to " + b;
    };
    if (r.max === 0) {
      // Usually because it's a day off somewhere: say where.
      // A day off: no working hours at all, and part of the shown day is that place's weekend.
      const off = s.places.filter((pl) => slots.every((t) => P.kind(t, pl).kind !== "work") && slots.some((t) => P.kind(t, pl).weekend));
      $("best-summary").textContent = off.length === s.places.length
        ? "This day is a day off for everyone in the list. Try a weekday."
        : "On this day there's no time when even one person is in working hours for the whole meeting" + (off.length ? " (it's a day off for " + off.map((p) => p.label).join(", ") + ")" : "") + ". Try another day or a shorter meeting.";
      return $("best").replaceChildren();
    }
    $("best-summary").textContent = r.max === r.total
      ? "Everyone is in working hours at these times (" + ref().label + " time):"
      : "No time on this day suits everyone. These keep the most people (" + r.max + " of " + r.total + ") in working hours (" + ref().label + " time):";
    $("best").replaceChildren(...r.ranges.slice(0, 6).map((x) => {
      const b = el("button", { type: "button", class: "best__pick" }, [
        el("strong", { text: fmtRange(x) }),
        x.outside.length ? el("span", { class: "muted", text: "Outside working hours: " + x.outside.map((label) => label + (x.asleepLabels.includes(label) ? " (night)" : "")).join(", ") }) : null
      ]);
      b.addEventListener("click", () => {
        startMinutes = refMinutes(x.from);
        render();
      });
      return el("li", {}, [b]);
    }));
  }

  function renderDst() {
    const changes = TZ.clockChanges(date, s.places.map((p) => p.zone), 14);
    if (!changes.length) return ($("dst-note").hidden = true);
    const lines = changes.map((c) => {
      const who = s.places.filter((p) => p.zone === c.zone).map((p) => p.label).join(", ");
      const day = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(Date.parse(c.date + "T12:00:00Z"));
      return "Clocks in " + who + " change around " + day + " (" + TZ.offsetLabel(c.from) + " → " + TZ.offsetLabel(c.to) + ").";
    });
    $("dst-note").textContent = lines.join(" ") + " The time differences shown are right for the date you picked; they differ on the other side of the change.";
    $("dst-note").hidden = false;
  }

  function renderPlaces() {
    const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const pad = (h) => (s.hour12 ? (h % 12 || 12) + (h < 12 || h === 24 ? " am" : " pm") : String(h).padStart(2, "0") + ":00");
    $("places").replaceChildren(...s.places.map((place, i) => {
      const name = el("input", { type: "text", value: place.label, maxlength: "60", "aria-label": "Name" });
      name.addEventListener("change", () => {
        place.label = name.value.trim() || place.zone;
        save();
        render();
      });
      const select = (label, values, current, text, onChange) => {
        const sel = el("select", { "aria-label": label }, values.map((v) => el("option", { value: String(v), text: text(v) })));
        sel.value = String(current);
        sel.addEventListener("change", () => onChange(sel.value));
        return sel;
      };
      const start = select("Work starts", hours(0, 23), place.start, pad, (v) => {
        place.start = Number(v);
        if (place.end <= place.start) place.end = Math.min(24, place.start + 1);
        save();
        render();
      });
      const end = select("Work ends", hours(1, 24), place.end, pad, (v) => {
        place.end = Number(v);
        if (place.start >= place.end) place.start = Math.max(0, place.end - 1);
        save();
        render();
      });
      const days = select("Work days", Object.keys(P.WORKDAYS), place.days, (k) => P.WORKDAYS[k].label, (v) => {
        place.days = v;
        save();
        render();
      });
      const button = (text, label, onClick, disabled) => {
        const b = el("button", { type: "button", class: "button button--small button--ghost", text, "aria-label": label });
        b.disabled = !!disabled;
        b.addEventListener("click", onClick);
        return b;
      };
      const move = (by) => () => {
        const [p] = s.places.splice(i, 1);
        s.places.splice(i + by, 0, p);
        save();
        render();
      };
      return el("li", { class: "place-row" }, [
        el("div", { class: "place-row__name" }, [name, el("span", { class: "muted small", text: (TZ.zoneName(place.zone) || place.zone) + " · " + place.zone.replace(/_/g, " ") })]),
        el("div", { class: "place-row__hours" }, [el("span", { class: "small", text: "Works" }), start, el("span", { text: "–" }), end, days]),
        el("div", { class: "place-row__actions" }, [
          button("↑", "Move " + place.label + " up", move(-1), i === 0),
          button("↓", "Move " + place.label + " down", move(1), i === s.places.length - 1),
          button("Remove", "Remove " + place.label, () => {
            s.places.splice(i, 1);
            if (!s.places.length) s = clean({ length: s.length, hour12: s.hour12 });
            save();
            render();
          })
        ])
      ]);
    }));
  }

  function render() {
    $("date").value = date;
    $("length").value = String(s.length);
    $("hour12").checked = s.hour12;
    slots = TZ.daySlots(date, ref().zone);
    if (startMinutes === null || !slots.some((t) => refMinutes(t) === startMinutes)) {
      // First good time if there is one, otherwise 9:00 (or the first hour after it).
      const best = s.places.length > 1 ? P.best(slots, s.places, s.length).ranges[0] : null;
      const fallback = slots.find((t) => refMinutes(t) >= 9 * 60) || slots[0];
      startMinutes = refMinutes(best ? best.from : fallback);
    }
    const start = startInstant();
    renderGrid(start);
    showPicked();
    renderStartSelect(start);
    renderMeeting(start);
    renderBest();
    renderDst();
    renderPlaces();
    $("status").textContent = "";
    $("search").disabled = s.places.length >= MAX_PLACES;
    $("search-note").textContent = s.places.length >= MAX_PLACES ? "That's the most places a plan can have (" + MAX_PLACES + ")." : "";
  }

  // ---------- Adding places ----------

  let found = [];
  let active = -1;
  function showSuggestions() {
    found = TZ.search($("search").value, 8);
    active = found.length ? 0 : -1;
    const list = $("suggestions");
    list.hidden = !$("search").value.trim();
    if (!found.length) return list.replaceChildren(el("li", { class: "muted small none", text: "No match. Try a big city nearby, or a zone name like “Central European Time”." }));
    list.replaceChildren(...found.map((p, i) => {
      const li = el("li", { role: "option", id: "sugg-" + i, class: i === active ? "is-active" : "" }, [
        el("strong", { text: p.label }),
        el("span", { class: "muted", text: [p.country, TZ.zoneName(p.zone)].filter(Boolean).join(" · ") })
      ]);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        add(p);
      });
      return li;
    }));
    $("search").setAttribute("aria-activedescendant", active >= 0 ? "sugg-" + active : "");
  }
  function highlight() {
    [...$("suggestions").children].forEach((li, i) => li.classList.toggle("is-active", i === active));
    $("search").setAttribute("aria-activedescendant", active >= 0 ? "sugg-" + active : "");
  }
  function add(p) {
    if (s.places.length >= MAX_PLACES) return;
    s.places.push(cleanPlace({ label: p.label, zone: p.zone }));
    $("search").value = "";
    $("suggestions").hidden = true;
    save();
    render();
  }
  $("search").addEventListener("input", showSuggestions);
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!found.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (found[active]) add(found[active]);
    } else if (e.key === "Escape") $("suggestions").hidden = true;
  });
  $("search").addEventListener("blur", () => ($("suggestions").hidden = true));

  // ---------- Sharing ----------

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      $("status").textContent = done;
    } catch (e) {
      $("status").textContent = "Your browser didn't allow copying. Here it is to copy by hand: " + text;
    }
  }
  $("copy-text").addEventListener("click", () => {
    const start = startInstant();
    if (start !== null) copy(P.inviteText(start, s.length, s.places, s.hour12), "Copied the times for every place.");
  });
  $("copy-link").addEventListener("click", () => copy(shareLink(), "Copied a link to this plan."));
  $("download-ics").addEventListener("click", () => {
    const start = startInstant();
    if (start === null) return;
    const title = $("title").value.trim() || "Meeting";
    const link = el("a", { download: title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) + ".ics" });
    link.href = URL.createObjectURL(new Blob([P.ics(start, s.length, title, s.places, s.hour12)], { type: "text/calendar" }));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  });

  // Another tab changed the saved places.
  window.addEventListener("storage", (e) => {
    if (e.key !== store.key || shared) return;
    s = clean(store.load({}));
    render();
  });

  // Keep "now" up to date.
  setInterval(() => {
    if (!document.hidden) renderGrid(startInstant());
  }, 60000);

  render();
})();
