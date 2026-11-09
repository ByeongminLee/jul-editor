// @vitest-environment jsdom
// jsdom implements neither ClipboardEvent, DataTransfer, nor DragEvent -- a
// plain, cancelable Event with `.clipboardData`/`.dataTransfer`/`.clientX/Y`
// monkey-patched onto it drives the exact same code path (our handlers only
// ever read those properties + call e.preventDefault(), which a plain Event
// supports natively); `decodeClipboard` itself only needs a plain
// {getData, files} object, never a real DataTransfer. Drop's own hit-testing
// (caretRangeFromPoint/elementFromPoint) has no meaningful jsdom
// implementation, so drop-position resolution is covered by e2e/image.spec.ts
// (a real browser) instead -- this file covers paste/upload orchestration,
// which needs no real layout at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { fromDoc, toDoc } from "../store/store.js";
import { bullet, doc, para } from "../store/test-helpers.js";
import { createTransaction } from "../store/transaction.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import { createView } from "./";

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

function fakePasteEvent(clipboardData: { getData(format: string): string; files?: File[] }): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: clipboardData });
  return ev;
}

function dataTransferOf(data: Record<string, string>, files: File[] = []): { getData(format: string): string; files: File[] } {
  return { getData: (format) => data[format] ?? "", files };
}

/** A writable fake DataTransfer for copy/cut -- captures whatever our own
 * `writeClipboardData` (interaction.ts) calls setData() with. */
function writableDataTransfer(): { getData(format: string): string; setData(format: string, value: string): void; data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getData: (format) => data[format] ?? "", setData: (format, value) => (data[format] = value) };
}

