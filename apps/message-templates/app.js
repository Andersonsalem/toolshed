// Message Templates page: pick a template, fill its blanks, copy the result,
// or fill it for a whole list of people from a spreadsheet.
// Built-in templates live in templates.js; people can also write their own.
(function () {
  "use strict";
  const { el } = window.UI;
  const MT = window.MessageTemplates;

  const APP_ID = "message-templates";
  const store = Store.open(APP_ID, 1);

  // Saved once in "Your details" and filled into every template that uses them.
  const DETAIL_FIELDS = ["Your name", "Your email", "Your phone", "Your LinkedIn"];
  const DEFAULT_CATEGORY = "My templates";
  const BLANK = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const MAX_CUSTOM = 100;
  // Drafts can only be opened one by one, and only for lists this small, so the
  // page can't become a bulk-email tool. Bigger lists can still be downloaded.
  const MAX_DRAFTS = 5;

  const BUILT_IN_CATEGORIES = [...new Set(MT.TEMPLATES.map((t) => t.category))];

  const $ = (id) => document.getElementById(id);

  // ---------- State ----------

  function cleanTemplate(t) {
    return {
      id: t.id,
      category: typeof t.category === "string" && t.category.trim() ? t.category.trim().slice(0, 60) : DEFAULT_CATEGORY,
      title: typeof t.title === "string" && t.title.trim() ? t.title.slice(0, 120) : "Untitled template",
      when: "",
      subject: typeof t.subject === "string" ? t.subject.slice(0, 500) : "",
      body: typeof t.body === "string" ? t.body.slice(0, 20000) : ""
    };
  }

  function cleanCustom(list) {
    return (Array.isArray(list) ? list : [])
      .filter((t) => t && typeof t.id === "string" && t.id.startsWith("my-"))
      .slice(0, MAX_CUSTOM)
      .map(cleanTemplate);
  }

  function cleanState(raw) {
    const values = {};
    if (raw && raw.values && typeof raw.values === "object") {
      for (const [key, value] of Object.entries(raw.values)) {
        if (typeof value === "string") values[key.slice(0, 200)] = value.slice(0, 5000);
      }
    }
    return { values, custom: cleanCustom(raw && raw.custom) };
  }

  const state = cleanState(store.load(null));
  let currentId = null;

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(state), 300);
  }
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    store.save(state);
  });

  const isMine = (template) => template.id.startsWith("my-");
  function allTemplates() {
    return state.custom.concat(MT.TEMPLATES);
  }
  function findTemplate(id) {
    return allTemplates().find((t) => t.id === id);
  }
  // Built-in categories first, in their usual order, then the person's own.
  function categories() {
    const own = [...new Set(state.custom.map((t) => t.category))].filter((c) => !BUILT_IN_CATEGORIES.includes(c)).sort();
    return BUILT_IN_CATEGORIES.concat(own);
  }

  function download(blob, name) {
    const link = el("a", { download: name });
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  function safeFileName(text) {
    return text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 80) || "message";
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- Blanks ----------

  // Names of the blanks in a template, in the order they first appear.
  function blanksOf(template) {
    const names = [];
    for (const text of [template.subject, template.body]) {
      for (const match of text.matchAll(BLANK)) if (!names.includes(match[1])) names.push(match[1]);
    }
    return names;
  }

  function valueOf(name) {
    return (state.values[name] || "").trim();
  }

  // Text with blanks filled in, as plain text. Unfilled blanks stay as [Name].
  // get(name) supplies values: what was typed, or a spreadsheet row in mail merge.
  function fillText(text, get = valueOf) {
    return text.replace(BLANK, (_, name) => get(name) || "[" + name + "]");
  }

  // The same, as page content with unfilled blanks highlighted.
  function fillNodes(text, get = valueOf) {
    const nodes = [];
    let last = 0;
    for (const match of text.matchAll(BLANK)) {
      nodes.push(text.slice(last, match.index));
      const value = get(match[1]);
      nodes.push(value || el("mark", { class: "blank", text: "[" + match[1] + "]" }));
      last = match.index + match[0].length;
    }
    nodes.push(text.slice(last));
    return nodes;
  }

  // prefix keeps ids unique when the same blank shows twice (e.g. "Your name"
  // in a template and in Your details). Every copy stays in sync.
  function fieldInput(name, onChange, prefix) {
    const id = prefix + "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    // Longer prompts ("Something you discussed") usually need a sentence, not a word.
    const long = name.length > 28 || /^(something|what|how|your key|short reason)/i.test(name);
    const input = el(long ? "textarea" : "input", { id, "data-blank": name, autocomplete: DETAIL_FIELDS.includes(name) ? "on" : "off" });
    if (long) input.rows = 2;
    if (name === "Your email") input.type = "email";
    input.value = state.values[name] || "";
    input.addEventListener("input", () => {
      state.values[name] = input.value;
      for (const other of document.querySelectorAll("[data-blank]")) {
        if (other !== input && other.dataset.blank === name) other.value = input.value;
      }
      save();
      onChange();
    });
    return el("div", { class: long ? "is-wide" : "" }, [el("label", { for: id, text: name }), input]);
  }

  const button = (text, onClick, kind) => {
    const b = el("button", { class: "button button--small " + (kind === undefined ? "button--ghost" : kind), type: "button", text });
    b.addEventListener("click", onClick);
    return b;
  };

  // ---------- Template list ----------

  function renderList() {
    const query = $("search").value.trim().toLowerCase();
    const matches = allTemplates().filter((t) =>
      !query || [t.title, t.category, t.when, t.subject, t.body].join(" ").toLowerCase().includes(query)
    );
    const children = [];
    for (const category of categories()) {
      // The person's own templates first in each category.
      const list = matches.filter((t) => t.category === category).sort((a, b) => isMine(b) - isMine(a));
      if (!list.length) continue;
      children.push(el("h3", { text: category }));
      children.push(
        el("ul", {}, list.map((t) =>
          el("li", {}, [
            el("a", { href: "#" + t.id, "aria-current": String(t.id === currentId) }, [
              t.title,
              isMine(t) ? el("span", { class: "mine-badge", text: "Mine" }) : null
            ])
          ])
        ))
      );
    }
    if (!matches.length) children.push(el("p", { class: "empty", text: "No templates match." }));
    $("template-list").replaceChildren(...children);

    const has = state.custom.length > 0;
    $("export-json").disabled = !has;
    $("export-text").disabled = !has;
  }

  // ---------- Editor ----------

  function renderEditor() {
    const template = findTemplate(currentId);
    if (!template) return;
    const mine = isMine(template);

    const blanksBox = el("div", { class: "fields" });
    const previewSubject = el("p", { class: "preview__subject" });
    const previewBody = el("p", { class: "preview__body" });
    const blanksLeft = el("p", { class: "blanks-left", role: "status" });
    const status = el("span", { class: "actions__status", role: "status" });
    const mergeBox = el("div");

    function updatePreview() {
      previewSubject.hidden = !template.subject.trim();
      previewSubject.replaceChildren(el("span", { text: "Subject: " }), ...fillNodes(template.subject));
      previewBody.replaceChildren(...fillNodes(template.body));
      const missing = blanksOf(template).filter((name) => !valueOf(name));
      blanksLeft.textContent = missing.length ? "Not filled in yet: " + missing.join(", ") + "." : "";
      blanksLeft.hidden = !missing.length;
      status.textContent = "";
      renderMerge(template, mergeBox);
    }

    function renderBlanks() {
      const names = blanksOf(template);
      blanksBox.replaceChildren(
        ...(names.length
          ? names.map((name) => fieldInput(name, updatePreview, "blank"))
          : [el("p", { class: "muted small", text: mine ? "Add blanks to your template by writing {{Like this}}." : "This template has no blanks." })])
      );
    }

    const copy = async (text, label) => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = label + " copied.";
      } catch (e) {
        status.textContent = "Couldn't copy here. Select the text in the preview and copy it yourself.";
      }
    };

    const actions = [
      button("Copy message", () => copy(fillText(template.body), "Message"), ""),
      template.subject.trim() ? button("Copy subject", () => copy(fillText(template.subject), "Subject")) : null,
      button("Open in email app", () => {
        location.href = mailto("", fillText(template.subject), fillText(template.body));
        status.textContent = "Opened your email app. Nothing is sent until you press send there.";
      }),
      mine ? null : button("Save my own version", () => {
        const copyOf = newCustom({ title: template.title + " (my version)", category: template.category, subject: template.subject, body: template.body });
        if (copyOf) openTemplate(copyOf.id);
      }),
      status
    ];

    const parts = [
      el("div", {}, [
        el("h2", { text: template.title }),
        template.when ? el("p", { class: "editor__when", text: "When: " + template.when }) : null
      ])
    ];

    if (mine) parts.push(customEditor(template, () => {
      renderBlanks();
      updatePreview();
      renderList();
    }));

    parts.push(
      el("div", { class: "card" }, [
        el("h3", { class: "card-title", text: "Fill in the blanks" }),
        blanksBox,
        el("p", { class: "muted small fields-note", text: "Blanks with the same name are shared between templates, and saved in this browser." })
      ]),
      el("div", { class: "card preview", "aria-label": "Preview" }, [previewSubject, previewBody]),
      blanksLeft,
      el("div", { class: "actions" }, actions),
      mergeBox
    );

    $("editor").replaceChildren(...parts);
    renderBlanks();
    updatePreview();
  }

  function customEditor(template, onChange) {
    const field = (label, key, tag, attrs) => {
      const id = "custom-" + key;
      const input = el(tag, { id, ...(attrs || {}) });
      input.value = template[key];
      input.addEventListener("input", () => {
        template[key] = input.value;
        if (key === "title") template.title = input.value.trim() ? input.value : "Untitled template";
        save();
        onChange();
      });
      return el("div", {}, [el("label", { for: id, text: label }), input]);
    };

    // Category: one of the existing ones, or a new one typed in.
    const NEW = "__new__";
    const select = el("select", { id: "custom-category" }, [
      ...categories().concat(categories().includes(DEFAULT_CATEGORY) ? [] : [DEFAULT_CATEGORY]).map((c) => el("option", { value: c, text: c })),
      el("option", { value: NEW, text: "New category…" })
    ]);
    select.value = template.category;
    const newName = el("input", { id: "custom-new-category", placeholder: "Name of the new category", maxlength: "60", "aria-label": "New category name" });
    newName.hidden = true;
    const setCategory = (name) => {
      template.category = name.trim() || DEFAULT_CATEGORY;
      save();
      renderList();
    };
    select.addEventListener("change", () => {
      newName.hidden = select.value !== NEW;
      if (select.value === NEW) newName.focus();
      else setCategory(select.value);
    });
    newName.addEventListener("input", () => setCategory(newName.value));

    const remove = button("Delete this template", () => {
      if (!confirm("Delete “" + template.title + "”? This can't be undone.")) return;
      state.custom = state.custom.filter((t) => t !== template);
      save();
      openTemplate(MT.TEMPLATES[0].id);
    }, "button--danger");

    return el("div", { class: "card custom" }, [
      el("div", { class: "fields" }, [
        field("Template name", "title", "input", { maxlength: "120" }),
        el("div", {}, [el("label", { for: "custom-category", text: "Category" }), el("div", { class: "category-pick" }, [select, newName])]),
        field("Subject (leave empty for chat messages)", "subject", "input", { maxlength: "500" }),
        field("Message", "body", "textarea", { maxlength: "20000", spellcheck: "true" })
      ]),
      el("p", { class: "muted small" }, [
        "Write blanks as ",
        el("code", { text: "{{Company}}" }),
        ". Use the same name in different templates to fill it once. ",
        el("code", { text: "{{Your name}}" }),
        " and the other details below are filled in automatically."
      ]),
      el("div", { class: "custom__actions" }, [el("span"), remove])
    ]);
  }

  function newCustom(fields) {
    if (state.custom.length >= MAX_CUSTOM) {
      alert("You've reached " + MAX_CUSTOM + " templates of your own. Delete some to add more.");
      return null;
    }
    const template = cleanTemplate({
      id: "my-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ...fields
    });
    state.custom.unshift(template);
    save();
    return template;
  }

  // ---------- Mail merge: one message per spreadsheet row ----------

  // The loaded list lives only in this tab: it's never saved.
  let sheet = null; // { fileName, headers, rows, truncated, maxRows }
  let mapping = {}; // blank name -> column index, or -1 for "what I typed"
  let emailColumn = -1;
  let previewRow = 0;
  let mergeMessage = "";

  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Match columns to blanks by name: "Company" fills {{Company}}, and a column
  // "Name" fills {{Their name}}. "Your …" blanks are the sender, so never matched.
  function autoMap(template) {
    const headers = sheet.headers.map(normalize);
    const result = {};
    for (const blank of blanksOf(template)) {
      if (DETAIL_FIELDS.includes(blank)) {
        result[blank] = -1;
        continue;
      }
      const key = normalize(blank);
      let index = headers.indexOf(key);
      if (index === -1) {
        let best = -1;
        headers.forEach((h, i) => {
          if (h.length >= 3 && key.includes(h) && (best === -1 || h.length > headers[best].length)) best = i;
        });
        index = best;
      }
      result[blank] = index;
    }
    return result;
  }

  function guessEmailColumn() {
    const headers = sheet.headers.map(normalize);
    const exact = headers.findIndex((h) => ["email", "emailaddress", "to", "recipient", "mail"].includes(h));
    return exact !== -1 ? exact : headers.findIndex((h) => h.includes("email"));
  }

  function rowGetter(row) {
    return (name) => (mapping[name] >= 0 ? (row[mapping[name]] || "").trim() : valueOf(name));
  }

  function rowLabel(row, index) {
    const email = emailColumn >= 0 ? row[emailColumn] : "";
    return email || row.find(Boolean) || "Person " + (index + 1);
  }

  const looksLikeEmail = (s) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);

  function mailto(to, subject, body) {
    const address = looksLikeEmail(to) ? to : "";
    return "mailto:" + address + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  async function loadSheet(file, template, box) {
    try {
      const data = await Sheet.read(file);
      sheet = { fileName: file.name, ...data };
      mapping = autoMap(template);
      emailColumn = guessEmailColumn();
      previewRow = 0;
      mergeMessage = data.truncated ? "Only the first " + data.maxRows + " rows were loaded." : "";
    } catch (error) {
      sheet = null;
      mergeMessage = error.message;
    }
    renderMerge(template, box, true);
  }

  function renderMerge(template, box, open) {
    const blanks = blanksOf(template);
    const fileInput = el("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.xls,.ods,.numbers", hidden: "" });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (file) loadSheet(file, template, box);
    });

    const intro = [
      el("p", { class: "muted small" }, [
        "Upload a spreadsheet with one row per person and the column names in the first row, like ",
        el("em", { text: "Email, Their name, Company" }),
        ". Columns named like the blanks are matched automatically. The list stays in this tab: it isn't uploaded or saved."
      ]),
      el("div", { class: "merge-file" }, [
        button(sheet ? "Use a different spreadsheet" : "Choose a spreadsheet (.csv or .xlsx)", () => fileInput.click(), sheet ? "button--ghost" : ""),
        fileInput,
        sheet ? el("span", { class: "muted small", text: sheet.fileName + ": " + sheet.rows.length + (sheet.rows.length === 1 ? " person" : " people") }) : null,
        sheet ? button("Remove list", () => { sheet = null; mergeMessage = ""; renderMerge(template, box, true); }) : null
      ]),
      mergeMessage ? el("p", { class: "small " + (sheet ? "muted" : "is-error"), role: "status", text: mergeMessage }) : null
    ];

    const content = sheet ? mergeContent(template, blanks, box) : [];
    const details = el("details", { class: "card merge" }, [
      el("summary", { text: "Fill it for a list of people" }),
      ...intro,
      ...content
    ]);
    // Stay open while the person is working with a list.
    details.open = !!(open || sheet || box.querySelector("details[open]"));
    box.replaceChildren(details);
  }

  function mergeContent(template, blanks, box) {
    // Keep the mapping in step with the template's current blanks.
    const auto = autoMap(template);
    for (const blank of blanks) if (!(blank in mapping)) mapping[blank] = auto[blank];

    const columnSelect = (value, onChange, firstLabel) => {
      const select = el("select", {}, [
        el("option", { value: "-1", text: firstLabel }),
        ...sheet.headers.map((h, i) => el("option", { value: String(i), text: "Column: " + h }))
      ]);
      select.value = String(value);
      select.addEventListener("change", () => onChange(Number(select.value)));
      return select;
    };

    const rerender = () => renderMerge(template, box, true);

    const mapRows = blanks.map((blank) => {
      const typed = valueOf(blank);
      const select = columnSelect(mapping[blank], (v) => { mapping[blank] = v; rerender(); }, "Same for everyone: " + (typed ? "“" + typed.slice(0, 30) + "”" : "(empty)"));
      select.setAttribute("aria-label", "Fill " + blank + " from");
      return el("tr", {}, [el("th", { scope: "row", text: blank }), el("td", {}, [select])]);
    });
    const emailSelect = columnSelect(emailColumn, (v) => { emailColumn = v; rerender(); }, "No email column");
    emailSelect.setAttribute("aria-label", "Email addresses from");
    mapRows.push(el("tr", { class: "merge-email" }, [el("th", { scope: "row", text: "Send to (email)" }), el("td", {}, [emailSelect])]));

    const messages = sheet.rows.map((row, i) => {
      const get = rowGetter(row);
      return {
        index: i,
        label: rowLabel(row, i),
        to: emailColumn >= 0 ? (row[emailColumn] || "").trim() : "",
        subject: fillText(template.subject, get),
        body: fillText(template.body, get),
        missing: blanks.filter((b) => !get(b)),
        get
      };
    });
    const incomplete = messages.filter((m) => m.missing.length);

    // Preview one person at a time.
    previewRow = Math.min(previewRow, messages.length - 1);
    const pick = el("select", { "aria-label": "Preview the message for" }, messages.map((m) =>
      el("option", { value: String(m.index), text: (m.index + 1) + ". " + m.label + (m.missing.length ? " (blanks empty)" : "") })
    ));
    pick.value = String(previewRow);
    pick.addEventListener("change", () => { previewRow = Number(pick.value); rerender(); });
    const shown = messages[previewRow];

    const summary = messages.length + (messages.length === 1 ? " message" : " messages") + " ready." +
      (incomplete.length ? " " + incomplete.length + " still " + (incomplete.length === 1 ? "has empty blanks: row " : "have empty blanks: rows ") +
        incomplete.slice(0, 10).map((m) => m.index + 1).join(", ") + (incomplete.length > 10 ? "…" : "") + "." : "");

    const downloadZip = () => {
      const width = String(messages.length).length;
      const encoder = new TextEncoder();
      const files = messages.map((m) => ({
        name: String(m.index + 1).padStart(width, "0") + " - " + safeFileName(m.label) + ".txt",
        data: encoder.encode((m.to ? "To: " + m.to + "\n" : "") + (template.subject.trim() ? "Subject: " + m.subject + "\n" : "") + "\n" + m.body + "\n")
      }));
      download(Zip.make(files), safeFileName(template.title) + " - messages.zip");
    };
    const downloadCsv = () => {
      const cell = (value) => {
        let s = String(value);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [["To", "Subject", "Message"]].concat(messages.map((m) => [m.to, m.subject, m.body]));
      const csv = "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n");
      download(new Blob([csv], { type: "text/csv;charset=utf-8" }), safeFileName(template.title) + " - messages.csv");
    };

    // Opening drafts: one click per person, small lists only.
    let drafts;
    if (messages.length > MAX_DRAFTS) {
      drafts = el("p", { class: "muted small", text:
        "Opening drafts in your email app is only offered for lists of up to " + MAX_DRAFTS + " people, so this page can't be used for bulk email. " +
        "For bigger lists, download the .csv and use your email provider's own mail merge. (It's a nudge, not a lock: you could split the list.)" });
    } else if (emailColumn < 0) {
      drafts = el("p", { class: "muted small", text: "Choose the column with email addresses to open drafts in your email app." });
    } else {
      drafts = el("div", { class: "drafts" }, [
        el("p", { class: "muted small", text: "Each button opens one draft in your email app. Nothing is sent until you press send there." }),
        el("div", { class: "drafts__buttons" }, messages.map((m) =>
          button("Open draft to " + (m.to || m.label), () => { location.href = mailto(m.to, m.subject, m.body); })
        ))
      ]);
    }

    return [
      el("table", { class: "merge-map" }, [
        el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Blank" }), el("th", { scope: "col", text: "Fill it from" })])]),
        el("tbody", {}, mapRows)
      ]),
      el("p", { class: incomplete.length ? "small blanks-left" : "small muted", role: "status", text: summary }),
      el("div", { class: "merge-preview" }, [
        el("label", { class: "small", text: "Preview" }),
        pick,
        el("div", { class: "card preview" }, [
          shown.to ? el("p", { class: "preview__subject" }, [el("span", { text: "To: " }), shown.to]) : null,
          template.subject.trim() ? el("p", { class: "preview__subject" }, [el("span", { text: "Subject: " }), ...fillNodes(template.subject, shown.get)]) : null,
          el("p", { class: "preview__body" }, fillNodes(template.body, shown.get))
        ])
      ]),
      el("div", { class: "actions" }, [
        button("Download all (.zip, one text file each)", downloadZip, ""),
        button("Download as spreadsheet (.csv)", downloadCsv)
      ]),
      drafts,
      el("p", { class: "muted small", text: "Sending many near-identical emails can get your account flagged as spam. Personal notes work better than mass messages." })
    ];
  }

  // ---------- Saving and loading your own templates ----------

  function exportText() {
    const parts = state.custom.map((t) =>
      "=== " + t.title + " ===\nCategory: " + t.category + "\n" + (t.subject ? "Subject: " + t.subject + "\n" : "") + "\n" + t.body + "\n"
    );
    download(new Blob([parts.join("\n\n")], { type: "text/plain;charset=utf-8" }), "my-message-templates-" + today() + ".txt");
  }

  async function importFile(file) {
    let data;
    try {
      data = await store.importFile(file);
    } catch (error) {
      return alert(error.message);
    }
    const incoming = cleanCustom(data && data.custom);
    if (!incoming.length) return alert("That backup has no templates in it.");
    const ids = new Set(state.custom.map((t) => t.id));
    const replacing = incoming.filter((t) => ids.has(t.id)).length;
    const room = MAX_CUSTOM - state.custom.length + replacing;
    if (incoming.length > room) return alert("That would be more than " + MAX_CUSTOM + " templates. Delete some first.");
    const ok = confirm(
      "Import " + incoming.length + " templates?\n\n" +
      (incoming.length - replacing) + " will be added.\n" + replacing + " with the same name and id will be replaced.\nNothing else changes."
    );
    if (!ok) return;
    const byId = new Map(state.custom.map((t) => [t.id, t]));
    for (const t of incoming) byId.set(t.id, t);
    state.custom = [...byId.values()];
    save();
    renderList();
    openTemplate(incoming[0].id);
  }

  // ---------- Navigation (the open template is in the address, e.g. #offer-accept) ----------

  function openTemplate(id) {
    if (location.hash.slice(1) !== id) {
      location.hash = id; // "hashchange" calls route()
    } else {
      route();
    }
  }

  function route() {
    const wanted = decodeURIComponent(location.hash.slice(1));
    const changed = wanted !== currentId;
    currentId = findTemplate(wanted) ? wanted : MT.TEMPLATES[0].id;
    // A different template has different blanks: match the list's columns again.
    if (changed && sheet) {
      mapping = autoMap(findTemplate(currentId));
      previewRow = 0;
    }
    renderList();
    renderEditor();
  }

  // ---------- Your details ----------

  function renderDetails() {
    // Only the preview needs refreshing: rebuilding the editor would steal focus.
    $("my-details").replaceChildren(...DETAIL_FIELDS.map((name) => fieldInput(name, () => {
      const template = findTemplate(currentId);
      if (template && blanksOf(template).includes(name)) renderEditor();
    }, "detail")));
  }

  $("search").addEventListener("input", renderList);
  $("new-template").addEventListener("click", () => {
    const template = newCustom({
      title: "My template",
      category: DEFAULT_CATEGORY,
      subject: "",
      body: "Hi {{Their name}},\n\n\n\nBest,\n{{Your name}}"
    });
    if (!template) return;
    $("search").value = "";
    openTemplate(template.id);
    setTimeout(() => $("custom-title") && $("custom-title").select(), 0);
  });
  $("export-json").addEventListener("click", () => store.exportFile({ custom: state.custom, values: {} }));
  $("export-text").addEventListener("click", exportText);
  $("import-button").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importFile(file);
  });
  $("clear-values").addEventListener("click", () => {
    if (!confirm("Clear your details and everything typed into blanks? Your own templates are kept.")) return;
    state.values = {};
    save();
    renderDetails();
    renderEditor();
  });
  window.addEventListener("hashchange", route);

  // On narrow screens the list sits above the editor: jump down after choosing.
  $("template-list").addEventListener("click", (e) => {
    if (e.target.closest("a") && window.matchMedia("(max-width: 800px)").matches) {
      setTimeout(() => $("editor").scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  renderDetails();
  route();
})();
