// @vitest-environment jsdom
// Adversarial tests for the v2 features: each test asserts the CORRECT behavior and is
// expected to FAIL on the current code, demonstrating a defect in a v2
// feature.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { validateDoc } from "../model/validate.js";
import type { Block, Doc, Inline } from "../model/types.js";
import { fromHTML } from "../serde/from-html.js";
import { toMarkdown } from "../serde/to-markdown.js";
import { tableGrid } from "../store/table.js";
import { createEditor } from "../view/editor.js";
import type { Editor } from "../view/editor.js";
import { promoteSelection } from "../view/selection.js";
import { BLOCK_ATTR, CELL_SELECTED_ATTR, CONTENT_ATTR, EMPTY_ATTR, ID_ATTR } from "../view/dom.js";
import type { Highlighter } from "../view/highlight.js";

const t = (text: string, marks?: { type: string; attrs?: Record<string, string> }[]): Inline => (marks ? { type: "text", text, marks } : { type: "text", text }) as Inline;
const para = (id: string, text: string, children?: Block[]): Block => ({ id, type: "paragraph", props: {}, content: text ? [t(text)] : [], ...(children ? { children } : {}) });
const cell = (id: string, text: string, props: Record<string, number> = {}): Block => ({ id, type: "tableCell", props, content: text ? [t(text)] : [] });
const row = (id: string, cells: Block[]): Block => ({ id, type: "tableRow", props: {}, children: cells });

function mk(blocks: Block[]): { editor: Editor; root: HTMLElement } {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = createEditor({ element: root, registry: coreRegistry, defaultValue: { version: 1, blocks } });
  return { editor, root };
}
function caret(editor: Editor, blockId: string, offset: number, focusOffset = offset): void {
  editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId, offset }, focus: { blockId, offset: focusOffset } }));
}
function fire(root: HTMLElement, inputType: string, data?: string): void {
  root.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true } as InputEventInit));
}
function type(root: HTMLElement, s: string): void {
  for (const ch of s) fire(root, "insertText", ch);
}
function key(root: HTMLElement, k: string, mods: KeyboardEventInit = {}): void {
  root.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
}
function find(doc: Doc, id: string): Block | undefined {
  const walk = (bs: Block[]): Block | undefined => {
    for (const b of bs) {
      if (b.id === id) return b;
      const f = b.children && walk(b.children);
      if (f) return f;
    }
    return undefined;
  };
  return walk(doc.blocks);
}
function textOf(b: Block | undefined): string {
  return (b?.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : `@${(i as { attrs: { label: string } }).attrs.label}`)).join("");
}
function allIds(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (bs: Block[]) => bs.forEach((b) => (out.push(b.id), b.children && walk(b.children)));
  walk(doc.blocks);
  return out;
}
function wrapper(root: HTMLElement, id: string): HTMLElement {
  return root.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${id}"]`) as HTMLElement;
}
function pasteEvent(text: string): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (f: string) => (f === "text/plain" ? text : ""), files: [] } });
  return ev;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- CSS Custom Highlight API stand-in (same shape as view/highlight.test.ts) ----
class FakeHighlight {
  ranges = new Set<Range>();
  add(r: Range): void {
    this.ranges.add(r);
  }
  delete(r: Range): boolean {
    return this.ranges.delete(r);
  }
}
const named = new Map<string, FakeHighlight>();
beforeAll(() => {
  (globalThis as unknown as { Highlight: unknown }).Highlight = FakeHighlight;
  (globalThis as unknown as { CSS: unknown }).CSS = {
    highlights: { set: (n: string, h: FakeHighlight) => named.set(n, h), get: (n: string) => named.get(n), delete: (n: string) => named.delete(n) },
  };
});
/** Every Range currently registered under jul-editor-keyword whose text lives inside `root`. */
function keywordRanges(root: HTMLElement): Range[] {
  return [...(named.get("jul-editor-keyword")?.ranges ?? [])].filter((r) => root.contains(r.startContainer));
}
const wholeKeyword: Highlighter = { highlight: (code) => (code.length ? [{ from: 0, to: code.length, token: "keyword" }] : []) };

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

