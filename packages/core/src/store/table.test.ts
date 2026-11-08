import { describe, expect, it } from "vitest";
import { para, r, storeFrom } from "./test-helpers.js";
import { applyOp } from "./ops.js";
import {
  buildAddColumnOps,
  buildAddRowOps,
  buildDeleteColumnOps,
  buildDeleteRowOps,
  buildDeleteTableOps,
  buildMergeBackwardOps,
  buildMergeCellsOps,
  buildMoveColumnOps,
  buildMoveRowOps,
  buildSplitCellOps,
  buildTableBlock,
  buildTablePasteOps,
  buildToggleHeaderRowOps,
  cellGridPosition,
  cellIdAt,
  cellPosition,
  tableFragmentGrid,
  tableGrid,
} from "./";
import { createTransaction } from "./transaction.js";
import type { Op } from "./types.js";
import type { Block } from "../model/types.js";

function commitAll(store: ReturnType<typeof storeFrom>, ops: Op[]) {
  let s = store;
  for (const op of ops) s = applyOp(s, op, r).store;
  return s;
}

function cell(id: string, text = ""): Block {
  return { id, type: "tableCell", props: {}, content: text ? [{ type: "text", text }] : [] };
}

/** A 2x2 table: r1=[a1,b1], r2=[a2,b2]. */
function tableStore() {
  return storeFrom([
    {
      id: "t1",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A1"), cell("b1", "B1")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("a2", "A2"), cell("b2", "B2")] },
      ],
    },
    para("after", "after"),
  ]);
}

describe("cellPosition / cellIdAt", () => {
  it("resolves a cell's table/row/col and dimensions", () => {
    const store = tableStore();
    expect(cellPosition(store, "b2")).toEqual({ tableId: "t1", rowId: "r2", row: 1, col: 1, rows: 2, cols: 2 });
  });

  it("returns null for a non-cell id", () => {
    const store = tableStore();
    expect(cellPosition(store, "after")).toBeNull();
    expect(cellPosition(store, "t1")).toBeNull();
  });

  it("finds a cell by (table, row, col)", () => {
    const store = tableStore();
    expect(cellIdAt(store, r, "t1", 1, 0)).toBe("a2");
    expect(cellIdAt(store, r, "t1", 5, 0)).toBeNull();
  });
});

describe("buildTableBlock", () => {
  it("builds a rows x cols tree of empty cells, header row on by default (omitted prop)", () => {
    const block = buildTableBlock(2, 3);
    expect(block.type).toBe("table");
    expect(block.props).toEqual({});
    expect(block.children).toHaveLength(2);
    for (const row of block.children!) {
      expect(row.type).toBe("tableRow");
      expect(row.children).toHaveLength(3);
      for (const c of row.children!) expect(c).toMatchObject({ type: "tableCell", content: [] });
    }
  });

  it("explicit headerRow:false is stored", () => {
    const block = buildTableBlock(1, 1, { headerRow: false });
    expect(block.props).toEqual({ headerRow: false });
  });

  it("clamps rows/cols to at least 1", () => {
    const block = buildTableBlock(0, 0);
    expect(block.children).toHaveLength(1);
    expect(block.children![0]!.children).toHaveLength(1);
  });
});

describe("insertTable (Transaction)", () => {
  it("inserts a table after the anchor and sets the caret in its first cell", () => {
    const store = storeFrom([para("p1", "hi")]);
    const state = { store, selection: null };
    const result = createTransaction(state, r).insertTable(null, 1, 2, 2).commit();
    expect(result.state.store.rootIds).toHaveLength(2);
    const tableId = result.state.store.rootIds[1]!;
    expect(result.state.store.records.get(tableId)!.type).toBe("table");
    const sel = result.state.selection;
    expect(sel?.type).toBe("text");
    if (sel?.type === "text") {
      const rec = result.state.store.records.get(sel.anchor.blockId);
      expect(rec?.type).toBe("tableCell");
      expect(sel.anchor.offset).toBe(0);
    }
  });

  it("undo removes the whole table in one step", () => {
    const store = storeFrom([para("p1", "hi")]);
    const state = { store, selection: null };
    const tx = createTransaction(state, r);
    const result = tx.insertTable(null, 1, 2, 2).commit();
    expect(result.inverseOps).toHaveLength(1);
    expect(result.inverseOps[0]!.type).toBe("removeBlock");
  });
});

