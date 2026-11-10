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

  it("store + pointer: a drag across a void includes it in both directions", () => {
    const { element, text, editor } = mount();
    for (const reverse of [false, true]) {
      if (reverse) select(text("z"), 2, text("p"), 2);
      else select(text("p"), 2, text("z"), 2);
      expect(readDOMSelection(element, { store: editor.getState().store, registry: coreRegistry, pointer: true })).toEqual({ type: "block", ids: ["p", "v", "z"] });
    }
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
  it("keeps the native backward drag anchor until release, then normalizes it", async () => {
    const { element, text, editor } = mount();
    element.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    text("p").parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, detail: 1 }));
    text("p").parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    select(text("p"), 0, text("a"), 2);
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "a", offset: 6 }, focus: { blockId: "a", offset: 2 } });
    expect(window.getSelection()!.anchorNode).toBe(text("p"));
    expect(window.getSelection()!.anchorOffset).toBe(0);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "a", offset: 6 }, focus: { blockId: "a", offset: 2 } });
    editor.destroy();
  });

  it("a triple click that ends at the next block's start selects only this block, and typing keeps the next block", async () => {
    const { element, text, content, editor } = mount();
    element.focus();
    text("a").parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, detail: 3 }));
    text("a").parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 3 }));
    select(text("a"), 0, content("p"), 0);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("cross-column selection", () => {
  it("does not promote a text drag between columns to the entire container", async () => {
    const { promoteSelection } = await import("./selection.js");
    const registry = { ...coreRegistry, blocks: new Map(coreRegistry.blocks)
      .set("columns", { type: "columns", content: "none", children: ["column"], isolating: true, props: {} })
      .set("column", { type: "column", content: "none", children: "any", parent: ["columns"], isolating: true, props: {} }) } as typeof coreRegistry;
    const { fromDoc } = await import("../store/store.js");
    const store = fromDoc({ version: 1, blocks: [{ id: "outside", type: "paragraph", props: {}, content: [{ type: "text", text: "outside" }] }, { id: "cols", type: "columns", props: {}, children: [
      { id: "left", type: "column", props: {}, children: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "left" }] }] },
      { id: "right", type: "column", props: {}, children: [{ id: "b", type: "paragraph", props: {}, content: [{ type: "text", text: "right" }] }] },
    ] }] }, registry);
    for (const [anchor, focus] of [[{ blockId: "a", offset: 2 }, { blockId: "b", offset: 2 }], [{ blockId: "b", offset: 2 }, { blockId: "a", offset: 2 }], [{ blockId: "outside", offset: 2 }, { blockId: "a", offset: 2 }], [{ blockId: "a", offset: 2 }, { blockId: "outside", offset: 2 }]]) {
      expect(promoteSelection(store, registry, { type: "text", anchor: anchor!, focus: focus! })).toEqual({ type: "text", anchor, focus: anchor });
    }
    const nestedStore = fromDoc({ version: 1, blocks: [{ id: "cols2", type: "columns", props: {}, children: [
      { id: "left2", type: "column", props: {}, children: [{ id: "table", type: "table", props: {}, children: [{ id: "row", type: "tableRow", props: {}, children: [{ id: "cell", type: "tableCell", props: {}, content: [{ type: "text", text: "cell" }] }] }] }] },
      { id: "right2", type: "column", props: {}, children: [{ id: "other", type: "paragraph", props: {}, content: [{ type: "text", text: "other" }] }] },
    ] }] }, registry);
    const anchor = { blockId: "cell", offset: 2 };
    expect(promoteSelection(nestedStore, registry, { type: "text", anchor, focus: { blockId: "other", offset: 2 } })).toEqual({ type: "text", anchor, focus: anchor });

    const element = document.createElement("div");
    document.body.appendChild(element);
    const { toDoc } = await import("../store/store.js");
    const editor = createEditor({ element, registry, defaultValue: toDoc(store) });
    const left = element.querySelector('[data-id="a"] [data-jul-editor-content]')!.firstChild!;
    const right = element.querySelector('[data-id="b"] [data-jul-editor-content]')!.firstChild!;
    select(left, 2, right, 2);
    element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "!", bubbles: true, cancelable: true }));
    select(element.querySelector('[data-id="a"] [data-jul-editor-content]')!.firstChild!, 1, element.querySelector('[data-id="b"] [data-jul-editor-content]')!.firstChild!, 1);
    const beforeComposition = editor.getDoc();
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(editor.getDoc()).toEqual(beforeComposition);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const columns = editor.getDoc().blocks[1]!;
    expect(columns.children?.map((column) => column.children?.[0]?.content)).toEqual([
      [{ type: "text", text: "le!ft" }], [{ type: "text", text: "right" }],
    ]);
    editor.destroy();
  });
});

