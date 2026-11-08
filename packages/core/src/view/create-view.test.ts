// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { toDoc } from "../store/store.js";
import { bullet, doc, para } from "../store/test-helpers.js";
import { createTransaction } from "../store/transaction.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import { fromDoc } from "../store/store.js";
import { createView } from "./";
import { BLOCK_ATTR, CONTENT_ATTR, FOCUSED_ATTR, ID_ATTR, VOID_ATTR } from "./dom.js";

/** Points a real jsdom Selection across two blocks' own content divs (found
 * by block id), so `readDOMSelection`+`promoteSelection` derive a genuine
 * `cells`-shaped selection the same way a real mouse drag across two table
 * cells would -- a `cells` model Selection has no DOM correlate of its own
 * (writeDOMSelection no-ops for it), so a beforeinput-driven test has to set
 * up the live DOM selection by hand instead of relying on the initial render. */
function selectAcross(root: HTMLElement, aBlockId: string, aOffset: number, bBlockId: string, bOffset: number): void {
  const aContent = root.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${aBlockId}"] > [${CONTENT_ATTR}]`)!;
  const bContent = root.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${bBlockId}"] > [${CONTENT_ATTR}]`)!;
  const domSel = window.getSelection()!;
  domSel.setBaseAndExtent(aContent.firstChild ?? aContent, aOffset, bContent.firstChild ?? bContent, bOffset);
}

function makeDispatch(initial: EditorState) {
  let state = initial;
  return {
    getState: () => state,
    dispatch: (build: (tx: Transaction) => Transaction) => {
      const tx = createTransaction(state, coreRegistry);
      const result = build(tx).commit();
      state = result.state;
      return result;
    },
  };
}

function fire(root: HTMLElement, inputType: string, data?: string) {
  root.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true } as InputEventInit));
  root.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createView: beforeinput -> model", () => {
  it("insertText at a collapsed caret commits the char and advances the caret", () => {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "insertText", "a");

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "a" }]);
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } });
    view.destroy();
  });

  it("deleteContentBackward at offset 0 merges with the previous block", () => {
    const store = fromDoc(doc([para("p1", "ab"), para("p2", "cd")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p2", offset: 0 }, focus: { blockId: "p2", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "deleteContentBackward");

    const resultDoc = toDoc(view.getState().store);
    expect(resultDoc.blocks.length).toBe(1);
    expect(resultDoc.blocks[0]?.content).toEqual([{ type: "text", text: "abcd" }]);
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } });
    view.destroy();
  });

  it("insertParagraph at offset 0 keeps the original id on the content-holding block", () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "insertParagraph");

    const resultDoc = toDoc(view.getState().store);
    expect(resultDoc.blocks.length).toBe(2);
    expect(resultDoc.blocks[1]?.id).toBe("p1");
    expect(resultDoc.blocks[1]?.content).toEqual([{ type: "text", text: "hello" }]);
    view.destroy();
  });

  it("insertParagraph mid-text splits into front (original id) / back (new id)", () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "insertParagraph");

    const resultDoc = toDoc(view.getState().store);
    expect(resultDoc.blocks.length).toBe(2);
    expect(resultDoc.blocks[0]?.id).toBe("p1");
    expect(resultDoc.blocks[0]?.content).toEqual([{ type: "text", text: "he" }]);
    expect(resultDoc.blocks[1]?.content).toEqual([{ type: "text", text: "llo" }]);
    expect(view.getState().selection).toEqual({
      type: "text",
      anchor: { blockId: resultDoc.blocks[1]!.id, offset: 0 },
      focus: { blockId: resultDoc.blocks[1]!.id, offset: 0 },
    });
    view.destroy();
  });

  it("never reaches the model for input inside a void block's own interactive DOM", () => {
    const store = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }, para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    let innerInput: HTMLInputElement | undefined;
    const view = createView({
      element: root,
      state,
      registry: coreRegistry,
      dispatch: d.dispatch,
      renderVoid: (_block, container) => {
        innerInput = document.createElement("input");
        container.appendChild(innerInput);
      },
    });

    expect(root.querySelector(`[${VOID_ATTR}]`)?.getAttribute("contenteditable")).toBe("false");
    innerInput!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true, cancelable: true }));
    innerInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(toDoc(view.getState().store).blocks[0]?.type).toBe("image"); // unchanged
    view.destroy();
  });

  it("clicking a void block (outside its own interactive DOM) selects it as a block selection and focuses the root", () => {
    const store = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }, para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    let voidEl: HTMLElement | undefined;
    const view = createView({
      element: root,
      state,
      registry: coreRegistry,
      dispatch: d.dispatch,
      renderVoid: (_block, container) => {
        voidEl = container;
      },
    });

    voidEl!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(d.getState().selection).toEqual({ type: "block", ids: ["img1"] });
    // preventDefault on mousedown also cancels the browser's own focus-
    // follows-click behavior -- the handler must focus the root explicitly,
    // or a subsequent real keydown (Backspace, arrows, ...) would never
    // reach it at all.
    expect(document.activeElement).toBe(root);
    view.destroy();
  });

  it("a click inside a void block's own interactive DOM (an <input>) is left alone -- no block selection", () => {
    const store = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    let innerInput: HTMLInputElement | undefined;
    const view = createView({
      element: root,
      state,
      registry: coreRegistry,
      dispatch: d.dispatch,
      renderVoid: (_block, container) => {
        innerInput = document.createElement("input");
        container.appendChild(innerInput);
      },
    });

    innerInput!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(d.getState().selection).toBeNull();
    view.destroy();
  });

  it("insertReplacementText (spellcheck/autocorrect) inserts like insertText", () => {
    const store = fromDoc(doc([para("p1", "helo")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 4 }, focus: { blockId: "p1", offset: 4 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "insertReplacementText", "o");

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "heloo" }]);
    view.destroy();
  });

  it("insertLineBreak (Shift+Enter) inserts a literal newline into the block's own text", () => {
    const store = fromDoc(doc([para("p1", "ab")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "insertLineBreak");

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "a\nb" }]);
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } });
    view.destroy();
  });

  it("deleteContentBackward at offset 0 of a list item converts it to a paragraph before merging (Notion)", () => {
    const store = fromDoc(doc([para("p0", "x"), bullet("li1", "child")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "li1", offset: 0 }, focus: { blockId: "li1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    fire(root, "deleteContentBackward");
    let after = toDoc(view.getState().store);
    expect(after.blocks.length).toBe(2); // not merged on the first Backspace
    expect(after.blocks[1]?.type).toBe("paragraph");
    expect(after.blocks[1]?.content).toEqual([{ type: "text", text: "child" }]);

    fire(root, "deleteContentBackward"); // second Backspace: now a plain paragraph, merges
    after = toDoc(view.getState().store);
    expect(after.blocks.length).toBe(1);
    expect(after.blocks[0]?.content).toEqual([{ type: "text", text: "xchild" }]);
    view.destroy();
  });

  it("Escape converts a collapsed text selection into a block selection (Notion)", () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(view.getState().selection).toEqual({ type: "block", ids: ["p1"] });
    view.destroy();
  });

  it("Mod+A selects the current block's text, then (pressed again) the whole document", () => {
    const store = fromDoc(doc([para("p1", "hello"), para("p2", "world")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    const modA = () => root.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));

    modA();
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } });
    modA();
    expect(view.getState().selection).toEqual({ type: "block", ids: ["p1", "p2"] });
    view.destroy();
  });

  it("Backspace on a block selection removes the selected blocks and lands the caret in a neighbor", () => {
    const store = fromDoc(doc([para("p1", "a"), para("p2", "b"), para("p3", "c")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "block", ids: ["p2"] } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    const after = toDoc(view.getState().store);
    expect(after.blocks.map((b) => b.id)).toEqual(["p1", "p3"]);
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "p3", offset: 0 }, focus: { blockId: "p3", offset: 0 } });
    view.destroy();
  });

  it("reverts a childList mutation an external script makes to a paragraph's content div", async () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    const stray = document.createElement("span");
    stray.textContent = "hijacked";
    content.replaceChildren(stray); // simulate an external script tampering with managed DOM

    await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver callback run
    expect(root.querySelector(`[${CONTENT_ATTR}]`)?.textContent).toBe("hello");
    view.destroy();
  });
});

