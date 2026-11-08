// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Inline } from "../model/types.js";
import { CONTENT_ATTR } from "./dom.js";
import { buildContentDOM } from "./inline-dom.js";
import { domFromPoint, pointFromDOM } from "./selection.js";

function contentDiv(inlines: Inline[]): HTMLElement {
  const root = document.createElement("div");
  const div = document.createElement("div");
  div.setAttribute(CONTENT_ATTR, "");
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-jul-editor-block", "");
  wrapper.setAttribute("data-id", "b1");
  wrapper.appendChild(div);
  root.appendChild(wrapper);
  const built = buildContentDOM(inlines);
  for (const n of built.nodes) div.appendChild(n);
  return div;
}

describe("selection: domFromPoint / pointFromDOM round-trip", () => {
  it("maps every offset of a plain text run both ways", () => {
    const content = contentDiv([{ type: "text", text: "hello" }]);
    const root = content.closest("[data-jul-editor-root], body") ?? content.parentElement!.parentElement!;
    for (let offset = 0; offset <= 5; offset++) {
      const { node, offset: domOffset } = domFromPoint(content, offset);
      const point = pointFromDOM(root as HTMLElement, node, domOffset);
      expect(point).toEqual({ blockId: "b1", offset });
    }
  });

  it("a mention counts as exactly 1 unit", () => {
    const content = contentDiv([
      { type: "text", text: "a" },
      { type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } },
      { type: "text", text: "b" },
    ]);
    const root = content.parentElement!.parentElement!;
    // offset 1 = right before the mention, offset 2 = right after it
    const before = domFromPoint(content, 1);
    const after = domFromPoint(content, 2);
    expect(pointFromDOM(root, before.node, before.offset)).toEqual({ blockId: "b1", offset: 1 });
    expect(pointFromDOM(root, after.node, after.offset)).toEqual({ blockId: "b1", offset: 2 });
  });

  it("offset past the end clamps to the last position", () => {
    const content = contentDiv([{ type: "text", text: "hi" }]);
    const { node, offset } = domFromPoint(content, 999);
    expect(node).toBe(content);
    expect(offset).toBe(content.childNodes.length);
  });

  it("empty content (placeholder <br>) maps offset 0 to the content div itself", () => {
    const content = contentDiv([]);
    const { node, offset } = domFromPoint(content, 0);
    expect(node).toBe(content);
    expect(offset).toBe(0);
  });

  it("a point inside a nested mark element resolves through the text node", () => {
    const content = contentDiv([{ type: "text", text: "bold", marks: [{ type: "bold" }] }]);
    const root = content.parentElement!.parentElement!;
    const textNode = content.querySelector("strong")!.firstChild!;
    const point = pointFromDOM(root, textNode, 2);
    expect(point).toEqual({ blockId: "b1", offset: 2 });
  });
});
