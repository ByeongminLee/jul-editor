import { describe, expect, it } from "vitest";
import { createRegistry, coreBlocks, coreInlines, coreMarks } from "@jul-editor/core";
import { fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import {
  DEFAULT_SETTINGS, PAGE_BREAK_HTML, applyPageTokens, blocksByPage, buildPrintCss, clampZoom, createPageBreak, normalizeSettings, pageBreak,
  pageDimensionsMm, pageGeometryPx, paginate, restorePageBreaks, splitPageTokens, exportDocx,
} from "./index.js";

const registry = createRegistry({ blocks: [...coreBlocks, pageBreak], inlines: coreInlines, marks: coreMarks });
const H = 100;
const opts = { contentHeight: 300, interPage: 50 };
const blocks = (n: number, h = H) => Array.from({ length: n }, () => ({ height: h }));

describe("paginate", () => {
  it("fits blocks on one page", () => {
    const r = paginate(blocks(3), opts);
    expect(r.pageCount).toBe(1);
    expect(r.blocks.map((b) => b.spacerBefore)).toEqual([0, 0, 0]);
    expect(r.blocks.map((b) => b.y)).toEqual([0, 100, 200]);
  });
  it("moves an overflowing block to the next page with a spacer", () => {
    const r = paginate([{ height: 200 }, { height: 150 }, { height: 100 }], opts);
    expect(r.pageCount).toBe(2);
    expect(r.blocks[1]).toMatchObject({ page: 1, spacerBefore: 100 + 50, y: 350 });
    expect(r.blocks[2]).toMatchObject({ page: 1, spacerBefore: 0, y: 500 });
    expect(blocksByPage(r)).toEqual([[0], [1, 2]]);
  });
  it("a block that exactly fills the page stays", () => {
    const r = paginate(blocks(4), opts);
    expect(r.blocks.map((b) => b.page)).toEqual([0, 0, 0, 1]);
  });
  it("breakAfter forces the next block to a fresh page", () => {
    const r = paginate([{ height: 100, breakAfter: true }, { height: 10 }, { height: 10 }], opts);
    expect(r.blocks.map((b) => b.page)).toEqual([0, 1, 1]);
    expect(r.blocks[1]!.spacerBefore).toBe(200 + 50);
  });
  it("two consecutive breaks do not create pages from nothing at page top", () => {
    const r = paginate([{ height: 10, breakAfter: true }, { height: 5, breakAfter: true }, { height: 5 }], opts);
    expect(r.blocks.map((b) => b.page)).toEqual([0, 1, 2]);
  });
  it("keepWithNext moves a heading with its follower", () => {
    const r = paginate([{ height: 200 }, { height: 50, keepWithNext: true }, { height: 100 }], opts);
    expect(r.blocks.map((b) => b.page)).toEqual([0, 1, 1]);
  });
  it("blocks taller than a page span pages", () => {
    const r = paginate([{ height: 50 }, { height: 700 }, { height: 20 }], opts);
    expect(r.blocks[1]).toMatchObject({ page: 1, endPage: 3 });
    expect(r.blocks[2]!.page).toBe(3);
    expect(r.pageCount).toBe(4);
  });
  it("empty doc has one page; bad contentHeight throws", () => {
    expect(paginate([], opts).pageCount).toBe(1);
    expect(() => paginate([], { contentHeight: 0, interPage: 0 })).toThrow();
  });
});

describe("settings", () => {
  it("defaults to A4 portrait 25.4mm margins", () => {
    expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.size).toBe("A4");
    expect(DEFAULT_SETTINGS.footer.text).toBe("{page} / {total}");
  });
  it("applies orientation and computes px geometry", () => {
    expect(pageDimensionsMm({ size: "Letter", orientation: "landscape" })).toEqual({ width: 279.4, height: 215.9 });
    const g = pageGeometryPx(DEFAULT_SETTINGS);
    expect(g.pageWidth).toBeCloseTo(793.7, 0);
    expect(g.contentHeight).toBeCloseTo(g.pageHeight - 2 * 96, 0);
  });
  it("sanitizes junk and clamps margins", () => {
    const s = normalizeSettings({ size: "Z" as never, margins: { top: 9999, bottom: 9999, left: -5, right: NaN as never } });
    expect(s.size).toBe("A4");
    expect(s.margins.left).toBe(0);
    expect(297 - s.margins.top - s.margins.bottom).toBeGreaterThanOrEqual(19.99);
  });
  it("clamps zoom to 40-200", () => {
    expect([clampZoom(10), clampZoom(250), clampZoom(95.4)]).toEqual([40, 200, 95]);
  });
  it("tokens", () => {
    expect(applyPageTokens("{page} / {total} {x}", 2, 5)).toBe("2 / 5 {x}");
    expect(splitPageTokens("p {page}")).toEqual([{ kind: "text", text: "p " }, { kind: "page" }]);
  });
  it("print css declares @page", () => {
    expect(buildPrintCss({ size: "A4", orientation: "landscape" })).toContain("@page { size: A4 landscape; margin: 0; }");
  });
});

