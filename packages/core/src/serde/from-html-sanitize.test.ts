// @vitest-environment jsdom
// fromHTML: real-world paste samples + nested structure + XSS vectors.
import { describe, expect, it } from "vitest";
import { fromHTML } from "./from-html.js";
import { toHTML } from "./to-html.js";
import { getProp } from "../model/canonical.js";
import { coreRegistry } from "../model/builtins.js";
import type { Block, Doc, Inline, TextInline } from "../model/types.js";

function isText(inl: Inline): inl is TextInline {
  return inl.type === "text";
}

function plainText(content: Inline[] | undefined): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : "")).join("");
}

function findByType(blocks: Block[], type: string): Block | undefined {
  for (const b of blocks) {
    if (b.type === type) return b;
    const found = b.children && findByType(b.children, type);
    if (found) return found;
  }
  return undefined;
}

describe("fromHTML: real-world paste samples", () => {
  it("Google Docs: <b style=font-weight:normal> wrapper is not bold, span 700/italic are marks", () => {
    const html =
      '<meta charset="utf-8">' +
      '<b style="font-weight:normal;" id="docs-internal-guid-1234">' +
      '<p dir="ltr">Hello <span style="font-weight:700">world</span></p>' +
      '<p dir="ltr">Second <span style="font-style:italic">paragraph</span></p>' +
      "</b>";
    const { doc } = fromHTML(html);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]!.type).toBe("paragraph");
    expect(plainText(doc.blocks[0]!.content)).toBe("Hello world");
    const bold = doc.blocks[0]!.content!.find((inl) => isText(inl) && inl.marks?.some((m) => m.type === "bold"));
    expect(bold).toBeDefined();
    expect(plainText(doc.blocks[1]!.content)).toBe("Second paragraph");
    const italic = doc.blocks[1]!.content!.find((inl) => isText(inl) && inl.marks?.some((m) => m.type === "italic"));
    expect(italic).toBeDefined();
  });

  it("inline <b style=font-weight:normal> directly overrides tag-default bold off", () => {
    const html = "<p><b style=\"font-weight:normal\">not bold</b> but <b>this is</b></p>";
    const { doc } = fromHTML(html);
    const content = doc.blocks[0]!.content!;
    const notBold = content.find((inl) => isText(inl) && inl.text.includes("not bold")) as TextInline;
    expect(notBold.marks ?? []).toEqual([]);
    const isBold = content.find((inl) => isText(inl) && inl.text.includes("this is")) as TextInline;
    expect(isBold.marks?.some((m) => m.type === "bold")).toBe(true);
  });

  it("Notion: nested bullet list becomes Notion-style children", () => {
    const html = "<ul><li>Item one<ul><li>Nested item</li></ul></li><li>Item two</li></ul>";
    const { doc } = fromHTML(html);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]!.type).toBe("bulletListItem");
    expect(plainText(doc.blocks[0]!.content)).toBe("Item one");
    expect(doc.blocks[0]!.children).toHaveLength(1);
    expect(plainText(doc.blocks[0]!.children![0]!.content)).toBe("Nested item");
    expect(plainText(doc.blocks[1]!.content)).toBe("Item two");
  });

  it("GitHub rendered markdown: table with thead, fenced code language, task list", () => {
    const html =
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>" +
      '<pre><code class="language-js">const x = 1;</code></pre>' +
      '<ul><li><input type="checkbox" checked disabled> Done</li><li><input type="checkbox" disabled> Todo</li></ul>';
    const { doc } = fromHTML(html);
    const table = findByType(doc.blocks, "table")!;
    // headerRow:true is the schema default, so it's omitted from props (the
    // codebase-wide "default props are omitted" convention) -- read it via
    // getProp, not table.props directly.
    expect(getProp(table, "headerRow", coreRegistry)).toBe(true);
    expect(table.children).toHaveLength(2);
    expect(plainText(table.children![0]!.children![0]!.content)).toBe("A");
    expect(plainText(table.children![1]!.children![1]!.content)).toBe("2");

    const code = findByType(doc.blocks, "codeBlock")!;
    expect(code.props.language).toBe("js");
    expect(plainText(code.content)).toBe("const x = 1;");

    const todos = doc.blocks.filter((b) => b.type === "todoListItem");
    expect(todos).toHaveLength(2);
    expect(todos[0]!.props.checked).toBe(true);
    expect(plainText(todos[0]!.content)).toBe("Done");
    expect(todos[1]!.props.checked ?? false).toBe(false);
  });

  it("MS Word: class/mso-* noise ignored, only font-weight/font-style read", () => {
    const html =
      '<p class="MsoNormal"><span style="font-weight:700">Bold</span> and ' +
      '<span style="mso-fareast-font-family:Calibri">normal</span></p>';
    const { doc } = fromHTML(html);
    const content = doc.blocks[0]!.content!;
    const bold = content.find((inl) => isText(inl) && inl.text === "Bold") as TextInline;
    expect(bold.marks?.some((m) => m.type === "bold")).toBe(true);
    // "and " and "normal" are adjacent, both mark-less text runs -- normalizeDoc
    // merges them into one run ("and normal" -- the leading run-edge trim of
    // "Bold"'s own block strips the leading space off " and ").
    const normal = content.find((inl) => isText(inl) && inl.text.endsWith("normal")) as TextInline;
    expect(normal).toBeDefined();
    expect(normal.marks ?? []).toEqual([]);
  });

  it("mention links: data-mention attribute and bare jul-editor: href both recognized", () => {
    const html =
      '<p>Hi <a data-mention data-kind="user" data-id="u1" href="jul-editor:user/u1">@Alice</a> and ' +
      '<a href="jul-editor:user/u2">@Bob</a>!</p>';
    const { doc } = fromHTML(html);
    const mentions = doc.blocks[0]!.content!.filter((inl) => inl.type === "mention");
    expect(mentions).toHaveLength(2);
    expect((mentions[0] as { attrs: { kind: string; id: string; label: string } }).attrs).toEqual({
      kind: "user",
      id: "u1",
      label: "Alice",
    });
    expect((mentions[1] as { attrs: { kind: string; id: string; label: string } }).attrs).toEqual({
      kind: "user",
      id: "u2",
      label: "Bob",
    });
  });

  it("blockquote splits leading paragraph as own content, rest as children", () => {
    const html = "<blockquote><p>quoted line</p><p>second para</p></blockquote>";
    const { doc } = fromHTML(html);
    expect(doc.blocks[0]!.type).toBe("quote");
    expect(plainText(doc.blocks[0]!.content)).toBe("quoted line");
    expect(doc.blocks[0]!.children).toHaveLength(1);
    expect(plainText(doc.blocks[0]!.children![0]!.content)).toBe("second para");
  });

  it("data: image src is never stored -- becomes a pendingUpload with src reset to ''", () => {
    const html = '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="pic"></p>';
    const { doc, pendingUploads } = fromHTML(html);
    const img = findByType(doc.blocks, "image")!;
    expect(img.props.src ?? "").toBe("");
    expect(pendingUploads).toHaveLength(1);
    expect(pendingUploads[0]!.dataUrl).toMatch(/^data:image\/png/);
    expect(pendingUploads[0]!.blockId).toBe(img.id);
  });
});

