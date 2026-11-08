import { describe, expect, it } from "vitest";
import { ensureUniqueIds, newId } from "./id.js";
import type { Doc } from "./types.js";

describe("newId", () => {
  it("returns a short base62 id", () => {
    const id = newId();
    expect(id.length).toBe(10);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("doesn't collide across many calls", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
  });
});

describe("ensureUniqueIds", () => {
  it("reissues duplicate ids", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", props: {}, content: [] },
        { id: "a", type: "paragraph", props: {}, content: [] },
      ],
    };
    const fixed = ensureUniqueIds(doc);
    expect(fixed.blocks[0]!.id).toBe("a");
    expect(fixed.blocks[1]!.id).not.toBe("a");
    expect(fixed.blocks[0]!.id).not.toBe(fixed.blocks[1]!.id);
  });

  it("reissues missing ids and recurses into children", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "",
          type: "bulletListItem",
          props: {},
          content: [],
          children: [
            { id: "x", type: "bulletListItem", props: {}, content: [] },
            { id: "x", type: "bulletListItem", props: {}, content: [] },
          ],
        },
      ],
    };
    const fixed = ensureUniqueIds(doc);
    expect(fixed.blocks[0]!.id).not.toBe("");
    const kids = fixed.blocks[0]!.children!;
    expect(kids[0]!.id).toBe("x");
    expect(kids[1]!.id).not.toBe("x");
  });

  it("leaves an already-unique doc's ids alone", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", props: {}, content: [] },
        { id: "b", type: "paragraph", props: {}, content: [] },
      ],
    };
    const fixed = ensureUniqueIds(doc);
    expect(fixed.blocks.map((b) => b.id)).toEqual(["a", "b"]);
  });
});
