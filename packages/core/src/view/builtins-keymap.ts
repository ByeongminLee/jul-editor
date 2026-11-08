// Attaches the block-level keymap hooks onto the built-in BlockSpec objects
// (same mutate-after-the-fact pattern as serde/builtins-serde.ts -- see that
// file's header comment for why: keeps model/builtins.ts DOM/view-agnostic
// while giving these specific block types real per-block key behavior).
// `attachBuiltinKeymaps()` is called once by view/editor.ts. IMPORTANT: it
// must be an actual FUNCTION CALL, not a bare `import "./builtins-keymap.js"`
// or a value import that's merely referenced-and-discarded -- @jul-editor/core's
// package.json has "sideEffects": false, and esbuild's tree-shaking silently
// drops both of those forms (verified empirically: the mutations vanished
// from the built dist/index.js). A call expression is assumed to have side
// effects and survives; that's why the mutations live inside a function
// instead of running at module top level like builtins-serde.ts's do (that
// file gets away with top-level mutation only because its callers import and
// functionally USE its `coreRegistry` export for real dispatch, not just to
// force the module to load).

import { codeBlock, table, tableCell, todoListItem } from "../model/builtins.js";
import { getProp, isText } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Block } from "../model/types.js";
import { contentLength, siblingsOf } from "../store/store.js";
import { cellGridPosition, cellPosition, tableGrid } from "../store/table.js";
import type { Point } from "../store/types.js";
import { findContentEl } from "./dom.js";
import { consumeCodeBlockLangGrab } from "./input-rules.js";
import type { Keymap } from "./keymap.js";
import { getCaretRect } from "./selection.js";

/** Thin field-renaming wrapper over store/table.ts's cellPosition (its own
 * `rows` field renamed `rowCount` here) -- kept so this file's existing
 * Tab/Shift-Tab handlers don't need touching. */
function cellPos(store: Parameters<typeof cellPosition>[0], cellId: string) {
  const pos = cellPosition(store, cellId);
  return pos && { tableId: pos.tableId, rowId: pos.rowId, row: pos.row, col: pos.col, rowCount: pos.rows };
}

/** Whether `content`'s caret at `offset` sits on the cell's first
 * ("no preceding \n") or last ("no following \n") own model line -- a real
 * per-visual-line check would need the live DOM's own line-box layout, which
 * core has no access to headlessly. Good enough for ArrowUp/Down's "move to
 * the same column, adjacent row" (ties for the common single-line cell, and
 * degrades to "moves within the cell's own multi-line text first" for one
 * with an embedded '\n' -- upgrade to real line-box measurement if that ever
 * matters). */
function isFirstModelLine(text: string, offset: number): boolean {
  return !text.slice(0, offset).includes("\n");
}
function isLastModelLine(text: string, offset: number): boolean {
  return !text.slice(offset).includes("\n");
}

/** a REAL visual-line boundary check -- compares the live caret's own
 * DOMRect (getCaretRect, selection.ts) against the cell's content div's
 * bounding rect. Where `isFirstModelLine`/`isLastModelLine` only know about
 * '\n' characters, this also gets a wrapped (no '\n' at all, just long text)
 * multi-line cell right: the caret sitting on the wrapped line's own visual
 * top/bottom is what should decide "move to the adjacent row" vs "move
 * within this cell's own text". Returns null (caller falls back to the
 * '\n'-proxy) when there's nothing real to measure -- jsdom's
 * getBoundingClientRect is always all-zero (no layout engine at all), so a
 * zero-height rect on either side means "not a real browser layout", not
 * "caret is exactly at the edge". */
function isAtVisualEdge(root: HTMLElement, blockId: string, edge: "top" | "bottom"): boolean | null {
  if (!root) return null; // no live DOM root at all (e.g. a pure-model unit test's KeymapCtx) -- nothing to measure
  const contentEl = findContentEl(root, blockId);
  if (!contentEl) return null;
  const contentRect = contentEl.getBoundingClientRect();
  const caretRect = getCaretRect();
  if (!caretRect || contentRect.height === 0 || caretRect.height === 0) return null;
  const slack = caretRect.height / 2; // half a line's height of tolerance, same idea as a caret's own thickness
  return edge === "top" ? caretRect.top <= contentRect.top + slack : caretRect.bottom >= contentRect.bottom - slack;
}

