import { describe, expect, it } from "vitest";
import { bullet, para, r, storeFrom } from "./test-helpers.js";
import { buildDeleteRangeOps, buildIndentOps, buildMergeBackwardOps, buildOutdentOps, buildSplitBlockOps, buildToggleMarkOps } from "./edits.js";
import { applyOp } from "./ops.js";
import { createTransaction } from "./transaction.js";
import type { Op, Selection } from "./types.js";
import type { Block } from "../model/types.js";

function commitAll(store: ReturnType<typeof storeFrom>, ops: Op[]) {
  let s = store;
  for (const op of ops) s = applyOp(s, op, r).store;
  return s;
}

describe("splitBlock", () => {
  it("offset 0: inserts a new empty block BEFORE, original keeps its id and children", () => {
    const store = storeFrom([bullet("p1", "hello", [para("c1", "child")])]);
    const ops = buildSplitBlockOps(store, { blockId: "p1", offset: 0 });
    const next = commitAll(store, ops);
    expect(next.rootIds.length).toBe(2);
    const newId = next.rootIds[0]!;
    expect(newId).not.toBe("p1");
    expect(next.records.get(newId)!.content).toEqual([]);
    expect(next.rootIds[1]).toBe("p1");
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
    expect(next.records.get("p1")!.childIds).toEqual(["c1"]); // original keeps its children
  });

  it("offset at the end: front keeps the id (all text, no children), back gets a new id with no content", () => {
    const store = storeFrom([para("p1", "hello")]);
    const ops = buildSplitBlockOps(store, { blockId: "p1", offset: 5 });
    const next = commitAll(store, ops);
    expect(next.rootIds).toEqual(["p1", expect.any(String)]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
    const backId = next.rootIds[1]!;
    expect(next.records.get(backId)!.content).toEqual([]);
  });

  it("offset in the middle: front keeps the id, back gets a new id and takes the children", () => {
    const store = storeFrom([bullet("p1", "hello world", [para("c1", "child")])]);
    const ops = buildSplitBlockOps(store, { blockId: "p1", offset: 5 });
    const next = commitAll(store, ops);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
    expect(next.records.get("p1")!.childIds).toEqual([]);
    const backId = next.rootIds[1]!;
    expect(next.records.get(backId)!.content).toEqual([{ type: "text", text: " world" }]);
    expect(next.records.get(backId)!.childIds).toEqual(["c1"]);
    expect(next.records.get("c1")!.parentId).toBe(backId);
  });
});

describe("mergeBackward (front id survives)", () => {
  it("merges a block into the previous sibling, front id survives", () => {
    const store = storeFrom([para("p1", "hello"), para("p2", " world")]);
    const ops = buildMergeBackwardOps(store, "p2", r);
    const next = commitAll(store, ops);
    expect(next.rootIds).toEqual(["p1"]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("appends the merged (focus) block's children to the survivor", () => {
    const store = storeFrom([bullet("p1", "hello"), bullet("p2", " world", [para("c1", "child")])]);
    const next = commitAll(store, buildMergeBackwardOps(store, "p2", r));
    expect(next.rootIds).toEqual(["p1"]);
    expect(next.records.get("p1")!.childIds).toEqual(["c1"]);
    expect(next.records.get("c1")!.parentId).toBe("p1");
  });

  it("is a no-op at the very first block in the document", () => {
    const store = storeFrom([para("p1", "hello")]);
    expect(buildMergeBackwardOps(store, "p1", r)).toEqual([]);
  });

  it("merges a block into its OWN PARENT when it's the parent's first child (Backspace at start of a nested item)", () => {
    // prevBlockInPreOrder(child) returns the parent itself here (no preceding
    // sibling) -- a zero-width buildDeleteRangeOps range (parent-content-end
    // .. child-start) would trim nothing and leave `child` untouched; this
    // must instead append child's content to the parent and remove `child`.
    const store = storeFrom([bullet("li1", "parent item", [bullet("li1a", "child item")])]);
    const next = commitAll(store, buildMergeBackwardOps(store, "li1a", r));
    expect(next.rootIds).toEqual(["li1"]);
    expect(next.records.get("li1")!.content).toEqual([{ type: "text", text: "parent itemchild item" }]);
    expect(next.records.get("li1")!.childIds).toEqual([]);
    expect(next.records.has("li1a")).toBe(false);
  });

  it("moves the merged child's OWN children up to the parent, at the position the child occupied", () => {
    const store = storeFrom([bullet("li1", "parent", [bullet("li1a", "child", [para("g1", "grandchild")])])]);
    const next = commitAll(store, buildMergeBackwardOps(store, "li1a", r));
    expect(next.records.get("li1")!.content).toEqual([{ type: "text", text: "parentchild" }]);
    expect(next.records.get("li1")!.childIds).toEqual(["g1"]);
    expect(next.records.get("g1")!.parentId).toBe("li1");
    expect(next.records.has("li1a")).toBe(false);
  });

  it("never nests a merged block's children inside a codeBlock merge target (children:'none') -- lifts them to a following sibling instead", () => {
    const store = storeFrom([
      { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "code" }] },
      bullet("b1", "x", [bullet("b2", "child")]),
    ]);
    const next = commitAll(store, buildMergeBackwardOps(store, "b1", r));
    expect(next.records.get("c1")!.content).toEqual([{ type: "text", text: "codex" }]);
    expect(next.records.get("c1")!.childIds).toEqual([]); // codeBlock's children stay empty
    expect(next.rootIds).toEqual(["c1", "b2"]); // b2 lifted to a following root sibling
    expect(next.records.get("b2")!.parentId).toBeNull();
    expect(next.records.has("b1")).toBe(false);
  });
});

describe("deleteRange: same-block", () => {
  it("deletes within a single block", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 11 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
  });
});

describe("deleteRange: cross-block", () => {
  it("merges two sibling blocks: anchor head + focus tail, own children of anchor dropped, focus's children appended", () => {
    const store = storeFrom([
      bullet("p1", "hello", [para("dropped", "gone")]),
      para("mid", "middle"),
      bullet("p2", "world", [para("kept", "stays")]),
    ]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p2", offset: 3 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.rootIds).toEqual(["p1"]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "held" }]);
    expect(next.records.get("p1")!.childIds).toEqual(["kept"]);
    expect(next.records.has("dropped")).toBe(false);
    expect(next.records.has("mid")).toBe(false);
    expect(next.records.has("p2")).toBe(false);
    expect(next.records.get("kept")!.parentId).toBe("p1");
  });

  it("handles a nested case: anchor is an ancestor of focus (focus nested two levels down)", () => {
    // a (bulletListItem "AA") is an ancestor of the selection's focus point b,
    // reached via c (also nested under a). dropped1 is a's earlier child, fully
    // before the branch leading to b, so it's intermediate and removed. c's own
    // content is fully before b too (it precedes its own children in pre-order),
    // so it's cleared -- but c itself survives as a (now empty) container, since
    // it still holds meaningful structure (b and its sibling d).
    const store = storeFrom([
      bullet("a", "AA", [bullet("dropped1", "d1"), bullet("c", "CC", [bullet("b", "BB"), bullet("d", "kept-sibling-of-b")])]),
    ]);
    const sel: Selection = { type: "text", anchor: { blockId: "a", offset: 1 }, focus: { blockId: "b", offset: 1 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.records.has("dropped1")).toBe(false);
    expect(next.records.get("a")!.content).toEqual([{ type: "text", text: "A" }]);
    expect(next.records.get("a")!.childIds).toEqual(["c"]);
    expect(next.records.get("c")!.content).toEqual([]);
    expect(next.records.get("c")!.childIds).toEqual(["b", "d"]);
    expect(next.records.get("b")!.content).toEqual([{ type: "text", text: "B" }]);
    expect(next.records.get("d")!.parentId).toBe("c");
  });

  it("selection order doesn't matter (focus before anchor works the same)", () => {
    const store = storeFrom([para("p1", "hello"), para("p2", "world")]);
    const sel: Selection = { type: "text", anchor: { blockId: "p2", offset: 3 }, focus: { blockId: "p1", offset: 2 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.rootIds).toEqual(["p1"]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "held" }]);
  });
});

describe("deleteRange: isolating boundary (table cells)", () => {
  function tableStore() {
    return storeFrom([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          {
            id: "r1",
            type: "tableRow",
            props: {},
            children: [
              { id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "one" }] },
              { id: "c2", type: "tableCell", props: {}, content: [{ type: "text", text: "two" }] },
            ],
          },
        ],
      },
      para("after", "after the table"),
    ]);
  }

  it("a text selection spanning two different cells clears each cell's own content but never merges the cells", () => {
    const store = tableStore();
    const sel: Selection = { type: "text", anchor: { blockId: "c1", offset: 1 }, focus: { blockId: "c2", offset: 2 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.records.has("c1")).toBe(true);
    expect(next.records.has("c2")).toBe(true);
    expect(next.records.get("c1")!.content).toEqual([{ type: "text", text: "o" }]);
    expect(next.records.get("c2")!.content).toEqual([{ type: "text", text: "o" }]);
    // still two distinct cells under the same row -- no merge happened
    expect(next.records.get("r1")!.childIds).toEqual(["c1", "c2"]);
  });

  it("a selection from inside a cell to a block after the table does not merge across the table", () => {
    const store = tableStore();
    const sel: Selection = { type: "text", anchor: { blockId: "c1", offset: 1 }, focus: { blockId: "after", offset: 3 } };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.records.get("c1")!.content).toEqual([{ type: "text", text: "o" }]);
    expect(next.records.get("after")!.content).toEqual([{ type: "text", text: "er the table" }]);
    expect(next.records.has("t1")).toBe(true); // table untouched, not merged away
  });

  it("cells-type selection clears the rectangular range of cells", () => {
    const store = tableStore();
    const sel: Selection = { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 1] };
    const next = commitAll(store, buildDeleteRangeOps(store, sel, r));
    expect(next.records.get("c1")!.content).toEqual([]);
    expect(next.records.get("c2")!.content).toEqual([]);
  });
});

