import { coreRegistry, normalizeDoc } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { applyDecisions, computeInlineDiff, decideAll } from "./";

const doc = (blocks: Block[]): Doc => ({ version: 1, blocks });
const p = (id: string, text: string, extra: Partial<Block> = {}): Block => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], ...extra });
const norm = (d: Doc) => normalizeDoc(d, coreRegistry);

describe("computeInlineDiff", () => {
  it("reports no changes for identical docs", () => {
    const d = doc([p("a", "x")]);
    const r = computeInlineDiff(d, d);
    expect(r.changes).toEqual([]);
    expect(r.blocks[0]!.status).toBe("same");
  });

  it("builds same/ins/del segments with stable change ids", () => {
    const r = computeInlineDiff(doc([p("a", "hello world")]), doc([p("a", "hello brave world")]));
    const segs = r.blocks[0]!.segments!;
    expect(segs.map((s) => [s.kind, s.text])).toEqual([["same", "hello "], ["ins", "brave "], ["same", "world"]]);
    expect(r.changes.map((c) => c.id)).toEqual(["text:a:0"]);
  });

  it("merges delete+insert into one replacement hunk", () => {
    const r = computeInlineDiff(doc([p("a", "I like cats")]), doc([p("a", "I like dogs")]));
    const ids = new Set(r.blocks[0]!.segments!.filter((s) => s.changeId).map((s) => s.changeId));
    expect(ids.size).toBe(1);
    expect(r.blocks[0]!.segments!.some((s) => s.kind === "del")).toBe(true);
    expect(r.blocks[0]!.segments!.some((s) => s.kind === "ins")).toBe(true);
  });

  it("flags inserted/deleted roots once, descendants ride along", () => {
    const before = doc([p("a", "a"), { id: "q", type: "quote", props: {}, content: [], children: [p("k", "kid")] }]);
    const after = doc([p("a", "a"), { id: "n", type: "quote", props: {}, content: [], children: [p("n2", "x")] }]);
    const r = computeInlineDiff(before, after);
    expect(r.changes.map((c) => c.id).sort()).toEqual(["delete:q", "insert:n"]);
    expect(r.blockById.get("n2")!.coverId).toBe("insert:n");
  });

  it("flags moves, props and format-only changes", () => {
    const before = doc([p("a", "one"), p("b", "two"), p("c", "three", { props: { textAlign: "left" } })]);
    const after = doc([p("b", "two"), p("a", "one"), p("c", "three", { props: { textAlign: "center" } })]);
    const r = computeInlineDiff(before, after);
    expect(r.changes.some((c) => c.kind === "move")).toBe(true);
    expect(r.changes.some((c) => c.id === "props:c")).toBe(true);

    const f = computeInlineDiff(doc([p("a", "bold")]), doc([{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }] }]));
    expect(f.changes.map((c) => c.kind)).toEqual(["format"]);
    expect(f.blocks[0]!.segments!.find((s) => s.kind === "fmt")!.text).toBe("bold");
  });

  it("calls attribute() per change", () => {
    const r = computeInlineDiff(doc([p("a", "x")]), doc([p("a", "x"), p("b", "y")]), { attribute: (c) => ({ id: "ai", name: "Agent", color: "#0a0" , ...(c.kind ? {} : {}) }) });
    expect(r.changes[0]!.attribution).toEqual({ id: "ai", name: "Agent", color: "#0a0" });
  });
});

