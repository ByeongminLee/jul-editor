import { describe, expect, it } from "vitest";
import { coreRegistry } from "./builtins.js";
import { validateDoc } from "./validate.js";
import type { Doc } from "./types.js";

const r = coreRegistry;

function doc(blocks: Doc["blocks"]): Doc {
  return { version: 1, blocks };
}

describe("validateDoc", () => {
  it("reports no issues for a well-formed doc", () => {
    const d = doc([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] }]);
    expect(validateDoc(d, r)).toEqual([]);
  });

  it("catches unknown mark", () => {
    const d = doc([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi", marks: [{ type: "glow" }] }] },
    ]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "unknown-mark")).toBe(true);
  });

  it("catches disallowed child type", () => {
    const d = doc([
      { id: "t1", type: "table", props: {}, children: [{ id: "p1", type: "paragraph", props: {}, content: [] }] },
    ]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "disallowed-child")).toBe(true);
  });

  it("catches parent violation", () => {
    const d = doc([{ id: "row1", type: "tableRow", props: {}, children: [] }]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "parent-violation")).toBe(true);
  });

  it("catches content on a none-content block", () => {
    const d = doc([{ id: "d1", type: "divider", props: {}, content: [{ type: "text", text: "oops" }] } as any]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "content-on-none")).toBe(true);
  });

  it("catches missing id", () => {
    const d = doc([{ id: "", type: "paragraph", props: {}, content: [] }]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "missing-id")).toBe(true);
  });

  it("catches duplicate id", () => {
    const d = doc([
      { id: "a", type: "paragraph", props: {}, content: [] },
      { id: "a", type: "paragraph", props: {}, content: [] },
    ]);
    const issues = validateDoc(d, r);
    expect(issues.some((i) => i.kind === "duplicate-id")).toBe(true);
  });

  it("doesn't choke on unregistered block types", () => {
    const d = doc([{ id: "x1", type: "notARealType", props: {}, content: [] } as any]);
    expect(() => validateDoc(d, r)).not.toThrow();
  });
});