describe("fromHTML: XSS vectors -> clean model + toHTML output", () => {
  const VECTORS: string[] = [
    '<a href="javascript:alert(1)">click</a>',
    '<a href="JAVASCRIPT:alert(1)">click</a>',
    '<a href="   javascript:alert(1)">click</a>',
    '<a href="java&#09;script:alert(1)">click</a>',
    '<a href="&#x6a;avascript:alert(1)">click</a>',
    '<a href="&#106;avascript:alert(1)">click</a>',
    '<a href="vbscript:msgbox(1)">click</a>',
    '<a href="javascript&#58;alert(1)">click</a>',
    '<img src="javascript:alert(1)">',
    '<img src="data:text/html,<script>alert(1)</script>">',
    "<img src=x onerror=\"alert(1)\">",
    "<svg onload=\"alert(1)\"></svg>",
    "<script>alert(1)</script>",
    "text with <img src=x onerror=alert(1)> inline",
    '<iframe src="javascript:alert(1)"></iframe>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    "<style>body{background:url('javascript:alert(1)')}</style>",
    '<p style="expression(alert(1))">text</p>',
    '<a href="#" onclick="alert(1)">click</a>',
    '<form action="javascript:alert(1)"><input></form>',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<base href="javascript:alert(1)//">',
    '<a href="jul-editor:&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;/x">@mention</a>',
  ];

  expect(VECTORS.length).toBeGreaterThanOrEqual(20);

  function hasLiveOnHandler(html: string): boolean {
    const tags = html.match(/<[^>]*>/g) ?? [];
    return tags.some((tag) => /\bon(?:error|load|click)\s*=/i.test(tag.replace(/"[^"]*"/g, '""')));
  }

  for (const html of VECTORS) {
    it(`is safe: ${JSON.stringify(html.slice(0, 60))}`, () => {
      const { doc } = fromHTML(html);
      const serialized = JSON.stringify(doc);
      expect(serialized).not.toMatch(/javascript:|vbscript:/i);

      const out = toHTML(doc);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/(?:href|src)="[^"]*(?:javascript|vbscript):/i);
      expect(hasLiveOnHandler(out)).toBe(false);
    });
  }
});

describe("fromHTML: no injected DOMParser and no global -> clear error", () => {
  it("throws a helpful error", () => {
    const realDOMParser = globalThis.DOMParser;
    // @ts-expect-error -- deliberately removing the global for this assertion
    delete globalThis.DOMParser;
    try {
      expect(() => fromHTML("<p>x</p>")).toThrow(/DOMParser/);
    } finally {
      globalThis.DOMParser = realDOMParser;
    }
  });
});

describe("fromHTML: custom BlockSpec.fromHTML hook + data-jul-editor-props void figure", () => {
  it("round-trips a chart block through its own toHTML void-figure convention", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "ch1", type: "chart", props: { kind: "line", source: { type: "inline", csv: "x,y\n1,2" } } }],
    };
    const html = toHTML(doc);
    const { doc: back } = fromHTML(html);
    const chart = back.blocks[0]!;
    expect(chart.type).toBe("chart");
    expect(chart.props).toEqual({ kind: "line", source: { type: "inline", csv: "x,y\n1,2" } });
  });
});