// =============================================================================
describe("input rules", () => {
  it("'# ' on the second line of a paragraph (after Shift+Enter) never deletes the first line's text", () => {
    const { editor, root } = mk([para("p1", "foo")]);
    caret(editor, "p1", 3);
    fire(root, "insertLineBreak");
    type(root, "# ");
    const b = find(editor.getDoc(), "p1");
    expect(textOf(b)).toContain("foo");
  });

  it("'```' on the second line of a paragraph never deletes the first line's text", () => {
    const { editor, root } = mk([para("p1", "foo")]);
    caret(editor, "p1", 3);
    fire(root, "insertLineBreak");
    type(root, "```");
    expect(textOf(find(editor.getDoc(), "p1"))).toContain("foo");
  });

  it("'---' + Enter on the second line of a paragraph never deletes the first line's text", () => {
    const { editor, root } = mk([para("p1", "foo")]);
    caret(editor, "p1", 3);
    fire(root, "insertLineBreak");
    type(root, "---");
    fire(root, "insertParagraph");
    const all = editor.getDoc().blocks.map(textOf).join("|");
    expect(all).toContain("foo");
  });

  it("a plain language-less codeBlock keeps its text when Space is pressed after a single word (no silent language grab)", () => {
    const { editor, root } = mk([{ id: "c1", type: "codeBlock", props: {}, content: [t("npm")] }, para("p2", "")]);
    caret(editor, "c1", 3);
    key(root, " ");
    const c = find(editor.getDoc(), "c1")!;
    expect(textOf(c)).toContain("npm");
    expect(c.props.language ?? "").toBe("");
  });

  it("a plain language-less codeBlock keeps its text when Enter is pressed after a single word", () => {
    const { editor, root } = mk([{ id: "c1", type: "codeBlock", props: {}, content: [t("return")] }, para("p2", "")]);
    caret(editor, "c1", 6);
    key(root, "Enter");
    expect(textOf(find(editor.getDoc(), "c1"))).toContain("return");
  });

  it("Backspace right after the instant '---' divider conversion undoes it (like every other input rule)", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    type(root, "---");
    expect(editor.getDoc().blocks[0]!.type).toBe("divider");
    key(root, "Backspace");
    const first = editor.getDoc().blocks[0]!;
    expect(first.type).toBe("paragraph");
    expect(textOf(first)).toBe("---");
  });

  it("text typed right after an inline `code` input rule is NOT inside the code mark", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    type(root, "`x`");
    type(root, "y");
    const content = find(editor.getDoc(), "p1")!.content!;
    const y = content.find((i) => i.type === "text" && (i as { text: string }).text.includes("y")) as { marks?: { type: string }[] };
    expect(y.marks ?? []).not.toContainEqual({ type: "code" });
  });

  it("autolink on type leaves trailing sentence punctuation out of the link", () => {
    const { editor, root } = mk([para("p1", "see https://example.com.")]);
    caret(editor, "p1", 24);
    type(root, " ");
    const content = find(editor.getDoc(), "p1")!.content! as { text: string; marks?: { type: string; attrs?: { href: string } }[] }[];
    const link = content.find((i) => i.marks?.some((m) => m.type === "link"));
    expect(link?.text).toBe("https://example.com");
    expect(link?.marks?.find((m) => m.type === "link")?.attrs?.href).toBe("https://example.com");
  });

  it("'**' + mention + '**' never turns the mention into a literal U+FFFC character", () => {
    const mention = { type: "mention", attrs: { kind: "user", id: "u1", label: "Ann" } } as unknown as Inline;
    const { editor, root } = mk([{ id: "p1", type: "paragraph", props: {}, content: [t("**"), mention, t("*")] }]);
    caret(editor, "p1", 4);
    type(root, "*");
    const content = find(editor.getDoc(), "p1")!.content!;
    expect(content.some((i) => i.type === "mention")).toBe(true);
    expect(JSON.stringify(content)).not.toContain("￼");
  });

  it("'```' typed inside a table cell never turns the cell into a codeBlock (table structure stays valid)", () => {
    const table: Block = { id: "t", type: "table", props: {}, children: [row("r0", [cell("a", ""), cell("b", "")])] };
    const { editor, root } = mk([table, para("p", "")]);
    caret(editor, "a", 0);
    type(root, "```");
    const doc = editor.getDoc();
    expect(find(doc, "a")!.type).toBe("tableCell");
    expect(validateDoc(doc, coreRegistry)).toEqual([]);
  });
});

