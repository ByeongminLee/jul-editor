import { describe, expect, it } from "vitest";
import { blockSelfHash, cyrb53 } from "./hash.js";
import type { Block } from "./types.js";

describe("cyrb53", () => {
  it("is deterministic", () => {
    expect(cyrb53("hello")).toBe(cyrb53("hello"));
  });

  it("differs for different input", () => {
    expect(cyrb53("hello")).not.toBe(cyrb53("hellp"));
  });
});

describe("blockSelfHash", () => {
  it("ignores id and children", () => {
    const a: Block = { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] };
    const b: Block = {
      id: "b",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "hi" }],
      children: [{ id: "c", type: "paragraph", props: {}, content: [] }],
    };
    expect(blockSelfHash(a)).toBe(blockSelfHash(b));
  });

  it("changes when content changes", () => {
    const a: Block = { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] };
    const b: Block = { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "bye" }] };
    expect(blockSelfHash(a)).not.toBe(blockSelfHash(b));
  });
});
