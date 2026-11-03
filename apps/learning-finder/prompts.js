// Prompt templates for "Ask an AI assistant". The page fills in the person's
// choices; nothing here is sent anywhere.
//
//   LF.PROMPTS                 -> [{ id, name, build(o) }]
//   LF.PROMPT_OPTIONS          -> the choices people can make
(function () {
  "use strict";
  const LF = (window.LearningFinder = window.LearningFinder || {});

  LF.PROMPT_OPTIONS = {
    level: [
      ["new", "I'm completely new to it"],
      ["basics", "I know the basics"],
      ["advanced", "I'm fairly advanced"]
    ],
    goal: [
      ["curious", "Understand it, out of curiosity"],
      ["work", "Use it at work, or to get a job"],
      ["exam", "Pass an exam or a course"],
      ["build", "Make or build something with it"]
    ],
    time: [
      ["1-2", "1–2 hours a week"],
      ["3-5", "3–5 hours a week"],
      ["6-10", "6–10 hours a week"],
      ["10+", "More than 10 hours a week"]
    ],
    formats: [
      ["video", "Videos"],
      ["reading", "Books and articles"],
      ["practice", "Exercises and practice"],
      ["projects", "Projects"],
      ["audio", "Podcasts and audio"]
    ],
    budget: [
      ["free", "Free only"],
      ["cheap", "Free or low cost"],
      ["any", "Any price"]
    ]
  };

  // The option's text for use mid-sentence: first letter lowercased, except "I" and "I'm".
  const label = (list, id) => (LF.PROMPT_OPTIONS[list].find((x) => x[0] === id) || ["", ""])[1].replace(/^(?!I\b|I['’])./, (c) => c.toLowerCase());

  function about(o) {
    const formats = o.formats.length ? o.formats.map((f) => label("formats", f)).join(", ") : "any format";
    return [
      "My level: " + label("level", o.level) + ".",
      "My goal: " + label("goal", o.goal) + ".",
      "Time I have: " + label("time", o.time) + ".",
      "I learn best with: " + formats + ".",
      "Budget: " + label("budget", o.budget) + "."
    ].join("\n");
  }

  // Asked of every resource-giving prompt: AI assistants sometimes invent sources.
  const HONEST = "Only recommend resources you're confident really exist. Give the name and who made it, and say clearly when you're not sure a link or title is right.";

  LF.PROMPTS = [
    {
      id: "plan",
      name: "Make me a learning plan",
      build: (o) => `I want to learn ${o.topic}.

${about(o)}

Act as an experienced teacher. Make me a step-by-step learning plan:
1. Split it into stages, from where I am now to my goal.
2. For each stage: what to learn, why it matters, roughly how long it takes with my time, and how I'll know I'm ready to move on.
3. Suggest 1–3 resources for each stage that fit my format and budget.
4. End with one small project or exercise for each stage, so I practise rather than only read or watch.

${HONEST}`
    },
    {
      id: "30days",
      name: "A 30-day plan",
      build: (o) => `Give me a 30-day plan to learn ${o.topic}.

${about(o)}

Lay it out day by day (or in short blocks of days), fitting my weekly time. Each day: one clear task, how long it should take, and what I should be able to do afterwards. Build in review days, and make the last week about using what I've learned on something real.

${HONEST}`
    },
    {
      id: "explain",
      name: "Explain it from scratch",
      build: (o) => `Explain ${o.topic} to me.

My level: ${label("level", o.level)}.
My goal: ${label("goal", o.goal)}.

Start with the big picture in a few sentences, then the key ideas one at a time, each with a simple example or comparison from everyday life. Define any jargon the first time you use it. Finish with the three most common misunderstandings, and three questions I can answer to check I've understood.`
    },
    {
      id: "resources",
      name: "Find me resources",
      build: (o) => `Recommend the best resources to learn ${o.topic}.

${about(o)}

Give me 5 to 8 resources, best first. For each one: the name, who made it, the format, roughly how long it takes, whether it's free, and why it suits someone like me. Mix formats where it makes sense.

${HONEST}`
    },
    {
      id: "quiz",
      name: "Quiz me",
      build: (o) => `Quiz me on ${o.topic}.

My level: ${label("level", o.level)}.

Ask one question at a time and wait for my answer. After each answer, tell me if I'm right, explain briefly why, then ask the next question. Start easy and make them harder as I get them right. After 10 questions, tell me what I know well and what to study next.`
    }
  ];
})();
