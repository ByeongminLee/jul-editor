// @vitest-environment jsdom
// Generic (span-rendered) marks keep their string attrs through DOM render and read-back,
// so an IME/DOM re-read cannot silently drop e.g. a comment anchor's threadId.
import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks } from "../model/builtins.js";
import { createRegistry, defineMark } from "../model/schema.js";
import type { Inline } from "../model/types.js";
import { buildContentDOM, readContentFromDOM } from "./inline-dom.js";

const anchor = defineMark({ type: "anchor", attrs: { threadId: "" } });
const registry = createRegistry({ blocks: coreBlocks, inlines: coreInlines, marks: [...coreMarks, anchor] });

describe("generic mark attrs", () => {
  it("round-trips string attrs through data-mark-* attributes", () => {
    const content: Inline[] = [{ type: "text", text: "hi", marks: [{ type: "anchor", attrs: { threadId: "t-1" } }] }];
    const el = document.createElement("div");
    for (const n of buildContentDOM(content).nodes) el.appendChild(n);
    expect(el.querySelector("span")?.getAttribute("data-mark-thread-id")).toBe("t-1");
    expect(readContentFromDOM(el, registry, undefined)).toEqual(content);
  });
});