// =============================================================================
describe("autolink / embed paste", () => {
  it("pasting a URL over already-linked selected text updates the href instead of removing the link", () => {
    const { editor, root } = mk([{ id: "p1", type: "paragraph", props: {}, content: [t("docs", [{ type: "link", attrs: { href: "https://old.example" } }])] }]);
    caret(editor, "p1", 0, 4);
    root.dispatchEvent(pasteEvent("https://new.example"));
    const run = find(editor.getDoc(), "p1")!.content![0] as { marks?: { type: string; attrs?: { href: string } }[] };
    expect(run.marks?.find((m) => m.type === "link")?.attrs?.href).toBe("https://new.example");
  });

  it("text typed after a pasted autolink is not swallowed into the link", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    root.dispatchEvent(pasteEvent("https://example.com"));
    type(root, " next");
    const content = find(editor.getDoc(), "p1")!.content! as { text: string; marks?: { type: string }[] }[];
    const linked = content.filter((i) => i.marks?.some((m) => m.type === "link")).map((i) => i.text).join("");
    expect(linked).toBe("https://example.com");
  });

  it("paste-to-embed into an empty paragraph that has nested children keeps the children", () => {
    const { editor, root } = mk([para("p1", "", [para("kid", "child text")]), para("p2", "")]);
    caret(editor, "p1", 0);
    root.dispatchEvent(pasteEvent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    const doc = editor.getDoc();
    expect(find(doc, "p1")!.type).toBe("embed");
    expect(textOf(find(doc, "kid"))).toBe("child text");
  });
});

// =============================================================================
describe("security / model invariants", () => {
  it("setType to embed with a javascript: url never stores it (sanitizeBlockProps bypass) and never exports it", () => {
    const { editor } = mk([para("p1", ""), para("p2", "")]);
    editor.update((tx) => tx.setType("p1", "embed", { provider: "link", url: "javascript:alert(document.domain)", id: "", title: "x" }));
    const doc = editor.getDoc();
    expect(find(doc, "p1")!.type).toBe("embed");
    expect(String(find(doc, "p1")!.props.url ?? "")).not.toMatch(/javascript:/i);
    expect(toMarkdown(doc).markdown).not.toMatch(/javascript:/i);
  });

  it("commands.setBlockType('image', {src: 'javascript:...'}) never stores the unsafe src", () => {
    const { editor } = mk([para("p1", ""), para("p2", "")]);
    caret(editor, "p1", 0);
    editor.commands.setBlockType("image", { src: "javascript:alert(1)", alt: "" });
    expect(String(find(editor.getDoc(), "p1")!.props.src ?? "")).not.toMatch(/javascript:/i);
  });

  it("replaceBlock whose new children reuse an id that already exists elsewhere never duplicates that block", () => {
    const { editor } = mk([para("p1", "one"), para("p2", "two")]);
    editor.update((tx) => tx.replaceBlock("p1", { id: "p1", type: "paragraph", props: {}, content: [t("one")], children: [para("p2", "clone")] }));
    const ids = allIds(editor.getDoc());
    expect(ids.filter((i) => i === "p2").length).toBe(1);
  });

  it("color tokens from pasted HTML are restricted to the documented palette", () => {
    const { doc } = fromHTML('<p><span data-jul-editor-color="url(https://evil.example/x)">a</span><mark data-jul-editor-highlight="expression(alert(1))">b</mark></p>');
    const colors = (doc.blocks[0]!.content ?? []).flatMap((i) => ((i as { marks?: { attrs?: { color?: string } }[] }).marks ?? []).map((m) => m.attrs?.color ?? "default"));
    for (const c of colors) expect(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]).toContain(c);
  });

  it("an empty paragraph converted to a void (divider) drops its stale data-jul-editor-empty marker", () => {
    const { editor, root } = mk([para("p1", ""), para("p2", "x")]);
    expect(wrapper(root, "p1").hasAttribute(EMPTY_ATTR)).toBe(true);
    caret(editor, "p1", 0);
    editor.commands.setBlockType("divider");
    expect(find(editor.getDoc(), "p1")!.type).toBe("divider");
    expect(wrapper(root, "p1").hasAttribute(EMPTY_ATTR)).toBe(false);
  });
});

