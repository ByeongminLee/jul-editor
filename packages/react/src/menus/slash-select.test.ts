// Pure store-level tests for selectSlashItem's convert-vs-insert-after +
// void-trailing-paragraph rules -- no DOM/view needed, just
// @jul-editor/core's store primitives directly, the same way core's own store
// tests exercise transactions.
import type { Doc, Editor as CoreEditor, EditorState, Transaction } from "@jul-editor/core";
import { coreRegistry, createTransaction, fromDoc, newId, toDoc } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { canInsertSlashItem, selectSlashItem } from "./slash-select.js";
import type { SlashItem } from "./slash-items.js";

function fakeEditor(doc: Doc): { editor: CoreEditor; getDoc: () => Doc } {
  let state: EditorState = { store: fromDoc(doc, coreRegistry), selection: null };
  const editor: Pick<CoreEditor, "getState" | "update"> = {
    getState: () => state,
    update: (build: (tx: Transaction) => Transaction) => {
      const tx = createTransaction(state, coreRegistry);
      const result = build(tx).commit();
      state = result.state;
      return result;
    },
  };
  return { editor: editor as unknown as CoreEditor, getDoc: () => toDoc(state.store) };
}

const HEADING_ITEM: SlashItem = { id: "heading-2", type: "heading", title: "Heading 2", keywords: [], props: { level: 2 } };
const TABLE_ITEM: SlashItem = { id: "table", type: "table", title: "Table", keywords: [] };
const IMAGE_ITEM: SlashItem = { id: "image", type: "image", title: "Image", keywords: [] };

describe("selectSlashItem", () => {
  it("converts an empty block in place when the '/query' is its whole content", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "/heading" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem(HEADING_ITEM, { editor, range: { blockId: "p1", from: 0, to: 8 }, close: () => {} }, coreRegistry);
    const out = getDoc();
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toMatchObject({ id: "p1", type: "heading", props: { level: 2 }, content: [] });
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } });
  });

  it("inserts after (leaving the original block) when the slash wasn't the whole content", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi /heading" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem(HEADING_ITEM, { editor, range: { blockId: "p1", from: 3, to: 11 }, close: () => {} }, coreRegistry);
    const out = getDoc();
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]?.id).toBe("p1"); // original stays, in place, before the new one
    expect(out.blocks[1]?.type).toBe("heading");
  });

  it("a void-like item (image) replaces the empty '/' line, adds a trailing paragraph and puts the caret there", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "/image" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem(IMAGE_ITEM, { editor, range: { blockId: "p1", from: 0, to: 6 }, close: () => {} }, coreRegistry);
    const out = getDoc();
    expect(out.blocks.map((b) => b.type)).toEqual(["image", "paragraph"]);
    const afterId = out.blocks[1]!.id;
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: afterId, offset: 0 }, focus: { blockId: afterId, offset: 0 } });
  });

  it("a void-like item after other text keeps that line and still puts the caret below the new block", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi\n/divider" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem({ id: "divider", type: "divider", title: "Divider", keywords: [] }, { editor, range: { blockId: "p1", from: 3, to: 11 }, close: () => {} }, coreRegistry);
    const out = getDoc();
    expect(out.blocks.map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
    expect(out.blocks[0]?.content).toEqual([{ type: "text", text: "hi\n" }]);
    const afterId = out.blocks[2]!.id;
    expect(editor.getState().selection).toMatchObject({ type: "text", anchor: { blockId: afterId, offset: 0 } });
  });

  it("does nothing in a table cell, where no slash item is admitted", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "t", type: "table", props: {}, children: [{ id: "r", type: "tableRow", props: {}, children: [{ id: "c", type: "tableCell", props: {}, content: [{ type: "text", text: "/head" }] }] }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    expect(canInsertSlashItem(HEADING_ITEM, editor.getState(), "c", coreRegistry)).toBe(false);
    expect(canInsertSlashItem(IMAGE_ITEM, editor.getState(), "c", coreRegistry)).toBe(false);
    const before = JSON.stringify(getDoc());
    selectSlashItem(HEADING_ITEM, { editor, range: { blockId: "c", from: 0, to: 5 }, close: () => {} }, coreRegistry);
    expect(JSON.stringify(getDoc())).toBe(before);
  });

  it("refuses a code block", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "k", type: "codeBlock", props: {}, content: [{ type: "text", text: "/" }] }] };
    const { editor } = fakeEditor(doc);
    expect(canInsertSlashItem(HEADING_ITEM, editor.getState(), "k", coreRegistry)).toBe(false);
  });

  it("table gets a real 3x3 tableRow/tableCell tree (same buildTableBlock(3,3) insertTable itself uses), caret in its first cell", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "/table" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem(TABLE_ITEM, { editor, range: { blockId: "p1", from: 0, to: 6 }, close: () => {} }, coreRegistry);
    const table = getDoc().blocks.find((b) => b.type === "table")!;
    expect(table.children).toHaveLength(3);
    for (const row of table.children ?? []) {
      expect(row.type).toBe("tableRow");
      expect(row.children).toHaveLength(3);
      for (const cell of row.children ?? []) expect(cell.type).toBe("tableCell");
    }
    const firstCellId = table.children![0]!.children![0]!.id;
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: firstCellId, offset: 0 }, focus: { blockId: firstCellId, offset: 0 } });
  });

  it("an item with `create()` (e.g. @jul-editor/plugins' pluginSlashItems) uses it instead of the generic props-only build", () => {
    const richerChart: SlashItem = {
      id: "chart",
      type: "chart",
      title: "Chart",
      keywords: [],
      create: () => ({ id: newId(), type: "chart", props: { kind: "line", source: { type: "inline", csv: "a,1\nb,2" } } }),
    };
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "/chart" }] }] };
    const { editor, getDoc } = fakeEditor(doc);
    selectSlashItem(richerChart, { editor, range: { blockId: "p1", from: 0, to: 6 }, close: () => {} }, coreRegistry);
    const chart = getDoc().blocks.find((b) => b.type === "chart")!;
    expect(chart.props.kind).toBe("line");
    expect(chart.props.source).toEqual({ type: "inline", csv: "a,1\nb,2" });
  });
});
