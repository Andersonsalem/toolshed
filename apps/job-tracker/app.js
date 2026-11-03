// Application Tracker: a list of job applications with statuses, follow-up
// reminders and simple stats. All data stays in this browser (shared/storage.js).
(function () {
  "use strict";
  const { el } = window.UI;

  const APP_ID = "job-tracker";
  const store = Store.open(APP_ID, 1);

  // An application with status "Applied" and no reply after this many days
  // shows up under Needs attention.
  const STALE_AFTER_DAYS = 14;

  const STATUSES = [
    { id: "saved", label: "Saved (not applied)" },
    { id: "applied", label: "Applied" },
    { id: "interviewing", label: "Interviewing" },
    { id: "offer", label: "Offer" },
    { id: "rejected", label: "Rejected" },
    { id: "noresponse", label: "No response" },
    { id: "withdrawn", label: "Withdrawn" }
  ];
  const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
  const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
  const CLOSED = new Set(["rejected", "noresponse", "withdrawn"]);
  const SENT = ["applied", "interviewing", "offer", "rejected", "noresponse"];
  const REPLIED = ["interviewing", "offer", "rejected"];

  // Fields edited in the dialog, by input name.
  const FIELDS = ["company", "role", "status", "location", "appliedOn", "followUpOn", "url", "salary", "contact", "notes"];

  const $ = (id) => document.getElementById(id);

  // ---------- Dates (always local "YYYY-MM-DD" strings) ----------

  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function today() {
    return isoDate(new Date());
  }
  function isDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s));
  }
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function daysBetween(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / 86400000);
  }
  function formatDate(s) {
    const d = parseDate(s);
    const options = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    return d.toLocaleDateString(undefined, options);
  }
  function relative(s) {
    const n = daysBetween(s, today());
    if (n === 0) return "today";
    if (n === 1) return "yesterday";
    if (n === -1) return "tomorrow";
    return n > 0 ? n + " days ago" : "in " + -n + " days";
  }

  // ---------- Data ----------

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function text(value, max) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  // Only plain web links are ever turned into clickable links.
  function isWebUrl(s) {
    return /^https?:\/\/\S+$/i.test(s);
  }

  // Turns what someone typed into a web link. Returns null if it isn't one.
  function cleanUrl(input) {
    const s = input.trim();
    if (!s) return "";
    if (isWebUrl(s)) return s;
    if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(s)) return "https://" + s;
    return null;
  }

  // Accepts anything (saved data, a backup file) and returns a valid job or null.
  function normalizeJob(raw) {
    if (!raw || typeof raw !== "object") return null;
    const now = new Date().toISOString();
    const job = {
      id: text(raw.id, 100) || newId(),
      company: text(raw.company, 200).trim(),
      role: text(raw.role, 200).trim(),
      status: STATUS_IDS.has(raw.status) ? raw.status : "saved",
      location: text(raw.location, 200).trim(),
      appliedOn: isDate(raw.appliedOn) ? raw.appliedOn : "",
      followUpOn: isDate(raw.followUpOn) ? raw.followUpOn : "",
      url: isWebUrl(text(raw.url, 2000)) ? raw.url : "",
      salary: text(raw.salary, 200).trim(),
      contact: text(raw.contact, 200).trim(),
      notes: text(raw.notes, 20000),
      createdAt: text(raw.createdAt, 40) || now,
      updatedAt: text(raw.updatedAt, 40) || now,
      history: Array.isArray(raw.history)
        ? raw.history
            .filter((h) => h && STATUS_IDS.has(h.status) && isDate(h.on))
            .map((h) => ({ status: h.status, on: h.on }))
        : []
    };
    if (!job.company && !job.role) return null;
    if (!job.company) job.company = "(no company)";
    return job;
  }

  function normalizeData(raw) {
    const jobs = raw && Array.isArray(raw.jobs) ? raw.jobs.map(normalizeJob).filter(Boolean) : [];
    const seen = new Set();
    for (const job of jobs) {
      if (seen.has(job.id)) job.id = newId();
      seen.add(job.id);
    }
    return { jobs };
  }

  // True if the job is, or ever was, in one of these statuses.
  function reached(job, statuses) {
    return statuses.includes(job.status) || job.history.some((h) => statuses.includes(h.status));
  }
  function isSent(job) {
    return reached(job, SENT) || (job.status === "withdrawn" && !!job.appliedOn);
  }

  let data = normalizeData(store.load({ jobs: [] }));
  const view = { search: "", filter: "active", sort: "updated" };
  let editingId = null;

  function findJob(id) {
    return data.jobs.find((j) => j.id === id);
  }

  function commit() {
    $("save-error").hidden = store.save(data);
    render();
  }

  function setStatus(job, status) {
    if (job.status === status) return;
    job.status = status;
    job.history.push({ status, on: today() });
    if (status === "applied" && !job.appliedOn) job.appliedOn = today();
    job.updatedAt = new Date().toISOString();
    commit();
    toast(job.company + ": " + STATUS_LABEL[status]);
  }

  function deleteJob(id) {
    const index = data.jobs.findIndex((j) => j.id === id);
    if (index === -1) return;
    const [job] = data.jobs.splice(index, 1);
    commit();
    toast("Deleted " + job.company + ".", "Undo", () => {
      data.jobs.splice(Math.min(index, data.jobs.length), 0, job);
      commit();
      toast("Restored " + job.company + ".");
    });
  }

  // ---------- Toast ----------

  let toastTimer;
  function toast(message, actionLabel, action) {
    const node = $("toast");
    const children = [el("span", { text: message })];
    if (actionLabel) {
      const button = el("button", { type: "button", text: actionLabel });
      button.addEventListener("click", () => {
        node.hidden = true;
        action();
      });
      children.push(button);
    }
    node.replaceChildren(...children);
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (node.hidden = true), actionLabel ? 10000 : 4000);
  }

  // ---------- Rendering ----------

  function render() {
    renderStats();
    renderAttention();
    renderFilterOptions();
    renderList();
    const empty = data.jobs.length === 0;
    $("export-json").disabled = empty;
    $("export-csv").disabled = empty;
    $("delete-all").disabled = empty;
  }

  function percent(part, whole) {
    return whole ? Math.round((part / whole) * 100) + "%" : "–";
  }

  function renderStats() {
    const sent = data.jobs.filter(isSent);
    const replied = sent.filter((j) => reached(j, REPLIED)).length;
    const interviews = sent.filter((j) => reached(j, ["interviewing", "offer"])).length;
    const offers = sent.filter((j) => reached(j, ["offer"])).length;
    const open = data.jobs.filter((j) => !CLOSED.has(j.status)).length;

    const tiles = [
      ["Open", open, "not closed yet"],
      ["Applied", sent.length, "sent so far"],
      ["Reply rate", percent(replied, sent.length), replied + " of " + sent.length + " replied"],
      ["Interviews", interviews, percent(interviews, sent.length) + " of applied"],
      ["Offers", offers, percent(offers, sent.length) + " of applied"]
    ];
    $("stats").replaceChildren(
      ...tiles.map(([label, value, detail]) =>
        el("div", { class: "card stat" }, [
          el("p", { class: "stat__label", text: label }),
          el("p", { class: "stat__value", text: String(value) }),
          el("p", { class: "stat__detail", text: detail })
        ])
      )
    );
  }

  function attentionItems() {
    const now = today();
    const items = [];
    for (const job of data.jobs) {
      if (CLOSED.has(job.status)) continue;
      if (job.followUpOn && job.followUpOn <= now) {
        items.push({
          job,
          kind: "followup",
          date: job.followUpOn,
          message: job.followUpOn === now ? "Follow-up due today" : "Follow-up was due " + relative(job.followUpOn)
        });
      } else if (job.status === "applied" && !job.followUpOn && job.appliedOn) {
        const days = daysBetween(job.appliedOn, now);
        if (days >= STALE_AFTER_DAYS) {
          items.push({ job, kind: "stale", date: job.appliedOn, message: "No reply in " + days + " days" });
        }
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  function smallButton(label, onClick, extraClass) {
    const button = el("button", { class: "button button--small " + (extraClass || "button--ghost"), type: "button", text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  function renderAttention() {
    const items = attentionItems();
    $("attention").hidden = items.length === 0;
    $("attention-list").replaceChildren(
      ...items.map(({ job, kind, message }) => {
        const actions =
          kind === "followup"
            ? [
                smallButton("Done", () => {
                  job.followUpOn = "";
                  job.updatedAt = new Date().toISOString();
                  commit();
                  toast("Follow-up for " + job.company + " marked done.");
                })
              ]
            : [smallButton("Mark no response", () => setStatus(job, "noresponse"))];
        actions.push(smallButton("Edit", () => openDialog(job)));
        return el("li", { class: "card attention-item" }, [
          el("p", {}, [
            el("strong", { text: job.company }),
            job.role ? document.createTextNode(" · " + job.role) : null,
            el("br"),
            el("span", { class: "muted small", text: message })
          ]),
          el("div", { class: "attention-item__actions" }, actions)
        ]);
      })
    );
  }

  function matchesFilter(job) {
    if (view.filter === "all") return true;
    if (view.filter === "active") return !CLOSED.has(job.status);
    return job.status === view.filter;
  }

  function renderFilterOptions() {
    const count = (fn) => data.jobs.filter(fn).length;
    const options = [
      ["active", "Open", count((j) => !CLOSED.has(j.status))],
      ["all", "All", data.jobs.length],
      ...STATUSES.map((s) => [s.id, s.label, count((j) => j.status === s.id)])
    ];
    $("filter").replaceChildren(
      ...options.map(([value, label, n]) => el("option", { value, text: label + " (" + n + ")" }))
    );
    $("filter").value = view.filter;
  }

  const SORTERS = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    applied: (a, b) => (b.appliedOn || "").localeCompare(a.appliedOn || ""),
    followup: (a, b) => (a.followUpOn || "9999").localeCompare(b.followUpOn || "9999"),
    company: (a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: "base" })
  };

  function renderList() {
    const query = view.search.trim().toLowerCase();
    const jobs = data.jobs
      .filter(matchesFilter)
      .filter((j) => !query || [j.company, j.role, j.location, j.contact, j.notes].join(" ").toLowerCase().includes(query))
      .sort(SORTERS[view.sort]);

    const list = $("list");
    $("list-count").textContent = data.jobs.length ? "Showing " + jobs.length + " of " + data.jobs.length + "." : "";

    if (!data.jobs.length) {
      list.replaceChildren(
        el("div", { class: "card empty" }, [
          el("h3", { text: "No applications yet" }),
          el("p", { text: "Add the jobs you've applied to, or ones you're planning to apply to." }),
          smallButton("Add your first application", () => openDialog(null), "")
        ])
      );
      return;
    }
    if (!jobs.length) {
      list.replaceChildren(
        el("div", { class: "card empty" }, [
          el("p", { text: "Nothing matches this search or filter." }),
          smallButton("Show all applications", () => {
            view.search = "";
            view.filter = "all";
            $("search").value = "";
            render();
          })
        ])
      );
      return;
    }
    list.replaceChildren(el("ul", { class: "job-list" }, jobs.map(jobRow)));
  }

  function jobRow(job) {
    const select = el("select", { "aria-label": "Status for " + job.company });
    for (const s of STATUSES) select.append(el("option", { value: s.id, text: s.label }));
    select.value = job.status;
    select.addEventListener("change", () => setStatus(job, select.value));

    const meta = [];
    if (job.appliedOn) meta.push(el("span", { text: "Applied " + formatDate(job.appliedOn) + " (" + relative(job.appliedOn) + ")" }));
    if (job.followUpOn && !CLOSED.has(job.status)) {
      const due = job.followUpOn <= today();
      meta.push(el("span", { class: due ? "is-due" : "", text: "Follow up " + formatDate(job.followUpOn) + (due ? " (due)" : "") }));
    }
    if (job.salary) meta.push(el("span", { text: job.salary }));
    if (job.contact) meta.push(el("span", { text: job.contact }));

    const subtitle = [job.role, job.location].filter(Boolean).join(" · ");
    const actions = [smallButton("Edit", () => openDialog(job))];
    if (job.url) actions.push(el("a", { href: job.url, target: "_blank", rel: "noopener noreferrer", text: "Job posting ↗" }));

    return el("li", { class: "card job" + (CLOSED.has(job.status) ? " is-closed" : ""), "data-status": job.status }, [
      el("div", {}, [
        el("h3", { class: "job__company", text: job.company }),
        subtitle ? el("p", { class: "job__role", text: subtitle }) : null
      ]),
      el("div", { class: "job__status" }, [select]),
      meta.length ? el("p", { class: "job__meta" }, meta) : null,
      job.notes.trim() ? el("p", { class: "job__notes", text: job.notes.trim() }) : null,
      el("div", { class: "job__actions" }, actions)
    ]);
  }

  // ---------- Add / edit dialog ----------

  const dialog = $("job-dialog");
  const form = $("job-form");

  $("f-status").replaceChildren(...STATUSES.map((s) => el("option", { value: s.id, text: s.label })));

  function showFormError(message, field) {
    $("form-error").textContent = message;
    $("form-error").hidden = false;
    if (field) form.elements[field].focus();
  }

  function openDialog(job) {
    editingId = job ? job.id : null;
    form.reset();
    $("dialog-title").textContent = job ? "Edit application" : "Add application";
    $("delete-job").hidden = !job;
    $("form-error").hidden = true;
    const values = job || { status: "applied", appliedOn: today() };
    for (const name of FIELDS) form.elements[name].value = values[name] || "";
    dialog.showModal();
    form.elements.company.focus();
  }

  // Picking a status that means you applied fills in today's date if it's empty.
  form.elements.status.addEventListener("change", () => {
    if (form.elements.status.value !== "saved" && !form.elements.appliedOn.value) {
      form.elements.appliedOn.value = today();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = {};
    for (const name of FIELDS) values[name] = form.elements[name].value.trim();

    if (!values.company) return showFormError("Add a company name.", "company");
    const url = cleanUrl(values.url);
    if (url === null) return showFormError("That link doesn't look like a web address. Paste the full link, or leave it empty.", "url");
    values.url = url;

    const now = new Date().toISOString();
    let name;
    if (editingId) {
      const index = data.jobs.findIndex((j) => j.id === editingId);
      if (index === -1) {
        dialog.close();
        return toast("This application was deleted, possibly in another tab. Your edit wasn't saved.");
      }
      const old = data.jobs[index];
      const job = normalizeJob({ ...old, ...values, updatedAt: now });
      if (job.status !== old.status) job.history.push({ status: job.status, on: today() });
      data.jobs[index] = job;
      name = "Saved " + job.company + ".";
    } else {
      const firstOn = values.status === "applied" && values.appliedOn ? values.appliedOn : today();
      const job = normalizeJob({ ...values, id: newId(), createdAt: now, updatedAt: now, history: [{ status: values.status, on: firstOn }] });
      data.jobs.push(job);
      name = "Added " + job.company + ".";
    }
    dialog.close();
    commit();
    toast(name);
  });

  $("cancel-job").addEventListener("click", () => dialog.close());
  $("delete-job").addEventListener("click", () => {
    dialog.close();
    deleteJob(editingId);
  });

  // ---------- Backup and data ----------

  function download(filename, content, type) {
    const link = el("a", { download: filename });
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // Quotes a value for CSV, and stops spreadsheet apps from running it as a formula.
  function csvCell(value) {
    let s = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $("export-json").addEventListener("click", () => store.exportFile(data));

  $("export-csv").addEventListener("click", () => {
    const columns = [
      ["Company", (j) => j.company],
      ["Role", (j) => j.role],
      ["Status", (j) => STATUS_LABEL[j.status]],
      ["Location", (j) => j.location],
      ["Date applied", (j) => j.appliedOn],
      ["Follow up on", (j) => j.followUpOn],
      ["Pay", (j) => j.salary],
      ["Contact", (j) => j.contact],
      ["Job posting", (j) => j.url],
      ["Notes", (j) => j.notes]
    ];
    const rows = [columns.map(([title]) => title)].concat(data.jobs.map((j) => columns.map(([, get]) => get(j))));
    const csv = "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    download("job-applications-" + today() + ".csv", csv, "text/csv;charset=utf-8");
  });

  $("import-button").addEventListener("click", () => $("import-file").click());

  $("import-file").addEventListener("change", async () => {
    const input = $("import-file");
    const file = input.files[0];
    input.value = "";
    if (!file) return;

    let incoming;
    try {
      incoming = normalizeData(await store.importFile(file));
    } catch (error) {
      return toast(error.message);
    }
    if (!incoming.jobs.length) return toast("That backup has no applications in it.");

    const existing = new Set(data.jobs.map((j) => j.id));
    const replacing = incoming.jobs.filter((j) => existing.has(j.id)).length;
    const adding = incoming.jobs.length - replacing;
    const ok = confirm(
      "Restore " + incoming.jobs.length + " applications from this backup?\n\n" +
        adding + " will be added.\n" +
        replacing + " already here will be replaced by the backup's version.\n" +
        "Nothing else is changed."
    );
    if (!ok) return;

    const byId = new Map(data.jobs.map((j) => [j.id, j]));
    for (const job of incoming.jobs) byId.set(job.id, job);
    data.jobs = [...byId.values()];
    commit();
    toast("Restored " + incoming.jobs.length + " applications.");
  });

  $("delete-all").addEventListener("click", () => {
    const count = data.jobs.length;
    const ok = confirm(
      "Delete all " + count + " applications from this browser?\n\n" +
        "Download a backup first if you might want them back."
    );
    if (!ok) return;
    const previous = data.jobs;
    data.jobs = [];
    commit();
    toast("Deleted all " + count + " applications.", "Undo", () => {
      data.jobs = previous.concat(data.jobs);
      commit();
      toast("Restored " + count + " applications.");
    });
  });

  // ---------- Controls ----------

  $("add-button").addEventListener("click", () => openDialog(null));
  $("search").addEventListener("input", (e) => {
    view.search = e.target.value;
    renderList();
  });
  $("filter").addEventListener("change", (e) => {
    view.filter = e.target.value;
    renderList();
  });
  $("sort").addEventListener("change", (e) => {
    view.sort = e.target.value;
    renderList();
  });

  // Another tab changed the data: reload it so this tab never saves over it.
  window.addEventListener("storage", (event) => {
    if (event.key !== store.key) return;
    data = normalizeData(store.load({ jobs: [] }));
    render();
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  render();
})();
