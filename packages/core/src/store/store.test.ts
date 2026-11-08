import { describe, expect, it } from "vitest";
import { bullet, para, r, storeFrom } from "./test-helpers.js";
import { commitPatch, contentLength, extractFragment, splitContentAt, toDoc } from "./store.js";
import type { BlockRecord, Selection } from "./types.js";

describe("path-copy identity", () => {
  it("editing a grandchild produces new ancestor objects but leaves untouched siblings' objects alone", () => {
    const store = storeFrom([
      para("p1", "top"),
      bullet("a", "A", [bullet("a1", "child of A")]),
      bullet("b", "B untouched"),
    ]);

    const grandchild = store.records.get("a1")!;
    const updated = new Map<string, BlockRecord | null>([["a1", { ...grandchild, content: [{ type: "text", text: "edited" }] }]]);
    const { store: next, changedIds } = commitPatch(store, updated);

    // The edited record and its ancestor chain up to the root all bump identity.
    expect(next.records.get("a1")).not.toBe(store.records.get("a1"));
    expect(next.records.get("a")).not.toBe(store.records.get("a"));
    expect(changedIds.has("a1")).toBe(true);
    expect(changedIds.has("a")).toBe(true);

    // An unrelated sibling subtree keeps the exact same object identity.
    expect(next.records.get("b")).toBe(store.records.get("b"));
    expect(changedIds.has("b")).toBe(false);
    expect(changedIds.has("p1")).toBe(false);
  });

  it("toDoc reuses the same Block object for unchanged subtrees, and produces a fresh one for changed ones", () => {
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")]), bullet("b", "B")]);
    const cache = new WeakMap();
    const docBefore = toDoc(store, 1, cache);
    const bBefore = docBefore.blocks.find((b) => b.id === "b")!;
    const aBefore = docBefore.blocks.find((b) => b.id === "a")!;

    const a1 = store.records.get("a1")!;
    const { store: next } = commitPatch(store, new Map<string, BlockRecord | null>([["a1", { ...a1, content: [{ type: "text", text: "edited" }] }]]));
    const docAfter = toDoc(next, 1, cache);
    const bAfter = docAfter.blocks.find((b) => b.id === "b")!;
    const aAfter = docAfter.blocks.find((b) => b.id === "a")!;

    expect(bAfter).toBe(bBefore); // untouched subtree: identical Block object
    expect(aAfter).not.toBe(aBefore); // ancestor of the edit: fresh Block object
    expect(aAfter.children![0]!.content).toEqual([{ type: "text", text: "edited" }]);
  });
});

describe("content offset helpers", () => {
  it("splitContentAt splits a text run mid-string", () => {
    const [before, after] = splitContentAt([{ type: "text", text: "hello world" }], 5);
    expect(before).toEqual([{ type: "text", text: "hello" }]);
    expect(after).toEqual([{ type: "text", text: " world" }]);
  });

  it("treats a mention as exactly 1 unit and never splits it", () => {
    const content = [{ type: "text", text: "a" }, { type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } }, { type: "text", text: "b" }] as const;
    expect(contentLength([...content])).toBe(3);
    const [before, after] = splitContentAt([...content], 1);
    expect(before).toEqual([{ type: "text", text: "a" }]);
    expect(after).toEqual([{ type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } }, { type: "text", text: "b" }]);
  });
});

