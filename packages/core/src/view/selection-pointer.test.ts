// @vitest-environment jsdom
// Regressions from the editor audit (round 1, batch 3): reading pointer selections.
//  - a triple click / a drag into the gap below a block ends the native range at offset 0 of the
//    NEXT block; replacing that selection used to merge the next block into this one;
//  - a drag that ends on (or past) a void block dropped the void and clamped back to text;
//  - a block selection left the old native text highlight painted;
//  - a click on an empty block (caret at its wrapper, offset 0) could not leave a block selection.
import { afterEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/index.js";
import { createEditor } from "./editor.js";
import { pointFromDOM, readDOMSelection } from "./selection.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({
    element,
    registry: coreRegistry,
    defaultValue: {
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "before" }] },
        { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "select me" }] },
        { id: "v", type: "divider", props: {} },
        { id: "z", type: "paragraph", props: {}, content: [{ type: "text", text: "after" }] },
        { id: "e", type: "paragraph", props: {}, content: [] },
      ],
    },
  });
  const wrapper = (id: string) => element.querySelector(`[data-jul-editor-block][data-id="${id}"]`) as HTMLElement;
  const content = (id: string) => wrapper(id).querySelector(":scope > [data-jul-editor-content]") as HTMLElement;
  const text = (id: string) => content(id).firstChild as Text;
  return { element, editor, wrapper, content, text };
}

function select(a: Node, ao: number, b: Node, bo: number): void {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.setBaseAndExtent(a, ao, b, bo);
}

describe("pointFromDOM on a text block's wrapper", () => {
  it("maps (wrapper, 0) of an empty block to its start", () => {
    const { element, wrapper, editor } = mount();
    expect(pointFromDOM(element, wrapper("e"), 0)).toEqual({ blockId: "e", offset: 0 });
    expect(pointFromDOM(element, wrapper("p"), 1)).toEqual({ blockId: "p", offset: 9 });
    editor.destroy();
  });
});

describe("readDOMSelection options", () => {
  it("pointer: clamps an end at offset 0 of the next block back to the end of the previous one", () => {
    const { element, text, content, editor } = mount();
    select(text("a"), 2, content("p"), 0);
    expect(readDOMSelection(element, { pointer: true })).toEqual({ type: "text", anchor: { blockId: "a", offset: 2 }, focus: { blockId: "a", offset: 6 } });
    // backward: the later end is the anchor
    select(text("p"), 0, text("a"), 2);
    expect(readDOMSelection(element, { pointer: true })).toEqual({ type: "text", anchor: { blockId: "a", offset: 6 }, focus: { blockId: "a", offset: 2 } });
    // keyboard extension keeps the end verbatim
    select(text("a"), 2, content("p"), 0);
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "a", offset: 2 }, focus: { blockId: "p", offset: 0 } });
    editor.destroy();
  });

  it("store: an end on a void block becomes a block selection that includes it", () => {
    const { element, text, wrapper, editor } = mount();
    select(text("a"), 2, wrapper("v"), 0);
    expect(readDOMSelection(element, { store: editor.getState().store })).toEqual({ type: "block", ids: ["a", "p", "v"] });
    // backward, from the text below the void up onto it
    select(text("z"), 3, wrapper("v"), 0);
    expect(readDOMSelection(element, { store: editor.getState().store })).toEqual({ type: "block", ids: ["v", "z"] });
    // without the store it still clamps to text (unchanged public behavior)
    select(text("a"), 2, wrapper("v"), 0);
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "a", offset: 2 }, focus: { blockId: "p", offset: 9 } });
    editor.destroy();
  });

  it("store + pointer: a drag past a void into the next block's start keeps the void", () => {
    const { element, text, content, editor } = mount();
    select(text("p"), 2, content("z"), 0);
    expect(readDOMSelection(element, { store: editor.getState().store, pointer: true })).toEqual({ type: "block", ids: ["p", "v"] });
    editor.destroy();
  });
});

describe("pointer selections through the editor", () => {
  it("a triple click that ends at the next block's start selects only this block, and typing keeps the next block", () => {
    const { element, text, content, editor } = mount();
    element.focus();
    text("a").parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, detail: 3 }));
    text("a").parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 3 }));
    select(text("a"), 0, content("p"), 0);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 6 } });
    // the DOM was rewritten to match, so a native edit reads the same range
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 6 } });
    element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "N", bubbles: true, cancelable: true }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["a", "p", "v", "z", "e"]);
    expect(element.querySelector('[data-id="a"] [data-jul-editor-content]')!.textContent).toBe("N");
    editor.destroy();
  });

  it("a triple click whose range ends on a void's wrapper does not select the void", () => {
    const { element, text, wrapper, editor } = mount();
    text("p").parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 3 }));
    select(text("p"), 0, wrapper("v"), 0);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "p", offset: 0 }, focus: { blockId: "p", offset: 9 } });
    editor.destroy();
  });

  it("a block selection collapses the leftover native text highlight", () => {
    const { element, text, editor } = mount();
    element.focus();
    select(text("a"), 2, text("p"), 3);
    document.dispatchEvent(new Event("selectionchange"));
    editor.update((tx) => tx.setSelection({ type: "block", ids: ["a", "p", "v", "z", "e"] }));
    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    expect(element.contains(sel.anchorNode)).toBe(true);
    editor.destroy();
  });

  it("a click on an empty block (caret at its wrapper) leaves a block selection", () => {
    const { element, wrapper, editor } = mount();
    element.focus();
    editor.update((tx) => tx.setSelection({ type: "block", ids: ["a", "p", "v", "z", "e"] }));
    wrapper("e").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    select(wrapper("e"), 0, wrapper("e"), 0);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    wrapper("e").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "e", offset: 0 }, focus: { blockId: "e", offset: 0 } });
    editor.destroy();
  });
});