describe("addRowBefore/After", () => {
  it("addRowAfter inserts a same-width row below and carets its first cell", () => {
    const store = tableStore();
    const result = buildAddRowOps(store, r, "a1", false)!;
    const next = commitAll(store, result.ops);
    const table = next.records.get("t1")!;
    expect(table.childIds).toHaveLength(3);
    const newRowId = table.childIds[1]!;
    expect(newRowId).not.toBe("r2");
    const newRow = next.records.get(newRowId)!;
    expect(newRow.childIds).toHaveLength(2);
    expect(next.records.get(newRow.childIds[0]!)!.content).toEqual([]);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: newRow.childIds[0], offset: 0 }, focus: { blockId: newRow.childIds[0], offset: 0 } });
  });

  it("addRowBefore inserts above the reference row", () => {
    const store = tableStore();
    const result = buildAddRowOps(store, r, "a2", true)!;
    const next = commitAll(store, result.ops);
    const table = next.records.get("t1")!;
    expect(table.childIds).toHaveLength(3);
    expect(table.childIds[2]).toBe("r2"); // r2 pushed to the end
    expect(table.childIds[0]).toBe("r1");
  });

  it("is a no-op (null) for a non-cell id", () => {
    const store = tableStore();
    expect(buildAddRowOps(store, r, "after", true)).toBeNull();
  });
});

describe("addColumnBefore/After", () => {
  it("addColumnAfter inserts a new cell into EVERY row at the same column, caret in the reference row's new cell", () => {
    const store = tableStore();
    const result = buildAddColumnOps(store, r, "a1", false)!;
    const next = commitAll(store, result.ops);
    const row1 = next.records.get("r1")!;
    const row2 = next.records.get("r2")!;
    expect(row1.childIds).toHaveLength(3);
    expect(row2.childIds).toHaveLength(3);
    expect(row1.childIds[0]).toBe("a1");
    expect(row1.childIds[2]).toBe("b1");
    const newCellInRow1 = row1.childIds[1]!;
    expect(next.records.get(newCellInRow1)!.content).toEqual([]);
    expect(result.selection).toMatchObject({ type: "text", anchor: { blockId: newCellInRow1 } });
    // row2 also grew, but at the SAME column index (0 = a2, 1 = new, 2 = b2)
    expect(row2.childIds[0]).toBe("a2");
    expect(row2.childIds[2]).toBe("b2");
  });

  it("addColumnBefore inserts to the left of the reference column", () => {
    const store = tableStore();
    const result = buildAddColumnOps(store, r, "b1", true)!;
    const next = commitAll(store, result.ops);
    const row1 = next.records.get("r1")!;
    expect(row1.childIds[0]).toBe("a1");
    expect(row1.childIds[2]).toBe("b1");
  });
});