// =============================================================================
describe("code highlight controller", () => {
  it("setDoc with a codeBlock gets highlighted (setDoc emits an empty changedIds set, not undefined)", async () => {
    const { editor, root } = mk([para("p1", "")]);
    editor.registerHighlighter(wholeKeyword);
    editor.setDoc({ version: 1, blocks: [{ id: "c1", type: "codeBlock", props: { language: "ts" }, content: [t("const x")] }] });
    await sleep(120);
    expect(keywordRanges(root).length).toBe(1);
  });

  it("converting a highlighted codeBlock to a paragraph removes its syntax-highlight ranges", async () => {
    const { editor, root } = mk([{ id: "c1", type: "codeBlock", props: { language: "ts" }, content: [t("const x")] }, para("p2", "")]);
    editor.registerHighlighter(wholeKeyword);
    await sleep(120);
    expect(keywordRanges(root).length).toBe(1);
    editor.update((tx) => tx.setType("c1", "paragraph"));
    await sleep(120);
    expect(keywordRanges(root).length).toBe(0);
  });

  it("after an IME composition inside a codeBlock ends, the highlight is recomputed for the composed text", async () => {
    const { editor, root } = mk([{ id: "c1", type: "codeBlock", props: { language: "ts" }, content: [t("ab")] }, para("p2", "")]);
    editor.registerHighlighter(wholeKeyword);
    await sleep(120);
    expect(keywordRanges(root)[0]?.toString()).toBe("ab");
    const contentEl = wrapper(root, "c1").querySelector(`[${CONTENT_ATTR}]`)!;
    const textNode = contentEl.firstChild as Text;
    const s = window.getSelection()!;
    s.removeAllRanges();
    const r = document.createRange();
    r.setStart(textNode, 2);
    s.addRange(r);
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    textNode.appendData("cd"); // what the browser does to the DOM during composition
    root.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data: "cd" } as InputEventInit));
    await sleep(120); // composition lasts longer than the 50ms debounce
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "cd" }));
    await sleep(120);
    expect(textOf(find(editor.getDoc(), "c1"))).toBe("abcd");
    expect(keywordRanges(root)[0]?.toString()).toBe("abcd");
  });
});

