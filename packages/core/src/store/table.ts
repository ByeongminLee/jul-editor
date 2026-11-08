// Table structure commands: insertTable / add-or-delete row|column / deleteTable
// / toggleHeaderRow, plus merge/split cells and move row/column.
// Pure builder functions (store in, Op[]+resulting selection out) in the same
// style as edits.ts -- wired onto Transaction by transaction.ts, and onto
// editor.commands by editor.ts.
//
// Grid model: a tableRow's childIds list ONLY the cells that are their
// own ANCHOR (top-left corner of their own colspan x rowspan box) -- a
// position covered by another cell's span has no block of its own at all.
// `tableGrid` (Store-based) / `blockTableGrid` (plain-Block-tree-based, for
// serde/clipboard fragments) compute the full rows x cols matrix from that
// sparser shape, like the HTML table layout algorithm. Every op below that
// needs to know "what's really at row r, col c" goes through one of these
// instead of assuming childIds.length === column count -- true only for a
// table with no merged cells (still the common case, and exactly what the
// original childIds-based functions below were written/tested against).

import { getProp } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline, Json } from "../model/types.js";
import { contentLength, siblingsOf } from "./store.js";
import type { BlockRecord, Op, Point, Selection, Store } from "./types.js";

export interface CellPos {
  tableId: string;
  rowId: string;
  /** 0-based row/col index of this cell within its table. */
  row: number;
  col: number;
  /** Total row count of the table, and this cell's OWN row's cell count. */
  rows: number;
  cols: number;
}

/** `cellId`'s position within its table, or null when `cellId` isn't itself a
 * tableRow's child (i.e. not really a tableCell) -- structural, not a type
 * check, since only a real tableCell can ever be a tableRow's child (schema
 * admits nothing else there). Before merge/split support: `col`/`cols` are raw childIds
 * indices/counts, NOT grid columns -- exactly right for a table with no
 * merged cells (childIds index === grid column then), and left exactly as
 * tested/used everywhere before merge/split support for backward compatibility. Use
 * `cellGridPosition` when spans may be present. */
export function cellPosition(store: Store, cellId: string): CellPos | null {
  const { parentId: rowId, index: col } = siblingsOf(store, cellId);
  if (rowId === null || col < 0) return null;
  const row = store.records.get(rowId);
  if (!row) return null;
  const { parentId: tableId, index: rowIndex, siblings: rows } = siblingsOf(store, rowId);
  if (tableId === null || rowIndex < 0) return null;
  return { tableId, rowId, row: rowIndex, col, rows: rows.length, cols: row.childIds.length };
}

// grid-aware (not raw childIds indices) -- a `cells` Selection's own
// (row, col) is always a GRID position (promoteSelection/the table keymap
// build it from cellGridPosition/tableGrid), so every reader of one must
// resolve it back through the same grid, or a merged cell's covered
// positions land on the wrong childIds-index neighbor.
export function cellIdAt(store: Store, registry: Registry, tableId: string, row: number, col: number): string | null {
  return tableGrid(store, registry, tableId)[row]?.[col]?.cellId ?? null;
}

function emptyCell(): Block {
  return { id: newId(), type: "tableCell", props: {}, content: [] };
}

/** Builds a fresh rows x cols table Block tree (own ids, every cell empty).
 * `opts.headerRow === false` is the only prop ever set explicitly (the
 * schema default is already `true`, so the common case stores no props at
 * all, matching every other builder in this codebase that hands a fresh
 * Block straight to an insertBlock op without running it through
 * normalizeProps first). */
export function buildTableBlock(rows: number, cols: number, opts?: { headerRow?: boolean }): Block {
  const r = Math.max(1, rows);
  const c = Math.max(1, cols);
  const props: Record<string, Json> = {};
  if (opts?.headerRow === false) props.headerRow = false;
  const makeRow = (): Block => ({ id: newId(), type: "tableRow", props: {}, children: Array.from({ length: c }, emptyCell) });
  return { id: newId(), type: "table", props, children: Array.from({ length: r }, makeRow) };
}

export interface TableOpResult {
  ops: Op[];
  selection: Selection | null;
}

// ---- grid layout ------------------------------------------------------

