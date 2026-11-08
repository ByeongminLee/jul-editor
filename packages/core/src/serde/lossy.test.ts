import { describe, expect, it } from "vitest";
import type { Doc } from "../model/types.js";
import { fromMarkdown } from "./from-markdown.js";
import { toMarkdown } from "./to-markdown.js";

// Each of the named lossy reasons, exercised directly (the round-trip
// tests deliberately avoid these so that invariant stays a
// simple full-tree comparison -- see fixtures.hand.ts).
describe("serde lossy reporting", () => {
  it("image-meta: width/assetId round-trip through markdown but are reported lossy", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "img", type: "image", props: { src: "https://x/y.png", alt: "a", width: 100 } }],
    };
    const { lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "img", type: "image", reason: "image-meta" }]);
  });

  it("no-header-row: table.props.headerRow false is reported, first row still used as header", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "t",
          type: "table",
          props: { headerRow: false },
          children: [
            { id: "r1", type: "tableRow", props: {}, children: [{ id: "c1", type: "tableCell", props: {}, content: [] }] },
          ],
        },
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "t", type: "table", reason: "no-header-row" }]);
    expect(markdown).toContain("---");
  });

  it("nesting-flattened: children on a block with no markdown nesting form become following siblings", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "parent" }],
          children: [{ id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "child" }] }],
        },
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "p2", type: "paragraph", reason: "nesting-flattened" }]);
    expect(markdown).toBe("parent\n\nchild");
  });

  it("unknown-type: a block type not in the registry is dropped and reported", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "x", type: "futureBlock", props: {} }] };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "x", type: "futureBlock", reason: "unknown-type" }]);
    expect(markdown).toBe("");
  });

  it("jul-editor-extension: chart is only reported lossy when opts.strict is set", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "ch", type: "chart", props: {} }] };
    expect(toMarkdown(doc).lossy).toEqual([]);
    expect(toMarkdown(doc, { strict: true }).lossy).toEqual([{ blockId: "ch", type: "chart", reason: "jul-editor-extension" }]);
  });

  it("raw-html: a raw HTML block degrades to text and is reported", () => {
    const { doc, lossy } = fromMarkdown("<div>hello</div>\n");
    expect(lossy).toEqual([{ blockId: expect.any(String), type: "html", reason: "raw-html" }]);
    expect(doc.blocks[0]!.type).toBe("paragraph");
    expect((doc.blocks[0]!.content?.[0] as { text: string }).text).toContain("<div>hello</div>");
  });

  it("reference-definition: a link reference definition is dropped and reported", () => {
    const { doc, lossy } = fromMarkdown("See [ref][1].\n\n[1]: https://example.com\n");
    expect(lossy.some((l) => l.reason === "reference-definition")).toBe(true);
    expect(doc.blocks).toHaveLength(1);
  });

  it("invalid-json: a malformed jul-editor-chart fence falls back to a plain code block", () => {
    const { doc, lossy } = fromMarkdown("```jul-editor-chart\nnot json\n```\n");
    expect(lossy).toEqual([{ blockId: expect.any(String), type: "jul-editor-chart", reason: "invalid-json" }]);
    expect(doc.blocks[0]!.type).toBe("codeBlock");
  });

  it("cell-newline: a literal newline inside a table cell is joined with a space and reported", () => {
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
              children: [{ id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "line1\nline2" }] }],
            },
          ],
        },
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "c1", type: "tableCell", reason: "cell-newline" }]);
    expect(markdown).not.toContain("\nline2");
    expect(markdown).toContain("line1 line2");
  });
});
