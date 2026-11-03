// Ready-made patterns, as blocks. Each: { name, test (sample text to try it on), make() -> blocks }.
(function () {
  "use strict";
  const B = (kind, fields) => RX.block(kind, fields);
  const q = (min, max, mode) => ({ min, max, mode: mode || "greedy" });
  const digits = (min, max) => B("class", { cls: "digit", q: q(min, max === undefined ? min : max) });

  window.PRESETS = [
    {
      name: "Email address",
      test: "Write to sam.lee@example.com or help@mail.example.org (not @nobody).",
      make: () => [
        B("anchor", { at: "wordEdge" }),
        B("set", { chars: "a-zA-Z0-9._%+-", q: q(1, null) }),
        B("text", { text: "@" }),
        B("set", { chars: "a-zA-Z0-9.-", q: q(1, null) }),
        B("text", { text: "." }),
        B("class", { cls: "letter", q: q(2, null) })
      ]
    },
    {
      name: "Date (2026-10-31)",
      test: "Due 2026-10-31, paid 2026-11-02, not 26-1-1.",
      make: () => [B("anchor", { at: "wordEdge" }), digits(4), B("text", { text: "-" }), digits(2), B("text", { text: "-" }), digits(2), B("anchor", { at: "wordEdge" })]
    },
    {
      name: "Time (09:45)",
      test: "Open 09:45 to 17:30, or 7:05.",
      make: () => [B("anchor", { at: "wordEdge" }), digits(1, 2), B("text", { text: ":" }), digits(2), B("anchor", { at: "wordEdge" })]
    },
    {
      name: "Phone (555-123-4567)",
      test: "Call 555-123-4567, 555.123.4567 or 555 123 4567.",
      make: () => [digits(3), B("set", { chars: "-. ", q: q(0, 1) }), digits(3), B("set", { chars: "-. ", q: q(0, 1) }), digits(4)]
    },
    {
      name: "Web address",
      test: "See https://example.com/page?id=4 or http://test.org.",
      make: () => [B("text", { text: "http" }), B("text", { text: "s", q: q(0, 1) }), B("text", { text: "://" }), B("set", { chars: " \t\n\"'<>", negate: true, q: q(1, null) }), B("look", { dir: "behind", negate: true, children: [B("set", { chars: ".,;:!?" })] })]
    },
    {
      name: "IP address",
      test: "Servers 192.168.0.1 and 10.0.0.254.",
      make: () => [
        B("anchor", { at: "wordEdge" }),
        B("group", { capture: "none", q: q(3, 3), children: [digits(1, 3), B("text", { text: "." })] }),
        digits(1, 3),
        B("anchor", { at: "wordEdge" })
      ]
    },
    {
      name: "Price after $",
      test: "Was $40, now $ 34.99 for 2 items.",
      make: () => [
        B("look", { dir: "behind", negate: false, children: [B("text", { text: "$" }), B("class", { cls: "blank", q: q(0, 1) })] }),
        B("class", { cls: "digit", q: q(1, null) }),
        B("group", { capture: "none", q: q(0, 1), children: [B("text", { text: "." }), digits(2)] })
      ]
    },
    {
      name: "Hex color",
      test: "Colors #1a2b3c, #FFF and #12345 (too short).",
      make: () => [
        B("text", { text: "#" }),
        B("or", { options: [[B("set", { chars: "0-9a-fA-F", q: q(6, 6) })], [B("set", { chars: "0-9a-fA-F", q: q(3, 3) })]] }),
        B("anchor", { at: "wordEdge" })
      ]
    },
    {
      name: "Hashtag",
      test: "#launch day! Not issue#42, but #two_words.",
      make: () => [B("look", { dir: "behind", negate: true, children: [B("class", { cls: "word" })] }), B("text", { text: "#" }), B("group", { capture: "name", name: "tag", children: [B("class", { cls: "word", q: q(1, null) })] })]
    },
    {
      name: "Repeated word",
      test: "This is is a test of the the finder.",
      make: () => {
        const g = B("group", { capture: "name", name: "word", children: [B("class", { cls: "letter", q: q(1, null) })] });
        return [B("anchor", { at: "wordEdge" }), g, B("class", { cls: "space", q: q(1, null) }), B("backref", { ref: g.id }), B("anchor", { at: "wordEdge" })];
      }
    },
    {
      name: "Quoted text",
      test: 'She said "hi" and then "bye".',
      make: () => [B("text", { text: '"' }), B("group", { capture: "number", children: [B("set", { chars: '"\n', negate: true, q: q(0, null, "lazy") })] }), B("text", { text: '"' })]
    },
    {
      name: "Strong password",
      test: "Tr0ub4dor&3",
      make: () => {
        const has = (cls) => B("look", { dir: "ahead", negate: false, children: [B("class", { cls: "any", q: q(0, null, "lazy") }), B("class", { cls })] });
        return [B("anchor", { at: "textStart" }), has("digit"), has("lower"), has("upper"), B("class", { cls: "notspace", q: q(8, null) }), B("anchor", { at: "textEnd" })];
      }
    },
    {
      name: "key = value lines",
      test: "name = Sam\nage=34\n# comment\ncity = Lyon",
      make: () => [
        B("anchor", { at: "lineStart" }),
        B("group", { capture: "name", name: "key", children: [B("class", { cls: "word", q: q(1, null) })] }),
        B("class", { cls: "blank", q: q(0, null) }),
        B("text", { text: "=" }),
        B("class", { cls: "blank", q: q(0, null) }),
        B("group", { capture: "name", name: "value", children: [B("class", { cls: "any", q: q(0, null) })] }),
        B("anchor", { at: "lineEnd" })
      ]
    },
    {
      name: "Number, not a percent",
      test: "Scores 12, 40% and 7.",
      make: () => [B("anchor", { at: "wordEdge" }), B("class", { cls: "digit", q: q(1, null, "possessive") }), B("look", { dir: "ahead", negate: true, children: [B("text", { text: "%" })] })]
    }
  ];
})();
