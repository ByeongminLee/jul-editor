// @vitest-environment jsdom
// Regression: triple-click in a paragraph whose NEXT sibling is a void block (bookmark, image,
// divider...). The browser ends the DOM selection at (next block wrapper, 0); that boundary has no
// content div, so readDOMSelection used to return null and the editor selection stayed collapsed
// or empty, which kept BubbleMenu from appearing.
import { afterEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/index.js";
import { createEditor } from "./editor.js";
import { readDOMSelection } from "./selection.js";

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
      ],
    },
  });
  const wrapper = (id: string) => element.querySelector(`[data-jul-editor-block][data-id="${id}"]`) as HTMLElement;
  const text = (id: string) => wrapper(id).querySelector("[data-jul-editor-content]")!.firstChild as Text;
  return { element, editor, wrapper, text };
}

function select(a: Node, ao: number, b: Node, bo: number): void {
  const r = document.createRange();
  r.setStart(a, ao);
  r.setEnd(b, bo);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

describe("readDOMSelection with a void block neighbour", () => {
  it("maps a triple-click range ending at the start of the next void block to the end of the paragraph", () => {
    const { element, wrapper, text, editor } = mount();
    select(text("p"), 0, wrapper("v"), 0);
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "p", offset: 0 }, focus: { blockId: "p", offset: 9 } });
    editor.destroy();
  });

  it("also maps a backwards selection that starts in the void block", () => {
    const { element, wrapper, text, editor } = mount();
    select(wrapper("v"), 0, text("z"), 3);
    expect(readDOMSelection(element)).toEqual({ type: "text", anchor: { blockId: "z", offset: 0 }, focus: { blockId: "z", offset: 3 } });
    editor.destroy();
  });

  it("a collapsed caret inside the void block stays unresolved (null)", () => {
    const { element, wrapper, editor } = mount();
    select(wrapper("v"), 0, wrapper("v"), 0);
    expect(readDOMSelection(element)).toBeNull();
    editor.destroy();
  });

  it("drives the editor selection when the DOM selection changes (what BubbleMenu listens to)", async () => {
    const { wrapper, text, editor } = mount();
    select(text("p"), 0, wrapper("v"), 0);
    document.dispatchEvent(new Event("selectionchange"));
    const sel = editor.getState().selection;
    expect(sel?.type).toBe("text");
    if (sel?.type === "text") expect(sel.anchor.offset === sel.focus.offset && sel.anchor.blockId === sel.focus.blockId).toBe(false);
    editor.destroy();
  });
});
