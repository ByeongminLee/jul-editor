// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { createEditor } from "./editor.js";

function twoParas(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] },
      { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "world" }] },
    ],
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createEditor", () => {
  it("opens a slash suggestion for typed slash, not for visiting an existing slash", () => {
    const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
    range.getClientRects ??= () => [] as unknown as DOMRectList;
    range.getBoundingClientRect ??= () => new DOMRect();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "/" }] }] } });
    const updates: { open: boolean; query: string }[] = [];
    const suggestion = editor.registerSuggestion({ char: "/", startOfLine: true, onUpdate: ({ open, query }) => updates.push({ open, query }) });
    const at = (offset: number) => ({ type: "text" as const, anchor: { blockId: "p1", offset }, focus: { blockId: "p1", offset } });

    editor.update((tx) => tx.setSelection(at(1)));
    expect(updates).toEqual([]);
    editor.update((tx) => tx.setSelection(at(0)));
    editor.update((tx) => tx.setSelection(at(1)));
    expect(updates).toEqual([]);

    editor.update((tx) => tx.replaceContent("p1", 0, 1, []).setSelection(at(0)));
    element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true }));
    expect(updates.at(-1)).toEqual({ open: true, query: "" });
    suggestion.closeSuggestion();
    editor.update((tx) => tx.setSelection(at(0)));
    editor.update((tx) => tx.setSelection(at(1)));
    expect(updates.at(-1)).toEqual({ open: false, query: "" });
    editor.destroy();
  });

  it("End/Home move a caret within its text line and cancel page navigation", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "alpha\nbeta" }] }] } });
    const caret = (offset: number) => ({ type: "text" as const, anchor: { blockId: "p1", offset }, focus: { blockId: "p1", offset } });
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event;
    };

    editor.update((tx) => tx.setSelection(caret(2)));
    expect(press("End").defaultPrevented).toBe(true);
    expect(editor.getState().selection).toEqual(caret(5));

    editor.update((tx) => tx.setSelection(caret(9)));
    expect(press("Home").defaultPrevented).toBe(true);
    expect(editor.getState().selection).toEqual(caret(6));

    editor.update((tx) => tx.setSelection(caret(2)));
    expect(press("End", true).defaultPrevented).toBe(true);
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 5 } });
    editor.destroy();
  });

  it("End uses the live DOM caret when keydown races ahead of selectionchange", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
    const text = element.querySelector('[data-id="p1"] [data-jul-editor-content]')!.firstChild!;
    window.getSelection()!.collapse(text, 2);
    expect(editor.getState().selection).toBeNull();

    const event = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } });
    editor.destroy();
  });

  it("getDoc/setDoc round-trip and reset history", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "!"));
    editor.commands.undo();
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello" }]);

    const fresh: Doc = { version: 1, blocks: [{ id: "q1", type: "paragraph", props: {}, content: [{ type: "text", text: "fresh" }] }] };
    editor.setDoc(fresh);
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["q1"]);
    editor.commands.undo(); // history was cleared by setDoc -- a no-op, not a revert to the old doc
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["q1"]);

    editor.destroy();
  });

  it("update() pushes an undoable history entry; undo/redo restore state", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "!"));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello!" }]);

    editor.commands.undo();
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello" }]);

    editor.commands.redo();
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello!" }]);

    editor.destroy();
  });

  it("a selection-only update() is not pushed to history (nothing to undo)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    editor.commands.undo(); // no history entry to pop -- a no-op
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello" }]);

    editor.destroy();
  });

  it("commands.toggleMark/indent/outdent operate on the current selection", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
    editor.commands.toggleMark("bold");
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello", marks: [{ type: "bold" }] }]);

    editor.commands.indent(); // p1 has no preceding sibling -- a no-op, must not throw
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);

    editor.destroy();
  });

  it("native Cmd+Z/Cmd+Shift+Z (beforeinput historyUndo/historyRedo) route to the injected history", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "!"));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello!" }]);

    element.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true } as InputEventInit));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello" }]);

    element.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyRedo", bubbles: true, cancelable: true } as InputEventInit));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello!" }]);

    editor.destroy();
  });

  it("on('change') fires after a committed update", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
    let seen = 0;
    const off = editor.on("change", () => {
      seen++;
    });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "!"));
    expect(seen).toBe(1);

    off();
    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 6 }, "?"));
    expect(seen).toBe(1); // unsubscribed

    editor.destroy();
  });
});