describe("extractFragment (copy/cut)", () => {
  it("same-block partial text selection: one block, sliced content, no children", () => {
    const store = storeFrom([para("p1", "hello world", [para("c1", "child")])]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } };
    const frag = extractFragment(store, sel, r);
    expect(frag.blocks).toEqual([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }]);
  });

  it("a collapsed selection extracts nothing", () => {
    const store = storeFrom([para("p1", "hello")]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } };
    expect(extractFragment(store, sel, r).blocks).toEqual([]);
  });

  it("cross-block sibling selection: head trimmed to its tail, tail trimmed to its head, middles kept whole", () => {
    const store = storeFrom([para("a", "AAAA"), para("b", "BBBB"), para("c", "CCCC")]);
    const sel: Selection = { type: "text", anchor: { blockId: "a", offset: 2 }, focus: { blockId: "c", offset: 2 } };
    const frag = extractFragment(store, sel, r);
    expect(frag.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(frag.blocks[0]!.content).toEqual([{ type: "text", text: "AA" }]);
    expect(frag.blocks[1]!.content).toEqual([{ type: "text", text: "BBBB" }]);
    expect(frag.blocks[2]!.content).toEqual([{ type: "text", text: "CC" }]);
  });

  it("preserves marks and mentions across the selected range", () => {
    const store = storeFrom([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi " }, { type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } }, { type: "text", text: " bye", marks: [{ type: "bold" }] }] },
    ]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 8 } };
    const frag = extractFragment(store, sel, r);
    expect(frag.blocks[0]!.content).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } },
      { type: "text", text: " bye", marks: [{ type: "bold" }] },
    ]);
  });

  it("nested case: start is an ancestor of end (a parent list item down into its own nested child)", () => {
    const store = storeFrom([bullet("p1", "parent text", [bullet("c1", "child text"), bullet("c2", "sibling")])]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 7 }, focus: { blockId: "c1", offset: 5 } };
    const frag = extractFragment(store, sel, r);
    expect(frag.blocks.length).toBe(1);
    const top = frag.blocks[0]!;
    expect(top.id).toBe("p1");
    expect(top.content).toEqual([{ type: "text", text: "text" }]); // "parent text"[7:]
    expect(top.children!.length).toBe(1); // c2 was never reached (comes after the branch into c1)
    expect(top.children![0]!.id).toBe("c1");
    expect(top.children![0]!.content).toEqual([{ type: "text", text: "child" }]); // "child text"[0:5]
    expect(top.children![0]!.children ?? []).toEqual([]);
  });

  it("block selection returns the blocks verbatim (full subtrees)", () => {
    const store = storeFrom([para("a", "A"), bullet("b", "B", [bullet("b1", "nested")]), para("c", "C")]);
    const frag = extractFragment(store, { type: "block", ids: ["b"] }, r);
    expect(frag.blocks).toEqual([{ id: "b", type: "bulletListItem", props: {}, content: [{ type: "text", text: "B" }], children: [{ id: "b1", type: "bulletListItem", props: {}, content: [{ type: "text", text: "nested" }] }] }]);
  });

  it("cells selection wraps the rectangular range back in a table/row shell", () => {
    const store = storeFrom([
      {
        id: "t1",
        type: "table",
        props: { headerRow: true },
        children: [
          { id: "r1", type: "tableRow", props: {}, children: [{ id: "c11", type: "tableCell", props: {}, content: [{ type: "text", text: "H1" }] }, { id: "c12", type: "tableCell", props: {}, content: [{ type: "text", text: "H2" }] }] },
          { id: "r2", type: "tableRow", props: {}, children: [{ id: "c21", type: "tableCell", props: {}, content: [{ type: "text", text: "A" }] }, { id: "c22", type: "tableCell", props: {}, content: [{ type: "text", text: "B" }] }] },
        ],
      },
    ]);
    const frag = extractFragment(store, { type: "cells", tableId: "t1", anchor: [1, 0], focus: [1, 1] }, r);
    expect(frag.blocks).toEqual([
      {
        id: "t1",
        type: "table",
        props: {}, // headerRow:true is the schema default, omitted (default-prop-omission rule)
        children: [{ id: "r2", type: "tableRow", props: {}, children: [{ id: "c21", type: "tableCell", props: {}, content: [{ type: "text", text: "A" }] }, { id: "c22", type: "tableCell", props: {}, content: [{ type: "text", text: "B" }] }] }],
      },
    ]);
  });
});
