// Time zone maths and place search. No page layout here.
// Uses only the browser's built-in time zone database (Intl), so it works
// offline and follows daylight saving rules for any date.
//
//   TZ.valid(zone)                       true if the browser knows the zone
//   TZ.offset(instant, zone)             minutes ahead of UTC at that moment
//   TZ.parts(instant, zone)              { year, month, day, hour, minute, weekday }
//   TZ.toInstant(dateStr, minutes, zone) instant for a wall-clock time in a zone
//   TZ.daySlots(dateStr, zone)           the hours of that day (23, 24 or 25 of them)
//   TZ.search(text)                      places matching a city, country or zone name
//   TZ.clockChanges(dateStr, zones, days) daylight saving changes near a date
(function () {
  "use strict";
  const TZ = (window.TZ = window.TZ || {});
  const HOUR = 3600000;

  const formatters = new Map();
  function fmt(zone) {
    if (!formatters.has(zone)) {
      formatters.set(zone, new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", weekday: "short"
      }));
    }
    return formatters.get(zone);
  }

  TZ.valid = function (zone) {
    try {
      fmt(zone);
      return true;
    } catch (e) {
      return false;
    }
  };

  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  TZ.parts = function (instant, zone) {
    const p = {};
    for (const { type, value } of fmt(zone).formatToParts(instant)) p[type] = value;
    return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: WEEKDAYS[p.weekday] };
  };

  TZ.offset = function (instant, zone) {
    const p = TZ.parts(instant, zone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    return Math.round((asUtc - Math.floor(instant / 60000) * 60000) / 60000);
  };

  // Wall-clock time -> instant. During the spring-forward gap the time doesn't
  // exist, and this returns the instant just after it; in the autumn overlap,
  // the first of the two.
  TZ.toInstant = function (dateStr, minutes, zone) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const wall = Date.UTC(y, m - 1, d) + minutes * 60000;
    // Clock changes never happen twice within a day, so the offsets half a day
    // either side are the only two candidates.
    const before = TZ.offset(wall - 12 * HOUR, zone);
    const after = TZ.offset(wall + 12 * HOUR, zone);
    const fits = [wall - before * 60000, wall - after * 60000].filter((t) => t + TZ.offset(t, zone) * 60000 === wall);
    if (fits.length) return Math.min(...fits);
    return wall - before * 60000; // in the gap: lands just after it
  };

  TZ.addDays = function (dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  };
  TZ.dateOf = (instant, zone) => {
    const p = TZ.parts(instant, zone);
    return p.year + "-" + String(p.month).padStart(2, "0") + "-" + String(p.day).padStart(2, "0");
  };

  // Every hour from midnight to the next midnight in the zone. On days when
  // clocks change there are 23 or 25.
  TZ.daySlots = function (dateStr, zone) {
    const start = TZ.toInstant(dateStr, 0, zone);
    const end = TZ.toInstant(TZ.addDays(dateStr, 1), 0, zone);
    const out = [];
    for (let t = start; t < end; t += HOUR) out.push(t);
    return out;
  };

  // "UTC+5:30"
  TZ.offsetLabel = function (minutes) {
    const sign = minutes < 0 ? "−" : "+";
    const a = Math.abs(minutes);
    return "UTC" + sign + Math.floor(a / 60) + (a % 60 ? ":" + String(a % 60).padStart(2, "0") : "");
  };

  // "Central European Time", "India Standard Time"... in the reader's language.
  const names = new Map();
  TZ.zoneName = function (zone) {
    if (!names.has(zone)) {
      let name = "";
      try {
        const p = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(Date.now());
        name = (p.find((x) => x.type === "timeZoneName") || {}).value || "";
      } catch (e) {
        name = "";
      }
      names.set(zone, name);
    }
    return names.get(zone);
  };

  // ---------- Places ----------

  // Some browsers still report old zone names; show the current spelling.
  const RENAMED = { Calcutta: "Kolkata", Saigon: "Ho Chi Minh", Katmandu: "Kathmandu", Kiev: "Kyiv", Rangoon: "Yangon", Godthab: "Nuuk" };

  let places = null;
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function buildPlaces() {
    const out = [];
    const seen = new Set();
    // Cities from the curated list first: they have countries, and they're what people search for.
    for (const [city, country, zones, aka] of TZ.CITIES) {
      const zone = zones.split("|").find(TZ.valid);
      if (!zone) continue;
      out.push({ label: city, country, zone, aka: aka || "" });
      seen.add(fold(city));
    }
    // Then every zone the browser knows, named after its main city.
    let all = [];
    try {
      all = Intl.supportedValuesOf("timeZone");
    } catch (e) {
      all = [];
    }
    for (const zone of all) {
      const last = zone.split("/").pop().replace(/_/g, " ");
      const city = RENAMED[zone.split("/").pop()] || last;
      if (seen.has(fold(city))) continue;
      seen.add(fold(city));
      out.push({ label: city, country: "", zone, aka: "" });
    }
    for (const p of out) {
      p.search = fold([p.label, p.aka, p.country, p.zone.replace(/_/g, " "), TZ.zoneName(p.zone)].join(" | "));
    }
    return out;
  }

  // Best first: name starts with the text, then a word starts with it, then anywhere.
  TZ.search = function (text, limit) {
    places = places || buildPlaces();
    const q = fold(text.trim());
    if (!q) return [];
    const scored = [];
    for (const p of places) {
      const name = fold(p.label);
      let score;
      if (name === q || fold(p.aka) === q) score = 0;
      else if (fold(p.country) === q) score = 0.5;
      else if (name.startsWith(q) || fold(p.aka).startsWith(q)) score = 1;
      else if (fold(p.country).startsWith(q)) score = 2;
      else if (p.search.includes(" " + q) || p.search.startsWith(q) || p.search.includes("/" + q) || p.search.includes("| " + q)) score = 3;
      else if (p.search.includes(q)) score = 4;
      else continue;
      scored.push([score + (p.country ? 0 : 0.5), p]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label)).slice(0, limit || 8).map((x) => x[1]);
  };

  // A name for the zone this device is set to.
  TZ.localPlace = function () {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    places = places || buildPlaces();
    const exact = places.find((p) => p.zone === zone && !p.country) || places.find((p) => p.zone === zone);
    return { label: exact ? exact.label : zone, zone };
  };

  // Daylight saving changes within `days` of a date, for each zone.
  TZ.clockChanges = function (dateStr, zones, days) {
    const out = [];
    for (const zone of new Set(zones)) {
      let prev = TZ.offset(TZ.toInstant(TZ.addDays(dateStr, -days), 12 * 60, zone), zone);
      for (let i = -days + 1; i <= days; i++) {
        const day = TZ.addDays(dateStr, i);
        const now = TZ.offset(TZ.toInstant(day, 12 * 60, zone), zone);
        if (now !== prev) out.push({ zone, date: day, from: prev, to: now });
        prev = now;
      }
    }
    return out;
  };
})();
