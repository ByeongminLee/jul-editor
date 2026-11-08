import { describe, expect, it } from "vitest";
import type { Doc } from "../model/types.js";
import { toText } from "./to-text.js";

describe("toText", () => {
  it("renders one line per text block", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "first" }] },
        { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "second" }] },
      ],
    };
    expect(toText(doc)).toBe("first\nsecond");
  });

  it("indents nested list children", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "b1",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "parent" }],
          children: [{ id: "b1a", type: "bulletListItem", props: {}, content: [{ type: "text", text: "child" }] }],
        },
      ],
    };
    expect(toText(doc)).toBe("parent\n  child");
  });

  it("renders mentions as @label", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "hi " },
            { type: "mention", attrs: { kind: "user", id: "u1", label: "Alice" } },
          ],
        },
      ],
    };
    expect(toText(doc)).toBe("hi @Alice");
  });

  it("renders a table tab-separated, one line per row", () => {
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
              children: [
                { id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "a" }] },
                { id: "c2", type: "tableCell", props: {}, content: [{ type: "text", text: "b" }] },
              ],
            },
            {
              id: "r2",
              type: "tableRow",
              props: {},
              children: [
                { id: "c3", type: "tableCell", props: {}, content: [{ type: "text", text: "1" }] },
                { id: "c4", type: "tableCell", props: {}, content: [{ type: "text", text: "2" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(toText(doc)).toBe("a\tb\n1\t2");
  });

  it("renders void blocks as bracket placeholders", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "d", type: "divider", props: {} },
        { id: "i", type: "image", props: { src: "x", alt: "y" } },
      ],
    };
    expect(toText(doc)).toBe("---\n[image]");
  });
});
