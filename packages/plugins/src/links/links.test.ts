// @vitest-environment jsdom
import { createEditor, createRegistry, coreBlocks, coreInlines, coreMarks, type Doc } from "@jul-editor/core";
import { fromHTML, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkBlocks } from "./blocks.js";
import { installUrlPaste, pasteChoicesFor, type PasteMenuRequest } from "./paste.js";

const policy = { allowedOrigins: ["https://example.com"] };
const registry = () => createRegistry({ blocks: [...coreBlocks, ...createLinkBlocks(policy)], inlines: coreInlines, marks: coreMarks });
const parser = () => new DOMParser();

describe("serde", () => {
  const bookmark: Doc = { version: 1, blocks: [{ id: "b", type: "bookmark", props: { url: "https://github.com/jul/editor", title: "jul/editor", description: "GitHub repository", image: "https://x.com/i.png", siteName: "github.com" } }] };
  it("bookmark: markdown is a lossy link line, html round trips", () => {
    const r = registry();
    const md = toMarkdown(bookmark, { registry: r });
    expect(md.markdown.trim()).toBe("[jul/editor](https://github.com/jul/editor)");
    expect(JSON.stringify(md.lossy)).toContain("bookmark-as-link");
    const html = toHTML(bookmark, { registry: r });
    expect(html).toContain('data-jul-editor-type="bookmark"');
    const back = fromHTML(html, { registry: r, parser: parser() }).doc.blocks[0]!;
    expect(back).toMatchObject({ type: "bookmark", props: bookmark.blocks[0]!.props });
  });
  it("bookmark: hostile href never becomes a block", () => {
    const html = '<div data-jul-editor-type="bookmark"><a href="javascript:alert(1)"><strong data-title>x</strong></a></div>';
    const doc = fromHTML(html, { registry: registry(), parser: parser() }).doc;
    expect(doc.blocks.some((b) => b.type === "bookmark")).toBe(false);
  });
  it("iframe: emits sandboxed iframe for providers and allowlisted origins, round trips", () => {
    const r = registry();
    for (const url of ["https://www.figma.com/design/AbCdEf1234567890/My-file", "https://example.com/app"]) {
      const doc: Doc = { version: 1, blocks: [{ id: "i", type: "iframe", props: { url, title: "T", height: 500 } }] };
      const html = toHTML(doc, { registry: r });
      expect(html).toContain("<iframe");
      expect(html).toContain("sandbox=");
      const back = fromHTML(html, { registry: r, parser: parser() }).doc.blocks[0]!;
      expect(back).toMatchObject({ type: "iframe", props: { url, title: "T", height: 500 } });
    }
  });
  it("iframe: a non-allowlisted url never produces an iframe (out or in)", () => {
    const r = registry();
    const doc: Doc = { version: 1, blocks: [{ id: "i", type: "iframe", props: { url: "https://evil.com/x", title: "" } }] };
    const html = toHTML(doc, { registry: r });
    expect(html).not.toContain("<iframe");
    expect(html).toContain('<a href="https://evil.com/x">');
    const hostile = '<div data-jul-editor-type="iframe"><iframe src="https://example.com.evil.com/x"></iframe></div>';
    expect(fromHTML(hostile, { registry: r, parser: parser() }).doc.blocks.some((b) => b.type === "iframe")).toBe(false);
  });
});

function pasteEvent(text: string): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (f: string) => (f === "text/plain" ? text : ""), files: [] } });
  return ev;
}