describe("indent / outdent (Notion behavior)", () => {
  it("indent: becomes the last child of the previous sibling", () => {
    const store = storeFrom([bullet("a", "A"), bullet("b", "B")]);
    const next = commitAll(store, buildIndentOps(store, "b", r));
    expect(next.rootIds).toEqual(["a"]);
    expect(next.records.get("a")!.childIds).toEqual(["b"]);
  });

  it("indent is a no-op for the first sibling (nothing to indent into)", () => {
    const store = storeFrom([bullet("a", "A"), bullet("b", "B")]);
    expect(buildIndentOps(store, "a", r)).toEqual([]);
  });

  it("outdent: becomes the next sibling of the parent, following siblings become its children", () => {
    const store = storeFrom([bullet("parent", "P", [bullet("a", "A"), bullet("b", "B"), bullet("c", "C")])]);
    const next = commitAll(store, buildOutdentOps(store, "b", r));
    expect(next.rootIds).toEqual(["parent", "b"]);
    expect(next.records.get("parent")!.childIds).toEqual(["a"]);
    expect(next.records.get("b")!.childIds).toEqual(["c"]); // following sibling adopted
    expect(next.records.get("c")!.parentId).toBe("b");
  });

  it("outdent is a no-op for an already top-level block", () => {
    const store = storeFrom([bullet("a", "A")]);
    expect(buildOutdentOps(store, "a", r)).toEqual([]);
  });

  it("never nests an outdented block's following siblings inside it when it can't admit them (codeBlock) -- lifts them to ITS following sibling instead", () => {
    const store = storeFrom([
      bullet("parent", "P", [{ id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "x" }] }, para("p2", "after")]),
    ]);
    const next = commitAll(store, buildOutdentOps(store, "c1", r));
    expect(next.rootIds).toEqual(["parent", "c1", "p2"]);
    expect(next.records.get("c1")!.childIds).toEqual([]); // codeBlock's children stay empty
    expect(next.records.get("p2")!.parentId).toBeNull(); // lifted to root, not nested
  });

  it("table cells refuse to indent or outdent (indentable: false)", () => {
    const store = storeFrom([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          {
            id: "r1",
            type: "tableRow",
            props: {},
            children: [
              { id: "c1", type: "tableCell", props: {}, content: [] },
              { id: "c2", type: "tableCell", props: {}, content: [] },
            ],
          },
        ],
      },
    ]);
    expect(buildIndentOps(store, "c2", r)).toEqual([]);
    expect(buildOutdentOps(store, "c2", r)).toEqual([]);
  });
});

