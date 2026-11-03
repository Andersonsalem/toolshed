// Reads bank statements into transactions, in the browser.
//   CSV / Excel: columns are found by their names (Date, Description, Amount or Debit/Credit).
//   PDF: best effort. Text lines that start with a date and end with amounts are
//        picked out; a running balance, when present, tells money in from money out.
// Every transaction is shown to the person to check before anything is used.
//
//   await Budget.readStatement(file) -> { transactions: [{ date, text, amount, sure }], kind, notes }
//     date: the date as written (parse with Budget.parseDate), amount: negative = money out,
//     sure: false when the in/out direction is a guess.
//   Budget.parseDate(text, order, yearHint) -> Date or null   (order "dmy" | "mdy")
//   Budget.guessDateOrder(dateTexts) -> "dmy" | "mdy" | null (null: can't tell)
//   Budget.categorize(text) -> category name
(function () {
  "use strict";
  const NS = (window.Budget = window.Budget || {});

  const MAX_ROWS = 5000;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // ---------- Amounts ----------

  // "1,234.56", "(12.00)", "-12.00", "12.00 DR", "1.234,56" -> signed number, or null.
  // DR (debit) and brackets mean money out; CR means money in.
  function parseMoney(raw) {
    let s = String(raw || "").trim();
    if (!s) return null;
    let sign = 1;
    if (/\bDR\b\.?$/i.test(s) || /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s)) sign = -1;
    s = s.replace(/\b(CR|DR)\b\.?$/i, "").replace(/[()\s$€£¥₹+-]/g, "").replace(/[A-Z]{3}$/i, "");
    if (!/^\d[\d.,']*$/.test(s)) return null;
    // A comma followed by exactly two digits at the end is a decimal comma (1.234,56).
    if (/,\d{2}$/.test(s)) s = s.replace(/[.']/g, "").replace(",", ".");
    else s = s.replace(/[,']/g, "");
    const value = parseFloat(s);
    return Number.isFinite(value) ? sign * value : null;
  }

  // ---------- Dates ----------

  function monthIndex(word) {
    return MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
  }

  function fullYear(y) {
    const n = Number(y);
    return n < 100 ? 2000 + n : n;
  }

  function valid(y, m, d) {
    const date = new Date(y, m, d);
    return date.getMonth() === m && date.getDate() === d && y > 1990 && y < 2100 ? date : null;
  }

  NS.parseDate = function (text, order, yearHint) {
    const s = String(text || "").trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return valid(+m[1], m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/))) {
      const year = m[3] ? fullYear(m[3]) : yearHint || new Date().getFullYear();
      return order === "mdy" ? valid(year, m[1] - 1, +m[2]) : valid(year, m[2] - 1, +m[1]);
    }
    if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?(?:[\s-,]+(\d{2,4}))?/)) && monthIndex(m[2]) >= 0) {
      return valid(m[3] ? fullYear(m[3]) : yearHint || new Date().getFullYear(), monthIndex(m[2]), +m[1]);
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/)) && monthIndex(m[1]) >= 0) {
      return valid(m[3] ? +m[3] : yearHint || new Date().getFullYear(), monthIndex(m[1]), +m[2]);
    }
    return null;
  };

  // Day/month or month/day? A first number over 12 means day first; a second
  // number over 12 means month first. If neither ever happens, we can't tell.
  NS.guessDateOrder = function (texts) {
    let dayFirst = false, monthFirst = false, numeric = false;
    for (const t of texts) {
      const m = String(t).trim().match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?/);
      if (!m) continue;
      numeric = true;
      if (+m[1] > 12) dayFirst = true;
      if (+m[2] > 12) monthFirst = true;
    }
    if (!numeric) return "dmy"; // no ambiguous dates at all
    if (dayFirst && !monthFirst) return "dmy";
    if (monthFirst && !dayFirst) return "mdy";
    return null;
  };

  // ---------- Categories ----------

  // Suggestions only: people can change every one in the review table.
  const RULES = [
    ["Transfers (not spending)", /transfer|xfer|venmo|zelle|paypal|revolut|wise\b|savings acc|to account|from account|internal|payment thank|thank you for your payment|autopay|card payment|credit card payment|directpay/i],
    ["Housing", /\brent\b|mortgage|landlord|letting|property mgmt|hoa\b|council tax/i],
    ["Utilities", /electric|energy|power co|water|sewer|\bgas\b(?! station)|utility|edf|british gas|octopus|duke energy|pg&e|con ed/i],
    ["Phone & internet", /verizon|at&t|t-mobile|tmobile|comcast|xfinity|spectrum|vodafone|\bo2\b|\bee\b|bt group|broadband|internet|mobile bill|fibre|fiber/i],
    ["Groceries", /grocer|supermarket|walmart|kroger|safeway|aldi|lidl|tesco|sainsbury|asda|morrisons|whole foods|trader joe|costco|carrefour|publix|albertsons|wegmans|food lion|h-e-b|\bheb\b|coop|co-op|rewe|edeka/i],
    ["Eating out", /restaurant|\bcafe\b|caf[eé]|coffee|starbucks|mcdonald|burger|pizza|kfc|subway|chipotle|taco|domino|uber ?eats|doordash|deliveroo|grubhub|just eat|bar\b|pub\b|bistro|diner/i],
    ["Transport", /\buber\b(?! ?eats)|\blyft\b|\btaxi\b|shell|\bbp\b|exxon|chevron|texaco|esso|fuel|petrol|gas station|parking|transit|metro|\btfl\b|railway|\btrain\b|\bbus\b|amtrak|toll|car wash|dmv/i],
    ["Insurance", /insurance|geico|allstate|progressive|state farm|aviva|axa|admiral|direct line|liberty mutual/i],
    ["Health", /pharmac|chemist|cvs|walgreens|boots|doctor|dental|dentist|clinic|hospital|medical|optician|gym|fitness|peloton|health/i],
    ["Subscriptions", /netflix|spotify|hulu|disney|hbo|max\.com|apple\.com|icloud|google storage|youtube|prime video|audible|adobe|microsoft|dropbox|patreon|subscription|chatgpt|openai|anthropic|claude\.ai/i],
    ["Shopping", /amazon|amzn|target|ebay|ikea|best buy|etsy|walmart\.com|zara|h&m|primark|uniqlo|argos|john lewis|shop/i],
    ["Entertainment", /cinema|theater|theatre|ticketmaster|eventbrite|steam|playstation|xbox|nintendo|concert|museum/i],
    ["Travel", /airbnb|hotel|airline|airways|ryanair|easyjet|delta air|united air|american air|expedia|booking\.com|hostel/i],
    ["Children", /daycare|nursery|childcare|school|toys/i],
    ["Pets", /\bpet|vet\b|veterinar|chewy|petco|petsmart/i],
    ["Gifts & giving", /donation|charity|gofundme|gift/i],
    ["Education", /tuition|university|college|course|udemy|coursera|books?\b/i]
  ];

  NS.categorize = function (text) {
    for (const [category, re] of RULES) if (re.test(text)) return category;
    return "Other";
  };

  // ---------- CSV and Excel ----------

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

  function findColumns(header) {
    const h = header.map(norm);
    const find = (re) => h.findIndex((x) => re.test(x));
    return {
      date: find(/^(transaction|posting|posted|booking|value)?date|^date/),
      text: find(/description|details|payee|merchant|narrative|memo|name|reference|particulars|transaction$/),
      amount: find(/^(transaction)?amount|^value$|^amt$/),
      debit: find(/debit|withdrawal|moneyout|paidout|spent|outgoing/),
      credit: find(/credit|deposit|moneyin|paidin|received|incoming/)
    };
  }

  function fromRows(rows) {
    // Banks sometimes put account details above the real header: find the
    // first row that names a date column and an amount-like column.
    let headerIndex = -1;
    let cols;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const c = findColumns(rows[i]);
      if (c.date >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0)) {
        headerIndex = i;
        cols = c;
        break;
      }
    }
    if (headerIndex === -1) {
      throw new Error("Couldn't find the date and amount columns. The file needs a header row with names like Date, Description and Amount (or Debit and Credit).");
    }
    const transactions = [];
    for (const row of rows.slice(headerIndex + 1, headerIndex + 1 + MAX_ROWS)) {
      let amount = null;
      if (cols.amount >= 0) amount = parseMoney(row[cols.amount]);
      if (amount === null && (cols.debit >= 0 || cols.credit >= 0)) {
        const out = cols.debit >= 0 ? parseMoney(row[cols.debit]) : null;
        const inn = cols.credit >= 0 ? parseMoney(row[cols.credit]) : null;
        if (out !== null || inn !== null) amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0);
      }
      const date = row[cols.date];
      if (amount === null || amount === 0 || !date) continue;
      const text = cols.text >= 0 ? row[cols.text] : row.filter((_, i) => i !== cols.date && i !== cols.amount).join(" ");
      transactions.push({ date, text: String(text || "").trim() || "(no description)", amount, sure: true });
    }
    const notes = [];
    // With one amount column, card statements often show spending as positive numbers.
    if (cols.amount >= 0 && transactions.length >= 5) {
      const positive = transactions.filter((t) => t.amount > 0).length / transactions.length;
      if (positive > 0.8) notes.push("Most amounts are positive. If this is a credit card statement, spending may be shown as positive: use “Swap in and out” below if the directions look wrong.");
    }
    return { transactions, notes };
  }

  // ---------- PDF ----------

  const DATE_START = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2}[\s-][A-Za-z]{3,9}\.?(?:[\s-]\d{2,4})?|[A-Za-z]{3,9}\.?\s\d{1,2}(?:,?\s\d{4})?)\b/;
  const MONEY = /(?:\(?-?[$€£]?\s?\d{1,3}(?:[,.' ]\d{3})*[.,]\d{2}\)?-?(?:\s?(?:CR|DR))?)/g;
  const SKIP = /opening balance|closing balance|balance (brought|carried) forward|previous balance|new balance|^total|subtotal|statement (period|date)|page \d/i;

  // Text lines of a PDF, top to bottom, with wide gaps kept as double spaces.
  async function pdfLines(bytes) {
    const doc = await PdfJs.open(bytes);
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await page.getTextContent()).items.filter((i) => i.str && i.str.trim());
      const rows = [];
      for (const item of items) {
        const y = item.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) rows.push((row = { y, items: [] }));
        row.items.push(item);
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = "";
        let end = null;
        for (const item of row.items) {
          const x = item.transform[4];
          if (end !== null) text += x - end > 12 ? "  " : x - end > 1 ? " " : "";
          text += item.str;
          end = x + item.width;
        }
        lines.push(text.trim());
      }
    }
    doc.close();
    return lines;
  }

  function fromPdfLines(lines) {
    // Statements often leave the year out of each line; use the year they mention most.
    const years = {};
    for (const l of lines) for (const y of l.match(/\b20\d{2}\b/g) || []) years[y] = (years[y] || 0) + 1;
    const yearHint = Number(Object.keys(years).sort((a, b) => years[b] - years[a])[0]) || null;

    const transactions = [];
    let lastBalance = null;
    for (const line of lines) {
      if (SKIP.test(line)) {
        // Still learn the starting balance, for working out directions.
        const nums = line.match(MONEY);
        if (nums && /opening|brought forward|previous balance/i.test(line)) lastBalance = parseMoney(nums[nums.length - 1]);
        continue;
      }
      const dateMatch = line.match(DATE_START);
      if (!dateMatch) continue;
      const rest = line.slice(dateMatch[0].length);
      const tokens = [...rest.matchAll(MONEY)];
      if (!tokens.length) continue;
      // Amounts at the end of the line: [..., amount, balance] or [..., amount].
      const trailing = [];
      let cut = rest.length;
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (rest.slice(t.index + t[0].length, cut).trim() !== "") break;
        trailing.unshift(t);
        cut = t.index;
      }
      if (!trailing.length) continue;
      const text = rest.slice(0, trailing[0].index).replace(/\s{2,}/g, " ").trim();
      if (!text) continue;

      const amountToken = trailing.length >= 2 ? trailing[trailing.length - 2] : trailing[0];
      const raw = parseMoney(amountToken[0]);
      if (raw === null || raw === 0) continue;
      const balance = trailing.length >= 2 ? parseMoney(trailing[trailing.length - 1][0]) : null;

      // Only CR/DR or a balance change say for certain which way money went:
      // a minus sign means "out" on bank statements but "in" (a refund) on cards.
      let amount = raw;
      let sure = /\b(CR|DR)\b/i.test(amountToken[0]);
      if (balance !== null && lastBalance !== null) {
        const size = Math.abs(raw);
        if (Math.abs(lastBalance - size - balance) < 0.011) {
          amount = -size;
          sure = true;
        } else if (Math.abs(lastBalance + size - balance) < 0.011) {
          amount = size;
          sure = true;
        }
      }
      // Nothing certain: follow the sign if there is one, otherwise assume
      // spending (most lines on a statement are). Flagged for the person to check.
      if (!sure && raw > 0) amount = -raw;
      if (balance !== null) lastBalance = balance;
      transactions.push({ date: dateMatch[0], text, amount, sure, yearHint });
    }
    return transactions;
  }

  // ---------- Entry point ----------

  NS.readStatement = async function (file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let lines;
      try {
        lines = await pdfLines(bytes);
      } catch (error) {
        if (error && error.name === "PasswordException") throw new Error("“" + file.name + "” is password-protected. Download it again without a password, or use the bank's CSV export.");
        throw new Error("“" + file.name + "” couldn't be read as a PDF.");
      }
      if (!lines.some((l) => /\d/.test(l))) {
        throw new Error("“" + file.name + "” has no readable text. It's probably a scanned image, which can't be read here. Use the bank's CSV export instead.");
      }
      const transactions = fromPdfLines(lines);
      if (!transactions.length) {
        throw new Error("No transactions were recognised in “" + file.name + "”. This bank's layout isn't understood; the bank's CSV export will work better.");
      }
      const unsure = transactions.filter((t) => !t.sure).length;
      return {
        kind: "pdf",
        transactions,
        notes: unsure ? [unsure + " of " + transactions.length + " transactions from “" + file.name + "” had no clear sign of money in or out. They're marked as money out: check them."] : []
      };
    }
    let rows;
    if (/\.(csv|tsv|txt)$/.test(name)) {
      rows = Sheet.parseCsv((await file.text()).replace(/^﻿/, ""));
    } else {
      const sheet = await Sheet.read(file, { maxRows: MAX_ROWS });
      rows = [sheet.headers].concat(sheet.rows);
    }
    rows = rows.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some(Boolean));
    const result = fromRows(rows);
    if (!result.transactions.length) throw new Error("No transactions with a date and an amount were found in “" + file.name + "”.");
    return { kind: "table", ...result };
  };

  NS.parseMoney = parseMoney;
})();