describe("createEditor: table commands", () => {
  it("insertTable inserts after the current selection's block, caret in its first cell, one undo removes it", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });

    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    editor.commands.insertTable(2, 2);

    const doc = editor.getDoc();
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    const sel = editor.getState().selection;
    expect(sel?.type).toBe("text");
    if (sel?.type === "text") expect(editor.getState().store.records.get(sel.anchor.blockId)?.type).toBe("tableCell");

    editor.commands.undo();
    expect(editor.getDoc().blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("addRowAfter/addColumnAfter/deleteRow/deleteColumn/deleteTable/toggleHeaderRow all resolve from the current selection", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    editor.commands.insertTable(2, 2);
    const tableId = editor.getDoc().blocks[1]!.id;

    editor.commands.addRowAfter();
    expect(editor.getDoc().blocks[1]!.children).toHaveLength(3);

    editor.commands.addColumnAfter();
    expect(editor.getDoc().blocks[1]!.children![0]!.children).toHaveLength(3);

    editor.commands.deleteRow();
    expect(editor.getDoc().blocks[1]!.children).toHaveLength(2);

    editor.commands.deleteColumn();
    expect(editor.getDoc().blocks[1]!.children![0]!.children).toHaveLength(2);

    editor.commands.toggleHeaderRow();
    expect(editor.getDoc().blocks[1]!.props.headerRow).toBe(false);

    editor.commands.deleteTable();
    expect(editor.getDoc().blocks.some((b) => b.id === tableId)).toBe(false);

    editor.destroy();
  });

  it("every table command no-ops when the selection isn't inside a table", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    const before = editor.getDoc();

    editor.commands.addRowAfter();
    editor.commands.addColumnAfter();
    editor.commands.deleteRow();
    editor.commands.deleteColumn();
    editor.commands.deleteTable();
    editor.commands.toggleHeaderRow();
    editor.commands.mergeCells();
    editor.commands.splitCell();
    editor.commands.moveRowUp();
    editor.commands.moveRowDown();
    editor.commands.moveColumnLeft();
    editor.commands.moveColumnRight();

    expect(editor.getDoc()).toEqual(before);
    editor.destroy();
  });
});

describe("createEditor: merge/split/move table commands", () => {
  function makeTableEditor() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    editor.commands.insertTable(3, 3);
    const tableId = editor.getDoc().blocks[1]!.id;
    return { editor, tableId };
  }

  it("mergeCells merges the current cells selection, splitCell restores it, one undo step each", () => {
    const { editor, tableId } = makeTableEditor();
    editor.update((tx) => tx.setSelection({ type: "cells", tableId, anchor: [0, 0], focus: [1, 1] }));

    editor.commands.mergeCells();
    const table = editor.getDoc().blocks[1]!;
    expect(table.children).toHaveLength(3);
    expect(table.children![0]!.children).toHaveLength(2); // row 0: the merged anchor + the untouched 3rd cell
    expect(table.children![0]!.children![0]!.props).toMatchObject({ colspan: 2, rowspan: 2 });
    const sel = editor.getState().selection;
    expect(sel?.type).toBe("text");

    editor.commands.undo();
    expect(editor.getDoc().blocks[1]!.children![0]!.children).toHaveLength(3); // back to a plain 3x3

    editor.commands.mergeCells();
    const mergedCellId = editor.getDoc().blocks[1]!.children![0]!.children![0]!.id;
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: mergedCellId, offset: 0 }, focus: { blockId: mergedCellId, offset: 0 } }));
    editor.commands.splitCell();
    expect(editor.getDoc().blocks[1]!.children![0]!.children).toHaveLength(3);
    expect(editor.getDoc().blocks[1]!.children![1]!.children).toHaveLength(3);

    editor.destroy();
  });

  it("mergeCells is a no-op for a single-cell (non-rectangle) cells selection", () => {
    const { editor, tableId } = makeTableEditor();
    editor.update((tx) => tx.setSelection({ type: "cells", tableId, anchor: [0, 0], focus: [0, 0] }));
    const before = editor.getDoc();
    editor.commands.mergeCells();
    expect(editor.getDoc()).toEqual(before);
    editor.destroy();
  });

  it("moveRowDown/moveColumnRight reorder around the current cell; moveRowUp/moveColumnLeft no-op at the edge", () => {
    const { editor } = makeTableEditor();
    const firstRowId = editor.getDoc().blocks[1]!.children![0]!.id;
    const firstCellId = editor.getDoc().blocks[1]!.children![0]!.children![0]!.id;
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: firstCellId, offset: 0 }, focus: { blockId: firstCellId, offset: 0 } }));

    // Already at row 0/col 0 -- "up"/"left" are no-ops.
    const before = editor.getDoc();
    editor.commands.moveRowUp();
    editor.commands.moveColumnLeft();
    expect(editor.getDoc()).toEqual(before);

    editor.commands.moveRowDown();
    expect(editor.getDoc().blocks[1]!.children![1]!.id).toBe(firstRowId);

    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: firstCellId, offset: 0 }, focus: { blockId: firstCellId, offset: 0 } }));
    editor.commands.moveColumnRight();
    expect(editor.getDoc().blocks[1]!.children![1]!.children![1]!.id).toBe(firstCellId);

    editor.destroy();
  });
});