function isAtFirstLine(root: HTMLElement, blockId: string, text: string, offset: number): boolean {
  return isAtVisualEdge(root, blockId, "top") ?? isFirstModelLine(text, offset);
}
function isAtLastLine(root: HTMLElement, blockId: string, text: string, offset: number): boolean {
  return isAtVisualEdge(root, blockId, "bottom") ?? isLastModelLine(text, offset);
}

function plainText(content: Block["content"]): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : " ")).join("");
}

// "```lang" typed right after the bare "```" conversion (inputRules.ts's
// codeBlockRule -- content:'code' blocks never run input rules themselves, by
// design) sets the language on the SPACE/Enter that follows, iff the block is
// still exactly a bare lang-token (nothing else typed, language still unset)
// -- keydown/keymap dispatch runs regardless of content kind, unlike input
// rules, so this is the one place that can catch it.
const LANG_TOKEN = /^[a-zA-Z0-9_+-]+$/;

function trySetLanguageFromTyped(ctx: Parameters<Keymap[string]>[0]): boolean {
  const sel = ctx.state.selection;
  if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset) return false;
  const blockId = sel.anchor.blockId;
  // only the Space/Enter immediately following a REAL "```" conversion
  // (inputRules.ts's codeBlockRule) may fire this -- a codeBlock loaded from
  // JSON, pasted, or created via a slash command/setBlockType must never have
  // its first word/line silently swallowed as a language. One-shot: this
  // check itself closes the window, matched or not.
  if (!consumeCodeBlockLangGrab(blockId)) return false;
  const rec = ctx.state.store.records.get(blockId);
  if (!rec) return false;
  const currentLang = getProp<string>({ id: rec.id, type: rec.type, props: rec.props }, "language", ctx.registry) ?? "";
  if (currentLang !== "") return false; // already has a language -- a plain space/newline inside real code
  const text = plainText(rec.content);
  if (sel.anchor.offset !== text.length || !LANG_TOKEN.test(text)) return false;
  const caret = { blockId, offset: 0 };
  ctx.dispatch((tx) => tx.setProps(blockId, { language: text }).replaceContent(blockId, 0, text.length, []).setSelection({ type: "text", anchor: caret, focus: caret }));
  return true;
}