describe("deleteRow/deleteColumn", () => {
  it("deleteRow removes the row and carets the same column of the next remaining row", () => {
    const store = tableStore();
    const result = buildDeleteRowOps(store, r, "a1")!;
    const next = commitAll(store, result.ops);
    expect(next.records.has("r1")).toBe(false);
    expect(next.records.get("t1")!.childIds).toEqual(["r2"]);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: "a2", offset: 0 }, focus: { blockId: "a2", offset: 0 } });
  });

  it("deleteRow on the last remaining row deletes the whole table instead", () => {
    const store = storeFrom([
      { id: "t1", type: "table", props: {}, children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A1")] }] },
      para("after", "after"),
    ]);
    const result = buildDeleteRowOps(store, r, "a1")!;
    const next = commitAll(store, result.ops);
    expect(next.records.has("t1")).toBe(false);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: "after", offset: 0 }, focus: { blockId: "after", offset: 0 } });
  });

  it("deleteColumn removes that column from every row", () => {
    const store = tableStore();
    const result = buildDeleteColumnOps(store, r, "a1")!;
    const next = commitAll(store, result.ops);
    expect(next.records.get("r1")!.childIds).toEqual(["b1"]);
    expect(next.records.get("r2")!.childIds).toEqual(["b2"]);
    expect(next.records.has("a1")).toBe(false);
    expect(next.records.has("a2")).toBe(false);
  });

  it("deleteColumn on the last remaining column deletes the whole table instead", () => {
    const store = storeFrom([
      { id: "t1", type: "table", props: {}, children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A1")] }] },
      para("after", "after"),
    ]);
    const result = buildDeleteColumnOps(store, r, "a1")!;
    expect(commitAll(store, result.ops).records.has("t1")).toBe(false);
  });
});

describe("deleteTable", () => {
  it("selects a text caret in the following block when it has a content slot", () => {
    const store = tableStore();
    const result = buildDeleteTableOps(store, r, "t1");
    expect(commitAll(store, result.ops).records.has("t1")).toBe(false);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: "after", offset: 0 }, focus: { blockId: "after", offset: 0 } });
  });

  it("falls back to a block selection when the surviving sibling has no content slot", () => {
    const store = storeFrom([
      { id: "t1", type: "table", props: {}, children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("a1")] }] },
      { id: "v1", type: "divider", props: {} },
    ]);
    const result = buildDeleteTableOps(store, r, "t1");
    expect(result.selection).toEqual({ type: "block", ids: ["v1"] });
  });

  it("selects nothing when there is truly no surviving sibling (raw store, bypassing normalizeDoc's trailing-paragraph repair)", () => {
    const store = storeFrom([para("only", "x")]);
    // storeFrom always normalizes (a lone table would get an auto-appended
    // trailing paragraph), so this constructs the raw single-table store by
    // hand to exercise the genuinely-no-sibling case directly.
    const raw = { records: new Map(store.records), rootIds: ["t1"] };
    raw.records.set("t1", { id: "t1", type: "table", props: {}, childIds: ["r1"], parentId: null });
    raw.records.set("r1", { id: "r1", type: "tableRow", props: {}, childIds: ["a1"], parentId: "t1" });
    raw.records.set("a1", { id: "a1", type: "tableCell", props: {}, content: [], childIds: [], parentId: "r1" });
    raw.records.delete("only");
    const result = buildDeleteTableOps(raw, r, "t1");
    expect(result.selection).toBeNull();
  });
});

describe("toggleHeaderRow", () => {
  it("flips the headerRow prop", () => {
    const store = tableStore();
    const next = commitAll(store, buildToggleHeaderRowOps(store, r, "t1"));
    expect(next.records.get("t1")!.props).toEqual({ headerRow: false });
    const next2 = commitAll(next, buildToggleHeaderRowOps(next, r, "t1"));
    expect(next2.records.get("t1")!.props).toEqual({}); // back to the (omitted) default true
  });
});

