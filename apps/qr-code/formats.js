// What goes inside the QR code for each kind of content. No page layout here.
//
//   QR.KINDS                      the kinds, with their fields
//   QR.encode(kind, values)       -> { text } or { error }, the exact text to put in the code
//
// The formats are the ones phone cameras understand: links, WIFI: (from the
// ZXing project, read by iOS and Android), mailto:, tel:, SMSTO: and vCard 3.0.
(function () {
  "use strict";
  const QR = (window.QR = window.QR || {});

  // Field: [id, label, type, extra]. Types: text, textarea, select, checkbox.
  QR.KINDS = [
    { id: "link", label: "Link", fields: [["url", "Web address", "url", { placeholder: "example.com/menu" }]] },
    { id: "text", label: "Text", fields: [["text", "Text", "textarea", { placeholder: "Any text: a note, a code, an address…" }]] },
    {
      id: "wifi",
      label: "Wi-Fi",
      fields: [
        ["ssid", "Network name", "text", { placeholder: "Exactly as it appears in your Wi-Fi list" }],
        ["security", "Security", "select", { options: [["WPA", "WPA, WPA2 or WPA3 (most networks)"], ["WEP", "WEP (old)"], ["nopass", "None (open network)"]] }],
        ["password", "Password", "text", { autocomplete: "off" }],
        ["hidden", "The network is hidden", "checkbox"]
      ]
    },
    {
      id: "contact",
      label: "Contact",
      fields: [
        ["first", "First name", "text", { half: true }],
        ["last", "Last name", "text", { half: true }],
        ["phone", "Phone", "tel", { half: true }],
        ["email", "Email", "email", { half: true }],
        ["org", "Company", "text", { half: true }],
        ["title", "Job title", "text", { half: true }],
        ["website", "Website", "url", {}]
      ]
    },
    {
      id: "email",
      label: "Email",
      fields: [
        ["to", "To", "email", {}],
        ["subject", "Subject", "text", {}],
        ["body", "Message", "textarea", {}]
      ]
    },
    { id: "phone", label: "Phone call", fields: [["number", "Phone number", "tel", { placeholder: "+1 555 123 4567" }]] },
    {
      id: "sms",
      label: "Text message",
      fields: [
        ["number", "Phone number", "tel", { placeholder: "+1 555 123 4567" }],
        ["message", "Message (optional)", "textarea", {}]
      ]
    }
  ];

  const trim = (v) => (typeof v === "string" ? v.trim() : "");
  // Phone numbers: keep a leading + and the digits; drop spaces, dashes and brackets.
  const phone = (v) => trim(v).replace(/(?!^\+)[^\d]/g, "");

  // Adds https:// when the scheme is missing, and checks it looks like a web address.
  function link(v) {
    let s = trim(v);
    if (!s) return { error: "Type a web address." };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    let u;
    try {
      u = new URL(s);
    } catch (e) {
      return { error: "That doesn't look like a web address." };
    }
    if (!/^https?:$/.test(u.protocol)) return { text: s };
    if (!u.hostname.includes(".") && u.hostname !== "localhost") {
      return { error: "That doesn't look like a web address (it needs a dot, like example.com)." };
    }
    // The browser's tidy form: accents and spaces percent-encoded, which every scanner reads.
    return { text: u.href };
  }

  // Wi-Fi format: \ ; , : and " must be escaped with a backslash.
  const wifiEscape = (s) => s.replace(/([\\;,:"])/g, "\\$1");
  // vCard: backslash, comma, semicolon and line breaks are escaped.
  const vcardEscape = (s) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

  QR.encode = function (kind, v) {
    switch (kind) {
      case "link":
        return link(v.url);
      case "text":
        return v.text && v.text.trim() ? { text: v.text } : { error: "Type some text." };
      case "wifi": {
        const ssid = v.ssid || "";
        if (!ssid.trim()) return { error: "Type the network name." };
        const sec = ["WPA", "WEP", "nopass"].includes(v.security) ? v.security : "WPA";
        if (sec !== "nopass" && !v.password) return { error: "Type the Wi-Fi password, or choose “None” if the network is open." };
        // Spaces in names and passwords are kept: they're part of them.
        let s = "WIFI:T:" + sec + ";S:" + wifiEscape(ssid) + ";";
        if (sec !== "nopass") s += "P:" + wifiEscape(v.password) + ";";
        if (v.hidden) s += "H:true;";
        return { text: s + ";" };
      }
      case "contact": {
        const first = trim(v.first), last = trim(v.last), org = trim(v.org);
        if (!first && !last && !org) return { error: "Type at least a name or a company." };
        const lines = ["BEGIN:VCARD", "VERSION:3.0", "N:" + vcardEscape(last) + ";" + vcardEscape(first) + ";;;", "FN:" + vcardEscape([first, last].filter(Boolean).join(" ") || org)];
        if (org) lines.push("ORG:" + vcardEscape(org));
        if (trim(v.title)) lines.push("TITLE:" + vcardEscape(trim(v.title)));
        if (phone(v.phone)) lines.push("TEL;TYPE=CELL:" + phone(v.phone));
        if (trim(v.email)) lines.push("EMAIL:" + vcardEscape(trim(v.email)));
        if (trim(v.website)) {
          const w = link(v.website);
          if (w.error) return { error: "Website: " + w.error };
          lines.push("URL:" + vcardEscape(w.text));
        }
        lines.push("END:VCARD");
        return { text: lines.join("\r\n") };
      }
      case "email": {
        const to = trim(v.to);
        if (!to && !trim(v.subject) && !trim(v.body)) return { error: "Type an address, a subject or a message." };
        const q = [];
        if (trim(v.subject)) q.push("subject=" + encodeURIComponent(trim(v.subject)));
        if (trim(v.body)) q.push("body=" + encodeURIComponent(v.body.trim()));
        return { text: "mailto:" + encodeURI(to) + (q.length ? "?" + q.join("&") : "") };
      }
      case "phone":
        return phone(v.number).replace("+", "").length >= 3 ? { text: "tel:" + phone(v.number) } : { error: "Type a phone number." };
      case "sms": {
        const n = phone(v.number);
        if (n.replace("+", "").length < 3) return { error: "Type a phone number." };
        return { text: "SMSTO:" + n + ":" + (v.message || "").trim() };
      }
    }
    return { error: "Unknown kind." };
  };
})();