export function attachBuiltinKeymaps(): void {
  // ---- codeBlock: Enter inserts a literal newline, Mod-Enter exits it ------

  (codeBlock.keymap as Keymap) = {
    " ": (ctx) => trySetLanguageFromTyped(ctx),
    Enter: (ctx) => {
      if (trySetLanguageFromTyped(ctx)) return true;
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const at = sel.anchor;
      const caret = { blockId: at.blockId, offset: at.offset + 1 };
      ctx.dispatch((tx) =>
        (sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset ? tx : tx.deleteRange(sel))
          .insertText(at, "\n")
          .setSelection({ type: "text", anchor: caret, focus: caret }),
      );
      return true;
    },
    "Mod-Enter": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const { parentId, index } = siblingsOf(ctx.state.store, sel.anchor.blockId);
      const newBlock: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
      const caret = { blockId: newBlock.id, offset: 0 };
      ctx.dispatch((tx) => tx.insertBlock(parentId, index + 1, newBlock).setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },
  };

  // ---- todoListItem: Mod-Enter toggles checked ------------------------------

  (todoListItem.keymap as Keymap) = {
    "Mod-Enter": (ctx) => {
      const sel = ctx.state.selection;
      const blockId = sel?.type === "text" ? sel.anchor.blockId : sel?.type === "block" ? sel.ids[0] : undefined;
      if (!blockId) return false;
      const rec = ctx.state.store.records.get(blockId);
      if (!rec) return false;
      const checked = getProp<boolean>({ id: rec.id, type: rec.type, props: rec.props }, "checked", ctx.registry);
      ctx.dispatch((tx) => tx.setProps(blockId, { checked: !checked }));
      return true;
    },
  };

  // ---- tableCell: Tab/Shift-Tab move between cells, last-cell Tab appends a row --

  (tableCell.keymap as Keymap) = {
    Tab: (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const store = ctx.state.store;
      const pos = cellPos(store, sel.anchor.blockId);
      if (!pos) return false;
      const row = store.records.get(pos.rowId)!;
      if (pos.col + 1 < row.childIds.length) {
        const nextCell = row.childIds[pos.col + 1]!;
        const caret = { blockId: nextCell, offset: 0 };
        ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
        return true;
      }
      const table = store.records.get(pos.tableId)!;
      if (pos.row + 1 < table.childIds.length) {
        const nextRow = store.records.get(table.childIds[pos.row + 1]!)!;
        const firstCell = nextRow.childIds[0]!;
        const caret = { blockId: firstCell, offset: 0 };
        ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
        return true;
      }
      // Last cell of the last row: append a new row with the same column count.
      const cols = row.childIds.length;
      const newRowId = newId();
      const cellIds = Array.from({ length: cols }, () => newId());
      const newRow: Block = {
        id: newRowId,
        type: "tableRow",
        props: {},
        children: cellIds.map((id) => ({ id, type: "tableCell", props: {}, content: [] })),
      };
      const caret = { blockId: cellIds[0]!, offset: 0 };
      ctx.dispatch((tx) => tx.insertBlock(pos.tableId, table.childIds.length, newRow).setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },
    "Shift-Tab": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const store = ctx.state.store;
      const pos = cellPos(store, sel.anchor.blockId);
      if (!pos) return false;
      const row = store.records.get(pos.rowId)!;
      if (pos.col > 0) {
        const prevCell = row.childIds[pos.col - 1]!;
        const len = contentLength(store.records.get(prevCell)?.content);
        const caret = { blockId: prevCell, offset: len };
        ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
        return true;
      }
      if (pos.row > 0) {
        const table = store.records.get(pos.tableId)!;
        const prevRow = store.records.get(table.childIds[pos.row - 1]!)!;
        const lastCell = prevRow.childIds[prevRow.childIds.length - 1]!;
        const len = contentLength(store.records.get(lastCell)?.content);
        const caret = { blockId: lastCell, offset: len };
        ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
        return true;
      }
      return true; // first cell of first row: no-op, but handled (never indents the cell)
    },

    // ---- Enter/Mod-Enter: a cell's own content is 'inline', so the
    // DEFAULT Enter (beforeinput's insertParagraph -> splitBlock) would wrongly
    // split the cell into two sibling blocks -- literal '\n' instead, same
    // shape as codeBlock's own Enter handler above. Mod-Enter exits the WHOLE
    // TABLE (not just the cell), unlike codeBlock's "exit after the block".

    Enter: (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const at = sel.anchor;
      const caret = { blockId: at.blockId, offset: at.offset + 1 };
      ctx.dispatch((tx) =>
        (sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset ? tx : tx.deleteRange(sel))
          .insertText(at, "\n")
          .setSelection({ type: "text", anchor: caret, focus: caret }),
      );
      return true;
    },
    "Mod-Enter": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const pos = cellPos(ctx.state.store, sel.anchor.blockId);
      if (!pos) return false;
      const { parentId, index } = siblingsOf(ctx.state.store, pos.tableId);
      const newBlock: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
      const caret = { blockId: newBlock.id, offset: 0 };
      ctx.dispatch((tx) => tx.insertBlock(parentId, index + 1, newBlock).setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },

    // ---- ArrowUp/Down: move to the same GRID
    // column in the adjacent row -- the DEFAULT arrow behavior would instead
    // follow the headless (no CSS grid) DOM's own linear stacking, i.e. "next
    // cell in this row", since a table renders as plain nested divs with no
    // visual grid layout of its own in core. Uses `tableGrid`/
    // `cellGridPosition` (not raw childIds indices) so a merged cell's own
    // colspan/rowspan doesn't misalign which column ArrowUp/Down lands in
    // across a merge boundary. ArrowDown from the table's very last row exits
    // it entirely (moves to the block right after the table, offset 0).

    ArrowUp: (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const store = ctx.state.store;
      const rec = store.records.get(sel.anchor.blockId);
      if (!isAtFirstLine(ctx.root, sel.anchor.blockId, plainText(rec?.content), sel.anchor.offset)) return false;
      const pos = cellGridPosition(store, ctx.registry, sel.anchor.blockId);
      if (!pos || pos.row <= 0) return false;
      const grid = tableGrid(store, ctx.registry, pos.tableId);
      const aboveCellId = grid[pos.row - 1]?.[pos.col]?.cellId ?? null;
      if (!aboveCellId) return false;
      const offset = Math.min(sel.anchor.offset, contentLength(store.records.get(aboveCellId)?.content));
      const caret = { blockId: aboveCellId, offset };
      ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },
    ArrowDown: (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const store = ctx.state.store;
      const rec = store.records.get(sel.anchor.blockId);
      if (!isAtLastLine(ctx.root, sel.anchor.blockId, plainText(rec?.content), sel.anchor.offset)) return false;
      const pos = cellGridPosition(store, ctx.registry, sel.anchor.blockId);
      if (!pos) return false;
      // `pos.row + pos.rowspan` (not `pos.row + 1`) -- every grid row this
      // cell's OWN rowspan already covers is still the same cell, so the
      // real "next" row starts right after its own bottom edge.
      if (pos.row + pos.rowspan < pos.rows) {
        const grid = tableGrid(store, ctx.registry, pos.tableId);
        const belowCellId = grid[pos.row + pos.rowspan]?.[pos.col]?.cellId ?? null;
        if (!belowCellId) return false;
        const offset = Math.min(sel.anchor.offset, contentLength(store.records.get(belowCellId)?.content));
        const caret = { blockId: belowCellId, offset };
        ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
        return true;
      }
      // Last row: exit the table to the block right after IT (its own next
      // SIBLING, not nextBlockInPreOrder -- that descends into a container's
      // own first child first, which for a table would just re-enter it). A
      // trailing paragraph always exists there when the table is the last
      // block overall (model/canonical.ts's normalization); when something
      // else already follows it and that block has no text-caret slot of its
      // own, this simply doesn't handle the key (falls through to
      // whatever the outer keydown chain does with a plain ArrowDown next,
      // same as any other block boundary it doesn't specially own).
      const { parentId, index } = siblingsOf(store, pos.tableId);
      const siblings = parentId ? store.records.get(parentId)!.childIds : store.rootIds;
      const nextId = siblings[index + 1];
      if (!nextId) return false;
      const nextSpec = ctx.registry.blocks.get(store.records.get(nextId)?.type ?? "");
      if (nextSpec?.content !== "inline" && nextSpec?.content !== "code") return false;
      const caret: Point = { blockId: nextId, offset: 0 };
      ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },

    // ---- Shift-Arrow at a cell edge: starts a
    // `cells` rectangle covering this cell + the adjacent one, in GRID
    // coordinates (`cellGridPosition`, not raw childIds indices -- correct
    // across a merged cell's own span). Anywhere else in the cell's own text,
    // falls through to the browser's ordinary text-selection extension
    // (only ever between two cells, never a
    // partial-cell + rectangle mix).

    "Shift-ArrowRight": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const store = ctx.state.store;
      const len = contentLength(store.records.get(sel.anchor.blockId)?.content);
      if (sel.focus.offset !== len) return false;
      const pos = cellGridPosition(store, ctx.registry, sel.anchor.blockId);
      if (!pos || pos.col + pos.colspan >= pos.cols) return false;
      ctx.dispatch((tx) => tx.setSelection({ type: "cells", tableId: pos.tableId, anchor: [pos.row, pos.col], focus: [pos.row, pos.col + pos.colspan] }));
      return true;
    },
    "Shift-ArrowLeft": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      if (sel.focus.offset !== 0) return false;
      const pos = cellGridPosition(ctx.state.store, ctx.registry, sel.anchor.blockId);
      if (!pos || pos.col <= 0) return false;
      ctx.dispatch((tx) => tx.setSelection({ type: "cells", tableId: pos.tableId, anchor: [pos.row, pos.col], focus: [pos.row, pos.col - 1] }));
      return true;
    },
    "Shift-ArrowDown": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const store = ctx.state.store;
      if (!isAtLastLine(ctx.root, sel.anchor.blockId, plainText(store.records.get(sel.anchor.blockId)?.content), sel.focus.offset)) return false;
      const pos = cellGridPosition(store, ctx.registry, sel.anchor.blockId);
      if (!pos || pos.row + pos.rowspan >= pos.rows) return false;
      ctx.dispatch((tx) => tx.setSelection({ type: "cells", tableId: pos.tableId, anchor: [pos.row, pos.col], focus: [pos.row + pos.rowspan, pos.col] }));
      return true;
    },
    "Shift-ArrowUp": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const store = ctx.state.store;
      if (!isAtFirstLine(ctx.root, sel.anchor.blockId, plainText(store.records.get(sel.anchor.blockId)?.content), sel.focus.offset)) return false;
      const pos = cellGridPosition(store, ctx.registry, sel.anchor.blockId);
      if (!pos || pos.row <= 0) return false;
      ctx.dispatch((tx) => tx.setSelection({ type: "cells", tableId: pos.tableId, anchor: [pos.row, pos.col], focus: [pos.row - 1, pos.col] }));
      return true;
    },
  };

  // ---- table (whole-table keymap, active when a `cells` Selection is
  // current -- keymap.ts's currentBlockKeymap looks it up by `sel.tableId` for
  // exactly that selection type): a plain Arrow collapses the rectangle back
  // to a single text caret in the adjacent cell, so the selection never gets
  // "stuck" once it exists. A Shift-Arrow instead GROWS/SHRINKS the existing
  // rectangle one row/column further, moving only its `focus` corner (the
  // `anchor` corner stays put) -- extending the initial
  // text-selection-to-cells promotion (still exactly one step) to repeated
  // presses.

  (table.keymap as Keymap) = {
    ArrowUp: (ctx) => collapseCellsSelection(ctx, -1, 0),
    ArrowDown: (ctx) => collapseCellsSelection(ctx, 1, 0),
    ArrowLeft: (ctx) => collapseCellsSelection(ctx, 0, -1),
    ArrowRight: (ctx) => collapseCellsSelection(ctx, 0, 1),
    "Shift-ArrowUp": (ctx) => extendCellsSelection(ctx, -1, 0),
    "Shift-ArrowDown": (ctx) => extendCellsSelection(ctx, 1, 0),
    "Shift-ArrowLeft": (ctx) => extendCellsSelection(ctx, 0, -1),
    "Shift-ArrowRight": (ctx) => extendCellsSelection(ctx, 0, 1),
  };
}