describe("table paste (grows rows/cols as needed)", () => {
  it("writes a same-size grid into an existing table starting at the anchor", () => {
    const store = tableStore();
    const grid = tableFragmentGrid(r, {
      id: "src",
      type: "table",
      props: {},
      children: [{ id: "sr1", type: "tableRow", props: {}, children: [cell("sc1", "X"), cell("sc2", "Y")] }],
    });
    const result = buildTablePasteOps(store, r, "t1", 0, 0, grid);
    const next = commitAll(store, result.ops);
    expect(next.records.get("a1")!.content).toEqual([{ type: "text", text: "X" }]);
    expect(next.records.get("b1")!.content).toEqual([{ type: "text", text: "Y" }]);
    expect(next.records.get("a2")!.content).toEqual([{ type: "text", text: "A2" }]); // untouched
    expect(result.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 1] });
  });

  it("grows extra columns on every row when pasting past the current width", () => {
    const store = tableStore();
    const grid = tableFragmentGrid(r, {
      id: "src",
      type: "table",
      props: {},
      children: [{ id: "sr1", type: "tableRow", props: {}, children: [cell("sc1", "X"), cell("sc2", "Y"), cell("sc3", "Z")] }],
    });
    const result = buildTablePasteOps(store, r, "t1", 0, 0, grid);
    const next = commitAll(store, result.ops);
    const row1 = next.records.get("r1")!;
    const row2 = next.records.get("r2")!;
    expect(row1.childIds).toHaveLength(3);
    expect(row2.childIds).toHaveLength(3); // grown too, even though the paste doesn't touch row 2
    expect(next.records.get(row1.childIds[2]!)!.content).toEqual([{ type: "text", text: "Z" }]);
    expect(next.records.get(row2.childIds[2]!)!.content).toEqual([]); // grown but not written
  });

  it("grows extra rows when pasting past the current height, anchored mid-table", () => {
    const store = tableStore();
    const grid = tableFragmentGrid(r, {
      id: "src",
      type: "table",
      props: {},
      children: [
        { id: "sr1", type: "tableRow", props: {}, children: [cell("sc1", "X")] },
        { id: "sr2", type: "tableRow", props: {}, children: [cell("sc2", "Y")] },
      ],
    });
    const result = buildTablePasteOps(store, r, "t1", 1, 0, grid);
    const next = commitAll(store, result.ops);
    const table = next.records.get("t1")!;
    expect(table.childIds).toHaveLength(3);
    expect(next.records.get("a2")!.content).toEqual([{ type: "text", text: "X" }]);
    const newRowId = table.childIds[2]!;
    const newRow = next.records.get(newRowId)!;
    expect(newRow.childIds).toHaveLength(2); // matches the table's existing column count
    expect(next.records.get(newRow.childIds[0]!)!.content).toEqual([{ type: "text", text: "Y" }]);
    expect(result.selection).toEqual({ type: "cells", tableId: "t1", anchor: [1, 0], focus: [2, 0] });
  });

  it("no-ops for an empty grid or unknown table id", () => {
    expect(buildTablePasteOps(tableStore(), r, "t1", 0, 0, []).ops).toEqual([]);
    expect(buildTablePasteOps(tableStore(), r, "nope", 0, 0, [[{ content: [], colspan: 1, rowspan: 1 }]]).ops).toEqual([]);
  });
});

describe("mergeBackward at a table cell boundary (Backspace at cell start never merges)", () => {
  it("the first cell of a row merging into its own parent row is a no-op (row has no content slot)", () => {
    const store = tableStore();
    expect(buildMergeBackwardOps(store, "a1", r)).toEqual([]);
  });

  it("a non-first cell backspacing into its own previous sibling cell is also a no-op (isolating boundary)", () => {
    const store = tableStore();
    expect(buildMergeBackwardOps(store, "b1", r)).toEqual([]);
  });
});

/** A 3x3 table: rows row0/row1/row2, cells named c<row><col> (e.g. c12 = row
 * 1, col 2), each cell's own text is its name uppercased. */
function table3x3() {
  const mkRow = (row: number) => ({
    id: `row${row}`,
    type: "tableRow" as const,
    props: {},
    children: [0, 1, 2].map((col) => cell(`c${row}${col}`, `C${row}${col}`)),
  });
  return storeFrom([
    { id: "t1", type: "table", props: {}, children: [mkRow(0), mkRow(1), mkRow(2)] },
    para("after", "after"),
  ]);
}