const MAX_SPAN = 100;

/** Clamps a colspan/rowspan prop value to a sane, always-positive integer
 * (schema default 1; a corrupt/adversarial doc could otherwise carry a
 * negative or absurd span that would make grid layout loop forever or hand a
 * huge number straight to an HTML attribute). */
function clampSpan(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_SPAN);
}

function cellSpan(cellRec: BlockRecord | undefined, key: "colspan" | "rowspan", registry: Registry): number {
  if (!cellRec) return 1;
  return clampSpan(getProp<number>({ id: cellRec.id, type: cellRec.type, props: cellRec.props }, key, registry));
}

export interface GridCell {
  cellId: string;
  /** The cell's own top-left ANCHOR position -- equals [r, c] itself exactly
   * when `isAnchor` is true. */
  anchor: [number, number];
  isAnchor: boolean;
  colspan: number;
  rowspan: number;
}

/** Computes a table's logical rows x cols grid (HTML table layout algorithm):
 * every position gets EITHER the anchor cell that starts there, or the
 * anchor cell of whichever earlier cell's colspan/rowspan covers it, or null
 * (a genuine hole -- a ragged/invalid row nothing covers). Pure/read-only;
 * the table's own current (possibly not-yet-repaired) structure is trusted
 * as-is, spans are clamped defensively (`clampSpan`) so a corrupt doc can
 * never make this loop or blow past the table's actual row count. */
export function tableGrid(store: Store, registry: Registry, tableId: string): (GridCell | null)[][] {
  const table = store.records.get(tableId);
  if (!table) return [];
  const rowIds = table.childIds;
  const grid: (GridCell | null)[][] = rowIds.map(() => []);
  for (let r = 0; r < rowIds.length; r++) {
    const row = store.records.get(rowIds[r]!);
    if (!row) continue;
    let col = 0;
    for (const cellId of row.childIds) {
      while (grid[r]![col]) col++;
      const cellRec = store.records.get(cellId);
      const colspan = cellSpan(cellRec, "colspan", registry);
      const rowspan = Math.min(cellSpan(cellRec, "rowspan", registry), rowIds.length - r);
      for (let rr = r; rr < r + rowspan; rr++) {
        (grid[rr] ??= []);
        for (let cc = col; cc < col + colspan; cc++) {
          grid[rr]![cc] = { cellId, anchor: [r, col], isAnchor: rr === r && cc === col, colspan, rowspan };
        }
      }
      col += colspan;
    }
  }
  const width = grid.reduce((m, row) => Math.max(m, row.length), 0);
  for (const row of grid) for (let c = 0; c < width; c++) if (row[c] === undefined) row[c] = null;
  return grid;
}

/** Count of DISTINCT anchor cells in `row` (one grid row of `tableGrid`,
 * or `blockTableGrid`) at columns strictly before `col` -- exactly that
 * row's childIds index a cell landing at grid column `col` would get (every
 * covered position has no childIds entry of its own, so childIds order is
 * always anchor left-to-right grid-column order). */
function countAnchorsBefore(row: readonly ({ isAnchor: boolean } | null)[] | undefined, col: number): number {
  if (!row) return 0;
  let n = 0;
  for (let c = 0; c < col && c < row.length; c++) if (row[c]?.isAnchor) n++;
  return n;
}

export interface GridPos {
  tableId: string;
  rowId: string;
  /** This cell's own ANCHOR row/col (grid coordinates, span-aware). */
  row: number;
  col: number;
  /** Total grid rows/cols of the table. */
  rows: number;
  cols: number;
  colspan: number;
  rowspan: number;
}

/** Span-aware counterpart of `cellPosition`: resolves `cellId`'s ANCHOR
 * position in the table's actual GRID (not its raw childIds index) --
 * needed by every grid-aware op that must reason about covered positions
 * (merge/split/move, and the grid-aware add/delete row|column below). Null
 * for the same cases `cellPosition` returns null for. */
