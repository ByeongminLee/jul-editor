import { describe, expect, it } from "vitest";
import { bullet, para, r, storeFrom } from "./test-helpers.js";
import { applyOp } from "./ops.js";
import { createTransaction } from "./transaction.js";

describe("createTransaction (editor.update(fn)-style)", () => {
  it("chains multiple edits and commits one final state", () => {
    const store = storeFrom([para("p1", "hello")]);
    const result = createTransaction({ store, selection: null }, r)
      .insertText({ blockId: "p1", offset: 5 }, " world")
      .setSelection({ type: "text", anchor: { blockId: "p1", offset: 11 }, focus: { blockId: "p1", offset: 11 } })
      .commit();
    expect(result.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.state.selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 11 }, focus: { blockId: "p1", offset: 11 } });
  });

  it("accumulates changedIds across every op in the transaction", () => {
    const store = storeFrom([bullet("a", "A"), bullet("b", "B")]);
    const result = createTransaction({ store, selection: null }, r).insertText({ blockId: "a", offset: 1 }, "x").indent("b").commit();
    expect(result.changedIds.has("a")).toBe(true);
    expect(result.changedIds.has("b")).toBe(true);
  });

  it("commit changedIds are minimal for a single typing edit: just the block and its ancestors", () => {
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")]), bullet("b", "B")]);
    const result = createTransaction({ store, selection: null }, r).insertText({ blockId: "a1", offset: 5 }, "!").commit();
    expect(result.changedIds).toEqual(new Set(["a1", "a"]));
  });

  it("returns inverse ops that undo the transaction when re-applied in order", () => {
    const store = storeFrom([para("p1", "hello")]);
    const result = createTransaction({ store, selection: null }, r).insertText({ blockId: "p1", offset: 5 }, " world").commit();
    expect(result.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hello world" }]);

    let undone = result.state.store;
    for (const op of result.inverseOps) undone = applyOp(undone, op, r).store;
    expect(undone.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);
  });
});
