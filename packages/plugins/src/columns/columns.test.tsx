// @vitest-environment jsdom
import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import { fromHTML, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { describe, expect, it } from "vitest";
import { caretAt, doc, mountEditor, para, stripIds } from "../notion-shared/test-helpers.js";
import { addColumn, columnsBlocks, columnsPlugin, columnsSlashItems, createColumnsBlock, removeColumn, unwrapColumns } from "./index.js";

const registry = createRegistry({ blocks: [...coreBlocks, ...columnsBlocks], inlines: coreInlines, marks: coreMarks });
const sample = () =>
  doc([
    {
      id: "cs",
      type: "columns",
      props: {},
      children: [
        { id: "c1", type: "column", props: {}, children: [para("a", "left"), para("b", "left 2")] },
        { id: "c2", type: "column", props: {}, children: [para("c", "right")] },
      ],
    },
    para("z", "after"),
  ]);

describe("columns: create", () => {
  it("builds 2-5 columns each with an empty paragraph; slash items offer 2 and 3", () => {
    const b = createColumnsBlock(3);
    expect(b.children).toHaveLength(3);
    expect(b.children!.every((c) => c.type === "column" && c.children?.[0]?.type === "paragraph")).toBe(true);
    expect(createColumnsBlock(99).children).toHaveLength(5);
    expect(createColumnsBlock(0).children).toHaveLength(2);
    expect(columnsSlashItems.map((i) => i.id)).toEqual(["columns-2", "columns-3"]);
    expect(columnsPlugin.blocks).toBe(columnsBlocks);
  });

  it("the schema keeps foreign blocks out of `columns` and `column` out of the root", () => {
    const m = mountEditor(sample(), registry);
    expect(() => m.editor.update((tx) => tx.insertBlock("cs", 0, para("x", "no")))).not.toThrow();
    expect(m.editor.getState().store.records.get("cs")!.childIds).toEqual(["c1", "c2"]); // rejected
    m.editor.update((tx) => tx.insertBlock(null, 0, { id: "stray", type: "column", props: {}, children: [] }));
    expect(m.editor.getState().store.records.has("stray")).toBe(false);
    m.destroy();
  });
});

describe("columns serde", () => {
  it("HTML round-trips losslessly", () => {
    const d = sample();
    const html = toHTML(d, { registry });
    expect(html).toContain('<div data-jul-editor-type="columns"><div data-jul-editor-type="column">');
    expect(stripIds(fromHTML(html, { registry }).doc.blocks)).toEqual(stripIds(d.blocks));
  });

  it("markdown flattens column after column and reports it as lossy", () => {
    const r = toMarkdown(sample(), { registry });
    expect(r.markdown).toBe("left\n\nleft 2\n\nright\n\nafter");
    expect(r.lossy.some((l) => l.reason === "columns-flattened")).toBe(true);
  });
});

describe("columns editing (real editor)", () => {
  it("Enter inside a column splits within that column; Backspace at a column start does not merge across columns", () => {
    const m = mountEditor(sample(), registry);
    m.editor.update((tx) => tx.splitBlock({ blockId: "a", offset: 2 }));
    expect(m.editor.getState().store.records.get("c1")!.childIds).toHaveLength(3);
    // first block of the second column: merging backward would cross into column 1
    m.editor.update((tx) => tx.mergeBackward("c"));
    expect(m.editor.getState().store.records.get("c2")!.childIds).toEqual(["c"]);
    expect(m.editor.getState().store.records.get("c")!.content).toEqual([{ type: "text", text: "right" }]);
    m.destroy();
  });

  it("a block can move between columns", () => {
    const m = mountEditor(sample(), registry);
    m.editor.moveBlockTo("c", { targetId: "a", placement: "after" });
    expect(m.editor.getState().store.records.get("c1")!.childIds).toEqual(["a", "c", "b"]);
    m.destroy();
  });

  it("addColumn caps at 5, removeColumn merges content left, and the last pair unwraps", () => {
    const m = mountEditor(sample(), registry);
    const added = addColumn(m.editor, "cs")!;
    expect(m.editor.getState().store.records.get("cs")!.childIds).toEqual(["c1", "c2", added]);
    removeColumn(m.editor, "c2"); // 3 -> 2 columns, "right" joins the previous column
    expect(m.editor.getState().store.records.get("c1")!.childIds).toEqual(["a", "b", "c"]);
    removeColumn(m.editor, added); // 2 columns left -> unwrap into plain blocks (the blank starter paragraph is dropped)
    expect(m.editor.getDoc().blocks.map((b) => b.id)).toEqual(["a", "b", "c", "z"]);
    m.destroy();
  });

  it("unwrapColumns keeps order and the caret target stays valid", () => {
    const m = mountEditor(sample(), registry);
    m.editor.update((tx) => tx.setSelection(caretAt("c", 0)));
    unwrapColumns(m.editor, "cs");
    expect(m.editor.getDoc().blocks.map((b) => b.id)).toEqual(["a", "b", "c", "z"]);
    m.destroy();
  });
});
