// @vitest-environment jsdom
// Clipboard codec: encode (Doc fragment -> 3 MIME payloads) and decode
// (DataTransfer-like -> Doc), priority order, untrusted-JSON handling.
import { describe, expect, it } from "vitest";
import { decodeClipboard, encodeClipboard, type DataTransferLike } from "./";
import { toJSON } from "../model/migrate.js";
import type { Doc, Inline, TextInline } from "../model/types.js";

function isText(inl: Inline): inl is TextInline {
  return inl.type === "text";
}
function plainText(content: Inline[] | undefined): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : "")).join("");
}

function fakeTransfer(data: Partial<Record<string, string>>, files: File[] = []): DataTransferLike {
  return {
    getData: (format: string) => data[format] ?? "",
    files,
  };
}

function collectIds(doc: Doc): string[] {
  const out: string[] = [];
  function walk(blocks: Doc["blocks"]) {
    for (const b of blocks) {
      out.push(b.id);
      if (b.children) walk(b.children);
    }
  }
  walk(doc.blocks);
  return out;
}

const sampleDoc: Doc = {
  version: 1,
  blocks: [
    { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }] },
    { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title" }] },
  ],
};

describe("encodeClipboard", () => {
  it("produces markdown, html and jul-editor json for the same fragment", () => {
    const out = encodeClipboard(sampleDoc);
    expect(out["text/plain"]).toContain("**Hello**");
    expect(out["text/plain"]).toContain("## Title");
    expect(out["text/html"]).toContain("<strong>Hello</strong>");
    expect(out["text/html"]).toContain("<h2");
    const parsed = JSON.parse(out["application/x-jul-editor+json"]) as Doc;
    expect(parsed.blocks).toHaveLength(2);
  });
});

describe("decodeClipboard: priority order", () => {
  it("prefers application/x-jul-editor+json over html and plain text", () => {
    const data = fakeTransfer({
      "application/x-jul-editor+json": toJSON(sampleDoc),
      "text/html": "<p>from html</p>",
      "text/plain": "from plain",
    });
    const { doc } = decodeClipboard(data);
    expect(plainText(doc.blocks[0]!.content)).toBe("Hello");
  });

  it("falls back to html when jul-editor json is absent", () => {
    const data = fakeTransfer({ "text/html": "<p>from <strong>html</strong></p>", "text/plain": "from plain" });
    const { doc } = decodeClipboard(data);
    expect(plainText(doc.blocks[0]!.content)).toBe("from html");
  });

  it("falls back to plain text when neither jul-editor json nor html is present", () => {
    const data = fakeTransfer({ "text/plain": "just plain text" });
    const { doc } = decodeClipboard(data);
    expect(doc.blocks[0]!.type).toBe("paragraph");
    expect(plainText(doc.blocks[0]!.content)).toBe("just plain text");
  });

  it("invalid jul-editor json falls back to html", () => {
    const data = fakeTransfer({
      "application/x-jul-editor+json": "{not valid json",
      "text/html": "<p>fallback html</p>",
    });
    const { doc } = decodeClipboard(data);
    expect(plainText(doc.blocks[0]!.content)).toBe("fallback html");
  });
});