describe("tableGrid / cellGridPosition", () => {
  it("an un-merged table's grid is every cell as its own 1x1 anchor", () => {
    const store = table3x3();
    const grid = tableGrid(store, r, "t1");
    expect(grid).toHaveLength(3);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        expect(grid[row]![col]).toEqual({ cellId: `c${row}${col}`, anchor: [row, col], isAnchor: true, colspan: 1, rowspan: 1 });
      }
    }
    expect(cellGridPosition(store, r, "c11")).toEqual({ tableId: "t1", rowId: "row1", row: 1, col: 1, rows: 3, cols: 3, colspan: 1, rowspan: 1 });
  });

  it("a colspan/rowspan cell covers the positions to its right/below with its own anchor", () => {
    const store = commitAll(table3x3(), [{ type: "setProps", id: "c00", patch: { colspan: 2, rowspan: 2 } }]);
    const grid = tableGrid(store, r, "t1");
    expect(grid[0]![0]).toMatchObject({ cellId: "c00", anchor: [0, 0], isAnchor: true, colspan: 2, rowspan: 2 });
    expect(grid[0]![1]).toMatchObject({ cellId: "c00", anchor: [0, 0], isAnchor: false });
    expect(grid[1]![0]).toMatchObject({ cellId: "c00", anchor: [0, 0], isAnchor: false });
    expect(grid[1]![1]).toMatchObject({ cellId: "c00", anchor: [0, 0], isAnchor: false });
    // c01/c10/c11 (the cells the merge would have removed) are still present
    // as separate blocks here (this test sets the prop directly, bypassing
    // buildMergeCellsOps) -- the grid still resolves every covered position
    // to the ANCHOR, never the block that happens to still sit there.
    expect(cellGridPosition(store, r, "c00")).toMatchObject({ row: 0, col: 0, colspan: 2, rowspan: 2 });
  });
});

describe("buildMergeCellsOps / buildSplitCellOps", () => {
  it("merges a rectangle: content concatenated, anchor keeps its id, colspan/rowspan set", () => {
    const store = table3x3();
    const result = buildMergeCellsOps(store, r, "t1", 0, 0, 1, 1)!;
    expect(result).not.toBeNull();
    const next = commitAll(store, result.ops);
    expect(next.records.has("c01")).toBe(false);
    expect(next.records.has("c10")).toBe(false);
    expect(next.records.has("c11")).toBe(false);
    const anchor = next.records.get("c00")!;
    expect(anchor.props).toEqual({ colspan: 2, rowspan: 2 });
    // normalizeInline (opReplaceContent) coalesces the adjacent plain-text
    // runs (no marks differ) into one text entry.
    expect(anchor.content).toEqual([{ type: "text", text: "C00\nC01\nC10\nC11" }]);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: "c00", offset: 0 }, focus: { blockId: "c00", offset: 0 } });
    const grid = tableGrid(next, r, "t1");
    expect(grid[0]![0]!.cellId).toBe("c00");
    expect(grid[1]![1]!.cellId).toBe("c00");
    expect(grid[0]![2]!.cellId).toBe("c02"); // untouched
  });

  it("rejects a single cell (nothing to merge)", () => {
    const store = table3x3();
    expect(buildMergeCellsOps(store, r, "t1", 1, 1, 1, 1)).toBeNull();
  });

  it("rejects a rectangle that only partially overlaps an existing merge", () => {
    const store = commitAll(table3x3(), buildMergeCellsOps(table3x3(), r, "t1", 0, 0, 1, 1)!.ops);
    // (0,0)-(1,1) is now one cell; selecting (1,1)-(1,2) touches it only
    // partially (its anchor is at (0,0), outside this rectangle).
    expect(buildMergeCellsOps(store, r, "t1", 1, 1, 1, 2)).toBeNull();
    // But re-selecting exactly its own footprint plus more IS a valid (bigger) merge.
    expect(buildMergeCellsOps(store, r, "t1", 0, 0, 2, 2)).not.toBeNull();
  });

  it("splitCell restores 1x1 cells with empty content, anchor keeps its own content", () => {
    const store = table3x3();
    const merged = commitAll(store, buildMergeCellsOps(store, r, "t1", 0, 0, 1, 1)!.ops);
    const result = buildSplitCellOps(merged, r, "c00")!;
    expect(result).not.toBeNull();
    const next = commitAll(merged, result.ops);
    const grid = tableGrid(next, r, "t1");
    expect(grid[0]![0]!.cellId).toBe("c00");
    expect(next.records.get("c00")!.props).toEqual({});
    expect(next.records.get("c00")!.content).toEqual([{ type: "text", text: "C00\nC01\nC10\nC11" }]);
    const otherIds = new Set([grid[0]![1]!.cellId, grid[1]![0]!.cellId, grid[1]![1]!.cellId]);
    expect(otherIds.size).toBe(3); // three distinct fresh cells
    for (const id of otherIds) expect(next.records.get(id)!.content).toEqual([]);
  });

  it("splitCell is a no-op on an un-merged cell", () => {
    const store = table3x3();
    expect(buildSplitCellOps(store, r, "c00")).toBeNull();
  });
});