/** Moves a `cells` Selection's own `focus` corner by (dRow, dCol), keeping
 * `anchor` fixed -- clamped to the table's actual GRID bounds (`tableGrid`,
 * span-aware: a merged cell's own colspan/rowspan can make a row narrower
 * than the table's own full width, so the row's own childIds length is NOT
 * the right bound) (a no-op, not a clamp-and-move, when the step
 * would leave the table entirely, same boundary style as
 * collapseCellsSelection's row/col clamping just below). */
function extendCellsSelection(ctx: Parameters<Keymap[string]>[0], dRow: number, dCol: number): boolean {
  const sel = ctx.state.selection;
  if (!sel || sel.type !== "cells") return false;
  const grid = tableGrid(ctx.state.store, ctx.registry, sel.tableId);
  const [fr, fc] = sel.focus;
  const targetRow = fr + dRow;
  const targetCol = fc + dCol;
  if (targetRow < 0 || targetRow >= grid.length) return false;
  const rowArr = grid[targetRow] ?? [];
  if (targetCol < 0 || targetCol >= rowArr.length || !rowArr[targetCol]) return false;
  ctx.dispatch((tx) => tx.setSelection({ type: "cells", tableId: sel.tableId, anchor: sel.anchor, focus: [targetRow, targetCol] }));
  return true;
}

function collapseCellsSelection(ctx: Parameters<Keymap[string]>[0], dRow: number, dCol: number): boolean {
  const sel = ctx.state.selection;
  if (!sel || sel.type !== "cells") return false;
  const grid = tableGrid(ctx.state.store, ctx.registry, sel.tableId);
  if (grid.length === 0) return false;
  const [fr, fc] = sel.focus;
  const targetRow = Math.max(0, Math.min(grid.length - 1, fr + dRow));
  const rowArr = grid[targetRow] ?? [];
  const targetCol = Math.max(0, Math.min(rowArr.length - 1, fc + dCol));
  const cellId = rowArr[targetCol]?.cellId ?? null;
  if (!cellId) return false;
  const caret: Point = { blockId: cellId, offset: 0 };
  ctx.dispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
  return true;
}
