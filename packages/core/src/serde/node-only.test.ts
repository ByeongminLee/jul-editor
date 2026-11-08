import { describe, expect, it } from "vitest";
import type { Doc } from "../model/types.js";
import { fromMarkdown } from "./from-markdown.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";
import { toText } from "./to-text.js";

// serde must run in plain node / Cloudflare Workers, i.e.
// with no `document`/`window` global at all -- this test's whole vitest
// project runs with environment "node" (see packages/core/vitest.config.ts),
// so this is a real guard, not a mock.
describe("serde runs DOM-free", () => {
  it("has no `document` global while serde runs", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");

    const doc: Doc = {
      version: 1,
      blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }],
    };
    const { markdown } = toMarkdown(doc);
    const { doc: doc2 } = fromMarkdown(markdown);
    expect(toHTML(doc2)).toContain("hello");
    expect(toText(doc2)).toBe("hello");
  });
});
