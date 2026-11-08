// toMarkdown must emit TIGHT lists --
// consecutive list items of the same type join with a single "\n", not a
// blank line -- and fromMarkdown must round-trip both a tight and an
// equivalent loose input to the same doc (our model has no "loose" flag of
// its own, so this direction was already fine; the bug was purely in the
// WRITE side always inserting a blank line).
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Block, Doc } from "../model/types.js";
import { fromMarkdown } from "./from-markdown.js";
import { canonicalNoIds } from "./test-helpers.js";
import { toMarkdown } from "./to-markdown.js";

function item(id: string, type: Block["type"], text: string, children?: Block[]): Block {
  return { id, type, props: {}, content: [{ type: "text", text }], ...(children ? { children } : {}) };
}

describe("tight list output", () => {
  it("consecutive bulletListItem siblings join with a single newline (no blank line)", () => {
    const doc: Doc = { version: 1, blocks: [item("a", "bulletListItem", "a"), item("b", "bulletListItem", "b"), item("c", "bulletListItem", "c")] };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([]);
    expect(markdown).toBe("- a\n- b\n- c");
  });

  it("consecutive orderedListItem and todoListItem siblings are likewise tight", () => {
    const ordered: Doc = { version: 1, blocks: [item("a", "orderedListItem", "one"), item("b", "orderedListItem", "two")] };
    expect(toMarkdown(ordered).markdown).toBe("1. one\n2. two");

    const todo: Doc = {
      version: 1,
      blocks: [
        { id: "a", type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "done" }] },
        { id: "b", type: "todoListItem", props: {}, content: [{ type: "text", text: "not done" }] },
      ],
    };
    expect(toMarkdown(todo).markdown).toBe("- [x] done\n- [ ] not done");
  });

  it("a blank line still separates a list from a following paragraph, and a bullet list from an ordered list (type change)", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        item("a", "bulletListItem", "a"),
        item("b", "bulletListItem", "b"),
        item("o", "orderedListItem", "one"),
        { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "after" }] },
      ],
    };
    expect(toMarkdown(doc).markdown).toBe("- a\n- b\n\n1. one\n\nafter");
  });

  it("a nested sublist (children are list items) joins tight -- no blank line before it", () => {
    const doc: Doc = {
      version: 1,
      blocks: [item("a", "bulletListItem", "a", [item("a1", "bulletListItem", "a1"), item("a2", "bulletListItem", "a2")]), item("b", "bulletListItem", "b")],
    };
    expect(toMarkdown(doc).markdown).toBe("- a\n  - a1\n  - a2\n- b");
  });

  it("a nested NON-list block (e.g. a paragraph) still gets the blank-line-separated loose form", () => {
    const doc: Doc = {
      version: 1,
      blocks: [item("a", "bulletListItem", "a", [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "nested para" }] }])],
    };
    expect(toMarkdown(doc).markdown).toBe("- a\n\n  nested para");
  });

  it("fromMarkdown parses a tight list and an equivalent loose list to the SAME doc structure", () => {
    const tight = "- a\n- b\n- c";
    const loose = "- a\n\n- b\n\n- c";
    const { doc: tightDoc, lossy: tightLossy } = fromMarkdown(tight);
    const { doc: looseDoc, lossy: looseLossy } = fromMarkdown(loose);
    expect(tightLossy).toEqual([]);
    expect(looseLossy).toEqual([]);
    expect(canonicalNoIds(tightDoc, coreRegistry)).toBe(canonicalNoIds(looseDoc, coreRegistry));
  });

  it("round-trip: fromMarkdown(toMarkdown(doc)) equals doc for a doc with sibling + nested list items", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        item("a", "bulletListItem", "a", [item("a1", "bulletListItem", "a1")]),
        item("b", "bulletListItem", "b"),
        item("o1", "orderedListItem", "one"),
        item("o2", "orderedListItem", "two"),
      ],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(lossy).toEqual([]);
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });

  it("idempotence: toMarkdown(fromMarkdown(md)) applied twice produces the same markdown", () => {
    const md = "- a\n  - a1\n  - a2\n- b\n\n1. one\n2. two";
    const { doc } = fromMarkdown(md);
    const once = toMarkdown(doc).markdown;
    const { doc: doc2 } = fromMarkdown(once);
    const twice = toMarkdown(doc2).markdown;
    expect(twice).toBe(once);
  });
});
