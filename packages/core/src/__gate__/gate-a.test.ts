// @vitest-environment jsdom
// Adversarial tests: each test asserts the CORRECT behavior and is expected
// to FAIL on the current code, demonstrating a defect.
import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { validateDoc } from "../model/validate.js";
import type { Block, Doc } from "../model/types.js";
import { createEditor } from "../view/editor.js";
import type { Editor } from "../view/editor.js";
import { BLOCK_ATTR, CONTENT_ATTR, ID_ATTR, VOID_ATTR } from "../view/dom.js";

const t = (text: string) => ({ type: "text" as const, text });
const para = (id: string, text: string, children?: Block[]): Block => ({ id, type: "paragraph", props: {}, content: text ? [t(text)] : [], ...(children ? { children } : {}) });

function mk(blocks: Block[], extra: Partial<Parameters<typeof createEditor>[0]> = {}): { editor: Editor; root: HTMLElement } {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = createEditor({ element: root, registry: coreRegistry, defaultValue: { version: 1, blocks }, ...extra });
  return { editor, root };
}

function caret(editor: Editor, blockId: string, offset: number, focusOffset = offset, focusId = blockId): void {
  editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId, offset }, focus: { blockId: focusId, offset: focusOffset } }));
}

function fire(root: HTMLElement, inputType: string, data?: string): void {
  root.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true } as InputEventInit));
}

function key(root: HTMLElement, k: string, mods: KeyboardEventInit = {}): void {
  root.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
}

function wrapper(root: HTMLElement, id: string): HTMLElement {
  return root.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${id}"]`) as HTMLElement;
}

function textOf(doc: Doc, id: string): string | undefined {
  const find = (bs: Block[]): Block | undefined => {
    for (const b of bs) {
      if (b.id === id) return b;
      const f = b.children && find(b.children);
      if (f) return f;
    }
    return undefined;
  };
  const b = find(doc.blocks);
  return b ? (b.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "")).join("") : undefined;
}

function pasteEvent(data: Record<string, string>, files: File[] = []): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (f: string) => data[f] ?? "", files } });
  return ev;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("render / model-DOM divergence", () => {
  it("toggleMark over a range renders the mark in the DOM", () => {
    const { editor, root } = mk([para("p1", "hello")]);
    caret(editor, "p1", 0, 5);
    editor.commands.toggleMark("bold");
    expect(editor.getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "hello", marks: [{ type: "bold" }] }]);
    expect(wrapper(root, "p1").querySelector("strong")?.textContent).toBe("hello");
  });

  it("removing a mark (toggle off) removes it from the DOM", () => {
    const { editor, root } = mk([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }] }]);
    expect(wrapper(root, "p1").querySelector("strong")).not.toBeNull();
    caret(editor, "p1", 0, 5);
    editor.commands.toggleMark("bold");
    expect(editor.getDoc().blocks[0]!.content).toEqual([t("hello")]);
    expect(wrapper(root, "p1").querySelector("strong")).toBeNull();
  });

  it("'---' input rule leaves no editable content div inside the divider wrapper", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    fire(root, "insertText", "-");
    fire(root, "insertText", "-");
    fire(root, "insertText", "-");
    // "---" converts instantly on the 3rd dash (Notion) -- see
    // view/input-rules.ts's dividerRule.
    expect(editor.getDoc().blocks[0]!.type).toBe("divider");
    expect(wrapper(root, "p1").querySelector(`:scope > [${CONTENT_ATTR}]`)).toBeNull();
  });

  it("undo of '---' removes the stale void container from the restored paragraph", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    for (let i = 0; i < 3; i++) fire(root, "insertText", "-");
    expect(editor.getDoc().blocks[0]!.type).toBe("divider");
    editor.commands.undo();
    expect(editor.getDoc().blocks[0]!.type).toBe("paragraph");
    expect(wrapper(root, "p1").querySelector(`:scope > [${VOID_ATTR}]`)).toBeNull();
  });
});

describe("text editing edge input", () => {
  it("Backspace after an emoji (surrogate pair) removes the whole code point", () => {
    const { editor, root } = mk([para("p1", "a\u{1F600}")]);
    caret(editor, "p1", 3);
    fire(root, "deleteContentBackward");
    expect(textOf(editor.getDoc(), "p1")).toBe("a");
  });
});

