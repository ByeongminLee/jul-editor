// @vitest-environment jsdom
import { coreBlocks, coreInlines, coreMarks, createEditor, createRegistry } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { blockTypeOf, createPageBreak, pageBreak, pageFlags } from "./index.js";

describe("pageFlags (block wrapper attributes)", () => {
  it("reads core's data-type as well as data-jul-editor-type", () => {
    const a = document.createElement("div");
    a.setAttribute("data-type", "heading");
    const b = document.createElement("div");
    b.setAttribute("data-jul-editor-type", "pageBreak");
    expect(blockTypeOf(a)).toBe("heading");
    expect(blockTypeOf(b)).toBe("pageBreak");
    expect(pageFlags(a)).toEqual({ breakAfter: false, keepWithNext: true });
    expect(pageFlags(b)).toEqual({ breakAfter: true, keepWithNext: false });
  });

  it("works on the wrappers a real editor renders (heading keepWithNext, pageBreak breakAfter)", () => {
    const registry = createRegistry({ blocks: [...coreBlocks, pageBreak], inlines: coreInlines, marks: coreMarks });
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({
      element,
      registry,
      defaultValue: {
        version: 1,
        blocks: [
          { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title" }] },
          { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "body" }] },
          { ...createPageBreak(), id: "pb" },
        ],
      },
    });
    const kids = Array.from(element.children).slice(0, 3); // the editor appends a trailing empty paragraph
    expect(kids.map((k) => pageFlags(k))).toEqual([
      { breakAfter: false, keepWithNext: true },
      { breakAfter: false, keepWithNext: false },
      { breakAfter: true, keepWithNext: false },
    ]);
    editor.destroy();
  });
});
