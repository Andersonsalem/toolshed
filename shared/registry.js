// Every tool on the site, in display order. The hub page is built from this list.
//
// To add a tool: copy apps/_template to apps/<id>, then add an entry here.
//   id          folder name under apps/ (lowercase, dashes)
//   name        short display name
//   description one sentence, says plainly what it does
//   category    used to group tools on the hub
//   status      "live" (usable, linked) or "planned" (shown, not linked)
//   online      optional: the outside service the tool contacts (e.g. "Open-Meteo").
//               Shown on the hub as "Uses the internet". Tools without it must
//               not make any network requests.
window.APPS = [
  {
    id: "job-tracker",
    name: "Application Tracker",
    description: "Track every job application, see what needs a follow-up, and spot what's working.",
    category: "Job search",
    status: "live"
  },
  {
    id: "resume-match",
    name: "Resume ↔ Job Match",
    description: "Compare your resume to a job description and see which keywords are missing.",
    category: "Job search",
    status: "live"
  },
  {
    id: "offer-compare",
    name: "Offer Comparator",
    description: "Put job offers side by side: total pay, pay after tax, what's left after living costs, and pay per hour.",
    category: "Job search",
    status: "live"
  },
  {
    id: "budget-planner",
    name: "Budget & Runway Planner",
    description: "Monthly budget, how long savings last without a paycheck, debt payoff plans and savings goals. Can read bank statements.",
    category: "Money",
    status: "live"
  },
  {
    id: "weather-planner",
    name: "Weather Planner",
    description: "This week's forecast, and the best times for a run, a ride, a picnic or drying laundry.",
    category: "Everyday",
    status: "live",
    online: "Open-Meteo"
  },
  {
    id: "wiki-paths",
    name: "Wikipedia Paths",
    description: "How is pizza connected to the Moon? Find a chain of Wikipedia links between two topics and read about each step.",
    category: "Learning",
    status: "live",
    online: "Wikipedia"
  },
  {
    id: "learning-finder",
    name: "Learning Finder",
    description: "Free textbooks, courses and books on any topic, plus a ready-made prompt for a personal learning plan.",
    category: "Learning",
    status: "live",
    online: "Wikipedia, Wikibooks, Wikiversity, Open Library"
  },
  {
    id: "fitness-log",
    name: "Fitness Log",
    description: "Plan and track workouts on a calendar, and keep a simple food diary with a USDA food list. No account.",
    category: "Health",
    status: "live"
  },
  {
    id: "unit-converter",
    name: "Unit Converter",
    description: "Length, weight, temperature, cooking, data sizes, pressure, fuel economy and more, with exact definitions and US vs UK units kept apart.",
    category: "Everyday",
    status: "live"
  },
  {
    id: "time-zones",
    name: "Time Zone Meeting Planner",
    description: "See everyone's local time side by side, find an hour that suits all of you, and send the times or a calendar invite.",
    category: "Everyday",
    status: "live"
  },
  {
    id: "password-generator",
    name: "Password Generator",
    description: "Random passwords, easy-to-type passphrases and PINs, with an honest look at how long each would take to crack.",
    category: "Everyday",
    status: "live"
  },
  {
    id: "qr-code",
    name: "QR Code Generator",
    description: "QR codes for links, Wi-Fi, contacts, emails, calls and texts. They never expire and don't track anyone. PNG or SVG.",
    category: "Everyday",
    status: "live"
  },
  {
    id: "message-templates",
    name: "Message Templates",
    description: "Fill-in-the-blank messages for follow-ups, thank-you notes, offers, networking, resigning, refunds and more.",
    category: "Writing",
    status: "live"
  },
  {
    id: "text-diff",
    name: "Text Compare",
    description: "Paste or open two versions of a text and see exactly what was added, removed or changed, line by line or word by word.",
    category: "Writing",
    status: "live"
  },
  {
    id: "image-toolkit",
    name: "Image Toolkit",
    description: "Crop, rotate, resize, convert and shrink images, remove hidden photo data, and make a signature image.",
    category: "Files",
    status: "live"
  },
  {
    id: "data-viewer",
    name: "JSON, YAML & CSV Viewer",
    description: "Read JSON, YAML and CSV as a tree or table, find errors, convert, and see what each setting in common config files does.",
    category: "Files",
    status: "live"
  },
  {
    id: "pdf-toolkit",
    name: "PDF Toolkit",
    description: "Merge PDFs, reorder, rotate and remove pages, or split them up, without uploading anything.",
    category: "Files",
    status: "live"
  },
  {
    id: "tensor-shapes",
    name: "Tensor Shape Visualizer",
    description: "Paste PyTorch or NumPy code and see every tensor drawn as a bar, grid or cube, step by step, with shape errors explained.",
    category: "Coding",
    status: "live"
  },
  {
    id: "einsum",
    name: "Einsum Explainer",
    description: "Learn einsum notation by clicking: see which numbers are multiplied and added for each result, with a tutorial from zero and a cheat sheet.",
    category: "Coding",
    status: "live"
  },
  {
    id: "regex-generator",
    name: "Regex Generator",
    description: "Type an example, adjust plain-language blocks, and get a regular expression for your language, tested live and explained part by part.",
    category: "Coding",
    status: "live"
  }
];
