// @vitest-environment jsdom
// Adversarial repros: toHTML -> fromHTML (our own output pasted back)
// and the third-party extensibility contract for HTML paste.
import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, coreRegistry } from "../model/builtins.js";
import { canonicalStringify, normalizeDoc } from "../model/canonical.js";
import { createRegistry, defineMark, type Registry } from "../model/schema.js";
import type { Block, Doc, Inline } from "../model/types.js";
import { fromHTML } from "../serde/from-html.js";
import { toHTML } from "../serde/to-html.js";

function strip(b: Block): unknown {
  const { id: _id, children, ...rest } = b;
  return children ? { ...rest, children: children.map(strip) } : rest;
}
function expectHtmlRoundTrip(blocks: Block[], registry: Registry = coreRegistry) {
  const d: Doc = { version: 1, blocks };
  const html = toHTML(d, { registry });
  const back = fromHTML(html, { registry }).doc;
  const c = (x: Doc) => canonicalStringify(normalizeDoc(x, registry).blocks.map(strip));
  expect(c(back), `html was: ${html}`).toBe(c(d));
}
const T = (text: string): Inline => ({ type: "text", text });

describe("html", () => {
  it("a bullet item whose nested child is a to-do becomes a to-do itself (querySelector finds the descendant checkbox)", () => {
    expectHtmlRoundTrip([
      { id: "a", type: "bulletListItem", props: {}, content: [T("parent")], children: [{ id: "b", type: "todoListItem", props: { checked: true }, content: [T("sub task")] }] },
    ]);
  });

  it("a hard break inside a paragraph survives toHTML -> fromHTML (toHTML emits a raw \\n, fromHTML collapses it to a space)", () => {
    expectHtmlRoundTrip([{ id: "a", type: "paragraph", props: {}, content: [T("line one\nline two")] }]);
  });

  it("extensibility: a custom mark with MarkSpec.html survives copy (toHTML) -> paste (fromHTML)", () => {
    const highlight = defineMark({ type: "highlight", html: { tag: "mark" }, markdown: { open: "==", close: "==" } });
    const registry = createRegistry({ blocks: coreBlocks, inlines: coreInlines, marks: [...coreMarks, highlight] });
    expectHtmlRoundTrip([{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hot", marks: [{ type: "highlight" }] }] }], registry);
  });

  it("heading level 4 from our own toHTML (<h4>) comes back as level 4", () => {
    expectHtmlRoundTrip([{ id: "a", type: "heading", props: { level: 4 }, content: [T("deep")] }]);
  });
});