describe("pageBreak serde", () => {
  const doc = { version: 1, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text" as const, text: "x" }] }, createPageBreak(), { id: "c", type: "paragraph", props: {}, content: [{ type: "text" as const, text: "y" }] }] };
  it("markdown out and back", () => {
    const { markdown } = toMarkdown(doc, { registry });
    expect(markdown).toContain("<!-- pagebreak -->");
    const back = fromMarkdown(markdown, { registry }).doc; // no post-pass: BlockSpec.fromMarkdownBlock
    expect(back.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    // the deprecated post-pass is a no-op on an already converted doc
    expect(restorePageBreaks(back).blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });
  it("accepts \\pagebreak", () => {
    const d = fromMarkdown("a\n\n\\pagebreak\n\nb", { registry }).doc;
    expect(d.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });
  it("html out", () => {
    expect(toHTML(doc, { registry })).toContain(PAGE_BREAK_HTML);
  });
});

describe("exportDocx (injected lib)", () => {
  const rec = (name: string) => class { constructor(public opts?: unknown) { void name; } };
  const lib = {
    Document: rec("Document"), Paragraph: rec("Paragraph"), TextRun: rec("TextRun"), Header: rec("Header"), Footer: rec("Footer"), PageBreak: rec("PageBreak"),
    Table: rec("Table"), TableRow: rec("TableRow"), TableCell: rec("TableCell"),
    Packer: { toBlob: async (d: unknown) => d as never },
    AlignmentType: { LEFT: "left", RIGHT: "right", CENTER: "center" }, HeadingLevel: { HEADING_1: "h1" },
    PageNumber: { CURRENT: "cur", TOTAL_PAGES: "tot" }, PageOrientation: { PORTRAIT: "p", LANDSCAPE: "l" },
  };
  it("builds a section with page size, margins and live page fields", async () => {
    const doc = { version: 1, blocks: [createPageBreak(), { id: "i", type: "image", props: {} }] };
    const { file, lossy } = await exportDocx(doc, { orientation: "landscape" }, { docxLib: lib as never });
    const sec = (file as { opts: { sections: { properties: { page: { size: { orientation: string; width: number } } } }[] } }).opts.sections[0]!;
    expect(sec.properties.page.size.orientation).toBe("l");
    expect(sec.properties.page.size.width).toBe(11906);
    expect(lossy.map((l) => l.type)).toEqual(["image"]);
  });

  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7L1m8AAAAASUVORK5CYII="; // 4x3
  const lib2 = { ...lib, ExternalHyperlink: rec("ExternalHyperlink"), ImageRun: rec("ImageRun"), AlignmentType: { ...lib.AlignmentType, JUSTIFIED: "both" } };
  const run = async (blocks: unknown[], extra: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
    const { file, lossy } = await exportDocx({ version: 1, blocks } as never, undefined, { docxLib: { ...lib2, ...extra } as never, ...o });
    const kids = (file as { opts: { sections: { children: { opts: Record<string, unknown> }[] }[] } }).opts.sections[0]!.children;
    return { kids, lossy };
  };
  const t = (text: string, marks: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: "text", text, marks });

  it("maps fontFamily, fontSize, textColor, highlight and link marks into runs", async () => {
    const { kids } = await run([
      { id: "a", type: "paragraph", props: {}, content: [
        t("styled", [{ type: "fontFamily", attrs: { family: "Arial" } }, { type: "fontSize", attrs: { size: "14pt" } }, { type: "textColor", attrs: { color: "red" } }, { type: "highlight", attrs: { color: "yellow" } }]),
        t("site", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ] },
    ]);
    const runs = (kids[0]!.opts.children as { opts: Record<string, unknown> }[]);
    expect(runs[0]!.opts).toMatchObject({ text: "styled", font: "Arial", size: 28, color: "D44C47", shading: { fill: "FBF3DB" } });
    expect(runs[1]!.opts).toMatchObject({ link: "https://example.com" });
    expect((runs[1]!.opts.children as { opts: { text: string } }[])[0]!.opts.text).toBe("site");
  });

  it("maps block textAlign to paragraph alignment", async () => {
    const { kids } = await run([
      { id: "a", type: "paragraph", props: { textAlign: "right" }, content: [] },
      { id: "b", type: "heading", props: { level: 1, textAlign: "justify" }, content: [] },
      { id: "c", type: "paragraph", props: {}, content: [] },
    ]);
    expect(kids.map((k) => k.opts.alignment)).toEqual(["right", "both", undefined]);
  });

  it("exports data URL images as ImageRun and keeps the lossy fallback otherwise", async () => {
    const { kids, lossy } = await run([
      { id: "i", type: "image", props: { src: tinyPng, width: null, align: "center", caption: "cap" } },
      { id: "j", type: "image", props: { src: "https://x.test/a.png" } },
    ]);
    const img = (kids[0]!.opts.children as { opts: { type: string; data: Uint8Array; transformation: { width: number; height: number } } }[])[0]!;
    expect(img.opts.type).toBe("png");
    expect(img.opts.data).toBeInstanceOf(Uint8Array);
    expect(img.opts.transformation).toEqual({ width: 4, height: 3 });
    expect(kids).toHaveLength(3); // image, caption, lossy placeholder
    expect(lossy.map((l) => l.blockId)).toEqual(["j"]);
  });

  it("uses resolveImage bytes for non data URL sources", async () => {
    const { kids, lossy } = await run([{ id: "j", type: "image", props: { src: "https://x.test/a.png", width: 100 } }], {}, {
      resolveImage: async () => ({ data: new Uint8Array([1]), type: "png", width: 200, height: 100 }),
    });
    const img = (kids[0]!.opts.children as { opts: { transformation: { width: number; height: number } } }[])[0]!;
    expect(img.opts.transformation).toEqual({ width: 100, height: 50 });
    expect(lossy).toEqual([]);
  });
});
