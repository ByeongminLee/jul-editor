// Headless hook: "is the current selection inside a table, and if so
// where" -- everything the toolbar atoms + a custom table UI need, without
// re-deriving cellPosition/cellIdAt logic themselves. Read-only (no editing
// behavior lives here, matches every other @jul-editor/react hook's own rule).

import type { EditorState, Registry, Selection as ModelSelection } from "@jul-editor/core";
import { cellGridPosition, cellIdAt, getProp } from "@jul-editor/core";
import { useEditorContext } from "../context.js";
import { useEditorState } from "../hooks.js";

export interface TableState {
  /** False when the current selection isn't inside any table at all -- every
   * other field is then a fixed placeholder (row/col -1, rows/cols 0). */
  inTable: boolean;
  /** This cell's own ANCHOR row/col (grid coordinates, span-aware -- see
   * @jul-editor/core's cellGridPosition). */
  row: number;
  col: number;
  /** Total grid rows/cols of the table. */
  rows: number;
  cols: number;
  /** This cell's own colspan/rowspan (1 when not merged). */
  colspan: number;
  rowspan: number;
  headerRow: boolean;
  tableId: string | null;
  /** The raw `cells` selection when the current selection is a rectangle
   * (not just a single-cell caret) -- null otherwise. */
  selection: Extract<ModelSelection, { type: "cells" }> | null;
}

const NOT_IN_TABLE: TableState = { inTable: false, row: -1, col: -1, rows: 0, cols: 0, colspan: 1, rowspan: 1, headerRow: false, tableId: null, selection: null };

function resolveCellId(state: EditorState, registry: Registry): { cellId: string; cellsSel: Extract<ModelSelection, { type: "cells" }> | null } | null {
  const sel = state.selection;
  if (!sel) return null;
  if (sel.type === "text") {
    return state.store.records.get(sel.anchor.blockId)?.type === "tableCell" ? { cellId: sel.anchor.blockId, cellsSel: null } : null;
  }
  if (sel.type === "cells") {
    const cellId = cellIdAt(state.store, registry, sel.tableId, sel.anchor[0], sel.anchor[1]);
    return cellId ? { cellId, cellsSel: sel } : null;
  }
  return null;
}

function selectTableState(state: EditorState, registry: Registry): TableState {
  const resolved = resolveCellId(state, registry);
  if (!resolved) return NOT_IN_TABLE;
  const pos = cellGridPosition(state.store, registry, resolved.cellId);
  if (!pos) return NOT_IN_TABLE;
  const tableRec = state.store.records.get(pos.tableId);
  const headerRow = tableRec ? (getProp<boolean>({ id: tableRec.id, type: tableRec.type, props: tableRec.props }, "headerRow", registry) ?? true) : true;
  return {
    inTable: true,
    row: pos.row,
    col: pos.col,
    rows: pos.rows,
    cols: pos.cols,
    colspan: pos.colspan,
    rowspan: pos.rowspan,
    headerRow,
    tableId: pos.tableId,
    selection: resolved.cellsSel,
  };
}

function tableStateEqual(a: TableState, b: TableState): boolean {
  return (
    a.inTable === b.inTable &&
    a.row === b.row &&
    a.col === b.col &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.colspan === b.colspan &&
    a.rowspan === b.rowspan &&
    a.headerRow === b.headerRow &&
    a.tableId === b.tableId &&
    JSON.stringify(a.selection) === JSON.stringify(b.selection)
  );
}

export function useTableState(): TableState {
  const ctx = useEditorContext("useTableState");
  return useEditorState((state) => selectTableState(state, ctx.registry), tableStateEqual);
}