function tableDoc() {
  return doc([
    {
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
    },
  ]);
}

describe("createView: table cells selection", () => {
  it("a live DOM selection spanning two cells promotes to a cells selection, and typing replaces the anchor cell + collapses", () => {
    const store = fromDoc(tableDoc(), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    selectAcross(root, "a1", 1, "b1", 1);
    fire(root, "insertText", "X");

    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "a1", offset: 1 }, focus: { blockId: "a1", offset: 1 } });
    expect(toDoc(view.getState().store).blocks[0]?.children?.[0]?.children?.[0]?.content).toEqual([{ type: "text", text: "X" }]);
    // the other cell (b1) is untouched -- only the anchor cell was replaced
    expect(toDoc(view.getState().store).blocks[0]?.children?.[0]?.children?.[1]?.content).toEqual([{ type: "text", text: "B1" }]);
    view.destroy();
  });

  it("Backspace at the very start of the first cell of a row is a no-op (never merges into the row)", () => {
    const store = fromDoc(tableDoc(), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(toDoc(view.getState().store)).toEqual(toDoc(state.store));
    expect(view.getState().selection).toEqual({ type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } });
    view.destroy();
  });
});

describe("FOCUSED_ATTR follows every selection change, not just content commits", () => {
  it("moves data-jul-editor-focused when the selection moves to a different block via setState (a selection-only change, no store edit)", () => {
    const store = fromDoc(doc([para("p1", "a"), para("p2", "b")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    expect(root.querySelector(`[data-id="p1"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(true);
    expect(root.querySelector(`[data-id="p2"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(false);

    const next: EditorState = { store, selection: { type: "text", anchor: { blockId: "p2", offset: 0 }, focus: { blockId: "p2", offset: 0 } } };
    view.setState(next);

    expect(root.querySelector(`[data-id="p1"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(false);
    expect(root.querySelector(`[data-id="p2"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(true);
    view.destroy();
  });

  it("is absent everywhere once the selection is non-collapsed (a real range, not a caret)", () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    expect(root.querySelector(`[data-id="p1"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(true);

    const next: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } } };
    view.setState(next);
    expect(root.querySelector(`[data-id="p1"]`)!.hasAttribute(FOCUSED_ATTR)).toBe(false);
    view.destroy();
  });
});