describe("drag handle core API", () => {
  function threeParas(): Doc {
    return {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "one" }] },
        { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "two" }] },
        { id: "p3", type: "paragraph", props: {}, content: [{ type: "text", text: "three" }] },
      ],
    };
  }

  it("getBlockAtPoint returns null when the point misses every block (jsdom never lays out real geometry)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });
    expect(editor.getBlockAtPoint(0, 0)).toBeNull();
    editor.destroy();
  });

  it("getBlockAtPoint resolves the nearest block across the editor's padded canvas", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });
    const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect);
    element.getBoundingClientRect = () => rect(0, 0, 400, 300);
    for (const [id, top] of [["p1", 20], ["p2", 80], ["p3", 140]] as const) {
      const block = element.querySelector(`[data-id="${id}"]`) as HTMLElement;
      block.getBoundingClientRect = () => rect(70, top, 330, top + 30);
    }
    const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
    try {
      expect(editor.getBlockAtPoint(12, 88)?.id).toBe("p2");
      expect(editor.getBlockAtPoint(12, 128)?.id).toBe("p3");
      expect(editor.getBlockAtPoint(12, 265)?.id).toBe("p3");
      expect(editor.getBlockAtPoint(-5, 88)).toBeNull();
    } finally {
      if (original) Object.defineProperty(document, "elementFromPoint", original);
      else delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      editor.destroy();
    }
  });

  it("getBlockRect finds a rendered block's wrapper, null once removed", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });
    expect(editor.getBlockRect("p2")).not.toBeNull();
    expect(editor.getBlockRect("does-not-exist")).toBeNull();
    editor.update((tx) => tx.removeBlock("p2"));
    expect(editor.getBlockRect("p2")).toBeNull();
    editor.destroy();
  });

  it("moveBlockTo reorders a sibling before/after another, one undo step, selection follows the moved block", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });

    editor.moveBlockTo("p3", { targetId: "p1", placement: "before" });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p3", "p1", "p2"]);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["p3"] });

    editor.commands.undo();
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);

    editor.moveBlockTo("p1", { targetId: "p2", placement: "after" });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1", "p3"]);

    editor.destroy();
  });

  it("dropping a block in its current gap does not consume an undo step", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 3 }, "!"));
    editor.moveBlockTo("p1", { targetId: "p2", placement: "before" });
    editor.commands.undo();

    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "one" }]);
    editor.destroy();
  });

  it("moveBlockTo 'child' nests under a container block (paragraph admits any children)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });

    editor.moveBlockTo("p3", { targetId: "p1", placement: "child" });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);
    expect(editor.getState().store.records.get("p1")?.childIds).toEqual(["p3"]);
    expect(editor.getState().store.records.get("p3")?.parentId).toBe("p1");

    editor.destroy();
  });

  it("moveBlockTo rejects dropping a block into its own descendant", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });
    editor.moveBlockTo("p3", { targetId: "p1", placement: "child" }); // p3 is now p1's child
    const before = editor.getDoc();

    editor.moveBlockTo("p1", { targetId: "p3", placement: "after" }); // p3 is p1's own descendant
    editor.moveBlockTo("p1", { targetId: "p3", placement: "child" });
    editor.moveBlockTo("p1", { targetId: "p1", placement: "after" }); // dropping onto itself

    expect(editor.getDoc()).toEqual(before);
    editor.destroy();
  });

  it("moveBlockTo rejects a schema-invalid target (e.g. nesting into a codeBlock)", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "one" }] },
        { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "code" }] },
      ],
    };
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: doc });
    const before = editor.getDoc();

    editor.moveBlockTo("p1", { targetId: "c1", placement: "child" });

    expect(editor.getDoc()).toEqual(before);
    editor.destroy();
  });

  it("moveBlockTo is a no-op for an unknown id/targetId (no history entry pushed)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: threeParas() });
    const before = editor.getDoc();

    editor.moveBlockTo("missing", { targetId: "p1", placement: "after" });
    editor.moveBlockTo("p1", { targetId: "missing", placement: "after" });
    editor.commands.undo(); // nothing was pushed -- must not disturb the doc either

    expect(editor.getDoc()).toEqual(before);
    editor.destroy();
  });

  function fourParas(): Doc {
    return {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "one" }] },
        { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "two" }] },
        { id: "p3", type: "paragraph", props: {}, content: [{ type: "text", text: "three" }] },
        { id: "p4", type: "paragraph", props: {}, content: [{ type: "text", text: "four" }] },
      ],
    };
  }

  it("moveBlocksTo moves a multi-block selection preserving order, as ONE undo step", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: fourParas() });

    // Drag [p1, p3] (doc order) to land after p4.
    editor.moveBlocksTo(["p1", "p3"], { targetId: "p4", placement: "after" });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p4", "p1", "p3"]);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["p1", "p3"] });

    // A single undo reverts the WHOLE multi-block move, not just the last id.
    editor.commands.undo();
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3", "p4"]);

    editor.destroy();
  });

  it("moveBlocksTo dropping [p1, p3] before p2 keeps their relative order (p1 then p3)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: fourParas() });

    editor.moveBlocksTo(["p1", "p3"], { targetId: "p2", placement: "before" });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p3", "p2", "p4"]);

    editor.destroy();
  });

  describe("stored marks (collapsed-caret toggleMark)", () => {
    const caret = (blockId: string, offset: number) => ({ type: "text" as const, anchor: { blockId, offset }, focus: { blockId, offset } });

    it("on('marks') fires and getActiveMarks reflects the pending mark", () => {
      const element = document.createElement("div");
      document.body.appendChild(element);
      const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
      editor.update((tx) => tx.setSelection(caret("p1", 2)));
      const seen: string[][] = [];
      const off = editor.on("marks", () => seen.push(editor.getActiveMarks().map((m) => m.type)));
      editor.commands.toggleMark("bold");
      expect(editor.getActiveMarks().map((m) => m.type)).toEqual(["bold"]);
      expect(seen).toEqual([["bold"]]);
      editor.commands.toggleMark("bold");
      expect(editor.getActiveMarks()).toEqual([]);
      expect(seen).toEqual([["bold"], []]);
      off();
      editor.destroy();
    });

    it("are discarded when the caret moves (no leak into another block or offset)", () => {
      const element = document.createElement("div");
      document.body.appendChild(element);
      const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
      editor.update((tx) => tx.setSelection(caret("p1", 2)));
      editor.commands.toggleMark("bold");
      editor.update((tx) => tx.setSelection(caret("p2", 2)));
      expect(editor.getActiveMarks()).toEqual([]);
      element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "W", bubbles: true, cancelable: true }));
      expect(editor.getDoc().blocks[1]?.content).toEqual([{ type: "text", text: "woWrld" }]);

      editor.update((tx) => tx.setSelection(caret("p1", 2)));
      editor.commands.toggleMark("bold");
      editor.update((tx) => tx.setSelection(caret("p1", 3)));
      expect(editor.getActiveMarks()).toEqual([]);
      editor.destroy();
    });

    it("survive a commit that keeps the caret in place and apply to the next typed text", () => {
      const element = document.createElement("div");
      document.body.appendChild(element);
      const editor = createEditor({ element, registry: coreRegistry, defaultValue: twoParas() });
      editor.update((tx) => tx.setSelection(caret("p1", 5)));
      editor.commands.toggleMark("bold");
      editor.commands.setBlockType("heading", { level: 1 });
      expect(editor.getActiveMarks().map((m) => m.type)).toEqual(["bold"]);
      element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "Q", bubbles: true, cancelable: true }));
      expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "hello" }, { type: "text", text: "Q", marks: [{ type: "bold" }] }]);
      editor.destroy();
    });
  });
});

