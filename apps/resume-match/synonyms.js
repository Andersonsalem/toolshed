// Groups of words that mean roughly the same thing in a job search.
// When a job's term is missing from a resume but another word from its group
// is there, the page says so ("you wrote 'developer'"). It doesn't add to the
// score, because hiring filters usually look for the exact words.
//
// Word endings are ignored when matching, so "engineer" also covers "engineers".
// Keep groups tight: only add a word if swapping it in would read as the same claim.
(window.ResumeMatch = window.ResumeMatch || {}).SYNONYMS = [
  // Job titles
  ["engineer", "developer", "programmer"],
  ["software engineer", "software developer"],
  ["frontend engineer", "frontend developer", "front end engineer", "front end developer", "ui engineer", "ui developer"],
  ["backend engineer", "backend developer", "back end engineer", "back end developer"],
  ["full stack", "fullstack"],
  ["frontend", "front end", "client side"],
  ["backend", "back end", "server side"],

  // Ways of working
  ["leadership", "led", "team lead", "mentored", "mentoring"],
  ["management", "managed", "managing"],
  ["project management", "managed projects", "project manager"],
  ["communication", "communicated", "presented", "presentations"],
  ["collaboration", "collaborated", "cross functional", "partnered"],
  ["stakeholders", "business partners"],
  ["problem solving", "troubleshooting", "debugging"],
  ["documentation", "documented", "technical writing"],
  ["agile", "scrum", "sprints", "kanban"],

  // Work and results
  ["customers", "clients"],
  ["performance", "optimization", "optimized", "load time", "latency"],
  ["analysis", "analyzed", "analysed", "analytics", "analytical"],
  ["automation", "automated", "scripting"],
  ["scalable", "scalability", "scaled"],
  ["deployment", "deployed", "released", "shipped"],
  ["dashboards", "reporting", "reports"],
  ["metrics", "kpis", "kpi"],
  ["testing", "tests", "tested", "qa", "quality assurance"],

  // Tools and areas
  ["cloud", "aws", "azure", "google cloud", "gcp"],
  ["databases", "database", "sql", "postgresql", "mysql"],
  ["ci/cd", "continuous integration", "continuous deployment", "github actions", "jenkins"],
  ["git", "github", "gitlab", "version control"],
  ["rest apis", "apis", "web services"],
  ["design systems", "component library", "component libraries"],
  ["user research", "usability testing", "user interviews"],
  ["machine learning", "predictive modeling", "predictive modelling"],
  ["microsoft excel", "excel", "spreadsheets", "google sheets"],
  ["data pipelines", "etl", "data engineering"],
  ["customer success", "customer support", "customer service", "account management"],
  ["seo", "organic search", "organic traffic"],
  ["mobile", "ios", "android"]
];
