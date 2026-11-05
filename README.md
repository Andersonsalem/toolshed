# Toolshed

Free tools that run in the browser. No backend, no build step, no package manager. The few third-party libraries are copied into the site (see below).

**Note:** This was built using claude code because I got offered a subscription and don't really know what to do with it. It's a fun way to provide people with useful tools and learning resources I myself can guarantee (because it uses my notes on obsidian for these and I double check before comitting). Anyways, I hope these are useful for you.

## Principles

1. **Honest.** Say exactly what a tool does and assumes. Mark anything unfinished as *Planned*. Never claim more than is true.
2. **Free.** Every feature works for everyone. Support is optional and unlocks nothing.
3. **Private.** Everything runs on the visitor's device. No analytics, no cookies, no third-party scripts, fonts or CDNs.
4. **Compartmentalized.** Each tool lives in its own folder and depends only on `shared/`. Deleting a tool's folder can't break any other tool.
5. **Foolproof.** Plain HTML, CSS and JS. Works from any static host, and most tools also work when opened straight from disk (the PDF Toolkit needs a web address, and says so). Storage failures are caught, and saved data can always be exported.

## Layout

```
index.html, hub.css, hub.js   Hub page (built from the registry)
about.html                    How the site works: privacy, money, limits
shared/
  config.js                   Site name, author, support link: edit this
  registry.js                 List of tools shown on the hub
  layout.js                   Header, footer, page titles, support links
  storage.js                  Safe, versioned localStorage + backup export/import
  base.css                    Design tokens (light and dark) and shared components
  icon.svg                    Favicon
apps/
  _template/                  Copy this to start a new tool
  <tool-id>/                  One folder per tool: index.html, app.js, app.css
```

## Common tasks

**Add the support link:** set `supportUrl` in `shared/config.js`. Every support button and message on the site switches on automatically.

**Rename the site:** change `name` in `shared/config.js`. (The `<title>` tags in the HTML are only fallbacks.)

**Add a tool:**
1. Copy `apps/_template` to `apps/<tool-id>`.
2. Set `APP_ID` in its `app.js` to `<tool-id>`.
3. Add an entry to `shared/registry.js` with `status: "planned"`, then switch it to `"live"` when it's ready.

**Change a tool's saved-data format:** bump the version in `Store.open(id, version, migrate)` and write a `migrate(oldData, oldVersion)` function so nobody loses their data.

## Rules for shared/

`shared/` is used by every tool, so changes there need extra care:
- Only add to it. Don't rename or remove anything an existing tool uses.
- Never change the storage prefix in `storage.js`; that would make everyone's saved data disappear.
- After changing anything in `shared/`, open every live tool and check it still works.

## Tools that use the internet

Most tools never touch the network. A tool that needs outside data must:
- make every request through `shared/net.js` (`Net.getJSON(serviceId, url, { cacheMinutes })`), which allows only the services listed in its `SERVICES`, caches answers, limits each service to 1 request a second and a cap per hour per browser, and backs off when a service says "too many requests";
- set `online: "<service name>"` in `shared/registry.js`, so the hub shows "Uses the internet";
- say on its own page exactly what it sends, and credit the data source if its licence asks for it.

