import { describe, expect, it } from "vitest";
import fastDiff from "fast-diff";
import { wordifyOps, type DiffOp } from "./word-diff.js";
import { computeInlineDiff } from "./inline-diff.js";
import type { Block, Doc } from "@jul-editor/core";

const hunks = (a: string, b: string) => wordifyOps(fastDiff(a, b) as DiffOp[]).filter((o) => o[0] !== 0);
const doc = (text: string): Doc => ({ version: 1, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text }] } as Block] });

describe("wordifyOps", () => {
  it("turns char level typo fixes into whole word replacements", () => {
    expect(hunks("teh agent can recieve", "The agent can receive")).toEqual([[-1, "teh"], [1, "The"], [-1, "recieve"], [1, "receive"]]);
  });
  it("keeps whole word insertions and deletions as they are", () => {
    expect(hunks("a cat", "a brave cat")).toEqual([[1, "brave "]]);
    expect(hunks("a brave cat", "a cat")).toEqual([[-1, "brave "]]);
  });
  it("expands a suffix edit to the word and merges near hunks", () => {
    expect(hunks("cat", "cats")).toEqual([[-1, "cat"], [1, "cats"]]);
    expect(hunks("big red", "bag rid")).toEqual([[-1, "big red"], [1, "bag rid"]]);
  });
  it("rebuilds ops that still reproduce both strings", () => {
    const a = "the quick brown fox";
    const b = "a quicker brown dog";
    const ops = wordifyOps(fastDiff(a, b) as DiffOp[]);
    expect(ops.filter((o) => o[0] !== 1).map((o) => o[1]).join("")).toBe(a);
    expect(ops.filter((o) => o[0] !== -1).map((o) => o[1]).join("")).toBe(b);
  });
});

describe("computeInlineDiff granularity", () => {
  it("word is the default; char keeps fine hunks", () => {
    const a = doc("teh agent can recieve");
    const b = doc("The agent can receive");
    expect(computeInlineDiff(a, b).changes.filter((c) => c.kind === "text")).toHaveLength(2);
    expect(computeInlineDiff(a, b, { granularity: "char" }).changes.filter((c) => c.kind === "text").length).toBeGreaterThan(2);
  });
});