describe("paste menu", () => {
  let off: (() => void) | undefined;
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => off?.());

  function mount() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: registry(), defaultValue: { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] } });
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    return { element, editor };
  }
  // a void block gets a trailing empty paragraph from the editor, so compare the first block only.
  const types = (e: ReturnType<typeof mount>["editor"]) => [e.getDoc().blocks[0]!.type];

  it("offers Link/Bookmark/Mention for a plain url and adds Embed only when embeddable", () => {
    expect(pasteChoicesFor("https://example.com/a")).toEqual(["link", "bookmark", "mention"]);
    expect(pasteChoicesFor("https://youtu.be/dQw4w9WgXcQ")).toEqual(["link", "bookmark", "embed", "mention"]);
    expect(pasteChoicesFor("https://github.com/a/b")).not.toContain("embed");
  });

  it("menu mode: inserts a link, shows the menu, Bookmark converts, one undo returns to the link", async () => {
    const { element, editor } = mount();
    let req!: PasteMenuRequest;
    off = installUrlPaste({ onMenu: (r) => (req = r) });
    element.dispatchEvent(pasteEvent("https://github.com/jul/editor"));
    expect(req.options).toEqual(["link", "bookmark", "mention"]);
    expect(types(editor)).toEqual(["paragraph"]);
    expect(await req.choose("bookmark")).toBe(true);
    const b = editor.getDoc().blocks[0]!;
    expect(b).toMatchObject({ type: "bookmark", props: { url: "https://github.com/jul/editor", title: "jul/editor" } });
    editor.commands.undo();
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("Embed on figma makes an iframe block; on youtube makes core's embed block; non-embeddable is refused", async () => {
    for (const [url, type, ok] of [
      ["https://www.figma.com/design/AbCdEf1234567890/My-file", "iframe", true],
      ["https://youtu.be/dQw4w9WgXcQ", "embed", true],
      ["https://example.com/page", "paragraph", false],
    ] as const) {
      document.body.innerHTML = "";
      const { element, editor } = mount();
      let req!: PasteMenuRequest;
      off?.();
      off = installUrlPaste({ onMenu: (r) => (req = r) });
      element.dispatchEvent(pasteEvent(url));
      expect(await req.choose("embed")).toBe(ok);
      expect(types(editor)).toEqual([type]);
    }
  });

  it("Mention replaces the url with a mention chip and Link keeps the text", async () => {
    const { element, editor } = mount();
    let req!: PasteMenuRequest;
    off = installUrlPaste({ onMenu: (r) => (req = r) });
    element.dispatchEvent(pasteEvent("https://github.com/jul/editor/issues/5"));
    expect(await req.choose("mention")).toBe(true);
    expect(editor.getDoc().blocks[0]!.content).toEqual([{ type: "mention", attrs: { kind: "link", id: "https://github.com/jul/editor/issues/5", label: "jul/editor#5" } }]);
  });

  it("Mention label upgrades from fetchMetadata when it resolves", async () => {
    const { element, editor } = mount();
    let req!: PasteMenuRequest;
    off = installUrlPaste({ onMenu: (r) => (req = r), fetchMetadata: async () => ({ title: "Real Title" }) });
    element.dispatchEvent(pasteEvent("https://example.com/post"));
    await req.choose("mention");
    expect((editor.getDoc().blocks[0]!.content![0] as { attrs: { label: string } }).attrs.label).toBe("Real Title");
  });

  it("dismiss and Link keep the plain link; a stale choice is a no-op", async () => {
    const { element, editor } = mount();
    let req!: PasteMenuRequest;
    off = installUrlPaste({ onMenu: (r) => (req = r) });
    element.dispatchEvent(pasteEvent("https://example.com/a"));
    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 0 }, "XX"));
    expect(await req.choose("bookmark")).toBe(false);
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("defaultChoice bookmark converts immediately; link stays a link; native/no onMenu declines to core", () => {
    let m = mount();
    off = installUrlPaste({ defaultChoice: "bookmark" });
    m.element.dispatchEvent(pasteEvent("https://example.com/a"));
    return vi.waitFor(() => expect(types(m.editor)).toEqual(["bookmark"])).then(() => {
      off?.();
      document.body.innerHTML = "";
      m = mount();
      off = installUrlPaste({ defaultChoice: "link" });
      m.element.dispatchEvent(pasteEvent("https://example.com/a"));
      expect(types(m.editor)).toEqual(["paragraph"]);
      expect(m.editor.getDoc().blocks[0]!.content).toMatchObject([{ type: "text", marks: [{ type: "link" }] }]);
      off?.();
      document.body.innerHTML = "";
      m = mount();
      off = installUrlPaste({}); // menu mode without onMenu: declines, core's youtube paste-to-embed runs
      m.element.dispatchEvent(pasteEvent("https://youtu.be/dQw4w9WgXcQ"));
      expect(types(m.editor)).toEqual(["embed"]);
    });
  });

  it("javascript: and non-url pastes are ignored by the interceptor", () => {
    const { element, editor } = mount();
    off = installUrlPaste({ defaultChoice: "bookmark" });
    element.dispatchEvent(pasteEvent("javascript:alert(1)"));
    element.dispatchEvent(pasteEvent("two words https://a.com"));
    expect(types(editor)).not.toContain("bookmark");
  });
});