// =============================================================================
describe("tables with merged cells", () => {
  // Built WITHOUT spans on load (see the normalizeDoc padding test below),
  // then merged in-session: grid (4 cols)  row0: [A A] B F   row1: C D E G
  function mergedEditor() {
    const table: Block = { id: "t", type: "table", props: {}, children: [row("r0", [cell("A", "a"), cell("A2", ""), cell("B", "b"), cell("F", "f")]), row("r1", [cell("C", "c"), cell("D", "d"), cell("E", "e"), cell("G", "g")])] };
    const m = mk([table, para("p", "")]);
    m.editor.update((tx) => tx.mergeCells("t", 0, 0, 0, 1));
    expect(find(m.editor.getDoc(), "A")!.props.colspan).toBe(2);
    return m;
  }

  it("a table with a merged cell survives a setDoc(getDoc()) round trip unchanged (normalizeDoc pads rows by childIds count)", () => {
    const { editor } = mergedEditor();
    const before = tableGrid(editor.getState().store, coreRegistry, "t").map((r) => r.length);
    editor.setDoc(editor.getDoc());
    const after = tableGrid(editor.getState().store, coreRegistry, "t").map((r) => r.length);
    expect(after).toEqual(before);
    expect(find(editor.getDoc(), "r0")!.children!.length).toBe(3);
  });

  it("a vertically merged table loaded from JSON gets no phantom cells", () => {
    // row0: A(rowspan 2) B    row1: (A) D   -- a valid 2x2 grid
    const table: Block = { id: "t", type: "table", props: {}, children: [row("r0", [cell("A", "a", { rowspan: 2 }), cell("B", "b")]), row("r1", [cell("D", "d")])] };
    const { editor } = mk([table, para("p", "")]);
    expect(find(editor.getDoc(), "r1")!.children!.length).toBe(1);
    expect(tableGrid(editor.getState().store, coreRegistry, "t")[1]!.length).toBe(2);
  });

  it("Backspace over a Shift+ArrowRight cells selection that starts right of a merge clears the cells it covers (grid vs childIds coordinates)", () => {
    const { editor, root } = mergedEditor();
    caret(editor, "B", 1);
    key(root, "ArrowRight", { shiftKey: true }); // B + F, grid cols 2..3
    expect(editor.getState().selection).toMatchObject({ type: "cells", anchor: [0, 2], focus: [0, 3] });
    key(root, "Backspace");
    const doc = editor.getDoc();
    expect(textOf(find(doc, "B"))).toBe("");
    expect(textOf(find(doc, "F"))).toBe("");
  });

  it("a keyboard cells selection right of a merge marks the cells it actually covers", () => {
    const { editor, root } = mergedEditor();
    caret(editor, "B", 1);
    key(root, "ArrowRight", { shiftKey: true });
    expect(wrapper(root, "B").hasAttribute(CELL_SELECTED_ATTR)).toBe(true);
    expect(wrapper(root, "F").hasAttribute(CELL_SELECTED_ATTR)).toBe(true);
  });

  it("drag-selecting F..G (the column right of a merge) then mergeCells merges exactly F and G", () => {
    const { editor } = mergedEditor();
    const promoted = promoteSelection(editor.getState().store, coreRegistry, { type: "text", anchor: { blockId: "F", offset: 0 }, focus: { blockId: "G", offset: 1 } });
    editor.update((tx) => tx.setSelection(promoted));
    editor.commands.mergeCells();
    const doc = editor.getDoc();
    expect(textOf(find(doc, "B"))).toBe("b"); // B was never selected
    expect(find(doc, "E")).toBeDefined();
    expect(find(doc, "F")!.props.rowspan).toBe(2);
  });

  it("deleting a row whose two rowspan cells relocate into the next row keeps every column in place", () => {
    // after merges -> row0: A(rs2) X B(rs2)   row1: (A) Y (B)   row2: p q r
    const table: Block = {
      id: "t",
      type: "table",
      props: {},
      children: [row("r0", [cell("A", "a"), cell("X", "x"), cell("B", "b")]), row("r1", [cell("A2", ""), cell("Y", "y"), cell("B2", "")]), row("r2", [cell("p", "p"), cell("q", "q"), cell("r", "r")])],
    };
    const { editor } = mk([table, para("after", "")]);
    editor.update((tx) => tx.mergeCells("t", 0, 0, 1, 0).mergeCells("t", 0, 2, 1, 2));
    expect(find(editor.getDoc(), "r1")!.children!.map((c) => c.id)).toEqual(["Y"]);
    caret(editor, "X", 0);
    editor.commands.deleteRow();
    const grid = tableGrid(editor.getState().store, coreRegistry, "t");
    expect(grid[0]!.map((g) => g?.cellId)).toEqual(["A", "Y", "B"]);
  });
});