describe("applyDecisions", () => {
  const base = doc([p("a", "hello world"), p("b", "bravo"), p("c", "charlie", { props: { textAlign: "left" } }), p("d", "delta")]);
  const proposed = doc([p("a", "hello brave world"), p("c", "charlie", { props: { textAlign: "center" } }), p("d", "delta"), p("e", "echo"), p("f", "fox")].slice(0, 5));
  // b deleted, a text edited, c props, e inserted.

  it("accept all equals proposed, reject all equals base", () => {
    const diff = computeInlineDiff(base, proposed);
    expect(diff.changes.length).toBeGreaterThanOrEqual(4);
    expect(applyDecisions(base, proposed, decideAll(diff, "accept"))).toEqual(proposed);
    expect(applyDecisions(base, proposed, decideAll(diff, "reject"))).toEqual(base);
    expect(applyDecisions(base, proposed, {})).toEqual(base);
  });

  it("applies a mixed set of decisions", () => {
    const out = applyDecisions(base, proposed, { "text:a:0": "accept", "delete:b": "accept", "props:c": "reject", "insert:e": "accept" });
    expect(out.blocks.map((b) => b.id)).toEqual(["a", "c", "d", "e"]);
    expect(out.blocks[0]!.content).toEqual([{ type: "text", text: "hello brave world" }]);
    expect(out.blocks[1]!.props).toEqual({ textAlign: "left" });
  });

  it("rejecting an insert and a delete keeps base shape", () => {
    const out = applyDecisions(base, proposed, { "text:a:0": "accept", "delete:b": "reject", "insert:e": "reject", "props:c": "accept" });
    expect(out.blocks.map((b) => b.id)).toEqual(["a", "b", "c", "d"]);
    expect(out.blocks[2]!.props).toEqual({ textAlign: "center" });
  });

  it("resolves partial text hunks independently", () => {
    const b = doc([p("a", "the cat sat on the mat")]);
    const pr = doc([p("a", "the dog sat on the rug")]);
    const diff = computeInlineDiff(b, pr);
    const [h1, h2] = diff.changes;
    expect(diff.changes).toHaveLength(2);
    const out = applyDecisions(b, pr, { [h1!.id]: "accept", [h2!.id]: "reject" });
    expect(out.blocks[0]!.content).toEqual([{ type: "text", text: "the dog sat on the mat" }]);
  });

  it("accepts moves into place and keeps rejected moves in base order", () => {
    const b = doc([p("a", "1"), p("b", "2"), p("c", "3")]);
    const pr = doc([p("c", "3"), p("a", "1"), p("b", "2")]);
    const diff = computeInlineDiff(b, pr);
    expect(applyDecisions(b, pr, decideAll(diff, "accept")).blocks.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(applyDecisions(b, pr, decideAll(diff, "reject")).blocks.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("handles nested inserts, deletes and reparent moves (accept all / reject all)", () => {
    const b = doc([{ id: "l", type: "bulletListItem", props: {}, content: [{ type: "text", text: "L" }], children: [p("x", "x"), p("y", "y")] }, p("z", "z")]);
    const pr = doc([{ id: "l", type: "bulletListItem", props: {}, content: [{ type: "text", text: "L" }], children: [p("x", "x"), p("n", "new")] }, p("z", "z"), p("y", "y")]);
    const diff = computeInlineDiff(b, pr);
    expect(norm(applyDecisions(b, pr, decideAll(diff, "accept")))).toEqual(norm(pr));
    expect(norm(applyDecisions(b, pr, decideAll(diff, "reject")))).toEqual(norm(b));
    // Insert accepted only: y keeps base spot.
    const only = applyDecisions(b, pr, { "insert:n": "accept" });
    expect(only.blocks[0]!.children!.map((c) => c.id)).toEqual(["x", "n", "y"]);
  });

  it("hoists a surviving child when its deleted parent is removed but its move rejected", () => {
    const b = doc([{ id: "q", type: "quote", props: {}, content: [], children: [p("k", "kid")] }]);
    const pr = doc([p("k", "kid")]);
    const diff = computeInlineDiff(b, pr);
    const out = applyDecisions(b, pr, { "delete:q": "accept", "move:k": "reject" });
    expect(out.blocks.map((x) => x.id)).toEqual(["k"]);
    expect(diff.changes.length).toBe(2);
  });
});