describe("decodeClipboard: jul-editor json is untrusted", () => {
  it("reissues every block id (not just duplicates)", () => {
    const data = fakeTransfer({ "application/x-jul-editor+json": toJSON(sampleDoc) });
    const { doc } = decodeClipboard(data);
    const ids = collectIds(doc);
    expect(ids).not.toContain("p1");
    expect(ids).not.toContain("h1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sanitizes an unsafe href/src smuggled in through the JSON payload", () => {
    const malicious: Doc = {
      version: 1,
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        { id: "img1", type: "image", props: { src: "javascript:alert(1)", alt: "x" } },
      ],
    };
    const data = fakeTransfer({ "application/x-jul-editor+json": JSON.stringify(malicious) });
    const { doc } = decodeClipboard(data);
    const run = doc.blocks[0]!.content!.find((inl) => isText(inl)) as TextInline;
    expect(run.marks?.some((m) => m.type === "link") ?? false).toBe(false);
    expect(doc.blocks[1]!.props.src ?? "").toBe("");
  });
});

describe("decodeClipboard: plain text heuristic", () => {
  it("markdown-looking plain text is parsed as markdown", () => {
    const data = fakeTransfer({ "text/plain": "# A heading\n\nSome *text*" });
    const { doc } = decodeClipboard(data);
    expect(doc.blocks[0]!.type).toBe("heading");
  });

  it("bare plain text becomes one paragraph per line", () => {
    const data = fakeTransfer({ "text/plain": "line one\nline two" });
    const { doc } = decodeClipboard(data);
    expect(doc.blocks).toHaveLength(2);
    expect(plainText(doc.blocks[0]!.content)).toBe("line one");
    expect(plainText(doc.blocks[1]!.content)).toBe("line two");
  });
});

describe("decodeClipboard: files", () => {
  it("returns files so the caller can choose image or attachment blocks", () => {
    const img = new File(["x"], "a.png", { type: "image/png" });
    const txt = new File(["y"], "a.txt", { type: "text/plain" });
    const data = fakeTransfer({ "text/plain": "hi" }, [img, txt]);
    const { files } = decodeClipboard(data);
    expect(files).toHaveLength(2);
    expect(files[0]!.name).toBe("a.png");
  });
});

describe("decodeClipboard: markdown pasted from editors that also put html on the clipboard", () => {
  const md = "# Title\n\n- one\n- two\n\nSome **bold** text";
  const spanHtml = (t: string) => `<meta charset='utf-8'><div style="color:#ccc"><span style="color:#569cd6">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</span></div>`;

  it("VS Code (vscode-editor-data + span html) parses the plain markdown", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": spanHtml(md), "vscode-editor-data": '{"mode":"markdown"}' }));
    expect(doc.blocks[0]!.type).toBe("heading");
    expect(doc.blocks.filter((b) => b.type === "bulletListItem")).toHaveLength(2);
    const para = doc.blocks.find((b) => b.type === "paragraph")!;
    expect((para.content as TextInline[]).some((i) => i.marks?.some((m) => m.type === "bold"))).toBe(true);
  });

  it("vscode-editor-data wins even if the html text differs from the plain text", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": "<span>something else</span>", "vscode-editor-data": "{}" }));
    expect(doc.blocks[0]!.type).toBe("heading");
  });

  it("a non-semantic html wrapper (div/span/pre/br only) of the same text prefers markdown", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": `<pre>${md.replace(/</g, "&lt;")}</pre>` }));
    expect(doc.blocks[0]!.type).toBe("heading");
  });

  it("semantic html (GitHub rendered markdown) still goes through the html path", () => {
    const html = "<h1>Title</h1><ul><li>one</li><li>two</li></ul><p>Some <strong>bold</strong> text</p>";
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": html }));
    expect(doc.blocks[0]!.type).toBe("heading");
    expect(doc.blocks.filter((b) => b.type === "bulletListItem")).toHaveLength(2);
  });

  it("html wrapper whose text differs from the markdown plain text keeps the html path", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": "<div>totally different</div>" }));
    expect(plainText(doc.blocks[0]!.content)).toBe("totally different");
  });

  it("plain prose with html wrapper stays paragraphs", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": "just a - b and 2 * 3", "text/html": "<span>just a - b and 2 * 3</span>", "vscode-editor-data": "{}" }));
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.type).toBe("paragraph");
    expect(plainText(doc.blocks[0]!.content)).toBe("just a - b and 2 * 3");
  });

  it("plain: true (shift-paste) never converts markdown or html", () => {
    const { doc } = decodeClipboard(fakeTransfer({ "text/plain": md, "text/html": "<h1>x</h1>" }), { plain: true });
    expect(doc.blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(plainText(doc.blocks[0]!.content)).toBe("# Title");
  });
});

describe("looksLikeMarkdown heuristic (via decodeClipboard plain text)", () => {
  const types = (t: string) => decodeClipboard(fakeTransfer({ "text/plain": t })).doc.blocks.map((b) => b.type);
  it("block markers are strong signals", () => {
    expect(types("+ a\n+ b")).toEqual(["bulletListItem", "bulletListItem"]);
    expect(types("- [ ] a\n- [x] b")).toEqual(["todoListItem", "todoListItem"]);
    expect(types("1) a\n2) b")).toContain("orderedListItem");
    expect(types("a\n\n---\n\nb")).toContain("divider");
    expect(types("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("table");
  });
  it("inline markers need 2 hits or multiple lines", () => {
    expect(types("use `npm i` now")).toEqual(["paragraph"]);
    expect(types("a **bold** one")).toEqual(["paragraph"]);
    const one = decodeClipboard(fakeTransfer({ "text/plain": "**bold** and ~~gone~~" })).doc.blocks;
    expect(one).toHaveLength(1);
    expect((one[0]!.content as TextInline[]).some((i) => i.marks?.some((m) => m.type === "bold"))).toBe(true);
    const multi = decodeClipboard(fakeTransfer({ "text/plain": "intro\nthis is **bold**" })).doc.blocks;
    expect(multi.flatMap((b) => (b.content as TextInline[]) ?? []).some((i) => i.marks?.some((m) => m.type === "bold"))).toBe(true);
  });
  it("a single 'a - b' or lone asterisk line stays a paragraph", () => {
    expect(types("a - b")).toEqual(["paragraph"]);
    expect(types("2 * 3 = 6")).toEqual(["paragraph"]);
  });
});