describe("buildMoveRowOps / buildMoveColumnOps", () => {
  it("moveRow reorders the row blocks and carets the moved row's first cell", () => {
    const store = table3x3();
    const result = buildMoveRowOps(store, r, "t1", 0, 2)!;
    const next = commitAll(store, result.ops);
    expect(next.records.get("t1")!.childIds).toEqual(["row1", "row2", "row0"]);
    expect(result.selection).toEqual({ type: "text", anchor: { blockId: "c00", offset: 0 }, focus: { blockId: "c00", offset: 0 } });
  });

  it("moveColumn reorders every row's cell at that column", () => {
    const store = table3x3();
    const result = buildMoveColumnOps(store, r, "t1", 0, 2)!;
    const next = commitAll(store, result.ops);
    expect(next.records.get("row0")!.childIds).toEqual(["c01", "c02", "c00"]);
    expect(next.records.get("row1")!.childIds).toEqual(["c11", "c12", "c10"]);
    expect(next.records.get("row2")!.childIds).toEqual(["c21", "c22", "c20"]);
  });

  it("rejects a row move that would tear a rowspan crossing the moved range, but allows one entirely outside it", () => {
    // 4 rows (row0..row3); merge rows 2-3 (col 0) into a rowspan=2 -- rows 0
    // and 1 sit entirely before it, so reordering just those two never
    // touches the span, but any range reaching into [2,3] does.
    const base4 = commitAll(table3x3(), buildAddRowOps(table3x3(), r, "c20", false)!.ops);
    const merged = commitAll(base4, buildMergeCellsOps(base4, r, "t1", 2, 0, 3, 0)!.ops);
    expect(buildMoveRowOps(merged, r, "t1", 1, 3)).toBeNull(); // [1,3] intersects the [2,3] span
    expect(buildMoveRowOps(merged, r, "t1", 0, 1)).not.toBeNull(); // [0,1] -- entirely before the span
  });

  it("rejects a column move that would tear a colspan crossing the moved range, but allows one entirely outside it", () => {
    const base4 = commitAll(table3x3(), buildAddColumnOps(table3x3(), r, "c02", false)!.ops); // 4 columns now
    const merged = commitAll(base4, buildMergeCellsOps(base4, r, "t1", 0, 2, 0, 3)!.ops); // colspan=2 at columns 2-3
    expect(buildMoveColumnOps(merged, r, "t1", 1, 3)).toBeNull(); // [1,3] intersects the [2,3] span
    expect(buildMoveColumnOps(merged, r, "t1", 0, 1)).not.toBeNull(); // [0,1] -- entirely before the span
  });

  it("no-ops for an out-of-range or identical from/to", () => {
    const store = table3x3();
    expect(buildMoveRowOps(store, r, "t1", 0, 0)).toBeNull();
    expect(buildMoveRowOps(store, r, "t1", 0, 5)).toBeNull();
    expect(buildMoveColumnOps(store, r, "t1", 0, 0)).toBeNull();
    expect(buildMoveColumnOps(store, r, "nope", 0, 1)).toBeNull();
  });
});