describe("void selection safety", () => {
  it("ignores hidden voids within a collapsed toggle", () => {
    const registry = { ...coreRegistry, blocks: new Map(coreRegistry.blocks).set("toggle", { type: "toggle", content: "inline", children: "any", props: { open: false } } as const) };
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry, defaultValue: { version: 1, blocks: [
      { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "above" }] },
      { id: "toggle", type: "toggle", props: {}, content: [{ type: "text", text: "closed" }], children: [{ id: "hidden", type: "divider", props: {} }] },
      { id: "z", type: "paragraph", props: {}, content: [{ type: "text", text: "below" }] },
    ] } });
    (element.querySelector('[data-id="toggle"] [data-jul-editor-children]') as HTMLElement).style.display = "none";
    const text = (id: string) => element.querySelector(`[data-id="${id}"] [data-jul-editor-content]`)!.firstChild!;
    select(text("a"), 1, text("z"), 1);
    expect(readDOMSelection(element, { store: editor.getState().store, registry, pointer: true })?.type).toBe("text");
    editor.destroy();
  });

  it("includes a whole intervening table when dragging across visible voids", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [
      { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "a" }] },
      { id: "v1", type: "divider", props: {} },
      { id: "table", type: "table", props: {}, children: [{ id: "row", type: "tableRow", props: {}, children: [{ id: "cell", type: "tableCell", props: {}, content: [] }] }] },
      { id: "v2", type: "divider", props: {} },
      { id: "z", type: "paragraph", props: {}, content: [{ type: "text", text: "z" }] },
    ] } });
    const text = (id: string) => element.querySelector(`[data-id="${id}"] [data-jul-editor-content]`)!.firstChild!;
    select(text("a"), 0, text("z"), 1);
    expect(readDOMSelection(element, { store: editor.getState().store, registry: coreRegistry, pointer: true })).toEqual({ type: "block", ids: ["a", "v1", "table", "v2", "z"] });
    editor.destroy();
  });

  it("keeps columns intact when a drag ends on a void in another column", () => {
    const registry = { ...coreRegistry, blocks: new Map(coreRegistry.blocks)
      .set("columns", { type: "columns", content: "none", children: ["column"], isolating: true, props: {} })
      .set("column", { type: "column", content: "none", children: "any", parent: ["columns"], isolating: true, props: {} }) } as typeof coreRegistry;
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry, defaultValue: { version: 1, blocks: [{ id: "cols", type: "columns", props: {}, children: [
      { id: "left", type: "column", props: {}, children: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "left" }] }] },
      { id: "right", type: "column", props: {}, children: [{ id: "void", type: "divider", props: {} }, { id: "b", type: "paragraph", props: {}, content: [{ type: "text", text: "right" }] }] },
    ] }] } });
    const text = element.querySelector('[data-id="a"] [data-jul-editor-content]')!.firstChild!;
    const target = element.querySelector('[data-id="void"] [data-jul-editor-void]')!;
    select(text, 2, target, 0);
    expect(readDOMSelection(element, { store: editor.getState().store, registry, pointer: true })).toEqual({ type: "text", anchor: { blockId: "a", offset: 2 }, focus: { blockId: "a", offset: 2 } });
    editor.destroy();
  });

  it("does not replace a parent subtree when dragging across a nested void", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [{ id: "parent", type: "paragraph", props: {}, content: [{ type: "text", text: "parent" }], children: [
      { id: "void", type: "divider", props: {} }, { id: "selected", type: "paragraph", props: {}, content: [{ type: "text", text: "selected" }] }, { id: "keep", type: "paragraph", props: {}, content: [{ type: "text", text: "keep" }] },
    ] }] } });
    const text = (id: string) => element.querySelector(`[data-id="${id}"] [data-jul-editor-content]`)!.firstChild!;
    select(text("parent"), 2, text("selected"), 2);
    const selection = readDOMSelection(element, { store: editor.getState().store, registry: coreRegistry, pointer: true });
    expect(selection).toEqual({ type: "text", anchor: { blockId: "parent", offset: 2 }, focus: { blockId: "parent", offset: 2 } });
    editor.destroy();
  });
});
