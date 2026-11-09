// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Block } from "../model/types.js";
import { createEditor } from "./editor.js";
import type { Editor } from "./editor.js";
import type { SuggestionConfig } from "./suggestion.js";

const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
range.getClientRects ??= () => [] as unknown as DOMRectList;
range.getBoundingClientRect ??= () => new DOMRect();

let editor: Editor | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function setup(block: Block) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [block] } });
  return { element, editor };
}

function track(ed: Editor, config: Omit<SuggestionConfig, "onUpdate">) {
  const updates: { open: boolean; query: string }[] = [];
  const handle = ed.registerSuggestion({ ...config, onUpdate: ({ open, query }) => updates.push({ open, query }) });
  return { updates, handle, isOpen: () => updates.at(-1)?.open === true };
}

function caretAt(ed: Editor, blockId: string, offset: number) {
  ed.update((tx) => tx.setSelection({ type: "text", anchor: { blockId, offset }, focus: { blockId, offset } }));
}

function type(element: HTMLElement, text: string) {
  for (const ch of text) element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ch, bubbles: true, cancelable: true }));
}

describe("suggestion triggers", () => {
  it("never opens inside a code block", () => {
    const { element, editor: ed } = setup({ id: "c1", type: "codeBlock", props: {}, content: [] });
    const slash = track(ed, { char: "/", startOfLine: true });
    const at = track(ed, { char: "@" });
    const tag = track(ed, { char: "#" });
    caretAt(ed, "c1", 0);
    type(element, "/");
    expect(slash.isOpen()).toBe(false);
    type(element, " @Mi #inc");
    expect(at.isOpen()).toBe(false);
    expect(tag.isOpen()).toBe(false);
  });

  it("a non-startOfLine trigger right after a letter does not open (email, C#)", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const at = track(ed, { char: "@" });
    const tag = track(ed, { char: "#" });
    caretAt(ed, "p1", 0);
    type(element, "email me@");
    expect(at.isOpen()).toBe(false);
    type(element, " C#");
    expect(tag.isOpen()).toBe(false);
    type(element, " @");
    expect(at.isOpen()).toBe(true);
  });

  it("opens at line start and after an opening bracket", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const at = track(ed, { char: "@" });
    caretAt(ed, "p1", 0);
    type(element, "@");
    expect(at.isOpen()).toBe(true);
    at.handle.closeSuggestion();
    type(element, " (@");
    expect(at.isOpen()).toBe(true);
  });

  it("only one menu opens at a time ('/@')", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const slash = track(ed, { char: "/", startOfLine: true });
    const at = track(ed, { char: "@" });
    caretAt(ed, "p1", 0);
    type(element, "/ ");
    // A space closes the slash query; "/ @" is a fresh boundary, but with
    // slash still active nothing else may open.
    slash.handle.closeSuggestion();
    caretAt(ed, "p1", 0);
    ed.update((tx) => tx.replaceContent("p1", 0, 2, []).setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    type(element, "/@");
    expect(slash.isOpen()).toBe(true);
    expect(at.updates.some((u) => u.open)).toBe(false);
  });

  it("allow() can veto opening", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const slash = track(ed, { char: "/", startOfLine: true, allow: ({ blockId, offset }) => !(blockId === "p1" && offset === 0) });
    caretAt(ed, "p1", 0);
    type(element, "/");
    expect(slash.isOpen()).toBe(false);
  });

  it("closes when focus leaves the editor to another element", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const slash = track(ed, { char: "/", startOfLine: true });
    caretAt(ed, "p1", 0);
    type(element, "/");
    expect(slash.isOpen()).toBe(true);
    element.dispatchEvent(new FocusEvent("focusout", { relatedTarget: outside, bubbles: true }));
    expect(slash.isOpen()).toBe(false);
  });

  it("a press outside closes only once the pointer is released", async () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const slash = track(ed, { char: "/", startOfLine: true });
    caretAt(ed, "p1", 0);
    type(element, "/");
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    element.dispatchEvent(new FocusEvent("focusout", { relatedTarget: outside, bubbles: true }));
    expect(slash.isOpen()).toBe(true);
    outside.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slash.isOpen()).toBe(false);
  });

  it("keeps the menu when focus moves to a keep-selection element", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const menu = document.createElement("div");
    menu.setAttribute("data-jul-editor-keep-selection", "");
    menu.tabIndex = 0;
    document.body.appendChild(menu);
    const slash = track(ed, { char: "/", startOfLine: true });
    caretAt(ed, "p1", 0);
    type(element, "/");
    element.dispatchEvent(new FocusEvent("focusout", { relatedTarget: menu, bubbles: true }));
    expect(slash.isOpen()).toBe(true);
  });

  it("re-emits the caret rect on scroll without changing the query", () => {
    const { element, editor: ed } = setup({ id: "p1", type: "paragraph", props: {}, content: [] });
    const slash = track(ed, { char: "/", startOfLine: true });
    caretAt(ed, "p1", 0);
    type(element, "/ta");
    const n = slash.updates.length;
    document.dispatchEvent(new Event("scroll"));
    expect(slash.updates.length).toBe(n + 1);
    expect(slash.updates.at(-1)).toEqual({ open: true, query: "ta" });
  });
});
