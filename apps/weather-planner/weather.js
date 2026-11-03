// Weather data from Open-Meteo (through shared/net.js) and the planner's math.
// No page layout here.
//
//   await Weather.search(text)         -> [{ name, region, country, lat, lon }]
//   await Weather.forecast(lat, lon)   -> { now, hours: [...], days: [...] } in °C and km/h
//   Weather.describe(code, isDay)      -> { text, icon }
//   Weather.windows(hours, activity, startIndex) -> best time slots
(function () {
  "use strict";
  const W = (window.Weather = window.Weather || {});

  const FORECAST_CACHE_MIN = 30;
  const SEARCH_CACHE_MIN = 24 * 60;

  // Locations are rounded to 2 decimals (about 1 km) before they're sent anywhere.
  const round = (v) => Math.round(v * 100) / 100;

  W.search = async function (text) {
    const lang = (navigator.language || "en").slice(0, 2);
    const url = "https://geocoding-api.open-meteo.com/v1/search?count=6&format=json&language=" + encodeURIComponent(lang) +
      "&name=" + encodeURIComponent(text.trim());
    const data = await Net.getJSON("open-meteo", url, { cacheMinutes: SEARCH_CACHE_MIN });
    return (data.results || []).map((r) => ({
      name: r.name,
      region: r.admin1 || "",
      country: r.country || r.country_code || "",
      lat: round(r.latitude),
      lon: round(r.longitude)
    }));
  };

  const HOURLY = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m", "uv_index", "is_day"];
  const DAILY = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "precipitation_sum", "wind_speed_10m_max", "sunrise", "sunset", "uv_index_max"];
  const CURRENT = ["temperature_2m", "apparent_temperature", "weather_code", "wind_speed_10m", "is_day"];

  // Always fetched in °C and km/h (one cached copy per place); converted for display.
  W.forecast = async function (lat, lon) {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + round(lat) + "&longitude=" + round(lon) +
      "&hourly=" + HOURLY.join(",") + "&daily=" + DAILY.join(",") + "&current=" + CURRENT.join(",") +
      "&timezone=auto&forecast_days=7";
    const d = await Net.getJSON("open-meteo", url, { cacheMinutes: FORECAST_CACHE_MIN });
    if (!d || !d.hourly || !d.daily) throw new Error("Open-Meteo's answer was missing the forecast.");

    const hours = d.hourly.time.map((time, i) => ({
      time, // local time at the place, like "2026-10-31T14:00"
      temp: d.hourly.temperature_2m[i],
      feels: d.hourly.apparent_temperature[i],
      rainChance: d.hourly.precipitation_probability[i] ?? 0,
      rain: d.hourly.precipitation[i] ?? 0,
      code: d.hourly.weather_code[i],
      wind: d.hourly.wind_speed_10m[i],
      uv: d.hourly.uv_index[i] ?? 0,
      day: d.hourly.is_day[i] === 1
    }));
    const days = d.daily.time.map((date, i) => ({
      date,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      rainChance: d.daily.precipitation_probability_max[i] ?? 0,
      rain: d.daily.precipitation_sum[i] ?? 0,
      wind: d.daily.wind_speed_10m_max[i],
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
      uv: d.daily.uv_index_max[i] ?? 0
    }));
    const c = d.current || {};
    // The forecast hour that "now" falls in, in the place's own time zone.
    const nowHour = (c.time || hours[0].time).slice(0, 13);
    const nowIndex = Math.max(0, hours.findIndex((h) => h.time.slice(0, 13) === nowHour));
    return {
      timezone: d.timezone_abbreviation || d.timezone || "",
      fetchedAt: Date.now(),
      now: { time: c.time, temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, wind: c.wind_speed_10m, day: c.is_day === 1, rainChance: hours[nowIndex].rainChance },
      nowIndex,
      hours,
      days
    };
  };

  // WMO weather codes, as Open-Meteo reports them.
  const CODES = {
    0: ["Clear", "☀️", "🌙"],
    1: ["Mostly clear", "🌤️", "🌙"],
    2: ["Partly cloudy", "⛅", "☁️"],
    3: ["Cloudy", "☁️", "☁️"],
    45: ["Fog", "🌫️"], 48: ["Freezing fog", "🌫️"],
    51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
    56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
    61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
    66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
    71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
    80: ["Light showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "🌧️"],
    85: ["Snow showers", "🌨️"], 86: ["Heavy snow showers", "❄️"],
    95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm with hail", "⛈️"], 99: ["Thunderstorm with hail", "⛈️"]
  };
  W.describe = function (code, isDay) {
    const c = CODES[code] || ["Unknown", "❔"];
    return { text: c[0], icon: !isDay && c[2] ? c[2] : c[1] };
  };

  // ---------- Units ----------

  W.temp = (c, units) => (units.temp === "F" ? (c * 9) / 5 + 32 : c);
  W.tempBack = (v, units) => (units.temp === "F" ? ((v - 32) * 5) / 9 : v);
  W.speed = (kmh, units) => (units.wind === "mph" ? kmh * 0.621371 : kmh);
  W.speedBack = (v, units) => (units.wind === "mph" ? v / 0.621371 : v);

  // ---------- Planner ----------

  // Criteria are stored in °C and km/h. Presets are reasonable starting points
  // that people can change; they're not advice.
  W.ACTIVITIES = [
    { id: "run", name: "Run", min: 4, max: 20, rainChance: 20, wind: 25, daylight: true, hours: 1 },
    { id: "walk", name: "Walk", min: 6, max: 27, rainChance: 30, wind: 30, daylight: true, hours: 1 },
    { id: "bike", name: "Bike ride", min: 10, max: 27, rainChance: 20, wind: 20, daylight: true, hours: 2 },
    { id: "picnic", name: "Picnic or barbecue", min: 17, max: 30, rainChance: 10, wind: 20, daylight: true, hours: 3 },
    { id: "laundry", name: "Dry laundry outside", min: 10, max: 45, rainChance: 10, wind: 40, daylight: true, hours: 4 },
    { id: "garden", name: "Gardening or outdoor jobs", min: 8, max: 28, rainChance: 30, wind: 30, daylight: true, hours: 2 }
  ];

  // Why an hour doesn't suit, or "" if it does.
  W.problem = function (h, a) {
    if (a.daylight && !h.day) return "dark";
    if (h.feels < a.min) return "cold";
    if (h.feels > a.max) return "hot";
    if (h.rainChance > a.rainChance || h.rain > 0.5) return "rain";
    if (h.wind > a.wind) return "wind";
    return "";
  };

  // Higher is better: comfortable temperature, low rain chance, light wind.
  function comfort(h, a) {
    const mid = (a.min + a.max) / 2;
    const half = Math.max(1, (a.max - a.min) / 2);
    return 0.5 * (1 - Math.min(1, Math.abs(h.feels - mid) / half)) +
      0.3 * (1 - h.rainChance / 100) +
      0.2 * (1 - Math.min(1, h.wind / Math.max(1, a.wind)));
  }

  // Up to `limit` non-overlapping slots of a.hours suitable hours in a row,
  // best first. Also counts why other hours didn't suit, for the summary.
  W.windows = function (hours, a, startIndex, limit) {
    const length = Math.max(1, Math.round(a.hours));
    const ok = hours.map((h, i) => i >= startIndex && !W.problem(h, a));
    const reasons = {};
    hours.forEach((h, i) => {
      if (i < startIndex) return;
      const p = W.problem(h, a);
      if (p && p !== "dark") reasons[p] = (reasons[p] || 0) + 1;
    });

    const candidates = [];
    for (let i = startIndex; i + length <= hours.length; i++) {
      let fits = true;
      let score = 0;
      for (let k = i; k < i + length; k++) {
        if (!ok[k]) {
          fits = false;
          break;
        }
        score += comfort(hours[k], a);
      }
      // A small nudge towards sooner slots: forecasts get less reliable each day out,
      // so a nearly-as-good slot tomorrow beats one five days away.
      if (fits) candidates.push({ start: i, end: i + length, score: score / length - 0.01 * Math.floor((i - startIndex) / 24) });
    }
    candidates.sort((x, y) => y.score - x.score || x.start - y.start);
    const picked = [];
    for (const c of candidates) {
      if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
      picked.push(c);
      if (picked.length >= (limit || 5)) break;
    }
    return { slots: picked, ok, reasons };
  };
})();
