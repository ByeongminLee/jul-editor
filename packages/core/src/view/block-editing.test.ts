// @vitest-environment jsdom
// Block-level editing rules driven through the real view event handlers:
// block-selection commands over isolating structures (table), Enter's
// split/exit rules (to-do, quote, heading, container), and a stale collapsed
// beforeinput target range losing to the live DOM caret.
import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Block } from "../model/types.js";
import { fromDoc, toDoc } from "../store/store.js";
import { doc, para } from "../store/test-helpers.js";
import { createTransaction } from "../store/transaction.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState, Selection } from "../store/types.js";
import { createView } from "./";
import { CONTENT_ATTR, ID_ATTR } from "./dom.js";

function mount(blocks: Block[], selection: Selection | null) {
  let state: EditorState = { store: fromDoc(doc(blocks), coreRegistry), selection };
  const dispatch = (build: (tx: Transaction) => Transaction) => {
    const result = build(createTransaction(state, coreRegistry)).commit();
    state = result.state;
    return result;
  };
  const root = document.createElement("div");
  document.body.appendChild(root);
  const view = createView({ element: root, state, registry: coreRegistry, dispatch });
  return { root, view, doc: () => toDoc(view.getState().store), sel: () => view.getState().selection };
}

const caret = (blockId: string, offset: number): Selection => ({ type: "text", anchor: { blockId, offset }, focus: { blockId, offset } });

function key(root: HTMLElement, k: string, init: KeyboardEventInit = {}) {
  root.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
}

function beforeInput(root: HTMLElement, inputType: string, data?: string, targetRanges?: StaticRange[]) {
  const ev = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true } as InputEventInit);
  if (targetRanges) Object.defineProperty(ev, "getTargetRanges", { value: () => targetRanges });
  root.dispatchEvent(ev);
  root.dispatchEvent(new Event("input", { bubbles: true }));
}

function table(): Block {
  return {
    id: "t1",
    type: "table",
    props: {},
    children: [
      {
        id: "r1",
        type: "tableRow",
        props: {},
        children: [
          { id: "a1", type: "tableCell", props: {}, content: [{ type: "text", text: "A1" }] },
          { id: "b1", type: "tableCell", props: {}, content: [{ type: "text", text: "B1" }] },
        ],
      },
    ],
  };
}

const text = (b: Block | undefined) => (b?.content ?? []).map((i) => ("text" in i ? i.text : "")).join("");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("block selection over a root-level table (isolating)", () => {
  it("Backspace deletes every selected block, the table included", () => {
    const m = mount([para("p1", "a"), table(), para("p2", "b"), para("p3", "c")], { type: "block", ids: ["p1", "t1", "p2"] });
    key(m.root, "Backspace");
    expect(m.doc().blocks.map((b) => b.id)).toEqual(["p3"]);
    m.view.destroy();
  });

  it("Select All (every root block) + Delete empties the document", () => {
    const m = mount([para("p1", "a"), table(), para("p2", "b")], { type: "block", ids: ["p1", "t1", "p2"] });
    key(m.root, "Delete");
    const blocks = m.doc().blocks;
    expect(blocks.some((b) => b.type === "table")).toBe(false);
    expect(blocks.map(text).join("")).toBe("");
    m.view.destroy();
  });

  it("typing a character replaces the selection (table + following block) with a paragraph holding it", () => {
    const m = mount([para("p0", "keep"), table(), { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "x" }] }], { type: "block", ids: ["t1", "c1"] });
    key(m.root, "x");
    const blocks = m.doc().blocks;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(text(blocks[1])).toBe("x");
    m.view.destroy();
  });

  it("Enter on a block selection holding the table inserts a paragraph after it", () => {
    const m = mount([table(), para("p2", "b")], { type: "block", ids: ["t1"] });
    key(m.root, "Enter");
    expect(m.doc().blocks.map((b) => b.type)).toEqual(["table", "paragraph", "paragraph"]);
    m.view.destroy();
  });

  it("a block selection of a single cell (Escape inside it) is refused: the table is untouched", () => {
    const m = mount([para("p0", "a"), table(), para("p2", "b")], { type: "block", ids: ["a1"] });
    const before = m.doc();
    key(m.root, "Backspace");
    expect(m.doc()).toEqual(before);
    m.view.destroy();
  });

  it("a block selection spanning two cells of one row lifts to the whole table and deletes it", () => {
    const m = mount([para("p0", "a"), table(), para("p2", "b")], { type: "block", ids: ["a1", "b1"] });
    key(m.root, "Backspace");
    expect(m.doc().blocks.map((b) => b.id)).toEqual(["p0", "p2"]);
    m.view.destroy();
  });
});

