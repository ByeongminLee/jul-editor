import { coreRegistry, fromDoc, normalizeDoc } from "@jul-editor/core";
import type { Store } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { mapOffset, mapSelectionOver, transformLists } from "./transform.js";
import type { WireOp } from "./types.js";
import { applyWireOps } from "./wire.js";

const store = (text: string): Store =>
  fromDoc(normalizeDoc({ version: 1, blocks: [{ id: "p", type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] }] }, coreRegistry), coreRegistry);
const textOf = (s: Store): string => (s.records.get("p")?.content ?? []).map((i) => (i as { text: string }).text).join("");
const ins = (at: number, t: string): WireOp => ({ type: "replaceContent", id: "p", from: at, to: at, inlines: [{ type: "text", text: t }] });
const del = (from: number, to: number): WireOp => ({ type: "replaceContent", id: "p", from, to, inlines: [] });
const run = (s: Store, ops: WireOp[]) => applyWireOps(s, ops, coreRegistry).store;

describe("text OT (TP1)", () => {
  it("insert vs insert at the same point: the winner lands first", () => {
    const base = store("abc");
    const a = [ins(1, "A")];
    const b = [ins(1, "B")];
    const [a2, b2] = transformLists(a, b, false); // b is the earlier-sequenced winner
    expect(textOf(run(run(base, b), a2))).toBe("aBAbc");
    expect(textOf(run(run(base, a), b2))).toBe("aBAbc");
  });

  it("insert inside a concurrently deleted range survives, delete splits around it", () => {
    const base = store("abcdef");
    const d = [del(1, 5)];
    const i = [ins(3, "XY")];
    const [d2, i2] = transformLists(d, i, true);
    expect(textOf(run(run(base, i), d2))).toBe("aXYf");
    expect(textOf(run(run(base, d), i2))).toBe("aXYf");
  });

  it("random pairs of op lists converge both ways (TP1 fuzz)", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed % n);
    const randOps = (len: number): WireOp[] => {
      const ops: WireOp[] = [];
      let l = len;
      for (let k = rnd(3) + 1; k > 0; k--) {
        if (rnd(2) === 0 || l === 0) {
          const t = "ABCDE".slice(0, rnd(3) + 1);
          ops.push(ins(rnd(l + 1), t));
          l += t.length;
        } else {
          const from = rnd(l);
          const to = from + 1 + rnd(l - from);
          ops.push(del(from, Math.min(to, l)));
          l -= Math.min(to, l) - from;
        }
      }
      return ops;
    };
    for (let n = 0; n < 3000; n++) {
      const base = store("0123456789".slice(0, rnd(10)));
      const len = textOf(base).length;
      const a = randOps(len);
      const b = randOps(len);
      const aWins = rnd(2) === 0;
      const [a2, b2] = transformLists(a, b, aWins);
      expect(textOf(run(run(base, a), b2)), `case ${n}`).toBe(textOf(run(run(base, b), a2)));
    }
  });
});

describe("other op types", () => {
  it("last write wins for setProps on the same keys, disjoint keys both survive", () => {
    const early: WireOp = { type: "setProps", id: "p", patch: { x: 1, y: 2 } };
    const late: WireOp = { type: "setProps", id: "p", patch: { x: 9 } };
    const [early2, late2] = transformLists([early], [late], true);
    expect(early2).toEqual([{ type: "setProps", id: "p", patch: { y: 2 }, unset: [] }]);
    expect(late2).toEqual([late]);
  });

  it("an edit to a block whose content was replaced wholesale is dropped", () => {
    const edit = ins(1, "x");
    const swap: WireOp = { type: "replaceBlock", id: "p", block: { id: "p", type: "paragraph", props: {} } };
    expect(transformLists([edit], [swap], false)[0]).toEqual([]);
    expect(transformLists([swap], [edit], false)[0]).toEqual([swap]);
  });
});

describe("offset and selection mapping", () => {
  it("shifts carets after a collaborator's insert, keeps a caret AT the insertion point", () => {
    expect(mapOffset(4, "p", ins(1, "XX"))).toBe(6);
    expect(mapOffset(1, "p", ins(1, "XX"))).toBe(1);
    expect(mapOffset(4, "p", del(1, 3))).toBe(2);
    expect(mapOffset(2, "p", del(1, 3))).toBe(1);
    expect(mapOffset(4, "other", ins(0, "XX"))).toBe(4);
  });

  it("drops the selection when its block disappears", () => {
    const sel = { type: "text" as const, anchor: { blockId: "p", offset: 1 }, focus: { blockId: "p", offset: 2 } };
    expect(mapSelectionOver(sel, [], () => false)).toBeNull();
    expect(mapSelectionOver(sel, [ins(0, "ab")], () => true)).toEqual({ type: "text", anchor: { blockId: "p", offset: 3 }, focus: { blockId: "p", offset: 4 } });
  });
});
