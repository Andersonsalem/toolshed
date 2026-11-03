// Units, their definitions, and conversion. No page layout here.
//
// Each unit converts to its category's base unit, either by a factor
// (value × factor = base) or, for temperature and fuel economy, by a pair of
// functions. "exact: true" means the factor is exact by definition (e.g. the
// inch is defined as exactly 25.4 mm), not a rounded measurement.
//
//   Units.CATEGORIES                       [{ id, name, base, units: [...] }]
//   Units.convert(value, fromUnit, toUnit) number
//   Units.parse(text)                      { value } or { value, unit } for "5 ft 11 in", or { error }
//   Units.format(number)                   readable text, up to 10 significant digits
//   Units.explain(from, to)                "1 mi = 1.609344 km (exact)" or a formula
(function () {
  "use strict";
  const U = (window.Units = window.Units || {});

  // [id, name, symbol, factor to base, group, exact, other names for search]
  const lin = (id, name, symbol, factor, group, exact, aka) => ({ id, name, symbol, factor, group, exact: !!exact, aka: aka || "" });

  U.CATEGORIES = [
    {
      id: "length", name: "Length", base: "m",
      units: [
        lin("mm", "millimeter", "mm", 0.001, "Metric", true),
        lin("cm", "centimeter", "cm", 0.01, "Metric", true),
        lin("m", "meter", "m", 1, "Metric", true, "metre"),
        lin("km", "kilometer", "km", 1000, "Metric", true, "kilometre"),
        lin("in", "inch", "in", 0.0254, "US / Imperial", true, "inches \""),
        lin("ft", "foot", "ft", 0.3048, "US / Imperial", true, "feet '"),
        lin("yd", "yard", "yd", 0.9144, "US / Imperial", true),
        lin("mi", "mile", "mi", 1609.344, "US / Imperial", true),
        lin("nmi", "nautical mile", "nmi", 1852, "Other", true, "nm"),
        lin("um", "micrometer", "µm", 1e-6, "Metric", true, "micron"),
        lin("nm-len", "nanometer", "nm", 1e-9, "Metric", true),
        lin("ly", "light-year", "ly", 9460730472580800, "Other", true)
      ]
    },
    {
      id: "mass", name: "Weight / mass", base: "kg",
      units: [
        lin("mg", "milligram", "mg", 1e-6, "Metric", true),
        lin("g", "gram", "g", 0.001, "Metric", true),
        lin("kg", "kilogram", "kg", 1, "Metric", true, "kilo"),
        lin("t", "tonne (metric ton)", "t", 1000, "Metric", true, "metric ton"),
        lin("oz", "ounce", "oz", 0.028349523125, "US / Imperial", true),
        lin("lb", "pound", "lb", 0.45359237, "US / Imperial", true, "lbs"),
        lin("st", "stone", "st", 6.35029318, "Imperial (UK)", true),
        lin("ton-us", "short ton (US)", "ton", 907.18474, "US", true),
        lin("ton-uk", "long ton (UK)", "long ton", 1016.0469088, "Imperial (UK)", true),
        lin("ozt", "troy ounce (gold, silver)", "oz t", 0.0311034768, "Other", true),
        lin("ct", "carat (gems)", "ct", 0.0002, "Other", true)
      ]
    },
    {
      id: "temperature", name: "Temperature", base: "°C",
      units: [
        { id: "c", name: "Celsius", symbol: "°C", group: "", exact: true, toBase: (v) => v, fromBase: (v) => v, aka: "centigrade" },
        { id: "f", name: "Fahrenheit", symbol: "°F", group: "", exact: true, toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
        { id: "k", name: "kelvin", symbol: "K", group: "", exact: true, toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
        { id: "r", name: "Rankine", symbol: "°R", group: "", exact: true, toBase: (v) => ((v - 491.67) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 491.67 }
      ],
      formulas: { c: "°C", f: "°F = °C × 9/5 + 32", k: "K = °C + 273.15", r: "°R = (°C + 273.15) × 9/5" }
    },
    {
      id: "volume", name: "Volume (and cooking)", base: "L",
      units: [
        lin("ml", "milliliter", "mL", 0.001, "Metric", true, "millilitre cc"),
        lin("l", "liter", "L", 1, "Metric", true, "litre"),
        lin("m3", "cubic meter", "m³", 1000, "Metric", true),
        lin("tsp", "teaspoon (US)", "tsp", 0.00492892159375, "US", true),
        lin("tbsp", "tablespoon (US)", "tbsp", 0.01478676478125, "US", true),
        lin("floz", "fluid ounce (US)", "fl oz", 0.0295735295625, "US", true),
        lin("cup", "cup (US)", "cup", 0.2365882365, "US", true),
        lin("pt", "pint (US)", "pt", 0.473176473, "US", true),
        lin("qt", "quart (US)", "qt", 0.946352946, "US", true),
        lin("gal", "gallon (US)", "gal", 3.785411784, "US", true),
        lin("cup-m", "cup (metric, 250 mL)", "cup", 0.25, "Metric", true, "australia canada"),
        lin("tbsp-m", "tablespoon (metric, 15 mL)", "tbsp", 0.015, "Metric", true),
        lin("tsp-m", "teaspoon (metric, 5 mL)", "tsp", 0.005, "Metric", true),
        lin("floz-uk", "fluid ounce (UK)", "fl oz", 0.0284130625, "Imperial (UK)", true),
        lin("pt-uk", "pint (UK)", "pt", 0.56826125, "Imperial (UK)", true),
        lin("gal-uk", "gallon (UK)", "gal", 4.54609, "Imperial (UK)", true),
        lin("in3", "cubic inch", "in³", 0.016387064, "US / Imperial", true),
        lin("ft3", "cubic foot", "ft³", 28.316846592, "US / Imperial", true)
      ]
    },
    {
      id: "area", name: "Area", base: "m²",
      units: [
        lin("cm2", "square centimeter", "cm²", 0.0001, "Metric", true),
        lin("m2", "square meter", "m²", 1, "Metric", true, "sqm"),
        lin("ha", "hectare", "ha", 10000, "Metric", true),
        lin("km2", "square kilometer", "km²", 1e6, "Metric", true),
        lin("in2", "square inch", "in²", 0.00064516, "US / Imperial", true),
        lin("ft2", "square foot", "ft²", 0.09290304, "US / Imperial", true, "sqft sq ft"),
        lin("yd2", "square yard", "yd²", 0.83612736, "US / Imperial", true),
        lin("acre", "acre", "ac", 4046.8564224, "US / Imperial", true),
        lin("mi2", "square mile", "mi²", 2589988.110336, "US / Imperial", true)
      ]
    },
    {
      id: "speed", name: "Speed", base: "m/s",
      units: [
        lin("ms", "meters per second", "m/s", 1, "Metric", true),
        lin("kmh", "kilometers per hour", "km/h", 1 / 3.6, "Metric", true, "kph"),
        lin("mph", "miles per hour", "mph", 0.44704, "US / Imperial", true),
        lin("fts", "feet per second", "ft/s", 0.3048, "US / Imperial", true),
        lin("kn", "knot", "kn", 1852 / 3600, "Other", true, "knots"),
        lin("pace-km", "minutes per kilometer (running pace)", "min/km", null, "Pace", true),
        lin("pace-mi", "minutes per mile (running pace)", "min/mi", null, "Pace", true)
      ]
    },
    {
      id: "time", name: "Time", base: "s",
      units: [
        lin("ms-t", "millisecond", "ms", 0.001, "", true),
        lin("s", "second", "s", 1, "", true),
        lin("min", "minute", "min", 60, "", true),
        lin("h", "hour", "h", 3600, "", true),
        lin("d", "day", "d", 86400, "", true),
        lin("wk", "week", "wk", 604800, "", true),
        lin("mo", "month (average)", "mo", 2629746, "", false),
        lin("yr", "year (average)", "yr", 31556952, "", false)
      ],
      note: "Months and years vary in length, so these use the average over the 400-year calendar cycle: a year of 365.2425 days and a month of 30.436875 days."
    },
    {
      id: "data", name: "Data size", base: "B",
      units: [
        lin("bit", "bit", "bit", 0.125, "", true),
        lin("B", "byte", "B", 1, "", true),
        lin("kB", "kilobyte (1,000 bytes)", "kB", 1e3, "Decimal (drives, networks)", true),
        lin("MB", "megabyte (1,000² bytes)", "MB", 1e6, "Decimal (drives, networks)", true),
        lin("GB", "gigabyte (1,000³ bytes)", "GB", 1e9, "Decimal (drives, networks)", true),
        lin("TB", "terabyte (1,000⁴ bytes)", "TB", 1e12, "Decimal (drives, networks)", true),
        lin("KiB", "kibibyte (1,024 bytes)", "KiB", 1024, "Binary (memory, Windows)", true),
        lin("MiB", "mebibyte (1,024² bytes)", "MiB", 1048576, "Binary (memory, Windows)", true),
        lin("GiB", "gibibyte (1,024³ bytes)", "GiB", 1073741824, "Binary (memory, Windows)", true),
        lin("TiB", "tebibyte (1,024⁴ bytes)", "TiB", 1099511627776, "Binary (memory, Windows)", true),
        lin("Mbit", "megabit (internet speeds)", "Mbit", 125000, "Decimal (drives, networks)", true, "mbps")
      ],
      note: "Drive makers use 1 GB = 1,000,000,000 bytes, while Windows and memory sizes count in 1,024s (GiB) but often still write \"GB\". That's why a \"1 TB\" drive shows as about 931 GB in Windows."
    },
    {
      id: "energy", name: "Energy", base: "J",
      units: [
        lin("J", "joule", "J", 1, "Metric", true),
        lin("kJ", "kilojoule", "kJ", 1000, "Metric", true),
        lin("cal", "calorie (small)", "cal", 4.184, "Food and heat", true),
        lin("kcal", "kilocalorie (food Calorie)", "kcal", 4184, "Food and heat", true, "Cal calories food"),
        lin("Wh", "watt-hour", "Wh", 3600, "Electricity", true),
        lin("kWh", "kilowatt-hour", "kWh", 3.6e6, "Electricity", true),
        lin("BTU", "British thermal unit", "BTU", 1055.05585262, "Food and heat", true),
        lin("eV", "electronvolt", "eV", 1.602176634e-19, "Other", true)
      ],
      note: "Food labels' \"Calories\" are kilocalories (kcal). Calories here are thermochemical (1 cal = 4.184 J); BTU is the International Table BTU."
    },
    {
      id: "pressure", name: "Pressure", base: "Pa",
      units: [
        lin("Pa", "pascal", "Pa", 1, "Metric", true),
        lin("kPa", "kilopascal", "kPa", 1000, "Metric", true),
        lin("bar", "bar", "bar", 100000, "Metric", true),
        lin("mbar", "millibar (hectopascal)", "mbar", 100, "Metric", true, "hpa"),
        lin("psi", "pounds per square inch", "psi", 6894.757293168361, "US / Imperial", true, "tire tyre"),
        lin("atm", "standard atmosphere", "atm", 101325, "Other", true),
        lin("mmHg", "millimeter of mercury", "mmHg", 133.322387415, "Other", true, "blood pressure torr"),
        lin("inHg", "inch of mercury", "inHg", 3386.389, "Other", false)
      ]
    },
    {
      id: "power", name: "Power", base: "W",
      units: [
        lin("W", "watt", "W", 1, "Metric", true),
        lin("kW", "kilowatt", "kW", 1000, "Metric", true),
        lin("hp", "horsepower (mechanical)", "hp", 745.69987158227022, "US / Imperial", true),
        lin("PS", "metric horsepower", "PS", 735.49875, "Metric", true, "cv ch pk"),
        lin("BTUh", "BTU per hour", "BTU/h", 1055.05585262 / 3600, "US / Imperial", true, "air conditioner")
      ]
    },
    {
      id: "fuel", name: "Fuel economy", base: "L/100 km",
      units: [
        { id: "l100", name: "liters per 100 km", symbol: "L/100 km", group: "", exact: true, toBase: (v) => v, fromBase: (v) => v },
        { id: "kml", name: "kilometers per liter", symbol: "km/L", group: "", exact: true, toBase: (v) => 100 / v, fromBase: (v) => 100 / v },
        { id: "mpg", name: "miles per gallon (US)", symbol: "mpg (US)", group: "", exact: true, toBase: (v) => (100 * 3.785411784) / 1.609344 / v, fromBase: (v) => (100 * 3.785411784) / 1.609344 / v },
        { id: "mpg-uk", name: "miles per gallon (UK)", symbol: "mpg (UK)", group: "", exact: true, toBase: (v) => (100 * 4.54609) / 1.609344 / v, fromBase: (v) => (100 * 4.54609) / 1.609344 / v }
      ],
      formulas: { l100: "L/100 km", kml: "km/L = 100 ÷ (L/100 km)", mpg: "mpg (US) = 235.215 ÷ (L/100 km)", "mpg-uk": "mpg (UK) = 282.481 ÷ (L/100 km)" },
      note: "Lower L/100 km is better, but higher mpg and km/L are better, so these convert by dividing, not multiplying. US and UK gallons differ: 30 mpg (US) is 36 mpg (UK)."
    },
    {
      id: "angle", name: "Angle", base: "°",
      units: [
        lin("deg", "degree", "°", 1, "", true),
        lin("rad", "radian", "rad", 180 / Math.PI, "", true),
        lin("grad", "gradian", "grad", 0.9, "", true),
        lin("turn", "turn (full circle)", "turn", 360, "", true),
        lin("arcmin", "arcminute", "′", 1 / 60, "", true),
        lin("arcsec", "arcsecond", "″", 1 / 3600, "", true)
      ]
    }
  ];

  // Running pace converts as the inverse of speed: minutes per distance.
  const speed = U.CATEGORIES.find((c) => c.id === "speed");
  for (const u of speed.units) {
    if (u.id === "pace-km") Object.assign(u, { toBase: (v) => 1000 / (v * 60), fromBase: (v) => 1000 / (v * 60), factor: undefined });
    if (u.id === "pace-mi") Object.assign(u, { toBase: (v) => 1609.344 / (v * 60), fromBase: (v) => 1609.344 / (v * 60), factor: undefined });
  }
  speed.note = "Paces are in decimal minutes: 5.5 min/km means 5 minutes 30 seconds per kilometer. The result also shows minutes and seconds.";

  U.category = (id) => U.CATEGORIES.find((c) => c.id === id);
  U.unit = (cat, id) => cat.units.find((u) => u.id === id);

  const toBase = (v, u) => (u.toBase ? u.toBase(v) : v * u.factor);
  const fromBase = (v, u) => (u.fromBase ? u.fromBase(v) : v / u.factor);
  U.convert = (value, from, to) => (from === to ? value : fromBase(toBase(value, from), to));

  // ---------- Reading what people type ----------

  // Accepts "1,234.5", "1 234,5" (comma decimals), "1e6", "3/4", "1 1/2" and "-40".
  function number(text) {
    let t = text.trim().replace(/[  ']/g, " ").replace(/^\+/, "").replace(/−/g, "-");
    if (!t) return null;
    let m = t.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) return (Number(m[1]) < 0 ? -1 : 1) * (Math.abs(Number(m[1])) + Number(m[2]) / Number(m[3]));
    m = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
    t = t.replace(/ /g, "");
    // One comma and no dot, not followed by exactly three digits: a decimal comma ("2,5").
    if (/^-?\d+,\d+$/.test(t) && !/^-?\d{1,3},\d{3}$/.test(t)) t = t.replace(",", ".");
    // Dots as thousands and a comma decimal ("1.234,5").
    else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,(?=\d{3}(\D|$))/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  // Two-part amounts people write: 5 ft 11 in, 5'11", 11 st 4 lb, 3 lb 4 oz, 1 h 30 min, 5:30 (pace).
  const COMPOUND = [
    { re: /^(-?[\d.,]+)\s*(?:'|’|ft|feet|foot)\s*([\d.,]+)?\s*(?:"|”|''|in|inch|inches)?$/i, cat: "length", unit: "ft", big: 1, small: 1 / 12 },
    { re: /^(-?[\d.,]+)\s*(?:st|stone|stones)\s*([\d.,]+)?\s*(?:lb|lbs|pounds?)?$/i, cat: "mass", unit: "st", big: 1, small: 1 / 14 },
    { re: /^(-?[\d.,]+)\s*(?:lb|lbs|pounds?)\s*([\d.,]+)\s*(?:oz|ounces?)?$/i, cat: "mass", unit: "lb", big: 1, small: 1 / 16 },
    { re: /^(-?[\d.,]+)\s*(?:h|hr|hrs|hours?)\s*([\d.,]+)\s*(?:m|min|mins|minutes?)?$/i, cat: "time", unit: "h", big: 1, small: 1 / 60 },
    { re: /^(\d+):([0-5]\d(?:\.\d+)?)$/, cat: "speed", unit: null, big: 1, small: 1 / 60 }
  ];

  U.parse = function (text) {
    const n = number(text);
    if (n !== null) return { value: n };
    for (const c of COMPOUND) {
      const m = text.trim().match(c.re);
      if (!m) continue;
      const a = number(m[1]);
      const b = m[2] === undefined ? 0 : number(m[2]);
      if (a === null || b === null) continue;
      return { value: a * c.big + Math.sign(a || 1) * b * c.small, cat: c.cat, unit: c.unit };
    }
    return { error: "Type a number, like 12.5, 3/4 or 1,250. You can also type 5 ft 11 in, 11 st 4 lb or 1 h 30 min." };
  };

  // ---------- Showing numbers ----------

  const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  U.format = function (n, digits) {
    if (!Number.isFinite(n)) return "—";
    if (n === 0) return "0";
    const a = Math.abs(n);
    if (a >= 1e15 || a < 1e-6) {
      const [m, e] = n.toExponential(Math.min(digits || 10, 10) - 1).split("e");
      const mant = String(Number(m));
      return mant + " × 10" + String(Number(e)).replace(/./g, (c) => SUP[c]);
    }
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: digits || 10 }).format(n);
  };

  // "5 ft 10.87 in" style extras for results people usually want in two parts.
  U.extra = function (cat, unit, value) {
    if (!Number.isFinite(value)) return "";
    const two = (v, bigName, smallName, perBig, decimals) => {
      const sign = v < 0 ? "−" : "";
      v = Math.abs(v);
      let big = Math.floor(v);
      let small = Number(((v - big) * perBig).toFixed(decimals));
      if (small >= perBig) {
        big += 1;
        small = 0;
      }
      return sign + big + " " + bigName + " " + small + " " + smallName;
    };
    // Only for everyday sizes: "3,280 ft 10 in" helps nobody.
    if (cat.id === "length" && Math.abs(U.convert(value, unit, U.unit(cat, "m"))) < 1000) return two(U.convert(value, unit, U.unit(cat, "ft")), "ft", "in", 12, 1);
    if (cat.id === "mass" && Math.abs(U.convert(value, unit, U.unit(cat, "kg"))) < 1000) {
      return two(U.convert(value, unit, U.unit(cat, "lb")), "lb", "oz", 16, 1) + " · " + two(U.convert(value, unit, U.unit(cat, "st")), "st", "lb", 14, 1);
    }
    if (cat.id === "time") return U.duration(U.convert(value, unit, U.unit(cat, "s")));
    if (cat.id === "speed" && unit.id.startsWith("pace") && value > 0) {
      const sec = Math.round(value * 60);
      return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + " " + unit.symbol;
    }
    return "";
  };

  // 5400 -> "1 h 30 min"
  U.duration = function (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1e12) return "";
    const parts = [];
    let s = Math.round(seconds * 1000) / 1000;
    for (const [name, size] of [["d", 86400], ["h", 3600], ["min", 60]]) {
      if (s >= size) {
        parts.push(Math.floor(s / size) + " " + name);
        s -= Math.floor(s / size) * size;
      }
    }
    if (s || !parts.length) parts.push(Number(s.toFixed(3)) + " s");
    return parts.join(" ");
  };

  // How the conversion works, in one line.
  U.explain = function (cat, from, to) {
    if (from === to) return "";
    // Temperature and fuel economy: show the formulas involved.
    if (cat.formulas) return [from, to].map((u) => cat.formulas[u.id]).filter((f) => f.includes("=")).join("; ");
    if (from.toBase || to.toBase) return "Pace and speed are inverses: the faster the speed, the fewer minutes per distance.";
    const ratio = from.factor / to.factor;
    // "(exact)" only when the ratio is a short decimal, not a rounded 0.3333…
    const r = Number(ratio.toPrecision(12));
    const digits = r.toExponential().split("e")[0].replace(/[-.]/g, "").length;
    const note = !(from.exact && to.exact) ? " (rounded)" : digits <= 11 ? " (exact)" : " (rounded)";
    return "1 " + from.symbol + " = " + U.format(ratio, 12) + " " + to.symbol + note;
  };

  // Every unit, for search: [category, unit, text].
  U.searchIndex = function () {
    const out = [];
    const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const cat of U.CATEGORIES) for (const u of cat.units) out.push({ cat, unit: u, text: fold([u.name, u.symbol, u.id, u.aka, cat.name].join(" ")) });
    return out;
  };
})();