describe("canApplyMarks / toggleMark across selection kinds", () => {
  function setup() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const cell = (id: string, text: string) => ({ id, type: "tableCell", props: {}, content: [{ type: "text" as const, text }] });
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: { version: 1, blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] },
      { id: "code", type: "codeBlock", props: { language: "js" }, content: [{ type: "text", text: "const accent = 1;" }] },
      { id: "t1", type: "table", props: {}, children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("a", "Docs"), cell("b", "120")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("c", "API"), cell("d", "880")] },
      ] },
    ] } });
    return editor;
  }

  it("is false inside a code block, and Bold there changes nothing", () => {
    const editor = setup();
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "code", offset: 6 }, focus: { blockId: "code", offset: 12 } }));
    expect(editor.canApplyMarks()).toBe(false);
    const before = JSON.stringify(editor.getDoc());
    editor.commands.toggleMark("bold");
    expect(JSON.stringify(editor.getDoc())).toBe(before);
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
    expect(editor.canApplyMarks()).toBe(true);
  });

  it("a cells rectangle formats every selected cell and reports the common marks", () => {
    const editor = setup();
    editor.update((tx) => tx.setSelection({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 1] }));
    expect(editor.canApplyMarks()).toBe(true);
    editor.commands.toggleMark("bold");
    const rows = editor.getDoc().blocks[2]!.children!;
    for (const row of rows) for (const c of row.children!) expect(c.content).toEqual([{ type: "text", text: expect.any(String), marks: [{ type: "bold" }] }]);
    expect(editor.getActiveMarks().map((m) => m.type)).toEqual(["bold"]);
  });
});