describe("invalid structures reachable via UI", () => {
  it("Backspace-merging a list item with children into a preceding codeBlock never nests blocks inside the codeBlock", () => {
    const { editor, root } = mk([
      { id: "c1", type: "codeBlock", props: {}, content: [t("code")] },
      { id: "b1", type: "bulletListItem", props: {}, content: [t("x")], children: [{ id: "b2", type: "bulletListItem", props: {}, content: [t("child")] }] },
    ]);
    caret(editor, "b1", 0);
    key(root, "Backspace"); // bullet -> paragraph
    key(root, "Backspace"); // merge into codeBlock
    const doc = editor.getDoc();
    expect(validateDoc(doc, coreRegistry)).toEqual([]);
    expect(root.textContent).toContain("child"); // DOM must still show the child text the model keeps
  });

  it("Shift+Tab (outdent) on a nested codeBlock does not move its following siblings inside the codeBlock", () => {
    const { editor, root } = mk([
      {
        id: "b1",
        type: "bulletListItem",
        props: {},
        content: [t("a")],
        children: [
          { id: "c1", type: "codeBlock", props: {}, content: [t("x")] },
          para("p2", "after"),
        ],
      },
    ]);
    caret(editor, "c1", 0);
    key(root, "Tab", { shiftKey: true });
    expect(validateDoc(editor.getDoc(), coreRegistry)).toEqual([]);
    expect(root.textContent).toContain("after");
  });

  it("Escape then Backspace inside a table cell never deletes the cell (row keeps its column count)", () => {
    const cell = (id: string, text: string): Block => ({ id, type: "tableCell", props: {}, content: [t(text)] });
    const { editor, root } = mk([
      { id: "tb", type: "table", props: {}, children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A"), cell("a2", "B")] }, { id: "r2", type: "tableRow", props: {}, children: [cell("b1", "C"), cell("b2", "D")] }] },
      para("tail", ""),
    ]);
    caret(editor, "a1", 1);
    key(root, "Escape");
    key(root, "Backspace");
    const table = editor.getDoc().blocks[0]!;
    expect(table.children!.map((r) => r.children!.length)).toEqual([2, 2]);
    expect(textOf(editor.getDoc(), "a1")).toBe("A");
  });

  it("Escape then typing inside a table cell never puts a paragraph inside a tableRow", () => {
    const cell = (id: string, text: string): Block => ({ id, type: "tableCell", props: {}, content: [t(text)] });
    const { editor, root } = mk([
      { id: "tb", type: "table", props: {}, children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A"), cell("a2", "B")] }] },
      para("tail", ""),
    ]);
    caret(editor, "a1", 1);
    key(root, "Escape");
    key(root, "x");
    expect(validateDoc(editor.getDoc(), coreRegistry)).toEqual([]);
  });

  it("pasting untrusted jul-editor JSON with a root-level tableCell does not produce a cell outside a row", () => {
    const { editor, root } = mk([para("p1", "hi")]);
    caret(editor, "p1", 2);
    const evil = JSON.stringify({ version: 1, blocks: [{ id: "x", type: "tableCell", props: {}, content: [t("orphan")] }, { id: "y", type: "tableRow", props: {}, children: [] }] });
    root.dispatchEvent(pasteEvent({ "application/x-jul-editor+json": evil }));
    expect(validateDoc(editor.getDoc(), coreRegistry)).toEqual([]);
  });

  it("select-all (Mod+A twice) then Backspace leaves an editable empty paragraph, so typing still works", () => {
    const { editor, root } = mk([para("p1", "one"), para("p2", "two")]);
    caret(editor, "p1", 1);
    key(root, "a", { ctrlKey: true });
    key(root, "a", { ctrlKey: true });
    key(root, "Backspace");
    const doc = editor.getDoc();
    expect(doc.blocks.length).toBeGreaterThanOrEqual(1);
    expect(root.querySelector(`[${CONTENT_ATTR}]`)).not.toBeNull();
  });
});

describe("history", () => {
  it("toggling bold right after typing is its own undo step (undo keeps the typed text)", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    fire(root, "insertText", "a");
    fire(root, "insertText", "b");
    caret(editor, "p1", 0, 2);
    editor.commands.toggleMark("bold");
    editor.commands.undo();
    expect(textOf(editor.getDoc(), "p1")).toBe("ab");
  });

  it("a paste right after typing is its own undo step (undo keeps the typed text)", () => {
    const { editor, root } = mk([para("p1", "")]);
    caret(editor, "p1", 0);
    fire(root, "insertText", "a");
    fire(root, "insertText", "b");
    root.dispatchEvent(pasteEvent({ "text/plain": "XY" }));
    expect(textOf(editor.getDoc(), "p1")).toBe("abXY");
    editor.commands.undo();
    expect(textOf(editor.getDoc(), "p1")).toBe("ab");
  });

  it("Enter over a non-collapsed selection is ONE undo step", () => {
    const { editor, root } = mk([para("p1", "hello world")]);
    caret(editor, "p1", 5, 11);
    fire(root, "insertParagraph");
    expect(editor.getDoc().blocks.length).toBe(2);
    editor.commands.undo();
    expect(editor.getDoc().blocks.length).toBe(1);
    expect(textOf(editor.getDoc(), "p1")).toBe("hello world");
  });

  it("typing over a block selection is ONE undo step", () => {
    const { editor, root } = mk([para("p1", "keep me"), para("p2", "x")]);
    caret(editor, "p1", 2);
    key(root, "Escape");
    key(root, "z");
    editor.commands.undo();
    expect(textOf(editor.getDoc(), "p1")).toBe("keep me");
  });

  it("an image uploaded after paste keeps its src across undo+redo", async () => {
    const { editor, root } = mk([para("p1", "hi")], { onUpload: async () => ({ src: "https://cdn.example/x.png" }) });
    caret(editor, "p1", 2);
    root.dispatchEvent(pasteEvent({}, [new File([new Uint8Array([1])], "a.png", { type: "image/png" })]));
    await tick();
    await tick();
    const img = () => {
      const find = (bs: Block[]): Block | undefined => bs.find((b) => b.type === "image") ?? bs.map((b) => b.children && find(b.children)).find(Boolean);
      return find(editor.getDoc().blocks);
    };
    expect(img()?.props.src).toBe("https://cdn.example/x.png");
    editor.commands.undo();
    expect(img()).toBeUndefined();
    editor.commands.redo();
    expect(img()?.props.src).toBe("https://cdn.example/x.png");
  });
});

describe("focus / multi-editor", () => {
  it("a background commit (upload completion) does not steal the DOM selection from an outside input/editor", async () => {
    let resolve!: (v: { src: string }) => void;
    const { editor, root } = mk([para("p1", "hi")], { onUpload: () => new Promise((r) => (resolve = r)) });
    caret(editor, "p1", 2);
    root.dispatchEvent(pasteEvent({}, [new File([new Uint8Array([1])], "a.png", { type: "image/png" })]));
    // user moves on: selection now lives in an unrelated element outside the editor
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    window.getSelection()!.collapse(outside.firstChild!, 3);
    resolve({ src: "https://cdn.example/x.png" });
    await tick();
    await tick();
    expect(window.getSelection()!.anchorNode).toBe(outside.firstChild);
  });
});

describe("security", () => {
  it("setDoc with an unsanitized javascript: link never renders it into the live DOM", () => {
    const { editor, root } = mk([para("p1", "x")]);
    editor.setDoc({ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] });
    const href = root.querySelector("a")?.getAttribute("href") ?? "";
    expect(href).not.toMatch(/^\s*javascript:/i);
  });

  it("editor.update(insertBlock) with a javascript: link is sanitized at the model write", () => {
    const { editor } = mk([para("p1", "x")]);
    editor.update((tx) => tx.insertBlock(null, 1, { id: "evil", type: "paragraph", props: {}, content: [{ type: "text", text: "c", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }));
    const evil = editor.getDoc().blocks.find((b) => b.id === "evil")!;
    const href = (evil.content![0] as { marks?: { attrs?: { href?: string } }[] }).marks?.[0]?.attrs?.href ?? "";
    expect(href).not.toMatch(/^\s*javascript:/i);
  });
});

describe("partial render attrs / lifecycle / suggestions", () => {
  it("indenting a block with children updates its descendants' data-jul-editor-depth", () => {
    const { editor, root } = mk([para("p1", "a"), para("b2", "b", [para("c3", "c")])]);
    caret(editor, "b2", 0);
    key(root, "Tab");
    expect(editor.getDoc().blocks[0]!.children?.[0]?.id).toBe("b2");
    expect(wrapper(root, "b2").getAttribute("data-jul-editor-depth")).toBe("1");
    expect(wrapper(root, "c3").getAttribute("data-jul-editor-depth")).toBe("2");
  });

  it("converting the middle ordered item to a paragraph renumbers the following item", () => {
    const ol = (id: string, text: string): Block => ({ id, type: "orderedListItem", props: {}, content: [t(text)] });
    const { editor, root } = mk([ol("o1", "one"), ol("o2", "two"), ol("o3", "three")]);
    caret(editor, "o2", 0);
    key(root, "Backspace");
    expect(editor.getDoc().blocks[1]!.type).toBe("paragraph");
    expect(wrapper(root, "o3").getAttribute("data-jul-editor-index")).toBe("1");
  });

  it("editor.destroy() runs every renderVoid cleanup", () => {
    let destroyed = 0;
    const { editor } = mk([{ id: "d1", type: "divider", props: {} }, para("p1", "")], { renderVoid: () => () => void destroyed++ });
    editor.destroy();
    expect(destroyed).toBe(1);
  });

  it("undo closes an open slash suggestion whose trigger text it removed", () => {
    const { editor, root } = mk([para("p1", "")]);
    const states: { open: boolean }[] = [];
    // jsdom has no layout: stub the two Range rect APIs getCaretRect() reads.
    const rp = Range.prototype as unknown as { getClientRects?: () => unknown[]; getBoundingClientRect?: () => DOMRect };
    rp.getClientRects ??= () => [];
    rp.getBoundingClientRect ??= () => new DOMRect();
    editor.registerSuggestion({ char: "/", onUpdate: (s) => states.push(s) });
    caret(editor, "p1", 0);
    fire(root, "insertText", "/");
    expect(states.at(-1)?.open).toBe(true);
    editor.commands.undo();
    expect(textOf(editor.getDoc(), "p1")).toBe("");
    expect(states.at(-1)?.open).toBe(false);
  });
});

describe("load-time normalization", () => {
  it("a doc containing only void blocks still gets a cursor slot (trailing paragraph)", () => {
    const { editor, root } = mk([{ id: "d1", type: "divider", props: {} }]);
    expect(editor.getDoc().blocks.at(-1)?.type).toBe("paragraph");
    expect(root.querySelector(`[${CONTENT_ATTR}]`)).not.toBeNull();
  });
});
