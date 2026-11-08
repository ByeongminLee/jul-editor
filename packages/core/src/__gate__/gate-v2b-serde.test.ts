// @vitest-environment jsdom
// Adversarial tests: serde of the v2 features. Every test
// asserts the CORRECT behavior and fails on current code.
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { normalizeDoc } from "../model/canonical.js";
import type { Block, Doc } from "../model/types.js";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "../serde";

const para = (content: Block["content"]): Doc => ({ version: 1, blocks: [{ id: "p", type: "paragraph", props: {}, content }] });
const one = (b: Block): Doc => ({ version: 1, blocks: [b] });
const HL = [{ type: "highlight", attrs: { color: "default" } }];
const textOf = (b: Block | undefined) => (b?.content ?? []).map((i) => ("text" in i ? i.text : "")).join("");
const hasMark = (b: Block | undefined, type: string) => (b?.content ?? []).some((i) => "marks" in i && i.marks?.some((m) => m.type === type));
const cell = (id: string, text: string, props: Record<string, number> = {}): Block => ({ id, type: "tableCell", props, content: [{ type: "text", text }] });
const shape = (t: Block) => t.children!.map((r) => r.children!.map((c) => `${textOf(c)}${c.props.colspan ? `/c${c.props.colspan}` : ""}${c.props.rowspan ? `/r${c.props.rowspan}` : ""}`));

describe("serde", () => {
  it("highlight over text containing '=' survives markdown (e.g. 'x = 1')", () => {
    const md = toMarkdown(para([{ type: "text", text: "x = 1", marks: HL }])).markdown;
    const b = fromMarkdown(md).doc.blocks[0];
    expect(textOf(b)).toBe("x = 1"); // observed: "==x = 1==" plain text
    expect(hasMark(b, "highlight")).toBe(true);
  });

  it("highlight spanning a hard break survives markdown", () => {
    const md = toMarkdown(para([{ type: "text", text: "a\nb", marks: HL }])).markdown;
    const b = fromMarkdown(md).doc.blocks[0];
    expect(textOf(b)).toBe("a\nb"); // observed: "==a\nb==" plain text
  });

  it("an x/link embed survives toHTML -> fromHTML (or is reported lossy); its link must not vanish", () => {
    const d = one({ id: "e", type: "embed", props: { provider: "link", url: "https://example.com/p", id: "", title: "T" } });
    const back = fromHTML(toHTML(d));
    const b = back.doc.blocks[0]!;
    const keptEmbed = b.type === "embed" && b.props.url === "https://example.com/p";
    const keptLink = hasMark(b, "link");
    expect(keptEmbed || keptLink).toBe(true); // observed: paragraph "T", no link mark, no lossy
  });

  it("a youtube embed with no title does not gain title 'youtube' through HTML", () => {
    const d = one({ id: "e", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } });
    const b = fromHTML(toHTML(d)).doc.blocks[0]!;
    expect(b.props.title ?? "").toBe("");
  });

  it("merged table cells round-trip through our own HTML without padding extra cells", () => {
    const t: Block = {
      id: "t",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("a", "A", { rowspan: 2 }), cell("c", "C")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("e", "E")] },
      ],
    };
    const back = fromHTML(toHTML(one(t))).doc.blocks[0]!;
    expect(shape(back)).toEqual(shape(t)); // observed: row 2 gains an empty cell -> grid becomes 3 columns wide
  });

  it("normalizeDoc keeps a valid merged table as-is (span-aware padding)", () => {
    const t: Block = {
      id: "t",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("a", "A", { colspan: 2 }), cell("c", "C")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("d", "D"), cell("e", "E"), cell("f", "F")] },
      ],
    };
    const n = normalizeDoc(one(t), coreRegistry).blocks[0]!;
    expect(shape(n)).toEqual(shape(t)); // observed: row 1 padded to 3 children -> 4 grid columns
  });

  it("hostile colspan/rowspan from pasted HTML are clamped to the table's real size", () => {
    const b = fromHTML('<table><tr><td colspan="99999">a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>').doc.blocks[0]!;
    const md = toMarkdown(one(b)).markdown;
    const cols = md.split("\n")[1]!.split("---").length - 1;
    expect(cols).toBeLessThanOrEqual(3); // observed: colspan 100 kept, markdown table 101 columns wide
  });

  it("fromHTML only accepts palette color tokens for textColor/highlight", () => {
    const b = fromHTML('<p><span data-jul-editor-color="url(x)">u</span><mark data-jul-editor-highlight="javascript:x">m</mark></p>').doc.blocks[0]!;
    const colors = (b.content ?? []).flatMap((i) => ("marks" in i ? (i.marks ?? []).map((m) => m.attrs?.color) : []));
    for (const c of colors) expect(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", undefined]).toContain(c);
  });

  it("fromHTML reads underline/sub/sup written as inline styles (Google Docs paste)", () => {
    const b = fromHTML('<p><span style="text-decoration:underline">u</span><span style="vertical-align:super">p</span><span style="vertical-align:sub">b</span></p>').doc.blocks[0]!;
    const marks = (b.content ?? []).map((i) => ("marks" in i ? (i.marks ?? []).map((m) => m.type).join() : ""));
    expect(marks).toEqual(["underline", "superscript", "subscript"]); // observed: plain "upb" (bold via style IS read)
  });

  it("underlined text containing a literal '</u>' survives markdown", () => {
    const md = toMarkdown(para([{ type: "text", text: "a</u>b", marks: [{ type: "underline" }] }])).markdown;
    const b = fromMarkdown(md).doc.blocks[0];
    expect(textOf(b)).toBe("a</u>b"); // observed: "a\\" underlined + "b</u>"
  });
});
