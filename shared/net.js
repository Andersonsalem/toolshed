// The only way a tool on this site talks to the internet. Every request goes
// through here so the limits can't be skipped:
//   - only services listed in SERVICES can be contacted
//   - answers are cached in the browser, so repeat requests don't go out
//   - each service has a minimum gap between requests (1 second unless set)
//     and a cap per hour, counted across tabs and reloads
//   - when a service says "too many requests" or is down, we wait before
//     trying again, longer each time
//   - no cookies or referrer are sent, and requests time out after 10 seconds
//
//   await Net.getJSON(serviceId, url, { cacheMinutes })  -> parsed JSON
//   Rejects with an Error whose message can be shown to people as-is.
(function () {
  "use strict";

  // Wikimedia asks API users to say who they are; browsers can't set
  // User-Agent, so this header is the agreed alternative.
  const site = window.SITE || {};
  const AGENT = "Toolshed/1.0 (free in-browser tools; " + (site.sourceUrl || site.contactEmail || "no contact address set yet") + ")";

  // Add a service here before any tool may use it.
  //   perHour: our own politeness cap; minGapMs: time between requests (default 1 s);
  //   headers: sent with every request to the service.
  const SERVICES = {
    "open-meteo": {
      name: "Open-Meteo",
      hosts: ["api.open-meteo.com", "geocoding-api.open-meteo.com"],
      perHour: 60 // Open-Meteo allows far more
    },
    wikipedia: {
      name: "Wikipedia",
      hosts: ["en", "es", "fr", "de", "it", "pt"].map((l) => l + ".wikipedia.org"),
      // Wikimedia has no fixed read limit but asks for requests one at a time;
      // a path search makes up to ~45, sent one after another.
      perHour: 600,
      minGapMs: 100,
      headers: { "Api-User-Agent": AGENT }
    },
    wikimedia: {
      name: "Wikibooks and Wikiversity",
      hosts: ["en", "es", "fr", "de", "it", "pt"].flatMap((l) => [l + ".wikibooks.org", l + ".wikiversity.org"]),
      perHour: 120,
      minGapMs: 200,
      headers: { "Api-User-Agent": AGENT }
    },
    openlibrary: {
      name: "Open Library",
      hosts: ["openlibrary.org"],
      perHour: 60
    }
  };

  const MIN_GAP_MS = 1000;
  const TIMEOUT_MS = 10000;
  const PREFIX = "net:"; // localStorage keys: cache entries and counters
  const inFlight = new Map();

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + key));
    } catch (e) {
      return null;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      /* storage full or blocked: the request still works, just isn't cached */
    }
  }

  // Throws if the service is cooling down or has used its hourly allowance.
  function claimSlot(serviceId, service) {
    const now = Date.now();
    const status = read("limit:" + serviceId) || { times: [], blockedUntil: 0, strikes: 0 };
    status.times = status.times.filter((t) => now - t < 3600000);
    if (status.blockedUntil > now) {
      const seconds = Math.ceil((status.blockedUntil - now) / 1000);
      throw new Error(service.name + " asked us to slow down. Try again in " + (seconds > 90 ? Math.ceil(seconds / 60) + " minutes." : seconds + " seconds."));
    }
    if (status.times.length >= service.perHour) {
      const wait = Math.ceil((status.times[0] + 3600000 - now) / 60000);
      throw new Error("This page has reached its limit of " + service.perHour + " requests an hour to " + service.name + ", to keep the free service fair for everyone. Try again in " + wait + " minutes.");
    }
    const last = status.times[status.times.length - 1] || 0;
    const wait = Math.max(0, last + (service.minGapMs || MIN_GAP_MS) - now);
    status.times.push(now + wait);
    write("limit:" + serviceId, status);
    return wait;
  }

  function strike(serviceId) {
    const status = read("limit:" + serviceId) || { times: [], blockedUntil: 0, strikes: 0 };
    status.strikes = Math.min((status.strikes || 0) + 1, 6);
    status.blockedUntil = Date.now() + 30000 * Math.pow(2, status.strikes - 1); // 30 s, 1 min, 2 min … 16 min
    write("limit:" + serviceId, status);
  }
  function clearStrikes(serviceId) {
    const status = read("limit:" + serviceId);
    if (status && status.strikes) {
      status.strikes = 0;
      write("limit:" + serviceId, status);
    }
  }

  async function getJSON(serviceId, url, options) {
    const service = SERVICES[serviceId];
    if (!service) throw new Error("This tool tried to contact a service that isn't allowed.");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !service.hosts.includes(parsed.hostname)) {
      throw new Error("This tool tried to contact an address that isn't allowed.");
    }

    const cacheMinutes = (options && options.cacheMinutes) || 0;
    const cacheKey = "cache:" + url;
    if (cacheMinutes) {
      const cached = read(cacheKey);
      if (cached && Date.now() - cached.at < cacheMinutes * 60000) return cached.data;
    }
    // The same request already on its way: share it instead of sending another.
    if (inFlight.has(url)) return inFlight.get(url);

    const request = (async () => {
      if (!navigator.onLine) throw new Error("You seem to be offline. Connect to the internet and try again.");
      const wait = claimSlot(serviceId, service);
      if (wait) await new Promise((r) => setTimeout(r, wait));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          headers: service.headers || {}
        });
      } catch (e) {
        throw new Error(controller.signal.aborted
          ? service.name + " took too long to answer. Try again in a moment."
          : "Couldn't reach " + service.name + ". Check your connection and try again.");
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 429 || response.status >= 500) {
        strike(serviceId);
        throw new Error(response.status === 429
          ? service.name + " says there have been too many requests. This page will wait before asking again."
          : service.name + " is having trouble right now. This page will wait a little before trying again.");
      }
      if (!response.ok) throw new Error(service.name + " couldn't answer that request (error " + response.status + ").");
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error(service.name + " sent an answer that couldn't be read.");
      }
      clearStrikes(serviceId);
      if (cacheMinutes) write(cacheKey, { at: Date.now(), data });
      return data;
    })();

    inFlight.set(url, request);
    try {
      return await request;
    } finally {
      inFlight.delete(url);
    }
  }

  // Removes expired cache entries so the browser's storage doesn't fill up.
  function tidy(maxAgeMinutes) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PREFIX + "cache:")) continue;
        const entry = read(key.slice(PREFIX.length));
        if (!entry || Date.now() - entry.at > maxAgeMinutes * 60000) localStorage.removeItem(key);
      }
    } catch (e) {
      /* nothing to tidy */
    }
  }

  window.Net = { getJSON, tidy, SERVICES };
})();