describe("toggleMark", () => {
  it("adds a mark over a partial run, splitting it", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } };
    const next = commitAll(store, buildToggleMarkOps(store, sel, "bold", undefined));
    expect(next.records.get("p1")!.content).toEqual([
      { type: "text", text: "hello", marks: [{ type: "bold" }] },
      { type: "text", text: " world" },
    ]);
  });

  it("removes the mark when the whole selection is already marked (toggle off)", () => {
    const store = storeFrom([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }] }]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } };
    const next = commitAll(store, buildToggleMarkOps(store, sel, "bold", undefined));
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("passes a mention through unaffected", () => {
    const store = storeFrom([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi " }, { type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } }, { type: "text", text: " bye" }] },
    ]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 8 } };
    const next = commitAll(store, buildToggleMarkOps(store, sel, "bold", undefined));
    const content = next.records.get("p1")!.content!;
    expect(content.some((inl) => inl.type === "mention")).toBe(true);
    expect(content).toEqual([
      { type: "text", text: "hi ", marks: [{ type: "bold" }] },
      { type: "mention", attrs: { kind: "user", id: "1", label: "Bo" } },
      { type: "text", text: " bye", marks: [{ type: "bold" }] },
    ]);
  });

  it("toggleMark works via a transaction too (chained API)", () => {
    const store = storeFrom([para("p1", "hello")]);
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } };
    const result = createTransaction({ store, selection: null }, r).toggleMark(sel, "italic", undefined).commit();
    expect(result.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hello", marks: [{ type: "italic" }] }]);
  });
});

