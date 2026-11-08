import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./from-markdown.js";
import { toMarkdown } from "./to-markdown.js";

// Idempotence: "md -> doc -> md" isn't required to reproduce the
// original messy markdown byte-for-byte (setext headings, `*` bullets, etc.
// don't survive as themselves -- that's expected and fine). What must hold
// is that applying the pipeline a SECOND time is a no-op: once a doc has
// been rendered through our own toMarkdown, re-parsing and re-rendering it
// again reproduces the exact same markdown.
const MESSY_INPUTS = [
  "Setext Title\n============\n\nSetext Subtitle\n---------------\n",
  "* one\n* two\n* three\n",
  "*emphasis via star* and _emphasis via underscore_\n",
  "See [ref link][1] for more.\n\n[1]: https://example.com \"a title\"\n",
  "- a\n  - b\n    - c\n  - d\n- e\n",
  "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n",
  "1) parens-style ordered marker\n2) second item\n",
  "Term with __double underscore bold__ and **double star bold**.\n",
];

describe("serde markdown idempotence", () => {
  for (const input of MESSY_INPUTS) {
    it(`stabilizes after one pass: ${JSON.stringify(input.slice(0, 30))}...`, () => {
      const m1 = toMarkdown(fromMarkdown(input).doc).markdown;
      const m2 = toMarkdown(fromMarkdown(m1).doc).markdown;
      expect(m2).toBe(m1);
    });
  }
});
