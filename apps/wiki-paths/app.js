// Wikipedia Paths page: two topics in, a chain of article cards out.
// The search itself is in wiki.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const WP = window.WikiPaths;
  const $ = (id) => document.getElementById(id);

  // Pairs that make fun routes, in English. Other languages get the same pairs,
  // translated through Wikipedia's own links between languages.
  const SURPRISES = [
    ["Pizza", "Moon"], ["Coffee", "Isaac Newton"], ["Banana", "Tsunami"], ["Chess", "Volcano"],
    ["Cat", "Eiffel Tower"], ["Honey", "Jupiter"], ["Penguin", "Great Pyramid of Giza"], ["Bicycle", "William Shakespeare"],
    ["Chocolate", "Antarctica"], ["Guitar", "Black hole"], ["Tea", "Roman Empire"], ["Origami", "Mars"]
  ];

  let search = null; // { stop } for the running search
  let lastResult = null;

  function formMessage(text, isError) {
    $("form-message").textContent = text;
    $("form-message").className = "small" + (isError ? " is-error" : " muted");
    $("form-message").hidden = !text;
  }

  // ---------- Language ----------

  function readLanguage() {
    try {
      return localStorage.getItem("hub:wiki-paths-lang") || "en";
    } catch (e) {
      return "en";
    }
  }
  for (const [code, name] of Object.entries(WP.LANGUAGES)) $("lang").append(el("option", { value: code, text: name }));
  $("lang").value = WP.LANGUAGES[readLanguage()] ? readLanguage() : "en";
  WP.setLanguage($("lang").value);
  $("lang").addEventListener("change", (e) => {
    WP.setLanguage(e.target.value);
    try {
      localStorage.setItem("hub:wiki-paths-lang", e.target.value);
    } catch (err) {
      /* the choice just isn't remembered */
    }
  });

  // ---------- Suggestions while typing ----------

  function suggester(inputId, listId) {
    let timer;
    let token = 0;
    $(inputId).addEventListener("input", () => {
      clearTimeout(timer);
      const text = $(inputId).value;
      // Waits for a pause in typing, so each word costs at most one request.
      timer = setTimeout(async () => {
        const mine = ++token;
        let titles = [];
        try {
          titles = await WP.suggest(text);
        } catch (e) {
          return; // suggestions are optional; searching still works
        }
        if (mine !== token) return;
        $(listId).replaceChildren(...titles.map((t) => el("option", { value: t })));
      }, 400);
    });
  }
  suggester("from", "from-list");
  suggester("to", "to-list");

  $("swap").addEventListener("click", () => {
    const a = $("from").value;
    $("from").value = $("to").value;
    $("to").value = a;
  });

  // ---------- Searching ----------

  async function run(from, to) {
    if (search) search.stop.stopped = true;
    const mine = { stop: { stopped: false } };
    search = mine;
    formMessage("");
    $("result").hidden = true;
    $("progress").hidden = false;
    $("go").disabled = true;
    location.hash = new URLSearchParams({ from, to, lang: $("lang").value }).toString();

    let result;
    try {
      result = await WP.find(from, to, (p) => {
        if (search !== mine) return;
        $("progress-text").textContent = p.stage + "…" + (p.total > 1 ? " (" + p.done + " of " + p.total + ")" : "") + " · " + p.requests + " of up to " + p.budget + " requests";
        $("progress-bar").style.width = Math.round((p.requests / p.budget) * 100) + "%";
      }, mine.stop);
    } catch (error) {
      if (search === mine) {
        formMessage(error.message, true);
        finish();
      }
      return;
    }
    if (search !== mine) return;
    if (mine.stop.stopped) {
      formMessage("Search stopped.");
      return finish();
    }
    lastResult = result;
    await show(result, 0);
    finish();
  }

  function finish() {
    search = null;
    $("progress").hidden = true;
    $("go").disabled = false;
  }

  function stepCard(title, info, index, total) {
    const tag = index === 0 ? "Start" : index === total - 1 ? "Goal" : "Step " + index;
    const image = info && info.image
      ? el("img", { class: "step__image", src: info.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("div", { class: "step__image step__image--empty", "aria-hidden": "true", text: "W" });
    return el("li", { class: "step" }, [
      image,
      el("div", { class: "step__body" }, [
        el("span", { class: "step__tag", text: tag }),
        el("h3", {}, [el("a", { href: WP.articleUrl(title), target: "_blank", rel: "noopener", text: title })]),
        info && info.description ? el("p", { class: "step__desc", text: info.description }) : null,
        info && info.extract ? el("p", { class: "step__extract", text: info.extract }) : null
      ])
    ]);
  }

  async function show(result, pick) {
    const box = $("result");
    box.hidden = false;
    if (!result.paths.length) {
      box.replaceChildren(el("div", { class: "card notfound" }, [
        el("h2", { text: "No route found within this search's limit" }),
        el("p", { text: "No chain of up to three links turned up between “" + result.from + "” and “" + result.to + "”" +
          (result.checked ? ", after checking " + result.checked.toLocaleString() + " possible links through other articles" : "") +
          " in " + result.requests + " requests." }),
        el("p", { class: "muted", text: result.complete
          ? "They may still be connected in four or more steps. Try a broader topic for one of them (a country, a science, a century)."
          : "The search stopped at its request limit before checking everything, so a route may still exist. Try a broader topic for one of them (a country, a science, a century)." })
      ]));
      return;
    }

    const path = result.paths[pick];
    let infos = new Map();
    try {
      infos = await WP.summaries(path);
    } catch (e) {
      /* the route still shows, just without summaries */
    }
    const steps = [];
    path.forEach((title, i) => {
      steps.push(stepCard(title, infos.get(title), i, path.length));
      if (i < path.length - 1) steps.push(el("li", { class: "link-arrow", "aria-hidden": "true", text: "links to" }));
    });

    const others = result.paths.length > 1
      ? el("div", { class: "others" }, [
          el("h3", { text: "Other routes found" }),
          el("ul", {}, result.paths.map((p, i) => {
            const b = el("button", { type: "button", "aria-pressed": String(i === pick), text: p.join(" → ") });
            b.addEventListener("click", () => show(result, i));
            return el("li", {}, [b]);
          }))
        ])
      : null;

    const clicks = path.length - 1;
    box.replaceChildren(...[
      el("h2", { text: clicks === 0 ? "That's the same article" : clicks + (clicks === 1 ? " click" : " clicks") + " from “" + result.from + "” to “" + result.to + "”" }),
      el("p", { class: "result__summary", text: "Each article links to the next one. Found with " + result.requests + " requests to Wikipedia." +
        (result.paths.length > 1 ? " Shortest routes are listed first." : "") }),
      el("ol", { class: "chain" }, steps),
      others
    ].filter(Boolean));
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const from = $("from").value.trim();
    const to = $("to").value.trim();
    if (!from || !to) return formMessage("Type a topic in both boxes.", true);
    run(from, to);
  });

  $("stop").addEventListener("click", () => {
    if (search) search.stop.stopped = true;
    formMessage("Stopping after the current request…");
  });

  $("surprise").addEventListener("click", async () => {
    const lang = $("lang").value;
    const order = SURPRISES.slice().sort(() => Math.random() - 0.5);
    let pair = order[0];
    if (lang !== "en") {
      // One request translates every surprise pair; pick one that exists in this language.
      try {
        const titles = [...new Set(SURPRISES.flat())];
        const data = await Net.getJSON("wikipedia", "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
          action: "query", titles: titles.join("|"), prop: "langlinks", lllang: lang, lllimit: "max", format: "json", formatversion: "2", origin: "*"
        }), { cacheMinutes: 24 * 60 });
        const names = new Map(data.query.pages.map((p) => [p.title, p.langlinks && p.langlinks[0] && p.langlinks[0].title]));
        const usable = order.map((p) => p.map((t) => names.get(t))).find((p) => p.every(Boolean));
        if (!usable) return formMessage("Surprise pairs aren't available in this language yet. Type two topics instead.", true);
        pair = usable;
      } catch (error) {
        return formMessage(error.message, true);
      }
    }
    $("from").value = pair[0];
    $("to").value = pair[1];
    run(pair[0], pair[1]);
  });

  // A shared link (#from=…&to=…&lang=…) fills in the boxes and runs the search.
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("lang") && WP.LANGUAGES[params.get("lang")]) {
    $("lang").value = params.get("lang");
    WP.setLanguage(params.get("lang"));
  }
  if (params.get("from") && params.get("to")) {
    $("from").value = params.get("from").slice(0, 200);
    $("to").value = params.get("to").slice(0, 200);
    run($("from").value, $("to").value);
  }
})();
