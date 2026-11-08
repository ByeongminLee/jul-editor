// @vitest-environment jsdom
// jsdom-level regression coverage for two bugs found while building out
// full IME coverage (real OS composition can't be driven from jsdom -- these
// are unit-level, e2e/ime.spec.ts covers the same behaviors end-to-end via
// CDP against a real Chromium):
// 1. Composing into a just-toggled stored mark (Mod+b with a collapsed caret,
//    then compose) silently dropped the mark entirely -- the IME absorb path
//    (ime.ts's syncBlockFromDOM) never consulted marks.ts's stored-mark
//    mechanism at all, unlike the plain-typing path (onInsertText).
// 2. A programmatic command (a toolbar button's click handler calling
//    `commands.*`/`update` directly) never fires a beforeinput/keydown of its
//    own, so it bypassed the pending-composition flush every real keyboard
//    event gets for free -- `view.flushPendingComposition()`
//    closes that gap.
// Also covers: codeBlock's content is literal ("code", not "inline") --
// markdown input rules ("# ", "- ", ...) must never fire inside one.
import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { fromDoc, toDoc } from "../store/store.js";
import { doc, para } from "../store/test-helpers.js";
import { createTransaction } from "../store/transaction.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import { CONTENT_ATTR } from "./dom.js";
import type { Extensions } from "./interaction.js";
import { createView } from "./";
import { createMarksRef } from "./marks.js";
import { getCaretRect } from "./selection.js";
import { createSuggestionController } from "./suggestion.js";

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

function makeExtensions(d: ReturnType<typeof makeDispatch>): Extensions {
  return {
    keymaps: [],
    inputRules: [],
    marksRef: createMarksRef(),
    onLinkRequest: async () => null,
    suggestions: createSuggestionController({ getState: d.getState, dispatch: d.dispatch, getCaretRect }),
  };
}

function fire(root: HTMLElement, inputType: string, data?: string) {
  root.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true } as InputEventInit));
  root.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ime.ts: composing into a stored-mark override", () => {
  it("wraps freshly composed text in a just-toggled mark", () => {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    extensions.marksRef.stored = [{ type: "bold" }];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.textContent = "한";
    root.dispatchEvent(new Event("input", { bubbles: true }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "한", marks: [{ type: "bold" }] }]);
    view.destroy();
  });

  it("leaves the surrounding text's own marks untouched, wrapping only the composed middle", () => {
    const store = fromDoc(doc([para("p1", "abcd")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    extensions.marksRef.stored = [{ type: "bold" }];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.textContent = "abXYcd"; // "XY" inserted at offset 2, as a real browser's composition write would
    root.dispatchEvent(new Event("input", { bubbles: true }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([
      { type: "text", text: "ab" },
      { type: "text", text: "XY", marks: [{ type: "bold" }] },
      { type: "text", text: "cd" },
    ]);
    view.destroy();
  });

  it("does not touch anything when no stored-mark override was pending (unaffected common case)", () => {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.textContent = "한";
    root.dispatchEvent(new Event("input", { bubbles: true }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "한" }]);
    view.destroy();
  });
});

describe("view.flushPendingComposition()", () => {
  it("absorbs a straggling DOM write that landed after compositionend with no follow-up event", () => {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.textContent = "한글";
    root.dispatchEvent(new Event("input", { bubbles: true }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); // its own best-effort sync commits "한글"
    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "한글" }]);

    // A straggling browser write lands right after, with no input/keydown/
    // compositionend of its own to trigger the normal absorb (the Safari-
    // ordering race) -- the model is stale until the
    // next command's flush.
    content.textContent = "한글책";
    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "한글" }]); // still stale

    view.flushPendingComposition();
    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "한글책" }]); // now absorbed
    view.destroy();
  });

  it("is a no-op when nothing is pending", () => {
    const store = fromDoc(doc([para("p1", "abc")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 3 }, focus: { blockId: "p1", offset: 3 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    expect(() => view.flushPendingComposition()).not.toThrow();
    expect(toDoc(view.getState().store).blocks[0]?.content).toEqual([{ type: "text", text: "abc" }]);
    view.destroy();
  });
});

describe("codeBlock: markdown input rules never fire", () => {
  it("'# ' stays literal text, not a heading conversion", () => {
    const store = fromDoc({ version: 1, blocks: [{ id: "cb", type: "codeBlock", props: {}, content: [] }] }, coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "cb", offset: 0 }, focus: { blockId: "cb", offset: 0 } } };
    const d = makeDispatch(state);
    const extensions = makeExtensions(d);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, extensions });

    fire(root, "insertText", "#");
    fire(root, "insertText", " ");

    const block = toDoc(view.getState().store).blocks[0]!;
    expect(block.type).toBe("codeBlock"); // NOT converted to "heading"
    expect(block.content).toEqual([{ type: "text", text: "# " }]);
    view.destroy();
  });
});