describe("Enter split/exit rules", () => {
  it("Enter at the end of a checked to-do creates an UNchecked one", () => {
    const m = mount([{ id: "t1", type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "done" }] }], caret("t1", 4));
    beforeInput(m.root, "insertParagraph");
    const blocks = m.doc().blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.props.checked).toBe(true);
    expect(blocks[1]!.type).toBe("todoListItem");
    expect(blocks[1]!.props.checked ?? false).toBe(false);
    m.view.destroy();
  });

  it("Enter on an empty quote turns it into a paragraph (exits the quote)", () => {
    const m = mount([{ id: "q1", type: "quote", props: {}, content: [{ type: "text", text: "said" }] }, { id: "q2", type: "quote", props: {}, content: [] }], caret("q2", 0));
    beforeInput(m.root, "insertParagraph");
    expect(m.doc().blocks.map((b) => b.type)).toEqual(["quote", "paragraph"]);
    m.view.destroy();
  });

  it("Enter at the end of a heading starts a paragraph; mid-heading keeps both halves headings", () => {
    const m = mount([{ id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title" }] }], caret("h1", 5));
    beforeInput(m.root, "insertParagraph");
    let blocks = m.doc().blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(m.sel()).toEqual(caret(blocks[1]!.id, 0));
    m.view.destroy();

    const m2 = mount([{ id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Title" }] }], caret("h1", 2));
    beforeInput(m2.root, "insertParagraph");
    blocks = m2.doc().blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "heading"]);
    m2.view.destroy();
  });

  it("Enter on an empty LAST child of a container lifts it out to the container's next sibling", () => {
    const quote: Block = { id: "q1", type: "quote", props: {}, content: [{ type: "text", text: "outer" }], children: [para("c1", "line"), para("c2", "")] };
    const m = mount([quote, para("after", "x")], caret("c2", 0));
    beforeInput(m.root, "insertParagraph");
    const blocks = m.doc().blocks;
    expect(blocks.map((b) => b.id)).toEqual(["q1", "c2", "after"]);
    expect(blocks[0]!.children?.map((b) => b.id)).toEqual(["c1"]);
    m.view.destroy();
  });

  it("Enter on an empty child that is NOT the last one splits as usual (stays inside)", () => {
    const quote: Block = { id: "q1", type: "quote", props: {}, content: [{ type: "text", text: "outer" }], children: [para("c1", ""), para("c2", "tail")] };
    const m = mount([quote], caret("c1", 0));
    beforeInput(m.root, "insertParagraph");
    const blocks = m.doc().blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.children).toHaveLength(3);
    m.view.destroy();
  });
});

describe("a stale collapsed beforeinput target range loses to the live DOM caret", () => {
  it("insertText goes where the DOM caret is, not into the block the target range names", () => {
    const m = mount([para("p1", "first"), para("p2", ""), para("p3", "Drag")], caret("p2", 0));
    const p2 = m.root.querySelector(`[${ID_ATTR}="p2"] > [${CONTENT_ATTR}]`)!;
    window.getSelection()!.collapse(p2, 0);
    const p3Text = m.root.querySelector(`[${ID_ATTR}="p3"] > [${CONTENT_ATTR}]`)!.firstChild!;
    const stale = new StaticRange({ startContainer: p3Text, startOffset: 0, endContainer: p3Text, endOffset: 0 });
    beforeInput(m.root, "insertText", "a", [stale]);
    const blocks = m.doc().blocks;
    expect(text(blocks[1])).toBe("a");
    expect(text(blocks[2])).toBe("Drag");
    m.view.destroy();
  });
});

describe("to-do checked state on the wrapper and marker-click toggle", () => {
  it("mirrors checked onto data-jul-editor-checked, and a press in the marker gutter toggles it", () => {
    const m = mount([{ id: "t1", type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "done" }] }, para("p1", "x")], null);
    const wrapper = m.root.querySelector(`[${ID_ATTR}="t1"]`)!;
    expect(wrapper.getAttribute("data-jul-editor-checked")).toBe("true");
    const content = wrapper.querySelector(`:scope > [${CONTENT_ATTR}]`)!;
    content.getBoundingClientRect = () => ({ left: 22, right: 200, top: 0, bottom: 20, width: 178, height: 20, x: 22, y: 0, toJSON: () => ({}) }) as DOMRect;
    const press = (clientX: number, target: Element) => {
      const ev = new MouseEvent("mousedown", { button: 0, clientX, clientY: 10, bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      return ev;
    };
    const ev = press(8, wrapper);
    expect(ev.defaultPrevented).toBe(true);
    expect(m.doc().blocks[0]!.props.checked ?? false).toBe(false);
    expect(wrapper.hasAttribute("data-jul-editor-checked")).toBe(false);
    press(60, content); // on the text: no toggle
    expect(m.doc().blocks[0]!.props.checked ?? false).toBe(false);
    press(8, wrapper);
    expect(m.doc().blocks[0]!.props.checked).toBe(true);
    m.view.destroy();
  });
});
