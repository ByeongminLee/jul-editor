import { describe, expect, it } from "vitest";
import type { Doc } from "../model/types.js";
import { fromMarkdown } from "./from-markdown.js";
import { canonicalNoIds } from "./test-helpers.js";
import { toMarkdown } from "./to-markdown.js";
import { coreRegistry } from "../model/builtins.js";

function para(text: string): Doc {
  return { version: 1, blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text }] }] };
}

// line-start #, >, -, +, *, "1."; inline *_[]`; | in table
// cells; ] in mention labels. Each case must round-trip through toMarkdown
// -> fromMarkdown back to the exact original text (proving the escape
// prevented a different block/inline type from being sniffed on re-parse).
describe("serde escaping", () => {
  const LINE_START_CASES = [
    "# looks like a heading",
    "###### looks like an h6",
    "> looks like a quote",
    "- looks like a bullet",
    "+ looks like a plus bullet",
    "* looks like a star bullet",
    "1. looks like an ordered item",
    "42) looks like a paren ordered item",
    "--- looks like a divider prefix",
    "---",
    "***",
    "___",
  ];
  for (const text of LINE_START_CASES) {
    it(`preserves paragraph text starting with ${JSON.stringify(text)}`, () => {
      const doc = para(text);
      const { markdown, lossy } = toMarkdown(doc);
      expect(lossy).toEqual([]);
      const { doc: doc2 } = fromMarkdown(markdown);
      expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
    });
  }

  const INLINE_CASES = [
    "a * b [c] d_e_f `g` h",
    "5 > 3 and 2 < 4",
    "a\\b\\c",
    "[not a link](nope)",
    "*not emphasis*",
  ];
  for (const text of INLINE_CASES) {
    it(`preserves inline text ${JSON.stringify(text)}`, () => {
      const doc = para(text);
      const { doc: doc2 } = fromMarkdown(toMarkdown(doc).markdown);
      expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
    });
  }

  it("escapes | inside a table cell", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "t",
          type: "table",
          props: { headerRow: true },
          children: [
            {
              id: "r1",
              type: "tableRow",
              props: {},
              children: [{ id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "a | b" }] }],
            },
            {
              id: "r2",
              type: "tableRow",
              props: {},
              children: [{ id: "c2", type: "tableCell", props: {}, content: [{ type: "text", text: "c" }] }],
            },
          ],
        },
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([]);
    const { doc: doc2 } = fromMarkdown(markdown);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });

  it("escapes ] inside a mention label", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [{ type: "mention", attrs: { kind: "user", id: "u1", label: "weird]label" } }],
        },
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([]);
    const { doc: doc2 } = fromMarkdown(markdown);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });

  it("uses a fence longer than any backtick run inside a code block", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "c",
          type: "codeBlock",
          props: { language: "md" },
          content: [{ type: "text", text: "```jul-editor-chart\n{}\n```" }],
        },
      ],
    };
    const { markdown } = toMarkdown(doc);
    expect(markdown.startsWith("````")).toBe(true);
    const { doc: doc2 } = fromMarkdown(markdown);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });
});
