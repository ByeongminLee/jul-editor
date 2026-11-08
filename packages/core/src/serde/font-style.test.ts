// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { normalizeDoc } from "../model/canonical.js";
import { fontFamilyCss, sanitizeFontFamily, sanitizeFontSize } from "../model/font-style.js";
import type { Doc } from "../model/types.js";
import { fromHTML } from "./from-html.js";
import { fromMarkdown } from "./from-markdown.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";

const styled: Doc = {
  version: 1,
  blocks: [
    {
      id: "p",
      type: "paragraph",
      props: { textAlign: "center", backgroundColor: "yellow", textColor: "blue" },
      content: [{ type: "text", text: "Hi", marks: [{ type: "fontFamily", attrs: { family: "Noto Sans KR" } }, { type: "fontSize", attrs: { size: "14pt" } }] }, { type: "text", text: " there" }],
    },
  ],
};

describe("sanitizers", () => {
  it("fontFamily keeps plain names and generics, takes the first of a list, rejects injection", () => {
    expect(sanitizeFontFamily("Arial")).toBe("Arial");
    expect(sanitizeFontFamily('"Times New Roman", serif')).toBe("Times New Roman");
    expect(sanitizeFontFamily("Sans-Serif")).toBe("sans-serif");
    expect(sanitizeFontFamily("맑은 고딕")).toBe("맑은 고딕");
    for (const bad of ['a;b:c', "x}body{", "url(javascript:1)", 'a"b', "", 5, null, "a\\b", "<script>", "a".repeat(80)]) expect(sanitizeFontFamily(bad)).toBeNull();
    expect(fontFamilyCss("Arial")).toBe('"Arial"');
    expect(fontFamilyCss("serif")).toBe("serif");
  });
  it("fontSize accepts bounded units only", () => {
    expect(sanitizeFontSize("14pt")).toBe("14pt");
    expect(sanitizeFontSize(" 1.5EM ")).toBe("1.5em");
    expect(sanitizeFontSize(18)).toBe("18px");
    for (const bad of ["0px", "-3px", "9999px", "14", "14pt;x", "calc(1px)", "1e3px", "", null, "400.5px"]) expect(sanitizeFontSize(bad)).toBeNull();
  });
});

describe("font marks and block style props through serde", () => {
  it("toHTML writes inline styles and block attributes; fromHTML restores them", () => {
    const html = toHTML(styled);
    expect(html).toContain('<span style="font-family:&quot;Noto Sans KR&quot;">');
    expect(html).toContain("font-size:14pt");
    expect(html).toContain('<p style="text-align:center" data-jul-editor-text-align="center" data-jul-editor-block-color="blue" data-jul-editor-block-bg="yellow"');
    const back = fromHTML(html).doc;
    expect(back.blocks[0]!.props).toEqual({ textAlign: "center", textColor: "blue", backgroundColor: "yellow" });
    expect(back.blocks[0]!.content![0]).toMatchObject({ text: "Hi", marks: expect.arrayContaining([{ type: "fontFamily", attrs: { family: "Noto Sans KR" } }, { type: "fontSize", attrs: { size: "14pt" } }]) });
  });

  it("reads Word/Google Docs style spans and text-align, ignoring unsafe values", () => {
    const html = '<p style="text-align: justify"><span style="font-family: Calibri, sans-serif; font-size: 11pt">a</span><span style="font-family: url(x)">b</span><span style="color:red">c</span></p><h2 style="text-align:evil">t</h2>';
    const d = fromHTML(html).doc;
    expect(d.blocks[0]!.props).toEqual({ textAlign: "justify" });
    expect(d.blocks[0]!.content).toEqual([
      { type: "text", text: "a", marks: [{ type: "fontFamily", attrs: { family: "Calibri" } }, { type: "fontSize", attrs: { size: "11pt" } }] },
      { type: "text", text: "bc" },
    ]);
    expect(d.blocks[1]!.props).toEqual({ level: 2 });
  });

  it("markdown drops them silently and keeps the text", () => {
    const r = toMarkdown(styled);
    expect(r.markdown).toBe("Hi there");
    expect(r.lossy).toEqual([]);
    expect(fromMarkdown(r.markdown).doc.blocks[0]!.content).toEqual([{ type: "text", text: "Hi there" }]);
  });

  it("normalization drops invalid mark values and invalid block style props", () => {
    const d = normalizeDoc(
      {
        version: 1,
        blocks: [{ id: "a", type: "paragraph", props: { textAlign: "diagonal", textColor: "#fff" }, content: [{ type: "text", text: "x", marks: [{ type: "fontFamily", attrs: { family: "a;b" } }, { type: "fontSize", attrs: { size: "12PT" } }] }] }],
      },
      coreRegistry,
    );
    expect(d.blocks[0]!.props).toEqual({});
    expect(d.blocks[0]!.content).toEqual([{ type: "text", text: "x", marks: [{ type: "fontSize", attrs: { size: "12pt" } }] }]);
  });
});
