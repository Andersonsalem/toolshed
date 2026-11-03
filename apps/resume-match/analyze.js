// Keyword analysis for Resume Match. Text in, results out: no page access here.
//
// How it works (also explained to people on the page):
//   1. Find known skills (skills.js plus the person's own list) in the job
//      description, in any spelling.
//   2. Find other words and two-word phrases the job description uses at least
//      twice, skipping common words and job-ad boilerplate.
//   3. Check which of those appear in the resume. Word endings are matched
//      loosely, so "managing" matches "managed".
//   4. For missing ones, look for a near-synonym (synonyms.js) in the resume.
//   5. Score = share found, where terms mentioned more often count more.
//      Near-synonyms don't count: hiring filters usually want the exact words.
(function () {
  "use strict";
  const NS = (window.ResumeMatch = window.ResumeMatch || {});

  const MAX_TERMS = 25;      // other (non-skill) terms kept from one job description
  const MIN_MENTIONS = 2;    // a non-skill term must appear this often to count
  const MAX_WEIGHT = 5;      // mentions beyond this don't add more weight

  // Common English plus words found in almost every job ad.
  const STOPWORDS = new Set(`
    a about above across after again against all almost along also although always am among an and any anyone
    anything are around as at be because been before being below between both but by can could did do does doing
    done down during each either else etc even ever every few for from further get gets getting give given go goes
    going good got great had has have having he her here hers him his how however i if in including into is it its
    itself just least less let like likely made make makes making many may me might more most much must my need
    needed needs new no nor not now of off often on once one only or other others our ours out over own per please
    rather really same see seem should since so some such than that the their them then there these they thing
    things this those though through throughout thus to too toward towards under until up upon us use used uses
    using very via want wants was way ways we well were what whatever when where whether which while who whom whose
    why will with within without would yet you your yours yourself
    ability able apply applicant applicants application benefit benefits best bonus candidate candidates career
    company companies competitive culture day days degree demonstrated description desired diverse diversity dynamic
    employee employees employer employment environment equal equivalent excellent exceptional excited existing
    experience experienced experiences familiar familiarity fast field full grow growing growth hands help helping
    high highly hire hiring hybrid ideal identity impact include includes inclusive individual individuals join
    job jobs key know knowledge level location looking love minimum mission month months national office
    offer opportunities opportunity orientation origin paced paid part passion passionate people perks plus
    position preferred proficiency proficient proven qualification qualifications qualified race record regard
    related relevant religion remote required requirement requirements responsibilities responsibility role
    roles salary seeking self sex sexual skill skills solid status strong success successful team teams time
    track understanding various veteran veterans week weeks welcome work worked working world year years
    across based closely cross deep desire drive driven ensure etc everything great join lead plus provide
    providing range including include strong support
    build builds building built create creates creating created deliver delivering develop develops developing
    developed end help improve improving make turn write writes writing done
  `.trim().split(/\s+/));

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Built-in skills as [{ name, terms: [{ term, exactCase }] }].
  let builtIn;
  function builtInSkills() {
    if (!builtIn) {
      builtIn = NS.SKILLS.map((line) => {
        const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
        return {
          name: parts[0].replace(/^=/, ""),
          terms: parts.map((p) => ({ term: p.replace(/^=/, ""), exactCase: p.startsWith("=") }))
        };
      });
    }
    return builtIn;
  }

  // Adds the person's own skills ([{ name, aliases }]) to the built-in ones.
  // A skill written like a built-in one ("k8s") joins it ("Kubernetes");
  // anything else becomes a new skill. Spellings of 1–2 letters ("Go", "R")
  // must match exact case, or they'd match ordinary words.
  function mergeSkills(mine) {
    const skills = builtInSkills().map((s) => ({ name: s.name, terms: s.terms.slice() }));
    const byTerm = new Map();
    for (const skill of skills) for (const t of skill.terms) byTerm.set(t.term.toLowerCase(), skill);

    const mineNames = [];
    for (const item of mine) {
      const spellings = [item.name].concat(item.aliases);
      let skill = spellings.map((s) => byTerm.get(s.toLowerCase())).find(Boolean);
      if (!skill) {
        skill = { name: item.name, terms: [] };
        skills.push(skill);
      }
      for (const term of spellings) {
        if (byTerm.has(term.toLowerCase())) continue;
        skill.terms.push({ term, exactCase: term.length <= 2 });
        byTerm.set(term.toLowerCase(), skill);
      }
      if (!mineNames.includes(skill.name)) mineNames.push(skill.name);
    }
    return { skills, mineNames };
  }

  // One regex per spelling, longest first, so "machine learning" is matched
  // before anything shorter could claim part of it. Cached per skills list.
  let cache = { key: null };
  function skillSet(mine) {
    const key = JSON.stringify(mine);
    if (cache.key === key) return cache;
    const { skills, mineNames } = mergeSkills(mine);
    const patterns = [];
    for (const skill of skills) {
      for (const { term, exactCase } of skill.terms) {
        const source = "(?<![\\w+#.])" + escapeRegExp(term) + "(?![\\w+#]|\\.\\w)";
        patterns.push({ name: skill.name, length: term.length, re: new RegExp(source, exactCase ? "g" : "gi") });
      }
    }
    patterns.sort((a, b) => b.length - a.length);
    cache = { key, patterns, mineNames };
    return cache;
  }

  // Returns the skills found (name -> mentions) and the text with them blanked
  // out, so their words aren't counted again as ordinary terms.
  function scanSkills(text, patterns) {
    const found = new Map();
    let masked = text;
    for (const { name, re } of patterns) {
      masked = masked.replace(re, () => {
        found.set(name, (found.get(name) || 0) + 1);
        return "\n";
      });
    }
    return { found, masked };
  }

  function sentences(text) {
    return text.toLowerCase().split(/[.!?;:\n\r•·|()[\]{}"“”]+|\s[-–—]\s/);
  }

  function words(sentence) {
    return sentence
      .split(/[^a-z0-9+#']+/)
      .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
      .filter(Boolean);
  }

  // Rough word ending removal so different forms of a word compare equal.
  function stem(w) {
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
    return w;
  }

  function isTermWord(w) {
    // Contractions ("we're", "you'll") are never keywords.
    return w.length >= 3 && /[a-z]/.test(w) && !w.includes("'") && !STOPWORDS.has(w);
  }

  // Words and two-word phrases the text repeats. Returns [{ key, label, count }].
  function repeatedTerms(text) {
    const singles = new Map();
    const pairs = new Map();
    const add = (map, key, label) => {
      const entry = map.get(key) || map.set(key, { key, label, count: 0 }).get(key);
      entry.count += 1;
    };

    for (const sentence of sentences(text)) {
      const list = words(sentence);
      for (let i = 0; i < list.length; i++) {
        if (!isTermWord(list[i])) continue;
        add(singles, stem(list[i]), list[i]);
        const next = list[i + 1];
        if (next && isTermWord(next)) add(pairs, stem(list[i]) + " " + stem(next), list[i] + " " + next);
      }
    }

    const keptPairs = [...pairs.values()].filter((p) => p.count >= MIN_MENTIONS);
    // Drop a single word if a kept phrase already accounts for all its mentions.
    const keptSingles = [...singles.values()].filter(
      (s) => s.count >= MIN_MENTIONS && !keptPairs.some((p) => p.key.split(" ").includes(s.key) && p.count >= s.count)
    );

    return keptPairs
      .concat(keptSingles)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, MAX_TERMS);
  }

  // Any phrase as its stemmed words, e.g. "Managed projects" -> "manag project".
  function phraseKey(text) {
    return sentences(text).flatMap(words).map(stem).join(" ");
  }

  // Synonym groups (synonyms.js) indexed by each member's stemmed form.
  let synonymIndex;
  function synonymGroups(key) {
    if (!synonymIndex) {
      synonymIndex = new Map();
      for (const group of NS.SYNONYMS || []) {
        const members = group.map((label) => ({ label, key: phraseKey(label) })).filter((m) => m.key);
        for (const m of members) {
          if (!synonymIndex.has(m.key)) synonymIndex.set(m.key, []);
          synonymIndex.get(m.key).push(members);
        }
      }
    }
    return synonymIndex.get(key) || [];
  }

  // For a keyword the resume lacks: a word from its synonym group that the
  // resume does use, or "" if there isn't one.
  function similarWording(label, resumeStems) {
    const key = phraseKey(label);
    for (const members of synonymGroups(key)) {
      const hit = members.find((m) => m.key !== key && resumeStems.includes(" " + m.key + " "));
      if (hit) return hit.label;
    }
    return "";
  }

  // ignored: Set of keyword ids the person said don't apply.
  // mine: the person's own skills, [{ name, aliases }].
  function analyze(resume, job, ignored, mine) {
    const set = skillSet(mine || []);
    const jobSkills = scanSkills(job, set.patterns);
    const resumeSkills = scanSkills(resume, set.patterns).found;
    const resumeStems = " " + sentences(resume).flatMap(words).map(stem).join(" ") + " ";

    const keywords = [];
    for (const [name, count] of jobSkills.found) {
      keywords.push({
        id: "skill:" + name.toLowerCase(),
        label: name,
        kind: "skill",
        count,
        found: resumeSkills.has(name),
        mine: set.mineNames.includes(name)
      });
    }
    for (const term of repeatedTerms(jobSkills.masked)) {
      keywords.push({
        id: "term:" + term.key,
        label: term.label,
        kind: "term",
        count: term.count,
        found: resumeStems.includes(" " + term.key + " ")
      });
    }
    for (const k of keywords) {
      k.weight = Math.min(k.count, MAX_WEIGHT) + (k.kind === "skill" ? 1 : 0);
      k.similar = k.found ? "" : similarWording(k.label, resumeStems);
    }
    keywords.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));

    const active = keywords.filter((k) => !ignored.has(k.id));
    const total = active.reduce((sum, k) => sum + k.weight, 0);
    const got = active.filter((k) => k.found).reduce((sum, k) => sum + k.weight, 0);

    // "similar" terms still count as missing in the score: filters want exact words.
    return {
      missing: active.filter((k) => !k.found && !k.similar),
      similar: active.filter((k) => !k.found && k.similar),
      found: active.filter((k) => k.found),
      ignored: keywords.filter((k) => ignored.has(k.id)),
      score: total ? Math.round((got / total) * 100) : null,
      // The person's skills, in their order: does the job ask for it, does the resume mention it.
      fit: set.mineNames.map((name) => ({ name, wanted: jobSkills.found.has(name), onResume: resumeSkills.has(name) }))
    };
  }

  // Simple factual checks on the resume text. Each: { ok: true|false, title, detail }.
  function checkResume(resume) {
    const lines = resume.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const heading = (pattern) => lines.some((l) => l.length < 40 && pattern.test(l));
    const workLines = lines.filter((l) => /^[-•*▪●◦‣–]/.test(l) || l.length > 60);
    const withNumbers = workLines.filter((l) => /\d|%|\$|€|£/.test(l)).length;

    const sections = [
      ["Experience", /^(work |professional |relevant )?(experience|employment|work history)\b/i],
      ["Education", /^education\b/i],
      ["Skills", /^(technical |core |key )?skills\b/i]
    ];
    const missingSections = sections.filter(([, re]) => !heading(re)).map(([name]) => name);

    return [
      {
        ok: /[\w.+-]+@[\w-]+\.[\w.-]+/.test(resume),
        title: "Email address",
        detail: "Recruiters need a way to reach you."
      },
      {
        // At least 9 digits, so date ranges like "2019 - 2023" don't count.
        ok: (resume.match(/\+?\d[\d\s().-]{7,}\d/g) || []).some((m) => m.replace(/\D/g, "").length >= 9),
        title: "Phone number",
        detail: "Optional, but many employers expect one."
      },
      {
        ok: missingSections.length === 0,
        title: "Standard section headings",
        detail: missingSections.length
          ? "Couldn't find a heading for: " + missingSections.join(", ") + ". Plain headings are easiest for software and people to find."
          : "Found Experience, Education and Skills."
      },
      {
        ok: workLines.length > 0 && withNumbers / workLines.length >= 0.3,
        title: "Results with numbers",
        detail: workLines.length
          ? withNumbers + " of " + workLines.length + " lines describing your work include a number. Numbers (%, $, counts) make results concrete where you have them."
          : "Couldn't find lines describing your work."
      }
    ];
  }

  NS.analyze = analyze;
  NS.checkResume = checkResume;
})();
