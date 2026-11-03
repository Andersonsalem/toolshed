// Where the Learning Finder looks, and how. No page layout here.
// Requests go through shared/net.js (allow-list, rate limits, caching).
//
//   await LF.overview(topic, lang)   -> { main, related } from Wikipedia
//   await LF.wikibooks(topic, lang)  -> [{ title, snippet, url }]
//   await LF.wikiversity(topic, lang)-> [{ title, snippet, url }]
//   await LF.books(topic)            -> [{ title, authors, year, access, url, cover }]
//   LF.SITES                         -> other free learning sites, searched by link only
(function () {
  "use strict";
  const LF = (window.LearningFinder = window.LearningFinder || {});
  const DAY = 24 * 60;

  // Search snippets come with <span> highlighting: turned into plain text, never inserted as HTML.
  function plain(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  function wikiUrl(host, params) {
    return "https://" + host + "/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  }
  const pageUrl = (host, title) => "https://" + host + "/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));

  // The best-matching article, then articles Wikipedia itself considers similar
  // to it ("morelike"), which are far more on-topic than the next search results.
  LF.overview = async function (topic, lang) {
    const host = lang + ".wikipedia.org";
    const data = await Net.getJSON("wikipedia", wikiUrl(host, {
      action: "query", generator: "search", gsrsearch: topic, gsrlimit: "1", gsrnamespace: "0",
      prop: "extracts|description|pageimages", exintro: "1", explaintext: "1", exsentences: "3",
      piprop: "thumbnail", pithumbsize: "240"
    }), { cacheMinutes: DAY });
    const page = ((data.query && data.query.pages) || [])[0];
    if (!page) return { main: null, related: [] };
    const main = {
      title: page.title,
      description: page.description || "",
      extract: page.extract || "",
      image: page.thumbnail ? page.thumbnail.source : "",
      url: pageUrl(host, page.title)
    };
    let related = [];
    try {
      const similar = await Net.getJSON("wikipedia", wikiUrl(host, {
        action: "query", list: "search", srsearch: "morelike:" + page.title, srlimit: "6", srnamespace: "0", srprop: ""
      }), { cacheMinutes: DAY });
      related = ((similar.query && similar.query.search) || [])
        .filter((r) => r.title !== page.title)
        .slice(0, 6)
        .map((r) => ({ title: r.title, url: pageUrl(host, r.title) }));
    } catch (e) {
      /* related topics are a bonus; the overview still shows */
    }
    return { main, related };
  };

  // Wikibooks and Wikiversity list chapters as "Book/Chapter": grouped under their book.
  async function wikimediaSearch(site, topic, lang) {
    const host = lang + "." + site + ".org";
    const data = await Net.getJSON("wikimedia", wikiUrl(host, {
      action: "query", list: "search", srsearch: topic, srlimit: "12", srnamespace: "0", srprop: "snippet"
    }), { cacheMinutes: DAY });
    const seen = new Set();
    const out = [];
    for (const r of (data.query && data.query.search) || []) {
      const root = r.title.split("/")[0];
      if (seen.has(root)) continue;
      seen.add(root);
      out.push({ title: root, snippet: plain(r.snippet), url: pageUrl(host, root) });
      if (out.length >= 5) break;
    }
    return out;
  }
  LF.wikibooks = (topic, lang) => wikimediaSearch("wikibooks", topic, lang);
  LF.wikiversity = (topic, lang) => wikimediaSearch("wikiversity", topic, lang);

  // Only books you can read or borrow for free through Open Library. Searches
  // titles and subjects, not authors (otherwise "guitar" finds an author called Guitar).
  LF.books = async function (topic) {
    const t = topic.replace(/[()"\\:]/g, " ").trim();
    const data = await Net.getJSON("openlibrary", "https://openlibrary.org/search.json?" + new URLSearchParams({
      q: "title:(" + t + ") OR subject:(" + t + ")", has_fulltext: "true", limit: "30",
      fields: "key,title,author_name,first_publish_year,ebook_access,cover_i"
    }), { cacheMinutes: DAY });
    const rank = { public: 0, borrowable: 1 };
    return ((data && data.docs) || [])
      .filter((d) => d.ebook_access in rank && d.title && d.key)
      .sort((a, b) => rank[a.ebook_access] - rank[b.ebook_access])
      .slice(0, 8)
      .map((d) => ({
        title: d.title,
        authors: (d.author_name || []).slice(0, 2).join(", "),
        year: d.first_publish_year || "",
        access: d.ebook_access,
        url: "https://openlibrary.org" + d.key,
        cover: d.cover_i ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg" : ""
      }));
  };

  // Free (or free-to-start) learning sites. These are plain links: nothing is
  // sent to them unless the person clicks.
  LF.SITES = [
    { name: "Khan Academy", note: "Free lessons and practice, mostly school and university subjects", url: "https://www.khanacademy.org/search?page_search_query={q}" },
    { name: "MIT OpenCourseWare", note: "Free materials from real MIT courses", url: "https://ocw.mit.edu/search/?q={q}" },
    { name: "Open Textbook Library", note: "Free university textbooks", url: "https://open.umn.edu/opentextbooks/textbooks?term={q}" },
    { name: "freeCodeCamp", note: "Free programming tutorials and courses", url: "https://www.freecodecamp.org/news/search/?query={q}" },
    { name: "edX", note: "University courses; many can be followed for free (“audit”)", url: "https://www.edx.org/search?q={q}" },
    { name: "Coursera", note: "Courses; many can be followed for free (“audit”), certificates cost money", url: "https://www.coursera.org/search?query={q}" },
    { name: "YouTube", note: "Video tutorials of every quality: check who made them", url: "https://www.youtube.com/results?search_query={q}+explained" },
    { name: "Project Gutenberg", note: "Free classic books (older than about 1930)", url: "https://www.gutenberg.org/ebooks/search/?query={q}" },
    { name: "Internet Archive", note: "Free books, lectures, audio and video", url: "https://archive.org/search?query={q}" }
  ];
  LF.siteUrl = (site, topic) => site.url.replace("{q}", encodeURIComponent(topic.trim()));
})();
