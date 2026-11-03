// Wikipedia API calls and the path search. No page layout here.
// Every request goes through shared/net.js (allow-list, rate limits, back-off).
//
//   WP.setLanguage("en")
//   await WP.suggest(text)                  -> ["Title", ...]
//   await WP.find(from, to, onProgress)     -> { paths, from, to, checked, requests, complete }
//   await WP.summaries(titles)              -> Map title -> { title, description, extract, image, url }
(function () {
  "use strict";
  const WP = (window.WikiPaths = window.WikiPaths || {});

  // How much one search may ask Wikipedia. Raising these finds more paths but
  // costs Wikipedia more; keep them modest.
  const BUDGET = 45; // requests per search
  const MAX_FROM = 500; // links from the start page that are checked
  const MAX_TO = 1000; // pages linking to the goal that are fetched
  const MIDDLE_BATCHES = 3; // groups of 49 "pages linking to the goal" tried as the third step
  const WANT_PATHS = 6;

  let lang = "en";
  WP.LANGUAGES = { en: "English", es: "Español", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português" };
  WP.setLanguage = (l) => {
    if (WP.LANGUAGES[l]) lang = l;
  };
  WP.articleUrl = (title) => "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));

  function apiUrl(params) {
    const q = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    return "https://" + lang + ".wikipedia.org/w/api.php?" + q.toString();
  }

  // ---------- Small lookups (cached in the browser for a day) ----------

  WP.suggest = async function (text) {
    const t = text.trim();
    if (t.length < 2) return [];
    const data = await Net.getJSON("wikipedia", apiUrl({ action: "query", list: "prefixsearch", pssearch: t, psnamespace: "0", pslimit: "6" }), { cacheMinutes: 24 * 60 });
    return ((data.query && data.query.prefixsearch) || []).map((p) => p.title);
  };

  // The article's real title (following redirects), or null if it doesn't exist.
  async function resolve(title, count) {
    count();
    const data = await Net.getJSON("wikipedia", apiUrl({ action: "query", titles: title.trim(), redirects: "1" }), { cacheMinutes: 24 * 60 });
    const page = data.query && data.query.pages && data.query.pages[0];
    if (!page || page.missing || page.invalid || page.ns !== 0) return null;
    return page.title;
  }

  WP.summaries = async function (titles) {
    const result = new Map();
    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const data = await Net.getJSON("wikipedia", apiUrl({
        action: "query", titles: batch.join("|"), prop: "extracts|pageimages|description",
        exintro: "1", explaintext: "1", exsentences: "2", exlimit: "20",
        piprop: "thumbnail", pithumbsize: "240", pilimit: "20"
      }), { cacheMinutes: 24 * 60 });
      for (const p of (data.query && data.query.pages) || []) {
        result.set(p.title, {
          title: p.title,
          description: p.description || "",
          extract: p.extract || "",
          image: p.thumbnail ? p.thumbnail.source : "",
          url: WP.articleUrl(p.title)
        });
      }
    }
    return result;
  };

  // ---------- Link lists (kept in memory only: they can be large) ----------

  const memory = new Map();

  // Follows Wikipedia's "continue" markers until `cap` titles or the budget runs out.
  // Only complete answers are remembered, so a stopped search doesn't leave half a list behind.
  async function collect(params, pick, cap, budget) {
    const key = lang + JSON.stringify(params) + cap;
    if (memory.has(key)) return memory.get(key);
    let finished = false;
    const out = [];
    let cont = {};
    for (;;) {
      if (!budget.take()) break;
      const data = await Net.getJSON("wikipedia", apiUrl({ ...params, ...cont }));
      for (const page of (data.query && data.query.pages) || []) pick(page, out);
      if (!data.continue || out.length >= cap) {
        finished = true;
        break;
      }
      cont = data.continue;
    }
    const result = out.slice(0, cap);
    if (finished) memory.set(key, result);
    return result;
  }

  const linksFrom = (title, cap, budget) =>
    collect({ action: "query", titles: title, prop: "links", plnamespace: "0", pllimit: "max" },
      (p, out) => (p.links || []).forEach((l) => out.push(l.title)), cap, budget);

  const linksTo = (title, cap, budget) =>
    collect({ action: "query", titles: title, prop: "linkshere", lhnamespace: "0", lhshow: "!redirect", lhlimit: "max" },
      (p, out) => (p.linkshere || []).forEach((l) => out.push(l.title)), cap, budget);

  // Which of `froms` (≤ 50 pages) link to which of `tos` (≤ 50 pages): [[from, to], ...]
  const linksAmong = (froms, tos, budget) =>
    collect({ action: "query", titles: froms.join("|"), prop: "links", pltitles: tos.join("|"), pllimit: "max" },
      (p, out) => (p.links || []).forEach((l) => out.push([p.title, l.title])), Infinity, budget);

  // ---------- The search ----------

  // Wikipedia lists links alphabetically, which would make every route start
  // with "A…". This shuffles with a seed taken from the two topics, so results
  // are varied but the same question always gives the same answer.
  function shuffled(list, seedText) {
    let seed = 0;
    for (const ch of seedText) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Pages the goal links back to first (usually the closest topics), the rest shuffled.
  function ordered(list, close, seedText) {
    const near = list.filter((t) => close.has(t));
    const far = shuffled(list.filter((t) => !close.has(t)), seedText);
    return near.concat(far);
  }

  // Looks for routes of up to three links from `fromText` to `toText`:
  //   1 step: the start page links to the goal
  //   2 steps: a page the start links to, which links to the goal
  //   3 steps: start → A → B → goal, with B among pages that link to the goal
  // It can't check every page on Wikipedia, so `complete` says whether the
  // budget ran out before everything it planned to check was checked.
  // `stop` is optional: { stopped: true } ends the search before its next request.
  WP.find = async function (fromText, toText, onProgress, stop) {
    let used = 0;
    const stopped = () => !!(stop && stop.stopped);
    const budget = { take: () => (!stopped() && used < BUDGET ? (used += 1, true) : false) };
    const count = () => (used += 1);
    const progress = (stage, done, total) => onProgress && onProgress({ stage, done, total, requests: used, budget: BUDGET });

    progress("Finding the two articles", 0, 1);
    const from = await resolve(fromText, count);
    if (!from) throw new Error("There's no Wikipedia article called “" + fromText.trim() + "”. Pick one from the suggestions.");
    const to = await resolve(toText, count);
    if (!to) throw new Error("There's no Wikipedia article called “" + toText.trim() + "”. Pick one from the suggestions.");
    if (from === to) return { from, to, paths: [[from]], checked: 0, requests: used, complete: true };

    progress("Reading the links on “" + from + "”", 0, 1);
    const fromLinks = await linksFrom(from, MAX_FROM * 2, budget);
    const paths = [];
    const add = (p) => {
      if (!paths.some((q) => q.join("\u0000") === p.join("\u0000"))) paths.push(p);
    };
    if (fromLinks.includes(to)) add([from, to]);

    progress("Reading what links to “" + to + "”", 0, 1);
    const toLinks = new Set(await linksTo(to, MAX_TO, budget));
    const goalLinks = new Set(await linksFrom(to, 500, budget));

    // Two steps, for free: pages the start links to that also link to the goal.
    // Pages the goal links back to come first: they're usually the closest topics.
    const twoStep = fromLinks.filter((t) => toLinks.has(t) && t !== to).sort((a, b) => goalLinks.has(b) - goalLinks.has(a));
    for (const middle of twoStep.slice(0, WANT_PATHS)) add([from, middle, to]);

    // Three steps: check the start's links against groups of pages that link to the goal.
    // `checked` counts the start-page/middle-page pairs actually checked.
    let checked = 0;
    let complete = true;
    if (paths.length < WANT_PATHS) {
      const seed = from + "\u0000" + to;
      const firsts = ordered(fromLinks.filter((t) => t !== to), goalLinks, seed).slice(0, MAX_FROM);
      const seconds = ordered([...toLinks].filter((t) => t !== from), goalLinks, seed + "2").slice(0, 49 * MIDDLE_BATCHES);
      const groups = [];
      for (let b = 0; b < seconds.length; b += 49) for (let a = 0; a < firsts.length; a += 50) groups.push([firsts.slice(a, a + 50), seconds.slice(b, b + 49)]);
      let done = 0;
      for (const [froms, tos] of groups) {
        if (used >= BUDGET || stopped()) {
          complete = false;
          break;
        }
        progress("Checking routes through other articles", done, groups.length);
        for (const [a, b] of await linksAmong(froms, tos, budget)) {
          if (a !== b && b !== from && a !== to) add([from, a, b, to]);
        }
        done += 1;
        checked += froms.length * tos.length;
        // Enough good routes: no need to keep asking.
        if (paths.length >= WANT_PATHS) break;
      }
      if (done < groups.length && paths.length < WANT_PATHS) complete = false;
    }

    paths.sort((x, y) => x.length - y.length);
    progress("Done", 1, 1);
    return { from, to, paths: paths.slice(0, WANT_PATHS), checked, requests: used, complete };
  };
})();
