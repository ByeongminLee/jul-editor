import { coreRegistry, fromDoc, normalizeDoc } from "@jul-editor/core";
import type { Block, Store } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { applyWireOps, diffStores, sameStore } from "./wire.js";

const p = (id: string, text = "", children?: Block[]): Block => ({ id, type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [], ...(children ? { children } : {}) });
const mk = (...blocks: Block[]): Store => fromDoc(normalizeDoc({ version: 1, blocks }, coreRegistry), coreRegistry);
const roundTrip = (from: Store, to: Store): Store => applyWireOps(from, JSON.parse(JSON.stringify(diffStores(from, to))), coreRegistry).store;

describe("diffStores / applyWireOps round trip (JSON safe)", () => {
  const cases: Record<string, [Store, Store]> = {
    "typing in the middle": [mk(p("a", "hello")), mk(p("a", "heXXllo"))],
    "replace a run": [mk(p("a", "hello world")), mk(p("a", "hello there"))],
    "delete all text": [mk(p("a", "hello")), mk(p("a", ""))],
    "insert and remove blocks": [mk(p("a", "1"), p("b", "2"), p("c", "3")), mk(p("a", "1"), p("n", "new"), p("c", "3"))],
    "reorder": [mk(p("a"), p("b"), p("c"), p("d")), mk(p("d"), p("b"), p("a"), p("c"))],
    "nest and unnest": [mk(p("a"), p("b"), p("c")), mk(p("a", "", [p("b")]), p("c"))],
    "move a child out of a deleted parent": [mk(p("a", "", [p("b", "keep")]), p("c")), mk(p("c"), p("b", "keep"))],
    "added parent that adopts a survivor": [mk(p("a"), p("b")), mk(p("a"), p("w", "", [p("b")]))],
    "props and type": [mk(p("a", "t")), mk({ id: "a", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "t" }] })],
    "whole doc replaced": [mk(p("a", "1")), mk(p("x", "9"), p("y", "8"))],
  };
  for (const [name, [from, to]] of Object.entries(cases)) {
    it(name, () => {
      expect(sameStore(roundTrip(from, to), to)).toBe(true);
    });
  }

  it("emits nothing for an unchanged store and minimal text atoms for typing", () => {
    const s = mk(p("a", "hello"));
    expect(diffStores(s, s)).toEqual([]);
    const ops = diffStores(s, mk(p("a", "heXXllo")));
    expect(ops).toEqual([{ type: "replaceContent", id: "a", from: 2, to: 2, inlines: [{ type: "text", text: "XX" }] }]);
  });

  it("skips an insert whose ids already exist (duplicate delivery)", () => {
    const from = mk(p("a"));
    const to = mk(p("a"), p("n", "x"));
    const ops = diffStores(from, to);
    const once = applyWireOps(from, ops, coreRegistry).store;
    const twice = applyWireOps(once, ops, coreRegistry).store;
    expect(sameStore(twice, to)).toBe(true);
  });
});
