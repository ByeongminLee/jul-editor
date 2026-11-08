// @vitest-environment jsdom
// new marks (underline/subscript/superscript/textColor/highlight)
// serde round-trip + lossy reporting + fromHTML paste mapping.
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc, TextInline } from "../model/types.js";
import { fromHTML } from "./from-html.js";
import { fromMarkdown } from "./from-markdown.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";
import { canonicalNoIds } from "./test-helpers.js";

function docWith(text: string, marks: TextInline["marks"]): Doc {
  return { version: 1, blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text, marks }] }] };
}

describe("marks: markdown serde", () => {
  it("underline round-trips through <u>x</u>", () => {
    const doc = docWith("hi", [{ type: "underline" }]);
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toContain("<u>hi</u>");
    expect(lossy).toEqual([]);
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });

  it("subscript/superscript round-trip through <sub>/<sup>", () => {
    for (const type of ["subscript", "superscript"] as const) {
      const doc = docWith("x", [{ type }]);
      const { markdown, lossy } = toMarkdown(doc);
      expect(lossy).toEqual([]);
      const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
      expect(lossy2).toEqual([]);
      expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
    }
  });

  it("highlight with no color round-trips through ==x==, no lossy report", () => {
    const doc = docWith("hi", [{ type: "highlight" }]);
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toContain("==hi==");
    expect(lossy).toEqual([]);
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
  });

  it("highlight WITH a color keeps the ==x== marker but reports the color lossy", () => {
    const doc = docWith("hi", [{ type: "highlight", attrs: { color: "yellow" } }]);
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toContain("==hi==");
    expect(lossy.some((l) => l.reason === "highlight-color")).toBe(true);
  });

  it("textColor has no markdown form -- text is kept, mark is reported lossy", () => {
    const doc = docWith("hi", [{ type: "textColor", attrs: { color: "red" } }]);
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toContain("hi");
    expect(markdown).not.toContain("<span");
    expect(lossy.some((l) => l.reason === "text-color")).toBe(true);
  });
});

describe("marks: HTML serde", () => {
  it("toHTML emits <u>/<sub>/<sup>, <mark data-jul-editor-highlight>, <span data-jul-editor-color>", () => {
    const underline = toHTML(docWith("a", [{ type: "underline" }]));
    expect(underline).toContain("<u>a</u>");
    const sub = toHTML(docWith("a", [{ type: "subscript" }]));
    expect(sub).toContain("<sub>a</sub>");
    const sup = toHTML(docWith("a", [{ type: "superscript" }]));
    expect(sup).toContain("<sup>a</sup>");
    const highlightPlain = toHTML(docWith("a", [{ type: "highlight" }]));
    expect(highlightPlain).toContain("<mark>a</mark>");
    const highlightColor = toHTML(docWith("a", [{ type: "highlight", attrs: { color: "yellow" } }]));
    expect(highlightColor).toContain('<mark data-jul-editor-highlight="yellow">a</mark>');
    const color = toHTML(docWith("a", [{ type: "textColor", attrs: { color: "red" } }]));
    expect(color).toContain('<span data-jul-editor-color="red">a</span>');
  });

  it("fromHTML reads <u>/<sub>/<sup> back as their marks", () => {
    const { doc } = fromHTML("<p><u>a</u> <sub>b</sub> <sup>c</sup></p>");
    const content = doc.blocks[0]!.content!;
    const a = content.find((inl) => "text" in inl && (inl as TextInline).text === "a") as TextInline;
    const b = content.find((inl) => "text" in inl && (inl as TextInline).text === "b") as TextInline;
    const c = content.find((inl) => "text" in inl && (inl as TextInline).text === "c") as TextInline;
    expect(a.marks?.some((m) => m.type === "underline")).toBe(true);
    expect(b.marks?.some((m) => m.type === "subscript")).toBe(true);
    expect(c.marks?.some((m) => m.type === "superscript")).toBe(true);
  });

  it("fromHTML reads our own data-jul-editor-color/data-jul-editor-highlight attributes back with the color", () => {
    const html = '<p><span data-jul-editor-color="red">a</span> <mark data-jul-editor-highlight="yellow">b</mark></p>';
    const { doc } = fromHTML(html);
    const content = doc.blocks[0]!.content!;
    const a = content.find((inl) => "text" in inl && (inl as TextInline).text === "a") as TextInline;
    const b = content.find((inl) => "text" in inl && (inl as TextInline).text === "b") as TextInline;
    expect(a.marks).toEqual([{ type: "textColor", attrs: { color: "red" } }]);
    expect(b.marks).toEqual([{ type: "highlight", attrs: { color: "yellow" } }]);
  });

  it("a bare third-party <span> (no data-jul-editor-color) is NOT treated as a textColor mark", () => {
    const { doc } = fromHTML('<p><span class="Foo">plain</span></p>');
    const content = doc.blocks[0]!.content!;
    const plain = content.find((inl) => "text" in inl && (inl as TextInline).text === "plain") as TextInline;
    expect(plain.marks ?? []).toEqual([]);
  });

  it("a bare <mark> (no color attribute) is still a legitimate default-color highlight", () => {
    const { doc } = fromHTML("<p><mark>hi</mark></p>");
    const content = doc.blocks[0]!.content!;
    const hi = content.find((inl) => "text" in inl && (inl as TextInline).text === "hi") as TextInline;
    expect(hi.marks).toEqual([{ type: "highlight" }]);
  });
});