| Service | Used by | Sends | Licence / terms |
|---|---|---|---|
| [Wikipedia API](https://www.mediawiki.org/wiki/API:Main_page) | Wikipedia Paths | Topic names searched; asks for page links and summaries. Up to ~45 requests per search, one at a time, with an `Api-User-Agent` header (set `sourceUrl` or `contactEmail` in `shared/config.js` so Wikimedia can reach you) | Text CC BY-SA 4.0, credited and linked on the page. No key needed; Wikimedia asks for serial requests and an identifying header. |
| Wikipedia, [Wikibooks](https://www.wikibooks.org/), [Wikiversity](https://www.wikiversity.org/) | Learning Finder | The topic typed; 4 requests per search, cached a day | Text CC BY-SA 4.0, credited on the page. |
| [Open Library](https://openlibrary.org/developers/api) | Learning Finder | The topic typed; 1 request per search, cached a day (book covers load from covers.openlibrary.org) | Open data from the Internet Archive; credited on the page. |
| [Open-Meteo](https://open-meteo.com/) | Weather Planner | Place name searched, or coordinates rounded to ~1 km | Data CC BY 4.0 (credited on the page). The free API is for non-commercial use: fine for a free site with optional tips; if tips become real income, consider their paid plan. |

## Third-party code

Libraries used by one tool live in that tool's `vendor/` folder; libraries used by several live in `shared/vendor/`. Each comes with its licence file. Nothing is loaded from a CDN.

| Used by | Library | Version | Licence | Files |
|---|---|---|---|---|
| PDF Toolkit, Budget Planner (via `shared/pdfjs.js`) | [pdf.js](https://github.com/mozilla/pdf.js) (reading PDFs) | 6.4.299 | Apache-2.0 | `shared/vendor/pdfjs/` |
| PDF Toolkit | [pdf-lib](https://github.com/Hopding/pdf-lib) (editing) | 1.17.1 | MIT | `apps/pdf-toolkit/vendor/pdf-lib.min.js` |
| JSON, YAML & CSV Viewer | [yaml](https://github.com/eemeli/yaml) (reads/writes YAML, keeps comments) | 2.9.1 | ISC | `apps/data-viewer/vendor/yaml/` (the package's `browser/` folder) |
| JSON, YAML & CSV Viewer | Config schemas from [SchemaStore](https://www.schemastore.org/) and the [Compose Specification](https://github.com/compose-spec/compose-spec) | downloaded 2026-10-31 | Apache-2.0 | `apps/data-viewer/schemas/` |
| Text Compare | [jsdiff](https://github.com/kpdecker/jsdiff) (finding differences) | 9.0.0 | BSD-3-Clause | `apps/text-diff/vendor/` (`dist/diff.min.js` from the npm package `diff`, unchanged) |
| QR Code Generator | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (encoding) | 2.0.4 | MIT | `apps/qr-code/vendor/` (`dist/qrcode.js` from the npm package, unchanged) |
| Password Generator | [EFF large word list](https://www.eff.org/dice) for passphrases (7,776 words) | 2016 list, SHA-256 `addd3553…996b903e` | CC BY 3.0 US (credited on the page) | `apps/password-generator/words.js` |
| Fitness Log | Food list from [USDA FoodData Central](https://fdc.nal.usda.gov/) SR Legacy (7,793 foods, ~0.9 MB) | SR Legacy, April 2018 (final release) | Public domain (credited on the page) | `apps/fitness-log/foods.json` |

**Rebuilding the food list:** download the SR Legacy CSV zip from FoodData Central, unzip it, and run `python -I apps/fitness-log/build_foods.py <unzipped folder> apps/fitness-log/foods.json`. Foods everyone searches for get a ranking boost from the `COMMON` list in `apps/fitness-log/data.js`; the names there must match the USDA names exactly.

**Updating the config schemas:** download fresh copies from `https://json.schemastore.org/<name>.json` (github-workflow, dependabot-2.0 → dependabot.json, pre-commit-config → pre-commit.json, package, tsconfig) and `https://raw.githubusercontent.com/compose-spec/compose-spec/main/schema/compose-spec.json` (→ docker-compose.json). To support another kind of file, add its schema there and an entry to `KINDS` in `apps/data-viewer/schema.js`.

Shared helpers written for this site: `shared/zip.js` (read/write .zip, also used for .docx and .xlsx), `shared/sheet.js` (read .csv and .xlsx), `shared/pdfjs.js` (load pdf.js safely).

**Updating pdf.js:** `npm pack pdfjs-dist@<version>`, then copy into `shared/vendor/pdfjs/` `build/pdf.min.mjs` and `build/pdf.worker.min.mjs` as `pdf.min.js` and `pdf.worker.min.js` (renamed because some servers label `.mjs` as plain text, which browsers refuse to run), plus `standard_fonts/`, `cmaps/`, `iccs/`, the `.wasm` files and licences from `wasm/` (not the `quickjs` files: PDFs never get to run code), and `LICENSE`. Then test the toolkit with a few real PDFs.

## Run locally

Double-click `index.html`, or serve the folder (needed for the PDF Toolkit):

```bash
python -m http.server 8080
```

## Deploy

Any static host works: GitHub Pages, Cloudflare Pages, Netlify. Upload the folder as-is; there's nothing to build.
