// Builds the tool list on the hub page from shared/registry.js.
//
// Category filter: the chosen category lives in the address (e.g. #job-search),
// so a filtered view can be shared as a link and the back button works.
// Filters and their counts only cover tools that are ready: a category with
// nothing usable gets no button, and with fewer than two the bar is hidden.
(function () {
  "use strict";
  const { el, root } = window.UI;

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const LIVE = APPS.filter((a) => a.status === "live");

  // Categories with ready tools, in registry order: [{ name, slug, count }].
  const categories = [];
  for (const app of LIVE) {
    let category = categories.find((c) => c.name === app.category);
    if (!category) categories.push((category = { name: app.category, slug: slug(app.category), count: 0 }));
    category.count += 1;
  }

  function currentFilter() {
    const hash = decodeURIComponent(location.hash.slice(1));
    return categories.some((c) => c.slug === hash) ? hash : "";
  }

  function card(app) {
    const live = app.status === "live";
    const top = el("div", { class: "app-card__top" }, [
      el("h3", { text: app.name }),
      el("span", { class: live ? "badge badge--live" : "badge", text: live ? "Ready" : "Planned" })
    ]);
    const body = el("p", { text: app.description });
    // Tools that contact an outside service say so before anyone opens them.
    const online = app.online
      ? el("p", { class: "app-card__online", text: "Uses the internet: " + app.online })
      : null;

    return live
      ? el("a", { class: "card app-card", href: root + "apps/" + app.id + "/" }, [top, body, online])
      : el("div", { class: "card app-card app-card--planned" }, [top, body, online]);
  }

  // Keeps registry order, both for categories and for tools inside them.
  function byCategory(apps) {
    const groups = new Map();
    for (const app of apps) {
      if (!groups.has(app.category)) groups.set(app.category, []);
      groups.get(app.category).push(app);
    }
    return groups;
  }

  function section(title, intro, apps, showCategories) {
    const children = [el("h2", { text: title })];
    if (intro) children.push(el("p", { class: "muted", text: intro }));
    if (!showCategories) {
      children.push(el("div", { class: "grid" }, apps.map(card)));
    } else {
      for (const [category, list] of byCategory(apps)) {
        children.push(el("h3", { class: "category-title", text: category }));
        children.push(el("div", { class: "grid" }, list.map(card)));
      }
    }
    return el("section", {}, children);
  }

  function filterBar(active) {
    const button = (label, value, count) => {
      const b = el("button", { class: "filter", type: "button", "aria-pressed": String(active === value) }, [
        label,
        el("span", { class: "filter__count", text: String(count) })
      ]);
      b.addEventListener("click", () => {
        if (value) {
          // Adds a history entry; "hashchange" re-renders.
          location.hash = value;
        } else {
          // "All": drop the hash entirely rather than leave a bare "#".
          history.pushState(null, "", location.pathname + location.search);
          render();
        }
      });
      return b;
    };
    return el("div", { class: "filters", role: "group", "aria-label": "Filter tools by category" }, [
      button("All", "", LIVE.length),
      ...categories.map((c) => button(c.name, c.slug, c.count))
    ]);
  }

  const target = document.getElementById("app-list");

  function render() {
    const active = currentFilter();
    const apps = active ? APPS.filter((a) => slug(a.category) === active) : APPS;
    const live = apps.filter((a) => a.status === "live");
    const planned = apps.filter((a) => a.status !== "live");
    // Category headings only help when more than one category is showing.
    const showCategories = !active && new Set(APPS.map((a) => a.category)).size > 1;

    const parts = [];
    if (categories.length > 1) parts.push(filterBar(active));

    if (live.length) {
      parts.push(section("Tools", "", live, showCategories));
    } else {
      parts.push(el("section", {}, [
        el("h2", { text: "Tools" }),
        el("p", { class: "muted", text: "Nothing is ready yet. The first tool is being built now." })
      ]));
    }

    if (planned.length) {
      parts.push(section(
        "Planned",
        "Not built yet. They're listed so you know what's next. I won't promise dates I can't keep.",
        planned,
        showCategories
      ));
    }

    target.replaceChildren(...parts);
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("popstate", render);
  render();
})();
