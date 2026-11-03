// Resume Match page: wires the text boxes and skills list to the analysis in analyze.js.
(function () {
  "use strict";
  const { el } = window.UI;
  const RM = window.ResumeMatch;

  const APP_ID = "resume-match";
  const store = Store.open(APP_ID, 1);

  // Below this, results would be noise, so the page asks for more text instead.
  const MIN_WORDS = 40;
  const MAX_SKILLS = 200;
  const MAX_SKILL_LENGTH = 60;

  const $ = (id) => document.getElementById(id);

  // Turns "Python, Kubernetes | k8s" into [{ name, aliases }]. Bad input is dropped, not fatal.
  function parseSkills(text) {
    return text
      .split(/[,;\n]+/)
      .map((item) => item.split("|").map((s) => s.replace(/^=+/, "").trim().slice(0, MAX_SKILL_LENGTH)).filter(Boolean))
      .filter((parts) => parts.length)
      .map((parts) => ({ name: parts[0], aliases: parts.slice(1, 11) }));
  }

  function cleanSkills(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && typeof s.name === "string" && s.name.trim())
      .map((s) => ({
        name: s.name.trim().slice(0, MAX_SKILL_LENGTH),
        aliases: Array.isArray(s.aliases) ? s.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()) : []
      }))
      .slice(0, MAX_SKILLS);
  }

  const saved = store.load({});
  const state = {
    resume: typeof saved.resume === "string" ? saved.resume : "",
    job: typeof saved.job === "string" ? saved.job : "",
    ignored: Array.isArray(saved.ignored) ? saved.ignored.filter((id) => typeof id === "string") : [],
    remember: saved.remember !== false,
    mySkills: cleanSkills(saved.mySkills)
  };

  // The skills list is always kept. The texts are kept only when "remember" is on.
  function persist() {
    store.save(
      state.remember
        ? state
        : { remember: false, resume: "", job: "", ignored: [], mySkills: state.mySkills }
    );
  }

  function wordCount(text) {
    return (text.match(/\S+/g) || []).length;
  }

  // ---------- Rendering ----------

  function render() {
    const resumeWords = wordCount(state.resume);
    const jobWords = wordCount(state.job);
    const resumeReady = resumeWords >= MIN_WORDS;
    const jobReady = jobWords >= MIN_WORDS;
    $("resume-count").textContent = resumeWords ? resumeWords + " words" : "";
    $("job-count").textContent = jobWords ? jobWords + " words" : "";

    renderMySkills();
    const result = jobReady ? RM.analyze(state.resume, state.job, new Set(state.ignored), state.mySkills) : null;
    renderFit(result, resumeReady);

    const hint = $("hint");
    if (!resumeReady || !jobReady) {
      $("results").hidden = true;
      hint.hidden = false;
      const needs = [];
      if (!resumeReady) needs.push("your resume");
      if (!jobReady) needs.push("the full job description");
      hint.textContent =
        "Paste " + needs.join(" and ") + " (at least " + MIN_WORDS + " words" + (needs.length > 1 ? " each" : "") +
        ") to see the keyword match.";
      return;
    }

    hint.hidden = true;
    $("results").hidden = false;
    renderScore(result);
    renderChips(result);
    renderChecks();
  }

  function renderScore(result) {
    const total = result.found.length + result.similar.length + result.missing.length;
    const similar = result.similar.length;
    $("score-value").textContent = result.score === null ? "–" : result.score + "%";
    $("score-bar").style.width = (result.score || 0) + "%";
    $("score-summary").textContent = total
      ? "Your resume contains " + result.found.length + " of the " + total + " key terms found in this job description." +
        (similar ? " " + similar + (similar === 1 ? " more is" : " more are") + " covered in different words." : "")
      : "No key terms found. Paste the full job posting, including the requirements.";
  }

  // kind: "missing" (can be ignored), "found", "ignored", or "plain".
  function chip(keyword, kind) {
    const children = [el("span", { text: keyword.label })];
    if (keyword.count > 1) {
      children.push(el("span", { class: "chip__count", title: "Mentioned " + keyword.count + " times", text: "(" + keyword.count + ")" }));
    }
    if (keyword.similar) {
      children.push(el("span", { class: "chip__aliases", text: "you wrote “" + keyword.similar + "”" }));
    }
    if (kind === "missing") {
      const button = el("button", { type: "button", "aria-label": "Ignore " + keyword.label, title: "Doesn't apply to me", text: "✕" });
      button.addEventListener("click", () => {
        state.ignored.push(keyword.id);
        update();
      });
      children.push(button);
    }
    return el("li", { class: "chip chip--" + kind + (keyword.mine ? " chip--mine" : "") }, children);
  }

  function fillChips(list, keywords, kind, emptyText) {
    list.replaceChildren(
      ...(keywords.length ? keywords.map((k) => chip(k, kind)) : [el("li", { class: "chips-empty", text: emptyText })])
    );
  }

  let lastMissing = [];
  function renderChips(result) {
    lastMissing = result.missing.map((k) => k.label);
    fillChips($("missing"), result.missing, "missing", "Nothing missing.");
    fillChips($("similar"), result.similar, "missing", "");
    $("similar-section").hidden = result.similar.length === 0;
    fillChips($("found"), result.found, "found", "None yet.");
    fillChips($("ignored"), result.ignored, "ignored", "");
    $("ignored-section").hidden = result.ignored.length === 0;
    $("mine-legend").hidden = !result.missing.concat(result.similar, result.found).some((k) => k.mine);
    $("copy-missing").disabled = result.missing.length === 0;
    $("copy-status").textContent = "";
  }

  function renderChecks() {
    $("checks").replaceChildren(
      ...RM.checkResume(state.resume).map((check) =>
        el("li", { class: "check " + (check.ok ? "check--ok" : "check--warn") }, [
          el("span", { class: "check__icon", "aria-label": check.ok ? "Looks good" : "Worth a look", text: check.ok ? "✓" : "!" }),
          el("div", {}, [
            el("p", { text: check.title }),
            el("p", { class: "check__detail", text: check.detail })
          ])
        ])
      )
    );
  }

  function renderMySkills() {
    const count = state.mySkills.length;
    $("my-skills-count").textContent = count ? count + (count === 1 ? " skill" : " skills") : "";
    $("clear-skills").hidden = count === 0;
    $("my-skills").replaceChildren(
      ...state.mySkills.map((skill, index) => {
        const remove = el("button", { type: "button", "aria-label": "Remove " + skill.name, title: "Remove", text: "✕" });
        remove.addEventListener("click", () => {
          state.mySkills.splice(index, 1);
          skillsMessage("");
          update();
        });
        return el("li", { class: "chip" }, [
          el("span", { text: skill.name }),
          skill.aliases.length ? el("span", { class: "chip__aliases", text: "(" + skill.aliases.join(", ") + ")" }) : null,
          remove
        ]);
      })
    );
  }

  function fitGroup(title, note, names, chipKind, action) {
    if (!names.length) return null;
    return el("div", { class: "fit-group" + (action ? " fit-group--action" : "") }, [
      el("h3", { text: title + " (" + names.length + ")" }),
      note ? el("p", { class: "muted small", text: note }) : null,
      el("ul", { class: "chips" }, names.map((name) => chip({ label: name }, chipKind)))
    ]);
  }

  function renderFit(result, resumeReady) {
    const section = $("fit");
    section.hidden = !result || state.mySkills.length === 0;
    if (section.hidden) return;

    const wanted = result.fit.filter((s) => s.wanted);
    const notMentioned = result.fit.filter((s) => !s.wanted).map((s) => s.name);
    $("fit-summary").textContent =
      "This job asks for " + wanted.length + " of your " + result.fit.length + " skills.";

    const groups = resumeReady
      ? [
          fitGroup(
            "Asked for, but not on your resume",
            "The job wants these and you listed them, but your resume doesn't mention them. Worth adding if they're true.",
            wanted.filter((s) => !s.onResume).map((s) => s.name),
            "found",
            true
          ),
          fitGroup("Asked for, and on your resume", "", wanted.filter((s) => s.onResume).map((s) => s.name), "found")
        ]
      : [fitGroup("Asked for by this job", "", wanted.map((s) => s.name), "found")];
    groups.push(fitGroup("Not mentioned in this job", "", notMentioned, "muted"));

    $("fit-groups").replaceChildren(...groups.filter(Boolean));
  }

  // ---------- Updates ----------

  let timer;
  function update() {
    clearTimeout(timer);
    persist();
    render();
  }
  function updateSoon() {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }

  function setText(field, text) {
    state[field] = text;
    $(field).value = text;
    update();
  }

  function message(id, text, isError) {
    const node = $(id);
    node.textContent = text;
    node.className = "small" + (isError ? " is-error" : "");
    node.hidden = !text;
  }
  const fileMessage = (text, isError) => message("file-message", text, isError);
  const skillsMessage = (text, isError) => message("skills-message", text, isError);

  // Adds skills that aren't on the list yet. Returns how many were added.
  function addSkills(items) {
    const have = new Set(state.mySkills.map((s) => s.name.toLowerCase()));
    let added = 0;
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (have.has(key) || state.mySkills.length >= MAX_SKILLS) continue;
      state.mySkills.push(item);
      have.add(key);
      added += 1;
    }
    return added;
  }

  // ---------- Controls ----------

  $("resume").addEventListener("input", (e) => {
    state.resume = e.target.value;
    updateSoon();
  });
  $("job").addEventListener("input", (e) => {
    state.job = e.target.value;
    updateSoon();
  });

  $("remember").addEventListener("change", (e) => {
    state.remember = e.target.checked;
    update();
  });

  $("clear-resume").addEventListener("click", () => {
    if (state.resume.trim() && !confirm("Clear your resume text?")) return;
    fileMessage("");
    setText("resume", "");
  });

  // A new job description starts with nothing ignored.
  $("clear-job").addEventListener("click", () => {
    if (state.job.trim() && !confirm("Clear the job description?")) return;
    state.ignored = [];
    setText("job", "");
  });

  $("open-file").addEventListener("click", () => $("resume-file").click());
  $("resume-file").addEventListener("change", async () => {
    const input = $("resume-file");
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const text = await RM.readResumeFile(file);
      if (!text) return fileMessage("That file doesn't seem to contain any text.", true);
      if (state.resume.trim() && !confirm("Replace the resume text with the text from " + file.name + "?")) return;
      setText("resume", text);
      fileMessage("Loaded " + file.name + ". Check the text came through correctly.");
    } catch (error) {
      fileMessage(error.message, true);
    }
  });

  $("example").addEventListener("click", () => {
    if ((state.resume.trim() || state.job.trim()) && !confirm("Replace both boxes with the example? Your current text will be lost.")) return;
    state.ignored = [];
    fileMessage("");
    state.job = RM.EXAMPLE.job;
    $("job").value = state.job;
    setText("resume", RM.EXAMPLE.resume);
  });

  $("restore-ignored").addEventListener("click", () => {
    state.ignored = [];
    update();
  });

  $("copy-missing").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastMissing.join(", "));
      $("copy-status").textContent = "Copied.";
    } catch (e) {
      $("copy-status").textContent = "Couldn't copy here. Select the words and copy them yourself.";
    }
  });

  $("skill-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const items = parseSkills($("skill-input").value);
    if (!items.length) return skillsMessage("Type a skill first.", true);
    const added = addSkills(items);
    $("skill-input").value = "";
    if (state.mySkills.length >= MAX_SKILLS && added < items.length) {
      skillsMessage("Your list is full (" + MAX_SKILLS + " skills). Remove some to add more.", true);
    } else if (added < items.length) {
      skillsMessage(added ? "Added " + added + ". The rest were already on your list." : "Already on your list.");
    } else {
      skillsMessage("");
    }
    update();
  });

  for (const pack of RM.PACKS) $("pack").append(el("option", { value: pack.name, text: pack.name }));
  $("pack").addEventListener("change", (e) => {
    const pack = RM.PACKS.find((p) => p.name === e.target.value);
    e.target.value = "";
    if (!pack) return;
    const added = addSkills(pack.skills.map((name) => ({ name, aliases: [] })));
    skillsMessage(
      added
        ? "Added " + added + " skills from the " + pack.name + " list. Remove any you don't actually have."
        : "Everything in the " + pack.name + " list is already on yours."
    );
    update();
  });

  $("clear-skills").addEventListener("click", () => {
    if (!confirm("Remove all " + state.mySkills.length + " skills from your list?")) return;
    state.mySkills = [];
    skillsMessage("");
    update();
  });

  if (!Store.available()) $("storage-warning").hidden = false;
  $("resume").value = state.resume;
  $("job").value = state.job;
  $("remember").checked = state.remember;
  render();
})();
