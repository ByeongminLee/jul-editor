// Adversarial repros: markdown / HTML serde. Every test asserts the
// CORRECT behavior and is expected to FAIL on current code. The round-trip
// invariant is: for blocks toMarkdown reports as
// non-lossy, fromMarkdown(toMarkdown(doc)).doc must equal doc (ids ignored).
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { canonicalStringify, normalizeDoc } from "../model/canonical.js";
import type { Block, Doc, Inline } from "../model/types.js";
import { fromMarkdown } from "../serde/from-markdown.js";
import { toMarkdown } from "../serde/to-markdown.js";

let n = 0;
const B = (type: string, content: Inline[] | undefined, props: Record<string, unknown> = {}, children?: Block[]): Block =>
  ({ id: `b${n++}`, type, props, ...(content ? { content } : {}), ...(children ? { children } : {}) }) as Block;
const T = (text: string, ...marks: string[]): Inline => (marks.length ? { type: "text", text, marks: marks.map((type) => ({ type })) } : { type: "text", text });

function strip(b: Block): unknown {
  const { id: _id, children, ...rest } = b;
  return children ? { ...rest, children: children.map(strip) } : rest;
}
const canon = (d: Doc) => canonicalStringify(normalizeDoc(d, coreRegistry).blocks.map(strip));

/** Asserts toMarkdown reports nothing lossy AND the doc survives md -> doc. */
function expectRoundTrip(blocks: Block[]) {
  const doc: Doc = { version: 1, blocks };
  const { markdown, lossy } = toMarkdown(doc);
  expect(lossy, "toMarkdown claims lossless").toEqual([]);
  const back = fromMarkdown(markdown).doc;
  expect(canon(back), `markdown was: ${JSON.stringify(markdown)}`).toBe(canon(doc));
}

describe("markdown round-trip corruption (no lossy reported)", () => {
  it("intraword italic (Korean: 한글 + _강조_ + 다음) loses the italic mark", () => {
    expectRoundTrip([B("paragraph", [T("이것은 "), T("강조", "italic"), T("입니다")])]);
  });

  it("intraword italic (English foo_bar_baz) loses the italic mark", () => {
    expectRoundTrip([B("paragraph", [T("foo"), T("bar", "italic"), T("baz")])]);
  });

  it('bold ending in punctuation directly followed by CJK ("인용"이라고) is emitted as literal asterisks', () => {
    expectRoundTrip([B("paragraph", [T('"인용"', "bold"), T("이라고 했다")])]);
  });

  it("bold run starting with a space (a** b**) is emitted as literal asterisks", () => {
    expectRoundTrip([B("paragraph", [T("a"), T(" b", "bold")])]);
  });

  it("plain text '~~x~~' and '~x~' gain a strike mark (tilde not escaped)", () => {
    expectRoundTrip([B("paragraph", [T("a ~~b~~ c ~d~ e")])]);
  });

  it("plain text '<https://x.com>' becomes a link and loses its angle brackets; 'www.x.com' gains a link", () => {
    expectRoundTrip([B("paragraph", [T("see <https://x.com> or www.example.com")])]);
  });

  it("a paragraph starting with '<!--' swallows every following block into one paragraph", () => {
    expectRoundTrip([B("paragraph", [T("<!-- draft note")]), B("paragraph", [T("second")]), B("heading", [T("Title")], { level: 2 })]);
  });

  it("a heading containing a hard break splits into heading + paragraph", () => {
    expectRoundTrip([B("heading", [T("line one\nline two")], { level: 2 })]);
  });

  it("a paragraph line that is '~~~' opens a fenced code block", () => {
    expectRoundTrip([B("paragraph", [T("before\n~~~\nafter")])]);
  });

  it("empty paragraphs between blocks are silently dropped", () => {
    expectRoundTrip([B("paragraph", [T("a")]), B("paragraph", []), B("paragraph", [T("b")])]);
  });

  it("an empty to-do item becomes a bullet item with literal text '[x]'", () => {
    expectRoundTrip([B("todoListItem", [], { checked: true }), B("todoListItem", [])]);
  });

  it("an empty list item with a nested child loses the nesting (child lifted, text gets leading spaces)", () => {
    expectRoundTrip([B("bulletListItem", [], {}, [B("paragraph", [T("child")])])]);
  });

  it("an empty quote whose first child is a paragraph collapses the child into the quote's own content", () => {
    expectRoundTrip([B("quote", [], {}, [B("paragraph", [T("child")])])]);
  });

  // Design decision (interop): diagram now exports
  // as ```mermaid (not ```jul-editor-mermaid) so GitHub/Notion render it natively.
  // That reclaims the plain "mermaid" fence from codeBlock, so a codeBlock
  // tagged language 'mermaid' is no longer round-trip-safe: it exports as
  // ```mermaid and re-imports as a diagram block. toMarkdown must report
  // that type change as lossy instead of claiming a silent, lossless round
  // trip.
  it("a codeBlock with language 'mermaid' is exported as ```mermaid and reported lossy (re-imports as diagram)", () => {
    const doc: Doc = { version: 1, blocks: [B("codeBlock", [T("graph TD; A-->B")], { language: "mermaid" })] };
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toContain("```mermaid\ngraph TD; A-->B\n```");
    expect(lossy).toEqual([{ blockId: doc.blocks[0]!.id, type: "codeBlock", reason: "mermaid-code-becomes-diagram" }]);
    const back = fromMarkdown(markdown).doc;
    expect(back.blocks[0]!.type).toBe("diagram");
  });

  it("tabs in a code block nested in a list item are expanded to spaces", () => {
    expectRoundTrip([B("bulletListItem", [T("item")], {}, [B("codeBlock", [T("func() {\n\treturn 1\n}")], { language: "go" })])]);
  });

  it("image alt containing '*' gains a literal backslash", () => {
    expectRoundTrip([B("image", undefined, { src: "https://x.com/a.png", alt: "5*3 chart" }), B("paragraph", [])]);
  });
});

describe("fromMarkdown on hostile input", () => {
  it("2000 nested '>' (2 KB) must not throw (stack overflow)", () => {
    expect(() => fromMarkdown(">".repeat(2000) + " x")).not.toThrow();
  });

  it("30 KB of '*a ' must parse in well under 1s (quadratic emphasis scan)", () => {
    const t = performance.now();
    fromMarkdown("*a ".repeat(10000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("extensibility: custom mark markdown escaping", () => {
  it("with a custom '==highlight==' mark registered, plain text 'a==b==' gains a highlight mark (escaping is not registry-driven)", async () => {
    const { createRegistry, defineMark } = await import("../model/schema.js");
    const { coreBlocks, coreInlines, coreMarks } = await import("../model/builtins.js");
    const highlight = defineMark({ type: "highlight", markdown: { open: "==", close: "==", parse: { start: "==", tokenizer: /^==([^=\n]+)==/ } } });
    const registry = createRegistry({ blocks: coreBlocks, inlines: coreInlines, marks: [...coreMarks, highlight] });
    const d: Doc = { version: 1, blocks: [B("paragraph", [T("x ==y== z")])] };
    const back = fromMarkdown(toMarkdown(d, { registry }).markdown, { registry }).doc;
    expect(back.blocks[0]!.content).toEqual([{ type: "text", text: "x ==y== z" }]);
  });
});
