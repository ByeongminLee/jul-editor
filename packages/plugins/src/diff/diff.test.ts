import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastDiffLib from "fast-diff";
import { describe, expect, it } from "vitest";
import { coreRegistry } from "@jul-editor/core";
import { createRegistry } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";
import { diffDocs, diffStats, summarize } from "./";
import { mutateFixture } from "./mutate.js";

const r = coreRegistry;
const dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(dir, "../../../../bench/fixtures");

function doc(blocks: Block[]): Doc {
  return { version: 1, blocks };
}

function para(id: string, text: string, extra: Partial<Block> = {}): Block {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text }], ...extra };
}

function countBlocks(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    n++;
    if (b.children) n += countBlocks(b.children);
  }
  return n;
}

describe("diffDocs: no-op", () => {
  it("keeps cold leaves unchanged across undefined props, defaults, and empty children", () => {
    const before = doc([
      para("undefined", "same"),
      para("children", "same"),
      { id: "default", type: "heading", props: {}, content: [{ type: "text", text: "same" }] },
    ]);
    const after = doc([
      { ...para("undefined", "same"), props: { ignored: undefined } as unknown as Block["props"] },
      { ...para("children", "same"), children: [] },
      { id: "default", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "same" }] },
    ]);
    const tree = diffDocs(before, after, r);
    expect(tree.root.map((node) => [node.status, node.collapsed])).toEqual([
      ["same", true],
      ["same", true],
      ["same", true],
    ]);
    expect(tree.stats.unchanged).toBe(3);
  });

  it("identical docs => all same, stats zero (except unchanged)", () => {
    const d = doc([
      para("p1", "hello"),
      { id: "l1", type: "bulletListItem", props: {}, content: [], children: [para("p2", "nested")] },
    ]);
    const tree = diffDocs(d, d, r);
    expect(tree.stats).toEqual({ inserted: 0, deleted: 0, modified: 0, moved: 0, unchanged: countBlocks(d.blocks) });
    for (const node of tree.root) {
      expect(node.status).toBe("same");
      expect(node.collapsed).toBe(true);
      expect(node.children).toEqual([]);
    }
  });
});

it("keeps self and subtree hashes separate across registries", () => {
  const registry = (level: number) => createRegistry({
    blocks: [
      { type: "heading", content: "inline", children: "any", props: { level } },
      { type: "paragraph", content: "inline", children: "any", props: {} },
    ],
    inlines: [],
    marks: [],
  });
  const heading = (id: string, props: Block["props"]): Block => ({ id, type: "heading", props, content: [{ type: "text", text: "same" }] });
  const before = doc([heading("leaf", { level: 1 }), para("parent", "same", { children: [heading("nested", { level: 1 })] })]);
  const after = doc([heading("leaf", {}), para("parent", "same", { children: [heading("nested", {})] })]);

  expect(diffDocs(before, after, registry(1)).stats.modified).toBe(0);
  const second = diffDocs(before, after, registry(2));
  expect(second.stats.modified).toBe(2);
  expect(second.root[0]!.status).toBe("modify");
  expect(second.root[1]!.collapsed).toBeUndefined();
  expect(second.root[1]!.children[0]!.status).toBe("modify");
});