describe("grid-aware add/delete row|column around an existing merge", () => {
  it("addRowAfter through a vertical merge extends its rowspan instead of splitting it", () => {
    const merged = commitAll(table3x3(), buildMergeCellsOps(table3x3(), r, "t1", 0, 0, 1, 0)!.ops); // c00 rowspan=2 at col 0, rows 0-1
    // c01 (row 0, col 1) is NOT merged -- "add row after" from ITS row (row
    // 0) inserts at boundary index 1, which sits INSIDE c00's span (between
    // its own row 0 and row 1).
    const result = buildAddRowOps(merged, r, "c01", false)!;
    const next = commitAll(merged, result.ops);
    expect(next.records.get("c00")!.props).toMatchObject({ rowspan: 3 });
    expect(next.records.get("t1")!.childIds).toHaveLength(4);
  });

  it("deleteRow through a vertical merge relocates the anchor down and shrinks it", () => {
    const merged = commitAll(table3x3(), buildMergeCellsOps(table3x3(), r, "t1", 0, 0, 1, 0)!.ops); // c00 rowspan=2, rows row0/row1
    const result = buildDeleteRowOps(merged, r, "c00")!; // delete row0 (the anchor's own row)
    const next = commitAll(merged, result.ops);
    expect(next.records.has("row0")).toBe(false);
    expect(next.records.get("c00")!.props).toEqual({}); // rowspan back to (omitted) default 1
    expect(next.records.get("row1")!.childIds[0]).toBe("c00"); // relocated into row1, still first
  });

  it("deleteColumn through a horizontal merge shrinks it in place (no relocation needed)", () => {
    const merged = commitAll(table3x3(), buildMergeCellsOps(table3x3(), r, "t1", 0, 0, 0, 1)!.ops); // c00 colspan=2
    const result = buildDeleteColumnOps(merged, r, "c00")!; // delete col 0 (c00's own anchor column)
    const next = commitAll(merged, result.ops);
    expect(next.records.get("c00")!.props).toEqual({}); // colspan back to (omitted) default 1
    expect(next.records.get("row0")!.childIds[0]).toBe("c00");
  });
});

describe("table paste of a merged region", () => {
  it("preserves colspan/rowspan on the pasted anchor, skips its covered positions", () => {
    const store = table3x3();
    const srcMerged = commitAll(table3x3(), buildMergeCellsOps(table3x3(), r, "t1", 0, 0, 1, 1)!.ops);
    // A real copy of this 2x2 merged region carries TWO row blocks -- row 1
    // has no cells of its own (fully covered by c00's rowspan) but the row
    // block itself still exists, same as the source table's own shape.
    const srcTableBlock: Block = {
      id: "src",
      type: "table",
      props: {},
      children: [
        { id: "sr0", type: "tableRow", props: {}, children: [{ id: "sc00", type: "tableCell", props: srcMerged.records.get("c00")!.props, content: srcMerged.records.get("c00")!.content ?? [] }] },
        { id: "sr1", type: "tableRow", props: {}, children: [] },
      ],
    };
    const grid = tableFragmentGrid(r, srcTableBlock);
    const result = buildTablePasteOps(store, r, "t1", 0, 0, grid);
    const next = commitAll(store, result.ops);
    expect(next.records.get("c00")!.props).toMatchObject({ colspan: 2, rowspan: 2 });
    const pastedGrid = tableGrid(next, r, "t1");
    expect(pastedGrid[1]![1]!.cellId).toBe("c00");
    expect(pastedGrid[0]![2]!.cellId).toBe("c02"); // untouched, outside the pasted 2x2
  });
});