function fakeEventOf(type: string, dataTransferProp: "clipboardData" | "dataTransfer", dataTransfer: unknown): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, dataTransferProp, { value: dataTransfer });
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachClipboard: paste", () => {
  it("pastes HTML at the current text selection", () => {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/html": "<p>hello <strong>world</strong></p>" })));

    const resultDoc = toDoc(d.getState().store);
    expect(resultDoc.blocks[0]?.content).toEqual([
      { type: "text", text: "hello " },
      { type: "text", text: "world", marks: [{ type: "bold" }] },
    ]);
    view.destroy();
  });

  function pasteSetup() {
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    return { d, root, view };
  }
  const MD = "# Title\n\n- one\n- two";
  const vscodeData = { "text/plain": MD, "text/html": `<div><span>${MD.replace(/\n/g, "<br>")}</span></div>`, "vscode-editor-data": "{}" };

  it("a VS Code style markdown paste (plain + vscode-editor-data + span html) becomes styled blocks", () => {
    const { d, root, view } = pasteSetup();
    root.dispatchEvent(fakePasteEvent(dataTransferOf(vscodeData)));
    const types = toDoc(d.getState().store).blocks.map((b) => b.type);
    expect(types[0]).toBe("heading");
    expect(JSON.stringify(toDoc(d.getState().store))).not.toContain("# Title");
    expect(types.filter((t) => t === "bulletListItem")).toHaveLength(2);
    view.destroy();
  });

  it("Cmd+Shift+V pastes the same clipboard as plain text, no conversion; the next normal paste converts again", () => {
    const { d, root, view } = pasteSetup();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "V", metaKey: true, shiftKey: true, bubbles: true }));
    root.dispatchEvent(fakePasteEvent(dataTransferOf(vscodeData)));
    let blocks = toDoc(d.getState().store).blocks;
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("# Title");
    root.dispatchEvent(fakePasteEvent(dataTransferOf(vscodeData)));
    blocks = toDoc(d.getState().store).blocks;
    expect(blocks.some((b) => b.type === "bulletListItem")).toBe(true);
    view.destroy();
  });

  it("paste into an EMPTY paragraph replaces it when the fragment starts with a non-paragraph block (heading + bullet)", () => {
    const { d, root, view } = pasteSetup();
    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/plain": "# Title\n- a" })));
    const blocks = toDoc(d.getState().store).blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bulletListItem"]);
    expect(blocks.some((b) => b.id === "p1")).toBe(false); // the empty paragraph is gone, not merged into
    view.destroy();
  });

  it("paste into an EMPTY bullet replaces it when the fragment starts with a heading", () => {
    const store = fromDoc(doc([bullet("b0", "x"), bullet("b1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "b1", offset: 0 }, focus: { blockId: "b1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/plain": "# MD Heading\n\n- item1" })));
    const blocks = toDoc(d.getState().store).blocks;
    expect(blocks.map((b) => b.type)).toEqual(["bulletListItem", "heading", "bulletListItem"]);
    expect(blocks[1]!.content).toEqual([{ type: "text", text: "MD Heading" }]);
    view.destroy();
  });

  it("paste into an empty bullet of a same-type (bullet) fragment still merges into it", () => {
    const store = fromDoc(doc([bullet("b1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "b1", offset: 0 }, focus: { blockId: "b1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/plain": "- one\n- two" })));
    const blocks = toDoc(d.getState().store).blocks;
    expect(blocks[0]!.id).toBe("b1");
    expect(blocks.map((b) => b.type)).toEqual(["bulletListItem", "bulletListItem"]);
    view.destroy();
  });

  it("a paste with no model selection yet (value replaced, caret placed by a click) uses the live DOM caret", () => {
    const store = fromDoc(doc([para("p0", "a"), para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    const content = root.querySelector('[data-id="p1"] > [data-jul-editor-content]')!;
    window.getSelection()!.collapse(content, 0);
    const ev = fakePasteEvent(dataTransferOf({ "text/html": "<p><strong>bold</strong></p>" }));
    root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const blocks = toDoc(d.getState().store).blocks;
    expect(blocks[1]!.content).toEqual([{ type: "text", text: "bold", marks: [{ type: "bold" }] }]);
    view.destroy();
  });

  it("paste into a NON-empty paragraph keeps the merge behaviour", () => {
    const store = fromDoc(doc([para("p1", "ab")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });
    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/plain": "# Title\n- a" })));
    const blocks = toDoc(d.getState().store).blocks;
    expect(blocks[0]!.id).toBe("p1");
    expect(blocks[0]!.type).toBe("paragraph");
    view.destroy();
  });

  it("does nothing when there is no active selection", () => {
    const store = fromDoc(doc([para("p1", "x")]), coreRegistry);
    const state: EditorState = { store, selection: null };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/html": "<p>should not land</p>" })));

    expect(toDoc(d.getState().store)).toEqual(toDoc(store));
    view.destroy();
  });

  it("never reaches the model when the paste target is inside a void's own interactive DOM", () => {
    const store = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }, para("p1", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
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

    innerInput!.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/html": "<p>nope</p>" })));

    expect(toDoc(d.getState().store)).toEqual(toDoc(store)); // unchanged
    view.destroy();
  });

  it("a single void-block fragment (e.g. a pasted <img>) splits the current block around it, not merges inline", () => {
    const store = fromDoc(doc([para("p1", "hello world")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/html": '<img src="https://example.com/x.png" alt="pic">' })));

    const resultDoc = toDoc(d.getState().store);
    expect(resultDoc.blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(resultDoc.blocks[0]!.content).toEqual([{ type: "text", text: "hello" }]);
    expect(resultDoc.blocks[2]!.content).toEqual([{ type: "text", text: " world" }]);
    view.destroy();
  });

  describe("image file upload", () => {
    it("inserts an image block, marks it uploading, then applies the resolved src as a NON-undoable system commit", async () => {
      const store = fromDoc(doc([para("p1", "")]), coreRegistry);
      const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
      const d = makeDispatch(state);
      const root = document.createElement("div");
      document.body.appendChild(root);
      let resolveUpload!: (r: { src: string; assetId?: string }) => void;
      const onUpload = vi.fn(() => new Promise<{ src: string; assetId?: string }>((resolve) => (resolveUpload = resolve)));
      const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, onUpload });

      const file = new File(["x"], "photo.png", { type: "image/png" });
      root.dispatchEvent(fakePasteEvent(dataTransferOf({}, [file])));

      let resultDoc = toDoc(d.getState().store);
      const imageBlock = resultDoc.blocks.find((b) => b.type === "image")!;
      expect(imageBlock).toBeTruthy();
      expect(onUpload).toHaveBeenCalledWith(file, { blockId: imageBlock.id, kind: "image" });
      expect(view.getUploadState(imageBlock.id)).toEqual({ status: "uploading" });

      resolveUpload({ src: "https://cdn/photo.png", assetId: "a1" });
      await Promise.resolve();
      await Promise.resolve(); // let performUpload's .then chain settle

      expect(view.getUploadState(imageBlock.id)).toBeUndefined();
      resultDoc = toDoc(d.getState().store);
      const updated = resultDoc.blocks.find((b) => b.id === imageBlock.id)!;
      expect(updated.props.src).toBe("https://cdn/photo.png");
      expect(updated.props.assetId).toBe("a1");
      view.destroy();
    });

    it("marks 'error' on upload failure; retryUpload re-attempts with the same File", async () => {
      const store = fromDoc(doc([para("p1", "")]), coreRegistry);
      const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
      const d = makeDispatch(state);
      const root = document.createElement("div");
      document.body.appendChild(root);
      const onUpload = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ src: "ok.png" });
      const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch, onUpload });

      const file = new File(["x"], "photo.png", { type: "image/png" });
      root.dispatchEvent(fakePasteEvent(dataTransferOf({}, [file])));
      const imageBlock = toDoc(d.getState().store).blocks.find((b) => b.type === "image")!;

      await vi.waitFor(() => expect(view.getUploadState(imageBlock.id)).toEqual({ status: "error", message: "network down" }));

      view.retryUpload(imageBlock.id);
      expect(onUpload).toHaveBeenCalledTimes(2);
      expect(onUpload.mock.calls[1]![0]).toBe(file);
      await vi.waitFor(() => expect(view.getUploadState(imageBlock.id)).toBeUndefined());
      expect(toDoc(d.getState().store).blocks.find((b) => b.id === imageBlock.id)!.props.src).toBe("ok.png");
      view.destroy();
    });

    it("without onUpload configured, a dropped/pasted image File is ignored entirely (no block inserted)", () => {
      const store = fromDoc(doc([para("p1", "")]), coreRegistry);
      const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
      const d = makeDispatch(state);
      const root = document.createElement("div");
      document.body.appendChild(root);
      const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

      const file = new File(["x"], "photo.png", { type: "image/png" });
      root.dispatchEvent(fakePasteEvent(dataTransferOf({}, [file])));

      expect(toDoc(d.getState().store)).toEqual(toDoc(store));
      view.destroy();
    });
  });
});

describe("attachClipboard: paste into structural targets", () => {
  it("paste into a codeBlock flattens the fragment to plain text", () => {
    const store = fromDoc(doc([{ id: "cb1", type: "codeBlock", props: { language: "" }, content: [] }]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "cb1", offset: 0 }, focus: { blockId: "cb1", offset: 0 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "text/html": "<p><strong>bold</strong> one</p><p>two</p>" })));

    const resultDoc = toDoc(d.getState().store);
    expect(resultDoc.blocks).toHaveLength(1);
    expect(resultDoc.blocks[0]!.content).toEqual([{ type: "text", text: "bold one\ntwo" }]);
    view.destroy();
  });

  it("paste a multi-block jul-editor-json fragment into a nested bulletListItem preserves nesting", () => {
    const store = fromDoc(doc([bullet("li1", "parent")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "li1", offset: 6 }, focus: { blockId: "li1", offset: 6 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const json = JSON.stringify({
      version: 1,
      blocks: [{ id: "x1", type: "paragraph", props: {}, content: [{ type: "text", text: "X" }], children: [{ id: "x1a", type: "paragraph", props: {}, content: [{ type: "text", text: "nested" }] }] }],
    });
    root.dispatchEvent(fakePasteEvent(dataTransferOf({ "application/x-jul-editor+json": json })));

    const resultDoc = toDoc(d.getState().store);
    expect(resultDoc.blocks[0]!.content).toEqual([{ type: "text", text: "parentX" }]);
    expect(resultDoc.blocks[0]!.children?.[0]?.content).toEqual([{ type: "text", text: "nested" }]);
    view.destroy();
  });
});

describe("copy/cut (interaction.ts)", () => {
  it("copy writes all 3 MIME formats for the current text selection and does not modify the doc", () => {
    const store = fromDoc(doc([para("p1", "hello world")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const dt = writableDataTransfer();
    root.dispatchEvent(fakeEventOf("copy", "clipboardData", dt));

    expect(dt.data["text/plain"]).toContain("hello");
    expect(dt.data["text/html"]).toContain("hello");
    expect(JSON.parse(dt.data["application/x-jul-editor+json"]!).blocks[0].content).toEqual([{ type: "text", text: "hello" }]);
    expect(toDoc(d.getState().store)).toEqual(toDoc(store)); // unchanged
    view.destroy();
  });

  it("cut writes the same data AND deletes the selection in exactly one undo-relevant commit", () => {
    const store = fromDoc(doc([para("p1", "hello world")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const dt = writableDataTransfer();
    root.dispatchEvent(fakeEventOf("cut", "clipboardData", dt));

    expect(dt.data["text/plain"]).toBe("hello");
    expect(toDoc(d.getState().store).blocks[0]!.content).toEqual([{ type: "text", text: " world" }]);
    view.destroy();
  });

  it("copy/cut with a collapsed selection (nothing to copy) is a no-op", () => {
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const dt = writableDataTransfer();
    root.dispatchEvent(fakeEventOf("copy", "clipboardData", dt));
    expect(dt.data["text/plain"]).toBeUndefined();
    root.dispatchEvent(fakeEventOf("cut", "clipboardData", dt));
    expect(dt.data["text/plain"]).toBeUndefined();
    expect(toDoc(d.getState().store)).toEqual(toDoc(store));
    view.destroy();
  });

  it("a block selection's copy/cut round-trips through jul-editor-json with fresh, non-colliding ids", () => {
    const store = fromDoc(doc([bullet("li1", "parent", [bullet("li1a", "child")]), para("p2", "")]), coreRegistry);
    const state: EditorState = { store, selection: { type: "block", ids: ["li1"] } };
    const d = makeDispatch(state);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = createView({ element: root, state, registry: coreRegistry, dispatch: d.dispatch });

    const dt = writableDataTransfer();
    root.dispatchEvent(fakeEventOf("copy", "clipboardData", dt));
    const json = dt.data["application/x-jul-editor+json"]!;
    expect(JSON.parse(json).blocks[0].id).toBe("li1"); // the copy itself keeps the original id (decodeClipboard reissues on the PASTE side)

    // A BLOCK-selection paste target (replacing p2 wholesale) rather than a
    // text caret -- pasting a single-block fragment at a text caret merges
    // its content inline into the target instead of inserting a distinct
    // block (see buildInsertFragmentOps), which isn't what this test is
    // checking (id reissue).
    d.dispatch((tx) => tx.setSelection({ type: "block", ids: ["p2"] }));
    view.setState(d.getState()); // sync the view's own state mirror (d.dispatch bypasses createView's runDispatch wrapper)
    root.dispatchEvent(fakePasteEvent({ getData: (format) => (format === "application/x-jul-editor+json" ? json : "") }));

    const resultDoc = toDoc(d.getState().store);
    expect(resultDoc.blocks).toHaveLength(2); // li1 (unchanged, copy never deletes) + the pasted copy (replaced p2)
    const pasted = resultDoc.blocks[1]!;
    expect(pasted.type).toBe("bulletListItem");
    expect(pasted.id).not.toBe("li1"); // reissued
    expect(pasted.children?.[0]?.id).not.toBe("li1a"); // reissued
    view.destroy();
  });
});