describe("diffDocs: insert/delete", () => {
  it("insert at start/middle/end", () => {
    const before = doc([para("a", "a"), para("b", "b"), para("c", "c")]);
    const after = doc([para("x1", "x1"), para("a", "a"), para("b", "b"), para("x2", "x2"), para("c", "c"), para("x3", "x3")]);
    const tree = diffDocs(before, after, r);
    expect(tree.root.map((n) => [n.id, n.status])).toEqual([
      ["x1", "insert"],
      ["a", "same"],
      ["b", "same"],
      ["x2", "insert"],
      ["c", "same"],
      ["x3", "insert"],
    ]);
    expect(tree.stats.inserted).toBe(3);
  });

  it("delete at start/middle/end", () => {
    const before = doc([para("a", "a"), para("b", "b"), para("c", "c"), para("d", "d"), para("e", "e")]);
    const after = doc([para("b", "b"), para("d", "d")]);
    const tree = diffDocs(before, after, r);
    expect(tree.root.map((n) => [n.id, n.status])).toEqual([
      ["a", "delete"],
      ["b", "same"],
      ["c", "delete"],
      ["d", "same"],
      ["e", "delete"],
    ]);
    expect(tree.stats.deleted).toBe(3);
  });

  it("deleted node placement: consecutive deletes stay adjacent and ordered", () => {
    const before = doc([para("a", "a"), para("b", "b"), para("c", "c"), para("d", "d")]);
    const after = doc([para("a", "a"), para("d", "d")]);
    const tree = diffDocs(before, after, r);
    expect(tree.root.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(tree.root.map((n) => n.status)).toEqual(["same", "delete", "delete", "same"]);
  });

  it("nested subtree insert: descendants of an inserted block are insert too", () => {
    const before = doc([para("a", "a")]);
    const after = doc([
      para("a", "a"),
      {
        id: "l1",
        type: "bulletListItem",
        props: {},
        content: [],
        children: [para("c1", "c1"), para("c2", "c2")],
      },
    ]);
    const tree = diffDocs(before, after, r);
    const inserted = tree.root.find((n) => n.id === "l1")!;
    expect(inserted.status).toBe("insert");
    expect(inserted.children.map((n) => [n.id, n.status])).toEqual([
      ["c1", "insert"],
      ["c2", "insert"],
    ]);
    expect(tree.stats.inserted).toBe(3);
  });

  it("nested subtree delete: descendants of a deleted block are delete too", () => {
    const before = doc([
      para("a", "a"),
      {
        id: "l1",
        type: "bulletListItem",
        props: {},
        content: [],
        children: [para("c1", "c1"), para("c2", "c2")],
      },
    ]);
    const after = doc([para("a", "a")]);
    const tree = diffDocs(before, after, r);
    const deleted = tree.root.find((n) => n.id === "l1")!;
    expect(deleted.status).toBe("delete");
    expect(deleted.children.map((n) => [n.id, n.status])).toEqual([
      ["c1", "delete"],
      ["c2", "delete"],
    ]);
    expect(tree.stats.deleted).toBe(3);
  });
});

describe("diffDocs: modify", () => {
  it("modify text: inline char ops are correct", () => {
    const before = doc([para("p1", "hello world")]);
    const after = doc([para("p1", "hello there")]);
    const tree = diffDocs(before, after, r);
    const node = tree.root[0]!;
    expect(node.status).toBe("modify");
    expect(node.inline).toEqual(fastDiffLib("hello world", "hello there"));
    expect(tree.stats.modified).toBe(1);
  });

  it("format-only change: text identical, marks differ => formatChanged + ranges", () => {
    const before = doc([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }]);
    const after = doc([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }] },
    ]);
    const tree = diffDocs(before, after, r);
    const node = tree.root[0]!;
    expect(node.status).toBe("modify");
    expect(node.formatChanged).toBe(true);
    expect(node.formatRanges).toEqual([[0, 5]]);
    expect(node.inline).toEqual([[0, "hello"]]);
  });

  it("mention change: same position, different reference => modify + formatChanged", () => {
    const mention = (id: string) => ({ type: "mention" as const, attrs: { kind: "user", id, label: "x" } });
    const before = doc([{ id: "p1", type: "paragraph", props: {}, content: [mention("u1")] }]);
    const after = doc([{ id: "p1", type: "paragraph", props: {}, content: [mention("u2")] }]);
    const tree = diffDocs(before, after, r);
    const node = tree.root[0]!;
    expect(node.status).toBe("modify");
    expect(node.formatChanged).toBe(true);
    expect(node.formatRanges).toEqual([[0, 1]]);
  });

  it("props change", () => {
    const before = doc([{ id: "i1", type: "image", props: { src: "a.png", alt: "a" } }]);
    const after = doc([{ id: "i1", type: "image", props: { src: "b.png", alt: "a" } }]);
    const tree = diffDocs(before, after, r);
    const node = tree.root[0]!;
    expect(node.status).toBe("modify");
    expect(node.props).toEqual([{ key: "src", before: "a.png", after: "b.png" }]);
  });

  it("type change", () => {
    const before = doc([para("p1", "hi")]);
    const after = doc([{ id: "p1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "hi" }] }]);
    const tree = diffDocs(before, after, r);
    const node = tree.root[0]!;
    expect(node.status).toBe("modify");
    expect(node.before).toBe("paragraph");
    expect(node.after).toBe("heading");
  });

  it("table cell edit", () => {
    const cell = (text: string) => ({
      id: "cell1",
      type: "tableCell",
      props: {},
      content: [{ type: "text" as const, text }],
    });
    const table = (text: string) => ({
      id: "t1",
      type: "table",
      props: {},
      children: [{ id: "row1", type: "tableRow", props: {}, children: [cell(text)] }],
    });
    const before = doc([table("old")]);
    const after = doc([table("new")]);
    const tree = diffDocs(before, after, r);
    const row = tree.root[0]!.children[0]!;
    const cellNode = row.children[0]!;
    expect(cellNode.status).toBe("modify");
    expect(cellNode.inline).toEqual(fastDiffLib("old", "new"));
  });

  it("default-prop equivalence: explicit default vs omitted => same", () => {
    const before = doc([{ id: "t1", type: "todoListItem", props: { checked: false }, content: [] }]);
    const after = doc([{ id: "t1", type: "todoListItem", props: {}, content: [] }]);
    const tree = diffDocs(before, after, r);
    expect(tree.root[0]!.status).toBe("same");
    expect(tree.stats.modified).toBe(0);
  });
});

describe("diffDocs: move", () => {
  it("classifies cold cloned leaves after a reorder and text edit", () => {
    const before = doc([para("a", "alpha"), para("b", "beta"), para("c", "old")]);
    const after = JSON.parse(JSON.stringify(doc([before.blocks[1]!, before.blocks[0]!, para("c", "new")]))) as Doc;
    const tree = diffDocs(before, after, r);
    expect(tree.root.map((node) => [node.id, node.status])).toEqual([
      ["b", "move"],
      ["a", "same"],
      ["c", "modify"],
    ]);
    expect(tree.root[0]!.from).toEqual({ parentId: null, index: 1 });
    expect(tree.root[2]!.inline).toEqual(fastDiffLib("old", "new"));
    expect(tree.stats).toEqual({ inserted: 0, deleted: 0, modified: 1, moved: 1, unchanged: 1 });
  });

  it("reorder within parent: moving one block among 100 reports exactly 1 move", () => {
    const items = Array.from({ length: 100 }, (_, i) => para(`p${i}`, `text${i}`));
    const before = doc(items);
    const reordered = [...items.slice(0, 50), ...items.slice(51), items[50]!];
    const after = doc(reordered);
    const tree = diffDocs(before, after, r);
    const moves = tree.root.filter((n) => n.status === "move");
    expect(moves.map((n) => n.id)).toEqual(["p50"]);
    expect(tree.stats.moved).toBe(1);
    expect(tree.stats.unchanged).toBe(99);
  });

  it("reparent via indent is reported as move, not delete+insert", () => {
    const before = doc([
      { id: "l1", type: "bulletListItem", props: {}, content: [{ type: "text", text: "one" }], children: [] },
      { id: "l2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "two" }], children: [] },
    ]);
    // Simulate Tab: l2 becomes a child of l1 (reparent), same content.
    const after = doc([
      {
        id: "l1",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "one" }],
        children: [{ id: "l2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "two" }], children: [] }],
      },
    ]);
    const tree = diffDocs(before, after, r);
    expect(tree.stats.inserted).toBe(0);
    expect(tree.stats.deleted).toBe(0);
    expect(tree.stats.moved).toBe(1);
    const l2 = tree.root[0]!.children[0]!;
    expect(l2.id).toBe("l2");
    expect(l2.status).toBe("move");
    expect(l2.from).toEqual({ parentId: null, index: 1 });
  });
});

describe("diffStats / summarize", () => {
  it("diffStats matches diffDocs(...).stats", () => {
    const before = doc([para("a", "a"), para("b", "b")]);
    const after = doc([para("a", "a"), para("b", "b changed")]);
    expect(diffStats(before, after, r)).toEqual(diffDocs(before, after, r).stats);
  });

  it("summarize renders the stats", () => {
    const before = doc([para("a", "a")]);
    const after = doc([para("a", "a changed")]);
    const tree = diffDocs(before, after, r);
    expect(summarize(tree)).toBe("0 inserted, 0 deleted, 1 modified, 0 moved, 0 unchanged");
  });
});

describe("diffDocs: fixture-based (doc-5000, 1% seeded mutation)", () => {
  it("reports exact stats", () => {
    const original = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "doc-5000.json"), "utf8")) as Doc;
    const totalBefore = countBlocks(original.blocks);
    const { doc: mutated, expected } = mutateFixture(original, 12345);

    const tree = diffDocs(original, mutated, r);
    expect(tree.stats.inserted).toBe(expected.inserted);
    expect(tree.stats.deleted).toBe(expected.deleted);
    expect(tree.stats.modified).toBe(expected.modified);
    expect(tree.stats.moved).toBe(expected.moved);
    expect(tree.stats.unchanged).toBe(totalBefore - expected.deleted - expected.modified - expected.moved);
  });
});
