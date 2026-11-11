// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/index.js";
import type { Block } from "../model/types.js";
import { createEditor } from "./editor.js";
import { readDOMSelection } from "./selection.js";

afterEach(() => {
  document.body.innerHTML = "";
});

const p = (id: string, children?: Block[]): Block => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id }], ...(children ? { children } : {}) });
const divider = (id: string): Block => ({ id, type: "divider", props: {} });
const caret = (blockId: string, offset: number) => ({ type: "text" as const, anchor: { blockId, offset }, focus: { blockId, offset } });
const toggleRegistry = { ...coreRegistry, blocks: new Map(coreRegistry.blocks).set("toggle", { type: "toggle", content: "inline", children: "any", props: { open: false } } as const) };

function mount(blocks: Block[], registry = coreRegistry) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry, defaultValue: { version: 1, blocks } });
  element.focus();
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
    return event;
  };
  const text = (id: string) => element.querySelector(`[data-id="${id}"] > [data-jul-editor-content]`)!.firstChild!;
  return { element, editor, press, text };
}

describe("selection across voids", () => {
  it("a drag from a block with children across voids selects the blocks", () => {
    const { element, editor, text } = mount([p("a", [p("child")]), divider("v1"), divider("v2"), p("z")]);
    const read = () => readDOMSelection(element, { store: editor.getState().store, registry: coreRegistry, pointer: true });
    window.getSelection()!.setBaseAndExtent(text("a"), 0, text("z"), 1);
    expect(read()).toEqual({ type: "block", ids: ["a", "v1", "v2", "z"] });
    window.getSelection()!.setBaseAndExtent(text("z"), 1, text("a"), 0);
    expect(read()).toEqual({ type: "block", ids: ["a", "v1", "v2", "z"] });
  });

  it("Shift+Arrow from a text range takes in one void at a time", () => {
    const { editor, press } = mount([p("abc"), divider("v1"), divider("v2"), p("z")]);
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "abc", offset: 1 }, focus: { blockId: "abc", offset: 3 } }));
    expect(press("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["abc", "v1"] });
    press("ArrowDown", { shiftKey: true });
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["abc", "v1", "v2"] });
    press("ArrowUp", { shiftKey: true });
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["abc", "v1"] });
  });
});

describe("block selection typing", () => {
  it("typing over a block selection undoes in one step", () => {
    const { element, editor, press } = mount([p("a"), p("b")]);
    editor.update((tx) => tx.setSelection({ type: "block", ids: ["a", "b"] }));
    const before = editor.getDoc();
    press("X");
    for (const data of ["Y", "Z"]) element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data, bubbles: true, cancelable: true }));
    expect(editor.getDoc().blocks.map((b) => b.content)).toEqual([[{ type: "text", text: "XYZ" }]]);
    editor.commands.undo();
    expect(editor.getDoc()).toEqual(before);
  });
});

describe("closed toggle boundaries", () => {
  const blocks = (): Block[] => [
    { id: "t", type: "toggle", props: {}, content: [{ type: "text", text: "title" }], children: [p("hidden")] },
    p("after"),
  ];

  it("Backspace after a closed toggle lands on its title without touching the hidden child", () => {
    const { editor, press } = mount(blocks(), toggleRegistry);
    const before = editor.getDoc();
    editor.update((tx) => tx.setSelection(caret("after", 0)));
    press("Backspace");
    expect(editor.getDoc()).toEqual(before);
    expect(editor.getState().selection).toEqual(caret("t", 5));
  });

  it("Delete at the end of a closed toggle title keeps the hidden child", () => {
    const { editor, press } = mount(blocks(), toggleRegistry);
    const before = editor.getDoc();
    editor.update((tx) => tx.setSelection(caret("t", 5)));
    press("Delete");
    expect(editor.getDoc()).toEqual(before);
  });

  it("an open toggle still merges with its children", () => {
    const open = blocks();
    open[0]!.props = { open: true };
    const { editor, press } = mount(open, toggleRegistry);
    editor.update((tx) => tx.setSelection(caret("t", 5)));
    press("Delete");
    expect(editor.getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "titlehidden" }]);
  });
});

describe("Tab", () => {
  it("leaves the editor from a top-level paragraph or a lone void, and indents elsewhere", () => {
    const { editor, press } = mount([p("a"), p("b", [p("n1"), p("n2")]), divider("v")]);
    const tab = (selection: unknown) => {
      editor.update((tx) => tx.setSelection(selection as never));
      return press("Tab").defaultPrevented;
    };
    expect(tab(caret("b", 0))).toBe(false);
    expect(tab({ type: "block", ids: ["v"] })).toBe(false);
    expect(tab(caret("n2", 0))).toBe(true);
    expect(editor.getDoc().blocks[1]!.children!.map((b) => [b.id, b.children?.map((c) => c.id)])).toEqual([["n1", ["n2"]]]);
  });
});