export function cellGridPosition(store: Store, registry: Registry, cellId: string): GridPos | null {
  const basic = cellPosition(store, cellId);
  if (!basic) return null;
  const grid = tableGrid(store, registry, basic.tableId);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    for (let c = 0; c < row.length; c++) {
      const g = row[c];
      if (g && g.isAnchor && g.cellId === cellId) {
        return { tableId: basic.tableId, rowId: basic.rowId, row: r, col: c, rows: grid.length, cols: row.length, colspan: g.colspan, rowspan: g.rowspan };
      }
    }
  }
  return null;
}

// ---- add/delete row|column (grid-aware: a span crossing the edit boundary --------
// is extended/shrunk instead of torn) --------------------------------------------

export function buildAddRowOps(store: Store, registry: Registry, cellId: string, before: boolean): TableOpResult | null {
  const pos = cellGridPosition(store, registry, cellId);
  if (!pos) return null;
  const grid = tableGrid(store, registry, pos.tableId);
  const width = grid[0]?.length ?? pos.cols;
  const insertIdx = before ? pos.row : pos.row + pos.rowspan;
  const ops: Op[] = [];
  const cells: Block[] = [];
  let caretCellId: string | null = null;
  for (let c = 0; c < width; c++) {
    const above = insertIdx > 0 ? (grid[insertIdx - 1]?.[c] ?? null) : null;
    const below = insertIdx < grid.length ? (grid[insertIdx]?.[c] ?? null) : null;
    if (above && below && above.cellId === below.cellId) {
      // A rowspan crosses this boundary -- extend it by one row instead of
      // inserting a brand-new cell at this column (matches how spreadsheets/
      // other table editors insert a row through an existing vertical merge).
      ops.push({ type: "setProps", id: above.cellId, patch: { rowspan: above.rowspan + 1 } });
    } else {
      const id = newId();
      cells.push({ id, type: "tableCell", props: {}, content: [] });
      if (caretCellId === null) caretCellId = id;
    }
  }
  const newRow: Block = { id: newId(), type: "tableRow", props: {}, children: cells };
  ops.push({ type: "insertBlock", parentId: pos.tableId, index: insertIdx, block: newRow });
  const caret: Point = { blockId: caretCellId ?? cellId, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

export function buildAddColumnOps(store: Store, registry: Registry, cellId: string, before: boolean): TableOpResult | null {
  const pos = cellGridPosition(store, registry, cellId);
  if (!pos) return null;
  const grid = tableGrid(store, registry, pos.tableId);
  const insertIdx = before ? pos.col : pos.col + pos.colspan;
  const table = store.records.get(pos.tableId)!;
  const ops: Op[] = [];
  let caretCellId: string | null = null;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const left = insertIdx > 0 ? (row[insertIdx - 1] ?? null) : null;
    const right = insertIdx < row.length ? (row[insertIdx] ?? null) : null;
    const rowId = table.childIds[r]!;
    if (left && right && left.cellId === right.cellId) {
      // A colspan crosses this boundary -- extend it instead of splitting it.
      ops.push({ type: "setProps", id: left.cellId, patch: { colspan: left.colspan + 1 } });
    } else {
      const id = newId();
      const index = countAnchorsBefore(row, insertIdx);
      ops.push({ type: "insertBlock", parentId: rowId, index, block: { id, type: "tableCell", props: {}, content: [] } });
      if (r === pos.row && caretCellId === null) caretCellId = id;
    }
  }
  const caret: Point = { blockId: caretCellId ?? cellId, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

export function buildDeleteRowOps(store: Store, registry: Registry, cellId: string): TableOpResult | null {
  const pos = cellGridPosition(store, registry, cellId);
  if (!pos) return null;
  if (pos.rows <= 1) return buildDeleteTableOps(store, registry, pos.tableId);
  const grid = tableGrid(store, registry, pos.tableId);
  const table = store.records.get(pos.tableId)!;
  const targetRow = pos.row;
  const rowId = table.childIds[targetRow]!;
  const width = grid[0]?.length ?? 0;
  const ops: Op[] = [];
  const handled = new Set<string>();
  // two-or-more rowspan cells relocating out of the SAME deleted row must
  // each land in the grid column order they actually had -- `countAnchorsBefore`
  // below is computed against the PRE-delete next-row grid, so it doesn't (and
  // can't) know about a cell THIS SAME LOOP already relocated into that row at
  // an earlier (smaller) column; `relocatedIntoNextRow` tracks that count and
  // adds it back in, since every earlier-column relocation always lands
  // before this one in the final childIds order.
  let relocatedIntoNextRow = 0;
  for (let c = 0; c < width; c++) {
    const g = grid[targetRow]?.[c];
    if (!g || handled.has(g.cellId)) continue;
    handled.add(g.cellId);
    const [ar] = g.anchor;
    if (ar !== targetRow) {
      // Covered by a rowspan anchored ABOVE this row -- just shrink it.
      const next = g.rowspan - 1;
      ops.push({ type: "setProps", id: g.cellId, patch: { rowspan: next > 1 ? next : undefined } });
    } else if (g.rowspan > 1) {
      // Anchored HERE with a rowspan reaching below -- relocate the cell
      // block (keeps its own content/id) down into the next row it still
      // covers, and shrink the span by the one row being removed.
      const nextRowId = table.childIds[targetRow + 1]!;
      const insertIdx = countAnchorsBefore(grid[targetRow + 1], c) + relocatedIntoNextRow;
      ops.push({ type: "moveBlock", id: g.cellId, newParentId: nextRowId, index: insertIdx });
      relocatedIntoNextRow++;
      const next = g.rowspan - 1;
      ops.push({ type: "setProps", id: g.cellId, patch: { rowspan: next > 1 ? next : undefined } });
    }
    // else: an ordinary (rowspan 1) cell anchored here -- removed along with
    // the row block itself below, nothing extra needed.
  }
  ops.push({ type: "removeBlock", id: rowId });
  const postRowIds = table.childIds.filter((id) => id !== rowId);
  const targetRowId = postRowIds[Math.min(pos.row, postRowIds.length - 1)]!;
  const targetRowRec = store.records.get(targetRowId)!;
  const col = Math.min(pos.col, targetRowRec.childIds.length - 1);
  const caret: Point = { blockId: targetRowRec.childIds[Math.max(0, col)]!, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

export function buildDeleteColumnOps(store: Store, registry: Registry, cellId: string): TableOpResult | null {
  const pos = cellGridPosition(store, registry, cellId);
  if (!pos) return null;
  if (pos.cols <= 1) return buildDeleteTableOps(store, registry, pos.tableId);
  const grid = tableGrid(store, registry, pos.tableId);
  const table = store.records.get(pos.tableId)!;
  const targetCol = pos.col;
  const ops: Op[] = [];
  for (let r = 0; r < table.childIds.length; r++) {
    const g = grid[r]?.[targetCol];
    if (!g) continue;
    if (g.anchor[1] !== targetCol) {
      // Covered by a colspan anchored to the LEFT in this same row -- shrink it.
      const next = g.colspan - 1;
      ops.push({ type: "setProps", id: g.cellId, patch: { colspan: next > 1 ? next : undefined } });
    } else if (g.colspan > 1) {
      // Anchored HERE with a colspan reaching right -- stays in place
      // (colspan is horizontal-only, so the block itself never needs to
      // move), just shrink it by the one column being removed.
      const next = g.colspan - 1;
      ops.push({ type: "setProps", id: g.cellId, patch: { colspan: next > 1 ? next : undefined } });
    } else {
      ops.push({ type: "removeBlock", id: g.cellId });
    }
  }
  const refRow = store.records.get(pos.rowId)!;
  const postCellIds = refRow.childIds.filter((id) => id !== cellId);
  const col = Math.min(pos.col, postCellIds.length - 1);
  if (postCellIds.length === 0) return { ops, selection: null };
  const caret: Point = { blockId: postCellIds[Math.max(0, col)]!, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

/** Removes the whole table, selecting the nearest surviving sibling (a text
 * caret when it has a content slot, else a block selection) -- same fallback
 * shape as interaction.ts's onDeleteBlockSelection. */
export function buildDeleteTableOps(store: Store, registry: Registry, tableId: string): TableOpResult {
  const { siblings, index } = siblingsOf(store, tableId);
  const ops: Op[] = [{ type: "removeBlock", id: tableId }];
  const afterId = siblings[index + 1] ?? null;
  const beforeId = index > 0 ? siblings[index - 1]! : null;
  const targetId = afterId ?? beforeId;
  if (!targetId) return { ops, selection: null };
  const targetRec = store.records.get(targetId);
  const spec = registry.blocks.get(targetRec?.type ?? "");
  if (spec?.content === "inline" || spec?.content === "code") {
    const offset = targetId === beforeId ? contentLength(targetRec?.content) : 0;
    const caret: Point = { blockId: targetId, offset };
    return { ops, selection: { type: "text", anchor: caret, focus: caret } };
  }
  return { ops, selection: { type: "block", ids: [targetId] } };
}

export function buildToggleHeaderRowOps(store: Store, registry: Registry, tableId: string): Op[] {
  const rec = store.records.get(tableId);
  if (!rec) return [];
  const current = getProp<boolean>({ id: rec.id, type: rec.type, props: rec.props }, "headerRow", registry) ?? true;
  return [{ type: "setProps", id: tableId, patch: { headerRow: !current } }];
}

// ---- merge / split cells ---------------------------------------------

/** Merges the rectangle [r1..r2] x [c1..c2] (inclusive, grid coordinates) of
 * `tableId` into one cell. Rejects (null) a non-rectangular selection: every
 * cell touched by the rectangle must be FULLY contained within it (no cell
 * partially inside/outside), and a single already-merged cell exactly
 * filling the rectangle (nothing left to merge) is also rejected. Content is
 * concatenated as separate lines (a literal '\n' inline between each
 * surviving cell's own content, in reading order); the top-left cell keeps
 * its id (and so its content lands first). One TableOpResult -> one dispatch
 * -> one history entry. */
export function buildMergeCellsOps(store: Store, registry: Registry, tableId: string, r1: number, c1: number, r2: number, c2: number): TableOpResult | null {
  const rowMin = Math.min(r1, r2);
  const rowMax = Math.max(r1, r2);
  const colMin = Math.min(c1, c2);
  const colMax = Math.max(c1, c2);
  const grid = tableGrid(store, registry, tableId);
  if (rowMin < 0 || colMin < 0 || rowMax >= grid.length || colMax >= (grid[0]?.length ?? 0)) return null;

  const seen = new Set<string>();
  const cellIds: string[] = [];
  for (let r = rowMin; r <= rowMax; r++) {
    for (let c = colMin; c <= colMax; c++) {
      const g = grid[r]?.[c];
      if (!g) return null; // hole -- an invalid/unrepaired grid, refuse rather than guess
      const [ar, ac] = g.anchor;
      if (ar < rowMin || ac < colMin || ar + g.rowspan - 1 > rowMax || ac + g.colspan - 1 > colMax) return null; // partial overlap
      if (!seen.has(g.cellId)) {
        seen.add(g.cellId);
        cellIds.push(g.cellId);
      }
    }
  }
  if (cellIds.length < 2) return null; // nothing to merge

  const anchorCellId = cellIds[0]!; // top-left-most, by reading order above
  let combined: Inline[] = store.records.get(anchorCellId)?.content ?? [];
  for (let i = 1; i < cellIds.length; i++) {
    const otherContent = store.records.get(cellIds[i]!)?.content ?? [];
    if (otherContent.length > 0) combined = [...combined, { type: "text", text: "\n" }, ...otherContent];
  }
  const ops: Op[] = [];
  const existingLen = contentLength(store.records.get(anchorCellId)?.content);
  ops.push({ type: "replaceContent", id: anchorCellId, from: 0, to: existingLen, inlines: combined });
  for (let i = 1; i < cellIds.length; i++) ops.push({ type: "removeBlock", id: cellIds[i]! });
  ops.push({ type: "setProps", id: anchorCellId, patch: { colspan: colMax - colMin + 1, rowspan: rowMax - rowMin + 1 } });
  const caret: Point = { blockId: anchorCellId, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

/** Splits a merged `cellId` back into its own 1x1 cells (all with empty
 * content) covering the rectangle it used to span -- the anchor keeps its id
 * AND its content; every other position gets a fresh empty tableCell. A
 * no-op (null) for a cell that isn't actually merged (colspan===rowspan===1). */
export function buildSplitCellOps(store: Store, registry: Registry, cellId: string): TableOpResult | null {
  const rec = store.records.get(cellId);
  if (!rec || rec.type !== "tableCell") return null;
  const colspan = cellSpan(rec, "colspan", registry);
  const rowspan = cellSpan(rec, "rowspan", registry);
  if (colspan <= 1 && rowspan <= 1) return null;
  const pos = cellGridPosition(store, registry, cellId);
  if (!pos) return null;
  const grid = tableGrid(store, registry, pos.tableId);
  const table = store.records.get(pos.tableId)!;
  const ops: Op[] = [{ type: "setProps", id: cellId, patch: { colspan: undefined, rowspan: undefined } }];
  for (let r = pos.row; r < pos.row + rowspan; r++) {
    const rowId = table.childIds[r];
    if (!rowId) continue;
    let insertIdx = countAnchorsBefore(grid[r], pos.col);
    for (let c = pos.col; c < pos.col + colspan; c++) {
      if (r === pos.row && c === pos.col) {
        insertIdx++; // the anchor's own (unchanged) slot
        continue;
      }
      ops.push({ type: "insertBlock", parentId: rowId, index: insertIdx, block: { id: newId(), type: "tableCell", props: {}, content: [] } });
      insertIdx++;
    }
  }
  const caret: Point = { blockId: cellId, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

// ---- move row / column -----------------------------------------------

/** True when any rowspan>1 cell's own vertical extent intersects
 * [rangeMin,rangeMax] -- moving (or reordering past) a row inside that range
 * would tear the merge apart. */
function rowSpanCrossesRange(grid: (GridCell | null)[][], rangeMin: number, rangeMax: number): boolean {
  for (const row of grid) {
    for (const g of row) {
      if (g?.isAnchor && g.rowspan > 1) {
        const spanEnd = g.anchor[0] + g.rowspan - 1;
        if (g.anchor[0] <= rangeMax && spanEnd >= rangeMin) return true;
      }
    }
  }
  return false;
}

/** Column counterpart of `rowSpanCrossesRange`. */
function colSpanCrossesRange(grid: (GridCell | null)[][], rangeMin: number, rangeMax: number): boolean {
  for (const row of grid) {
    for (const g of row) {
      if (g?.isAnchor && g.colspan > 1) {
        const spanEnd = g.anchor[1] + g.colspan - 1;
        if (g.anchor[1] <= rangeMax && spanEnd >= rangeMin) return true;
      }
    }
  }
  return false;
}

/** Reorders row `from` to land at index `to` (both plain row-block indices --
 * rows always map 1:1 to blocks, spans never add/remove row blocks). Rejects
 * (null, no-op) when any rowspan>1 cell's vertical extent intersects
 * [min(from,to), max(from,to)] -- moving would split that merge. */
export function buildMoveRowOps(store: Store, registry: Registry, tableId: string, from: number, to: number): TableOpResult | null {
  const table = store.records.get(tableId);
  if (!table) return null;
  const rowIds = table.childIds;
  if (from < 0 || from >= rowIds.length || to < 0 || to >= rowIds.length || from === to) return null;
  const grid = tableGrid(store, registry, tableId);
  if (rowSpanCrossesRange(grid, Math.min(from, to), Math.max(from, to))) return null;
  const rowId = rowIds[from]!;
  const ops: Op[] = [{ type: "moveBlock", id: rowId, newParentId: tableId, index: to }];
  const firstCellId = store.records.get(rowId)?.childIds[0] ?? null;
  const selection: Selection | null = firstCellId ? { type: "text", anchor: { blockId: firstCellId, offset: 0 }, focus: { blockId: firstCellId, offset: 0 } } : null;
  return { ops, selection };
}

/** Reorders grid column `from` to land at index `to`. Rejects (null, no-op)
 * when any colspan>1 cell's horizontal extent intersects [min(from,to),
 * max(from,to)] -- moving would split that merge. Emits one moveBlock per
 * row that actually anchors a cell at column `from` (a row where that
 * position is covered by a rowspan from above has nothing of its own to
 * move -- the row that owns it is handled on its own turn). */
export function buildMoveColumnOps(store: Store, registry: Registry, tableId: string, from: number, to: number): TableOpResult | null {
  const grid = tableGrid(store, registry, tableId);
  const width = grid[0]?.length ?? 0;
  if (width === 0 || from < 0 || from >= width || to < 0 || to >= width || from === to) return null;
  if (colSpanCrossesRange(grid, Math.min(from, to), Math.max(from, to))) return null;
  const table = store.records.get(tableId)!;
  const ops: Op[] = [];
  let caretCellId: string | null = null;
  for (let r = 0; r < grid.length; r++) {
    const fromCell = grid[r]?.[from];
    if (!fromCell || !fromCell.isAnchor) continue;
    const rowId = table.childIds[r]!;
    // `countAnchorsBefore` counts every OTHER anchor before grid column `to`
    // (fromCell itself, wherever it sits, never lands strictly before its
    // own position without also being excluded by the very next line's own
    // removal) -- this is exactly the position moveBlock (below) should
    // insert at within the row's post-removal ("without fromCell") childIds
    // array to land fromCell at grid column `to`.
    const toIdx = countAnchorsBefore(grid[r], to);
    ops.push({ type: "moveBlock", id: fromCell.cellId, newParentId: rowId, index: toIdx });
    if (caretCellId === null) caretCellId = fromCell.cellId;
  }
  if (!caretCellId) return null;
  const caret: Point = { blockId: caretCellId, offset: 0 };
  return { ops, selection: { type: "text", anchor: caret, focus: caret } };
}

// ---- table-shaped paste (grows rows/cols as needed) -------------------------
// pasteFragment's `cells`-selection branch only
// cleared cells; a caret-in-a-cell paste flattened the whole fragment to one
// inline run. A copied table pastes cell-by-cell instead, starting at the
// anchor, growing the target table as needed to fit. also carries
// over a copied cell's own colspan/rowspan (skipping the positions its span
// covers, instead of pre-filling them with brand-new empty cells) -- the
// DESTINATION side stays childIds-index-based (correct as long as the
// destination table itself has no pre-existing merge overlapping the pasted
// rectangle, same assumption the earlier plain-content version already made for plain content).

export interface CellContent {
  content: Inline[];
  colspan: number;
  rowspan: number;
}
/** A table's rows x cols grid: `grid[row][col]` is that cell's own content +
 * span, or null at a position covered by an earlier cell's span (skip it --
 * it's already represented at its anchor). */
export type TableGrid = (CellContent | null)[][];

/** A decoded table Block's own rows x cols grid (see module doc comment's
 * `blockTableGrid` -- same algorithm as `tableGrid`, over a plain Block tree
 * instead of a normalized Store, since a clipboard/paste fragment is a bare
 * Block, not yet in any store). */
export function tableFragmentGrid(registry: Registry, tableBlock: Block): TableGrid {
  const rows = tableBlock.children ?? [];
  const grid: (CellContent | null)[][] = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    let col = 0;
    for (const cell of row.children ?? []) {
      while (grid[r]![col]) col++;
      const colspan = clampSpan(getProp<number>(cell, "colspan", registry));
      const rowspan = Math.min(clampSpan(getProp<number>(cell, "rowspan", registry)), rows.length - r);
      for (let rr = r; rr < r + rowspan; rr++) {
        (grid[rr] ??= []);
        for (let cc = col; cc < col + colspan; cc++) {
          // Only the anchor position gets the real content -- a covered
          // position is represented by null (nothing to paste there on its
          // own; the anchor's own colspan/rowspan below re-creates the span).
          grid[rr]![cc] = rr === r && cc === col ? { content: cell.content ?? [], colspan, rowspan } : null;
        }
      }
      col += colspan;
    }
  }
  return grid;
}

export function buildTablePasteOps(store: Store, registry: Registry, tableId: string, anchorRow: number, anchorCol: number, grid: TableGrid): TableOpResult {
  const srcRows = grid.length;
  const srcCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const table = store.records.get(tableId);
  if (srcRows === 0 || srcCols === 0 || !table) return { ops: [], selection: null };

  const currentRowIds = table.childIds;
  const currentCols = currentRowIds.reduce((m, rid) => Math.max(m, store.records.get(rid)?.childIds.length ?? 0), 0);
  const finalCols = Math.max(currentCols, anchorCol + srcCols);
  const finalRows = Math.max(currentRowIds.length, anchorRow + srcRows);

  function contentFor(r: number, c: number): CellContent | null {
    if (r < anchorRow || r >= anchorRow + srcRows) return null;
    if (c < anchorCol || c >= anchorCol + srcCols) return null;
    return grid[r - anchorRow]?.[c - anchorCol] ?? null;
  }

  const ops: Op[] = [];
  // Grow every existing row out to finalCols, pre-filling a brand-new cell
  // with its share of the pasted grid directly (no separate replaceContent).
  // A covered (null) position is skipped entirely -- no cell there.
  for (let r = 0; r < currentRowIds.length; r++) {
    const rowId = currentRowIds[r]!;
    const row = store.records.get(rowId)!;
    for (let c = row.childIds.length; c < finalCols; c++) {
      const cc = contentFor(r, c);
      if (r >= anchorRow && r < anchorRow + srcRows && c >= anchorCol && c < anchorCol + srcCols && cc === null) continue;
      const props: Record<string, Json> = {};
      if (cc && cc.colspan > 1) props.colspan = cc.colspan;
      if (cc && cc.rowspan > 1) props.rowspan = cc.rowspan;
      ops.push({ type: "insertBlock", parentId: rowId, index: c, block: { id: newId(), type: "tableCell", props, content: cc?.content ?? [] } });
    }
  }
  // Append brand-new rows (finalCols wide) for any row the paste needs beyond
  // the table's current row count, same pre-fill approach.
  for (let r = currentRowIds.length; r < finalRows; r++) {
    const cells: Block[] = [];
    for (let c = 0; c < finalCols; c++) {
      const cc = contentFor(r, c);
      if (r >= anchorRow && r < anchorRow + srcRows && c >= anchorCol && c < anchorCol + srcCols && cc === null) continue;
      const props: Record<string, Json> = {};
      if (cc && cc.colspan > 1) props.colspan = cc.colspan;
      if (cc && cc.rowspan > 1) props.rowspan = cc.rowspan;
      cells.push({ id: newId(), type: "tableCell", props, content: cc?.content ?? [] });
    }
    ops.push({ type: "insertBlock", parentId: tableId, index: r, block: { id: newId(), type: "tableRow", props: {}, children: cells } });
  }
  // Overwrite EXISTING cells within the paste rectangle (their content came
  // from before this paste, so a real replaceContent/setProps -- not a
  // pre-filled insertBlock -- is what actually changes them). A covered
  // (null) source position means some OTHER pasted anchor's span now covers
  // it -- the existing destination cell that used to sit there would
  // otherwise become an orphaned extra column (tableGrid packs childIds
  // left-to-right into the first free column, so a leftover cell here would
  // get silently pushed past the pasted anchor's new span instead); remove
  // it, its own content is superseded by the anchor covering it now.
  for (let r = 0; r < srcRows && anchorRow + r < currentRowIds.length; r++) {
    const rowId = currentRowIds[anchorRow + r]!;
    const originalCols = store.records.get(rowId)!.childIds.length; // BEFORE this paste's own growth ops
    for (let c = 0; c < srcCols && anchorCol + c < originalCols; c++) {
      const cc = grid[r]?.[c];
      const cellId = store.records.get(rowId)!.childIds[anchorCol + c]!;
      if (cc === null || cc === undefined) {
        ops.push({ type: "removeBlock", id: cellId });
        continue;
      }
      const existingLen = contentLength(store.records.get(cellId)?.content);
      ops.push({ type: "replaceContent", id: cellId, from: 0, to: existingLen, inlines: cc.content });
      ops.push({ type: "setProps", id: cellId, patch: { colspan: cc.colspan > 1 ? cc.colspan : undefined, rowspan: cc.rowspan > 1 ? cc.rowspan : undefined } });
    }
  }

  const anchor: [number, number] = [anchorRow, anchorCol];
  const focus: [number, number] = [anchorRow + srcRows - 1, anchorCol + srcCols - 1];
  return { ops, selection: { type: "cells", tableId, anchor, focus } };
}
