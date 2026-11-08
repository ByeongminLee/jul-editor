// Row/column hover handles -- the consumer draws its own 3-dot menu
// (this hook owns no DOM/CSS of its own, matches every other @jul-editor/react
// hook here); report which row/col the pointer is over via
// `setHoverRow`/`setHoverColumn` (e.g. from that row/column's own
// onMouseEnter), read back its live rect (for positioning the handle) and
// call the action it exposes. Actions go through `editor.update` directly
// (not `useCommands()`) since they act on the HOVERED row/column, not
// necessarily the current selection the way every toolbar atom's plain
// `commands.xxx()` call does.
//
// Row/col -> cellId resolution is now grid-aware (`tableGrid`, same
// as mergeCells/splitCell/moveRow/moveColumn already were) -- a merged
// table's hover handles now act on the actual anchor cell at that grid
// position instead of a raw (and, across a merge, misaligned) childIds index.

import type { Transaction } from "@jul-editor/core";
import { tableGrid } from "@jul-editor/core";
import { useCallback, useState } from "react";
import { useEditorContext } from "../context.js";
import { useEditor } from "../hooks.js";

export interface TableHoverRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TableHoverHandle {
  row: number | null;
  col: number | null;
  rowRect: TableHoverRect | null;
  colRect: TableHoverRect | null;
  setHoverRow(row: number | null): void;
  setHoverColumn(col: number | null): void;
  insertRowAbove(): void;
  insertRowBelow(): void;
  insertColumnLeft(): void;
  insertColumnRight(): void;
  deleteRow(): void;
  deleteColumn(): void;
  moveRowUp(): void;
  moveRowDown(): void;
  moveColumnLeft(): void;
  moveColumnRight(): void;
}

function toRect(r: DOMRect | null): TableHoverRect | null {
  return r && { top: r.top, left: r.left, width: r.width, height: r.height };
}

function union(a: TableHoverRect, b: TableHoverRect): TableHoverRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

/** `tableId`: which table this hook tracks hover for -- a consumer building
 * a custom table UI already has this (it's rendering that one table's own
 * block). Owns its own row/col hover state (like useTableGridPicker); report
 * it via `setHoverRow`/`setHoverColumn` from each row/column's own
 * onMouseEnter (and `null` on onMouseLeave). */
export function useTableHover(tableId: string | null): TableHoverHandle {
  const editor = useEditor();
  const ctx = useEditorContext("useTableHover");
  const [row, setHoverRow] = useState<number | null>(null);
  const [col, setHoverColumn] = useState<number | null>(null);

  const state = editor?.getState();
  const table = tableId && state ? state.store.records.get(tableId) : undefined;
  const grid = table && state ? tableGrid(state.store, ctx.registry, tableId!) : [];

  // A plain `grid[row][0]` / `grid[0][col]` lookup picks whatever cell
  // sits at that grid position, which -- when a rowspan/colspan from an
  // earlier row/column covers it -- is that EARLIER cell's own anchor, not
  // one actually anchored at the hovered index. Core's row/column ops
  // (deleteRow, addRowBefore/After, ...) resolve their target back through
  // `cellGridPosition(cellId).row`, so handing them that anchor acts on the
  // WRONG row/column (e.g. hovering row 1 of a rowspan-2 table deletes row 0).
  // Scan the hovered row/column for a cell whose OWN anchor sits exactly at
  // that index instead -- null (no-op) when every cell there is covered from
  // outside the hovered row/column (rare: the whole row/column is spanned over).
  function anchorCellInRow(r: number): string | null {
    const rowArr = grid[r];
    if (!rowArr) return null;
    for (const slot of rowArr) if (slot && slot.anchor[0] === r) return slot.cellId;
    return null;
  }
  function anchorCellInColumn(c: number): string | null {
    for (const rowArr of grid) {
      const slot = rowArr[c];
      if (slot && slot.anchor[1] === c) return slot.cellId;
    }
    return null;
  }

  const rowId = table && row !== null ? table.childIds[row] : undefined;
  const rowRect = editor && rowId ? toRect(editor.getBlockRect(rowId)) : null;

  let colRect: TableHoverRect | null = null;
  if (editor && grid.length && col !== null) {
    const seen = new Set<string>();
    for (const rowArr of grid) {
      const cellId = rowArr[col]?.cellId;
      if (!cellId || seen.has(cellId)) continue;
      seen.add(cellId);
      const r = toRect(editor.getBlockRect(cellId));
      if (r) colRect = colRect ? union(colRect, r) : r;
    }
  }

  const run = useCallback(
    (build: (tx: Transaction) => Transaction) => {
      editor?.update(build);
    },
    [editor],
  );

  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;

  return {
    row,
    col,
    rowRect,
    colRect,
    setHoverRow,
    setHoverColumn,
    insertRowAbove() {
      const c = row !== null ? anchorCellInRow(row) : null;
      if (c) run((tx) => tx.addRowBefore(c));
    },
    insertRowBelow() {
      const c = row !== null ? anchorCellInRow(row) : null;
      if (c) run((tx) => tx.addRowAfter(c));
    },
    insertColumnLeft() {
      const c = col !== null ? anchorCellInColumn(col) : null;
      if (c) run((tx) => tx.addColumnBefore(c));
    },
    insertColumnRight() {
      const c = col !== null ? anchorCellInColumn(col) : null;
      if (c) run((tx) => tx.addColumnAfter(c));
    },
    deleteRow() {
      const c = row !== null ? anchorCellInRow(row) : null;
      if (c) run((tx) => tx.deleteRow(c));
    },
    deleteColumn() {
      const c = col !== null ? anchorCellInColumn(col) : null;
      if (c) run((tx) => tx.deleteColumn(c));
    },
    moveRowUp() {
      if (tableId && row !== null && row > 0) run((tx) => tx.moveRow(tableId, row, row - 1));
    },
    moveRowDown() {
      if (tableId && row !== null && row < rowCount - 1) run((tx) => tx.moveRow(tableId, row, row + 1));
    },
    moveColumnLeft() {
      if (tableId && col !== null && col > 0) run((tx) => tx.moveColumn(tableId, col, col - 1));
    },
    moveColumnRight() {
      if (tableId && col !== null && col < colCount - 1) run((tx) => tx.moveColumn(tableId, col, col + 1));
    },
  };
}