describe("pasteFragment (clipboard/drop insertion)", () => {
  it("single-block fragment merges inline (marks preserved) at the caret, no new block", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment = [{ id: "frag1", type: "paragraph", props: {}, content: [{ type: "text" as const, text: "X", marks: [{ type: "bold" }] }] }];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit();
    expect(result.state.store.rootIds).toEqual(["p1"]);
    expect(result.state.store.records.get("p1")!.content).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "X", marks: [{ type: "bold" }] },
      { type: "text", text: " world" },
    ]);
    expect(result.state.selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 6 }, focus: { blockId: "p1", offset: 6 } });
  });

  it("non-collapsed selection is replaced before the fragment is inserted", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment = [{ id: "frag1", type: "paragraph", props: {}, content: [{ type: "text" as const, text: "X" }] }];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 11 } }, fragment)
      .commit();
    expect(result.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "helloX" }]);
  });

  it("multi-block fragment splits the current block: first block merges into the head, last into a new tail", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment = [
      { id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "-A" }] },
      { id: "f2", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "MID" }] },
      { id: "f3", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "Z-" }] },
    ];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit();
    const next = result.state.store;
    expect(next.rootIds).toEqual(["p1", "f2", "f3"]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello-A" }]);
    expect(next.records.get("f2")!.content).toEqual([{ type: "text", text: "MID" }]);
    expect(next.records.get("f3")!.content).toEqual([{ type: "text", text: "Z- world" }]); // merged (normalizeInline)
    expect(result.state.selection).toEqual({ type: "text", anchor: { blockId: "f3", offset: 2 }, focus: { blockId: "f3", offset: 2 } });
  });

  it("multi-block fragment preserves the original block's nested children on the new tail block", () => {
    const store = storeFrom([para("p1", "hello world", [para("c1", "child")])]);
    const fragment = [
      { id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "-A" }] },
      { id: "f2", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "Z-" }] },
    ];
    const next = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit().state.store;
    expect(next.records.get("p1")!.childIds).toEqual([]);
    expect(next.records.get("f2")!.childIds).toEqual(["c1"]);
  });

  it("a single void (content:'none') fragment block splits the current block around it, like Enter", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment = [{ id: "img1", type: "image", props: { src: "x.png", alt: "" } }];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit();
    const next = result.state.store;
    expect(next.rootIds.length).toBe(3);
    expect(next.rootIds[0]).toBe("p1");
    expect(next.rootIds[1]).toBe("img1");
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
    const backId = next.rootIds[2]!;
    expect(next.records.get(backId)!.content).toEqual([{ type: "text", text: " world" }]);
    expect(result.state.selection).toEqual({ type: "text", anchor: { blockId: backId, offset: 0 }, focus: { blockId: backId, offset: 0 } });
  });

  it("paste into a codeBlock inserts plain text only, dropping marks/mentions/nesting", () => {
    const store = storeFrom([{ id: "cb1", type: "codeBlock", props: { language: "" }, content: [{ type: "text", text: "" }] }]);
    const fragment = [
      { id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "bold", marks: [{ type: "bold" }] }] },
      { id: "f2", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "line2" }] },
    ];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "cb1", offset: 0 }, focus: { blockId: "cb1", offset: 0 } }, fragment)
      .commit();
    expect(result.state.store.records.get("cb1")!.content).toEqual([{ type: "text", text: "bold\nline2" }]);
    expect(result.state.store.rootIds).toEqual(["cb1"]); // no new blocks
  });

  it("paste into a tableCell flattens the fragment to one inline run (marks kept)", () => {
    const store = storeFrom([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [{ id: "r1", type: "tableRow", props: {}, children: [{ id: "c1", type: "tableCell", props: {}, content: [] }] }],
      },
    ]);
    const fragment = [
      { id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "bold", marks: [{ type: "bold" }] }] },
      { id: "f2", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "plain" }] },
    ];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "c1", offset: 0 }, focus: { blockId: "c1", offset: 0 } }, fragment)
      .commit();
    expect(result.state.store.records.get("c1")!.content).toEqual([
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " plain" },
    ]);
  });

  it("a void (image) block at the edge of a multi-block fragment is inserted as a sibling, not dropped", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment: Block[] = [
      { id: "img1", type: "image", props: { src: "x.png", alt: "" } },
      { id: "f2", type: "paragraph", props: {}, content: [{ type: "text", text: "caption" }] },
    ];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit();
    const next = result.state.store;
    // head unchanged (image can't merge inline) -- inserted as a sibling
    // ("middle"); the trailing caption block legitimately has content, so it
    // still merges with the original tail (it IS the fragment's own "last"
    // block, per the merge rule -- only a content-less block is exempted).
    expect(next.rootIds).toEqual(["p1", "img1", "f2"]);
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
    expect(next.records.get("f2")!.content).toEqual([{ type: "text", text: "caption world" }]);
  });

  it("a void (image) block as the fragment's OWN last block gets a fresh plain-split tail instead of vanishing", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fragment: Block[] = [
      { id: "f1", type: "paragraph", props: {}, content: [{ type: "text", text: "caption" }] },
      { id: "img1", type: "image", props: { src: "x.png", alt: "" } },
    ];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }, fragment)
      .commit();
    const next = result.state.store;
    expect(next.records.get("p1")!.content).toEqual([{ type: "text", text: "hellocaption" }]); // "caption" is now the fragment's own FIRST block, merges into the head
    expect(next.rootIds[1]).toBe("img1");
    const backId = next.rootIds[2]!;
    expect(next.records.get(backId)!.content).toEqual([{ type: "text", text: " world" }]); // original tail survives on its own fresh block, not lost
    expect(result.state.selection).toEqual({ type: "text", anchor: { blockId: backId, offset: 0 }, focus: { blockId: backId, offset: 0 } });
  });

  it("block-selection paste removes the selected blocks and inserts the fragment in their place", () => {
    const store = storeFrom([para("a", "A"), para("b", "B"), para("c", "C")]);
    const fragment = [{ id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "X" }] }];
    const result = createTransaction({ store, selection: null }, r).pasteFragment({ type: "block", ids: ["b"] }, fragment).commit();
    const next = result.state.store;
    expect(next.rootIds).toEqual(["a", "f1", "c"]);
    expect(result.state.selection).toEqual({ type: "block", ids: ["f1"] });
  });

  it("cells-selection paste clears the selected cells and drops the fragment (table paste is out of scope)", () => {
    const store = storeFrom([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [{ id: "r1", type: "tableRow", props: {}, children: [{ id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "old" }] }] }],
      },
    ]);
    const fragment = [{ id: "f1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text: "X" }] }];
    const result = createTransaction({ store, selection: null }, r)
      .pasteFragment({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 0] }, fragment)
      .commit();
    expect(result.state.store.records.get("c1")!.content).toEqual([]);
  });
});
