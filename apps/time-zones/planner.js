// Meeting planning: which hours suit whom, best times, invite text and .ics.
// No page layout here; time zone maths is in tz.js.
//
//   place = { label, zone, start, end, days }   start/end: working hours (0-24),
//                                                days: key of Planner.WORKDAYS
//   Planner.kind(instant, place)       "work" | "edge" | "night" (and .weekend)
//   Planner.fits(start, minutes, place) true if the whole meeting is in working hours
//   Planner.best(slots, places, minutes) ranges of slots, best first
//   Planner.ics(start, minutes, title, places) calendar file text
(function () {
  "use strict";
  const TZ = window.TZ;
  const P = (window.Planner = window.Planner || {});

  // Which days are working days (0 = Sunday).
  P.WORKDAYS = {
    "mon-fri": { label: "Monday to Friday", days: [1, 2, 3, 4, 5] },
    "sun-thu": { label: "Sunday to Thursday", days: [0, 1, 2, 3, 4] },
    "sat-wed": { label: "Saturday to Wednesday", days: [6, 0, 1, 2, 3] },
    "every": { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] }
  };
  // Countries where the work week is usually Sunday to Thursday or Saturday to
  // Wednesday. Only a starting point: people can change it per place.
  const SUN_THU = ["Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "Asia/Qatar", "Asia/Muscat", "Asia/Jerusalem", "Africa/Cairo", "Asia/Baghdad", "Asia/Amman"];
  const SAT_WED = ["Asia/Tehran", "Asia/Kabul"];
  P.defaultDays = (zone) => (SUN_THU.includes(zone) ? "sun-thu" : SAT_WED.includes(zone) ? "sat-wed" : "mon-fri");

  // Awake but not working: from 7:00 until work starts, and from work's end until 22:00.
  P.WAKE = 7;
  P.SLEEP = 22;

  const minutesOf = (p) => p.hour * 60 + p.minute;

  P.kind = function (instant, place) {
    const p = TZ.parts(instant, place.zone);
    const m = minutesOf(p);
    const workday = P.WORKDAYS[place.days].days.includes(p.weekday);
    let kind;
    if (workday && m >= place.start * 60 && m < place.end * 60) kind = "work";
    else if (m >= P.WAKE * 60 && m < P.SLEEP * 60) kind = "edge";
    else kind = "night";
    return { kind, weekend: !workday, parts: p };
  };

  // The whole meeting, start to end, falls in one stretch of working hours.
  P.fits = function (start, minutes, place) {
    const a = P.kind(start, place);
    const b = P.kind(start + minutes * 60000 - 60000, place);
    return a.kind === "work" && b.kind === "work" && a.parts.day === b.parts.day;
  };
  // Not asleep: everyone between 7:00 and 22:00 for the whole meeting.
  P.awake = function (start, minutes, place) {
    const a = P.kind(start, place).kind;
    const b = P.kind(start + minutes * 60000 - 60000, place).kind;
    return a !== "night" && b !== "night";
  };

  // Groups neighbouring start times with the same result into ranges.
  // Returns { all: [...], most: [...], countAll } where each range is
  // { from, to (last start), working: n, outside: [labels] }.
  P.best = function (slots, places, minutes) {
    const rows = slots.map((t) => {
      const outside = places.filter((pl) => !P.fits(t, minutes, pl));
      const asleep = places.filter((pl) => !P.awake(t, minutes, pl));
      return { t, working: places.length - outside.length, outside: outside.map((p) => p.label), asleep: asleep.length, asleepLabels: asleep.map((p) => p.label) };
    });
    const max = Math.max(0, ...rows.map((r) => r.working));
    const ranges = [];
    for (const r of rows) {
      if (r.working !== max || max === 0) continue;
      const last = ranges[ranges.length - 1];
      if (last && last.to === r.t - 3600000 && last.key === r.outside.join("|") + "#" + r.asleepLabels.join("|")) last.to = r.t;
      else ranges.push({ from: r.t, to: r.t, working: r.working, outside: r.outside, key: r.outside.join("|") + "#" + r.asleepLabels.join("|"), asleep: r.asleep, asleepLabels: r.asleepLabels });
    }
    // Among equally good ranges, ones where nobody is asleep come first.
    ranges.sort((a, b) => a.asleep - b.asleep || a.from - b.from);
    return { ranges, max, total: places.length };
  };

  // ---------- Sharing the result ----------

  P.formatTime = (instant, zone, hour12) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit", hour12 }).format(instant);
  P.formatDay = (instant, zone) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(instant);

  // "Tue 3 Nov, 15:00 – 16:00"
  P.span = function (start, minutes, zone, hour12) {
    const end = start + minutes * 60000;
    const d1 = P.formatDay(start, zone), d2 = P.formatDay(end, zone);
    return d1 + ", " + P.formatTime(start, zone, hour12) + " – " + (d2 !== d1 ? d2 + ", " : "") + P.formatTime(end, zone, hour12);
  };

  P.inviteText = function (start, minutes, places, hour12) {
    const lines = places.map((p) => "• " + p.label + ": " + P.span(start, minutes, p.zone, hour12));
    lines.push("• UTC: " + P.span(start, minutes, "UTC", false));
    return lines.join("\n");
  };

  const icsTime = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // Text in .ics files escapes backslashes, semicolons, commas and line breaks.
  const icsText = (s) => s.replace(/\\/g, "\\\\").replace(/[;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

  P.ics = function (start, minutes, title, places, hour12) {
    const uid = Date.now().toString(36) + Math.random().toString(36).slice(2) + "@toolshed";
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Toolshed//Time Zone Planner//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + icsTime(Date.now()),
      "DTSTART:" + icsTime(start),
      "DTEND:" + icsTime(start + minutes * 60000),
      "SUMMARY:" + icsText(title),
      "DESCRIPTION:" + icsText(P.inviteText(start, minutes, places, hour12)),
      "END:VEVENT",
      "END:VCALENDAR"
    ].map(foldLine).join("\r\n") + "\r\n";
  };

  // Calendar files wrap lines longer than 75 bytes: the rest goes on the next line after a space.
  function foldLine(line) {
    const chars = [...line];
    if (new TextEncoder().encode(line).length <= 75) return line;
    const out = [];
    let cur = "", bytes = 0;
    for (const c of chars) {
      const n = new TextEncoder().encode(c).length;
      if (bytes + n > (out.length ? 74 : 75)) {
        out.push(cur);
        cur = "";
        bytes = 0;
      }
      cur += c;
      bytes += n;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
})();
