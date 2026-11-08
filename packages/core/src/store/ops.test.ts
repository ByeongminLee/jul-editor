import { describe, expect, it } from "vitest";
import { bullet, para, r, storeFrom } from "./test-helpers.js";
import { applyOp } from "./ops.js";
import { toDoc } from "./store.js";
import type { Op } from "./types.js";

function roundTrip(storeIn: ReturnType<typeof storeFrom>, op: Op) {
  const before = toDoc(storeIn, 1, new WeakMap());
  const forward = applyOp(storeIn, op, r);
  const back = applyOp(forward.store, forward.inverse, r);
  const after = toDoc(back.store, 1, new WeakMap());
  expect(after).toEqual(before);
  return forward;
}

describe("Op + inverse round trip", () => {
  it("insertBlock / removeBlock", () => {
    const store = storeFrom([para("p1", "hello")]);
    const op: Op = { type: "insertBlock", parentId: null, index: 1, block: para("p2", "world") };
    const fwd = roundTrip(store, op);
    expect(fwd.store.rootIds).toEqual(["p1", "p2"]);
    expect(fwd.inverse).toEqual({ type: "removeBlock", id: "p2" });
  });

  it("removeBlock / insertBlock (with a nested subtree)", () => {
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")]), bullet("b", "B")]);
    const fwd = roundTrip(store, { type: "removeBlock", id: "a" });
    expect(fwd.store.rootIds).toEqual(["b"]);
    expect(fwd.store.records.has("a1")).toBe(false);
  });

  it("moveBlock (reparent) / moveBlock back", () => {
    const store = storeFrom([bullet("a", "A"), bullet("b", "B")]);
    const fwd = roundTrip(store, { type: "moveBlock", id: "b", newParentId: "a", index: 0 });
    expect(fwd.store.records.get("b")!.parentId).toBe("a");
    expect(fwd.store.rootIds).toEqual(["a"]);
  });

  it("moveBlock refuses to move a block into its own subtree", () => {
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")])]);
    const result = applyOp(store, { type: "moveBlock", id: "a", newParentId: "a1", index: 0 }, r);
    expect(result.store).toBe(store); // no-op
    expect(result.changedIds.size).toBe(0);
  });

  it("setProps / setProps inverse", () => {
    const store = storeFrom([{ id: "h1", type: "heading", props: { level: 1 }, content: [] }]);
    const fwd = roundTrip(store, { type: "setProps", id: "h1", patch: { level: 3 } });
    expect(fwd.store.records.get("h1")!.props).toEqual({ level: 3 });
  });

  it("setProps with undefined resets a prop back to the schema default (and stays omitted)", () => {
    const store = storeFrom([{ id: "h1", type: "heading", props: { level: 3 }, content: [] }]);
    const fwd = applyOp(store, { type: "setProps", id: "h1", patch: { level: undefined } }, r);
    expect(fwd.store.records.get("h1")!.props).toEqual({});
    expect(fwd.inverse).toEqual({ type: "setProps", id: "h1", patch: { level: 3 } });
  });

  it("setType / setType inverse between compatible inline-content types", () => {
    const store = storeFrom([para("p1", "hi")]);
    const fwd = roundTrip(store, { type: "setType", id: "p1", blockType: "heading", props: { level: 2 } });
    expect(fwd.store.records.get("p1")!.type).toBe("heading");
    expect(fwd.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("setType rejects a change that would drop non-empty content", () => {
    const store = storeFrom([para("p1", "hi")]);
    const result = applyOp(store, { type: "setType", id: "p1", blockType: "divider" }, r);
    expect(result.store).toBe(store);
    expect(result.store.records.get("p1")!.type).toBe("paragraph");
  });

  it("setType rejects a change that would drop non-empty children", () => {
    // paragraph now has children: 'any' (Notion-style nesting), so it no
    // longer rejects this -- use divider (children: 'none') instead.
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")])]);
    const result = applyOp(store, { type: "setType", id: "a", blockType: "divider" }, r);
    expect(result.store).toBe(store);
  });

  it("setType allows a change to a type with children: 'any' even with non-empty children", () => {
    const store = storeFrom([bullet("a", "A", [bullet("a1", "child")])]);
    const result = applyOp(store, { type: "setType", id: "a", blockType: "paragraph" }, r);
    expect(result.store).not.toBe(store);
    expect(result.store.records.get("a")!.type).toBe("paragraph");
    expect(result.store.records.get("a")!.childIds).toEqual(["a1"]);
  });

  it("replaceContent / replaceContent inverse", () => {
    const store = storeFrom([para("p1", "hello world")]);
    const fwd = roundTrip(store, { type: "replaceContent", id: "p1", from: 5, to: 11, inlines: [{ type: "text", text: "!" }] });
    expect(fwd.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hello!" }]);
  });

  // replaceBlock -- unlike setType, this DOES allow trading away
  // existing content/children (its inverse carries the exact pre-swap block,
  // so nothing is actually lost across an undo).
  it("replaceBlock / replaceBlock inverse allows dropping non-empty content (unlike setType)", () => {
    const store = storeFrom([para("p1", "hello")]);
    const fwd = roundTrip(store, { type: "replaceBlock", id: "p1", block: { id: "p1", type: "divider", props: {}, content: [] } });
    expect(fwd.store.records.get("p1")!.type).toBe("divider");
    expect(fwd.store.records.get("p1")!.content).toBeUndefined();
    expect(fwd.inverse).toEqual({ type: "replaceBlock", id: "p1", block: { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] } });
    // The inverse round trip (asserted by roundTrip() above) already proves
    // undo restores "hello" exactly -- nothing lost.
  });

  it("replaceBlock rejects a type the current parent's schema doesn't admit (a root-level block turning into a tableRow, whose schema restricts it to a table parent)", () => {
    const store = storeFrom([para("p1", "hi")]);
    const result = applyOp(store, { type: "replaceBlock", id: "p1", block: { id: "p1", type: "tableRow", props: {}, children: [] } }, r);
    expect(result.store).toBe(store); // no-op
    expect(result.store.records.get("p1")!.type).toBe("paragraph");
  });

  it("replaceBlock is a no-op for an unknown id", () => {
    const store = storeFrom([para("p1", "hi")]);
    const result = applyOp(store, { type: "replaceBlock", id: "nope", block: { id: "nope", type: "divider", props: {} } }, r);
    expect(result.store).toBe(store);
    expect(result.changedIds.size).toBe(0);
  });
});
