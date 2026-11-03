// Learning Finder page: a topic in, free sources and a prompt out.
// Searches are in sources.js, prompt templates in prompts.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const LF = window.LearningFinder;
  const $ = (id) => document.getElementById(id);

  const store = Store.open("learning-finder", 1);
  const saved = store.load({}) || {};
  const pick = (list, value, fallback) => (LF.PROMPT_OPTIONS[list].some((o) => o[0] === value) ? value : fallback);
  // Only the prompt choices and language are remembered, not what was searched.
  const prefs = {
    lang: ["en", "es", "fr", "de", "it", "pt"].includes(saved.lang) ? saved.lang : "en",
    level: pick("level", saved.level, "new"),
    goal: pick("goal", saved.goal, "curious"),
    time: pick("time", saved.time, "3-5"),
    budget: pick("budget", saved.budget, "free"),
    formats: Array.isArray(saved.formats) ? saved.formats.filter((f) => LF.PROMPT_OPTIONS.formats.some((o) => o[0] === f)) : ["video", "practice"],
    template: LF.PROMPTS.some((p) => p.id === saved.template) ? saved.template : "plan"
  };
  const save = () => store.save(prefs);

  function formMessage(text, isError) {
    $("form-message").textContent = text;
    $("form-message").className = "small" + (isError ? " is-error" : " muted");
    $("form-message").hidden = !text;
  }

  // ---------- Results ----------

  const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener", text });
  const loading = () => el("p", { class: "loading", text: "Searching…" });
  const failed = (source, error) => el("p", { class: "empty", text: source + " couldn't be searched: " + error.message });

  function renderOverview(data, topic) {
    if (!data.main) {
      return [el("p", { class: "empty", text: "Wikipedia has no article matching “" + topic + "”. Try a broader or differently spelled topic." })];
    }
    const m = data.main;
    const parts = [
      el("div", { class: "overview" }, [
        m.image ? el("img", { src: m.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("div"),
        el("div", {}, [
          el("h3", {}, [link(m.url, m.title)]),
          m.description ? el("p", { class: "desc", text: m.description }) : null,
          m.extract ? el("p", { text: m.extract }) : null,
          el("p", {}, [link(m.url, "Read the full article on Wikipedia")])
        ])
      ])
    ];
    if (data.related.length) {
      parts.push(el("div", { class: "related" }, [el("span", { text: "Related:" }), ...data.related.map((r) => link(r.url, r.title))]));
    }
    return parts;
  }

  function renderList(items, emptyText) {
    if (!items.length) return [el("p", { class: "empty", text: emptyText })];
    return [el("ul", { class: "list" }, items.map((i) => el("li", {}, [link(i.url, i.title), i.snippet ? el("p", { text: i.snippet + "…" }) : null])))];
  }

  function renderBooks(books) {
    if (!books.length) return [el("p", { class: "empty", text: "No free-to-read books found for this topic on Open Library." })];
    return [el("ul", { class: "books" }, books.map((b) =>
      el("li", { class: "book" }, [
        b.cover ? el("img", { src: b.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("div", { class: "no-cover", "aria-hidden": "true", text: "📖" }),
        el("div", {}, [
          link(b.url, b.title),
          el("p", { text: [b.authors, b.year].filter(Boolean).join(", ") }),
          b.access === "public"
            ? el("span", { class: "access access--public", text: "Free to read" })
            : el("span", { class: "access access--borrowable", text: "Free to borrow, account needed" })
        ])
      ])
    ))];
  }

  let searchToken = 0;
  async function search(topic, lang) {
    const token = ++searchToken;
    formMessage("");
    $("results").hidden = false;
    location.hash = new URLSearchParams({ topic, lang }).toString();
    for (const id of ["overview", "wikibooks", "wikiversity", "books"]) $(id).replaceChildren(loading());
    $("sites").replaceChildren(...LF.SITES.map((s) => el("li", {}, [
      el("a", { href: LF.siteUrl(s, topic), target: "_blank", rel: "noopener noreferrer" }, [el("strong", { text: s.name }), el("span", { text: s.note })])
    ])));
    renderPrompt();

    // Each source shows its own result as soon as it arrives; one failing doesn't hide the others.
    const jobs = [
      ["overview", "Wikipedia", () => LF.overview(topic, lang), (d) => renderOverview(d, topic)],
      ["wikibooks", "Wikibooks", () => LF.wikibooks(topic, lang), (d) => renderList(d, "No Wikibooks textbooks match this topic.")],
      ["wikiversity", "Wikiversity", () => LF.wikiversity(topic, lang), (d) => renderList(d, "No Wikiversity pages match this topic.")],
      ["books", "Open Library", () => LF.books(topic), renderBooks]
    ];
    // One after another, to go easy on these free services.
    for (const [id, name, fetcher, render] of jobs) {
      try {
        const data = await fetcher();
        if (token !== searchToken) return;
        $(id).replaceChildren(...render(data));
      } catch (error) {
        if (token !== searchToken) return;
        $(id).replaceChildren(failed(name, error));
      }
    }
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const topic = $("topic").value.trim();
    if (topic.length < 2) return formMessage("Type a topic first, like “statistics” or “guitar”.", true);
    search(topic, $("lang").value);
  });

  $("lang").value = prefs.lang;
  $("lang").addEventListener("change", (e) => {
    prefs.lang = e.target.value;
    save();
  });

  // ---------- Prompt ----------

  for (const key of ["level", "goal", "time", "budget"]) {
    const select = $("p-" + key);
    select.replaceChildren(...LF.PROMPT_OPTIONS[key].map(([value, text]) => el("option", { value, text })));
    select.value = prefs[key];
    select.addEventListener("change", () => {
      prefs[key] = select.value;
      save();
      renderPrompt();
    });
  }

  $("p-formats").replaceChildren(...LF.PROMPT_OPTIONS.formats.map(([value, text]) => {
    const box = el("input", { type: "checkbox", value, id: "f-" + value });
    box.checked = prefs.formats.includes(value);
    box.addEventListener("change", () => {
      prefs.formats = [...document.querySelectorAll("#p-formats input:checked")].map((b) => b.value);
      save();
      renderPrompt();
    });
    return el("label", { for: "f-" + value }, [box, text]);
  }));

  $("templates").replaceChildren(...LF.PROMPTS.map((p) => {
    const b = el("button", { type: "button", "aria-pressed": String(p.id === prefs.template), text: p.name });
    b.addEventListener("click", () => {
      prefs.template = p.id;
      save();
      document.querySelectorAll("#templates button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderPrompt();
    });
    return b;
  }));

  function renderPrompt() {
    const topic = $("topic").value.trim() || "[your topic]";
    const template = LF.PROMPTS.find((p) => p.id === prefs.template);
    $("prompt").value = template.build({ ...prefs, topic });
    $("copy-status").textContent = "";
  }
  $("topic").addEventListener("input", renderPrompt);

  $("copy").addEventListener("click", async () => {
    if (!$("topic").value.trim()) {
      $("copy-status").textContent = "Type your topic at the top first.";
      return;
    }
    try {
      await navigator.clipboard.writeText($("prompt").value);
      $("copy-status").textContent = "Copied. Paste it into your AI assistant.";
    } catch (e) {
      $("prompt").select();
      $("copy-status").textContent = "Couldn't copy automatically: the text is selected, press Ctrl+C (or Cmd+C).";
    }
  });

  // A shared link (#topic=…&lang=…) runs the search.
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("lang") && ["en", "es", "fr", "de", "it", "pt"].includes(params.get("lang"))) $("lang").value = params.get("lang");
  if (params.get("topic")) {
    $("topic").value = params.get("topic").slice(0, 120);
    search($("topic").value, $("lang").value);
  }
  renderPrompt();
})();
