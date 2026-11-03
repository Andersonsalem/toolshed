// Shared page chrome: header, footer, support links, page title.
// Load after config.js. Every page includes this; apps never build their own header.
//
// Markup hooks a page can use:
//   <div data-site-header></div>   site header
//   <div data-site-footer></div>   site footer
//   <body data-page-title="X">     sets the tab title to "X · Site name"
//   data-site-name / data-site-tagline   filled with text from config
//   data-if-support / data-if-no-support shown only when a support link is / isn't set
(function () {
  "use strict";

  // Path to the site root, worked out from where this file lives (shared/).
  // Works from any folder depth, on a server or opened straight from disk.
  const root = new URL("../", document.currentScript.src).href;

  // Small DOM helper. Text is always set with textContent, never parsed as HTML.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children || [])) {
      if (child) node.append(child);
    }
    return node;
  }

  function supportLink(label, className) {
    return el("a", {
      class: className,
      href: SITE.supportUrl,
      target: "_blank",
      rel: "noopener",
      text: label
    });
  }

  function header() {
    const current = location.href;
    const navItem = (href, label) => {
      const link = el("a", { href: root + href, text: label });
      if (current === root + href || (href === "index.html" && current === root)) {
        link.setAttribute("aria-current", "page");
      }
      return link;
    };
    return el("header", { class: "site-header" }, [
      el("div", { class: "container site-header__inner" }, [
        el("a", { class: "brand", href: root + "index.html" }, [
          el("img", { src: root + "shared/icon.svg", alt: "", width: "24", height: "24" }),
          el("span", { text: SITE.name })
        ]),
        el("nav", { class: "site-nav", "aria-label": "Main" }, [
          navItem("index.html", "Tools"),
          navItem("about.html", "About"),
          SITE.supportUrl ? supportLink("Support", "button button--small") : null
        ])
      ])
    ]);
  }

  function footer() {
    const links = [
      el("a", { href: root + "about.html", text: "How this site works" }),
      SITE.sourceUrl ? el("a", { href: SITE.sourceUrl, target: "_blank", rel: "noopener", text: "Source code" }) : null,
      SITE.contactEmail ? el("a", { href: "mailto:" + SITE.contactEmail, text: "Contact" }) : null,
      SITE.supportUrl ? supportLink("Support this site", "") : null
    ];
    return el("footer", { class: "site-footer" }, [
      el("div", { class: "container" }, [
        el("p", {
          text: "Everything here is free. Your data stays in your browser. " +
                "Support is optional and unlocks nothing."
        }),
        el("p", { class: "site-footer__links" }, links),
        el("p", { class: "muted", text: "Made by " + SITE.author + "." })
      ])
    ]);
  }

  function render() {
    const pageTitle = document.body.dataset.pageTitle;
    document.title = pageTitle ? pageTitle + " · " + SITE.name : SITE.name;

    document.querySelectorAll("[data-site-header]").forEach((n) => n.replaceWith(header()));
    document.querySelectorAll("[data-site-footer]").forEach((n) => n.replaceWith(footer()));
    document.querySelectorAll("[data-site-name]").forEach((n) => (n.textContent = SITE.name));
    document.querySelectorAll("[data-site-tagline]").forEach((n) => (n.textContent = SITE.tagline));
    document.querySelectorAll("[data-if-support]").forEach((n) => (n.hidden = !SITE.supportUrl));
    document.querySelectorAll("[data-if-no-support]").forEach((n) => (n.hidden = !!SITE.supportUrl));
    document.querySelectorAll("a[data-support-link]").forEach((n) => (n.href = SITE.supportUrl || "#"));
  }

  window.UI = { el, root };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
