import { describe, expect, it } from "vitest";
import { indentCodeText } from "./code-indent.js";

describe("indentCodeText", () => {
  it("Tab at a caret inserts two spaces and moves the caret after them", () => {
    expect(indentCodeText("ab", 1, 1, 1)).toEqual({ value: "a  b", start: 3, end: 3 });
  });
  it("Tab over a range indents every touched line", () => {
    expect(indentCodeText("a\nb\nc", 0, 3, 1)).toEqual({ value: "  a\n  b\nc", start: 2, end: 7 });
  });
  it("Shift-Tab removes up to two leading spaces (or one tab) per touched line", () => {
    expect(indentCodeText("    x\n\ty", 4, 7, -1)).toEqual({ value: "  x\ny", start: 2, end: 4 });
  });
  it("Shift-Tab with nothing to remove returns null", () => {
    expect(indentCodeText("x", 1, 1, -1)).toBeNull();
  });
  it("indents only the first line of a range starting at offset 0 before a newline", () => {
    expect(indentCodeText("\nab", 0, 1, 1)?.value).toBe("  \nab");
  });
});
