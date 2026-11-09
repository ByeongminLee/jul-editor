// editor.update(fn)-style transactions: `createTransaction(state, registry)`
// returns a chainable builder; each call applies one Op (or an edit helper's
// Op[]) against the transaction's own running Store, then `.commit()` returns
// the final EditorState + the union of every op's changedIds + the full
// inverse (in undo order).

import { newId } from "../model/id.js";
import { isVoidBlockSpec } from "../model/schema.js";
import type { Registry } from "../model/schema.js";
import type { Block, Json, Mark } from "../model/types.js";
import {
  buildDeleteRangeOps,
  buildIndentOps,
  buildInsertFragmentOps,
  buildInsertTextOps,
  buildMergeBackwardOps,
  buildOutdentOps,
  buildSetBlockTypeOps,
  buildSplitBlockOps,
  buildToggleMarkOps,
} from "./edits.js";
import { applyOp } from "./ops.js";
import { ancestorChain, canAdmit, containerInfo, orderPoints, siblingsOf } from "./store.js";
import {
  buildAddColumnOps,
  buildAddRowOps,
  buildDeleteColumnOps,
  buildDeleteRowOps,
  buildDeleteTableOps,
  buildMergeCellsOps,
  buildMoveColumnOps,
  buildMoveRowOps,
  buildSplitCellOps,
  buildTableBlock,
  buildTablePasteOps,
  buildToggleHeaderRowOps,
  cellPosition,
  tableFragmentGrid,
} from "./table.js";
import type { TableOpResult } from "./table.js";
import type { EditorState, Op, Point, Selection, Store } from "./types.js";

export interface TransactionResult {
  state: EditorState;
  changedIds: Set<string>;
  inverseOps: Op[];
}

/** where a block lands relative to `targetId` -- as a
 * sibling right before/after it, or nested as its last child. */
export type MoveBlockPlacement = "before" | "after" | "child";
export interface MoveBlockTarget {
  targetId: string;
  placement: MoveBlockPlacement;
}

/** Resolves a drag-handle drop into a concrete (newParentId, index) for
 * the existing `moveBlock` op, or null when the move must be rejected --
 * dropping a block onto itself, into its own descendant (which would orphan
 * a whole subtree into a cycle), or into a container its schema doesn't
 * admit (e.g. nesting under a codeBlock, whose `children` is 'none'). Pure
 * (takes `store` explicitly) so it can resolve against either a live
 * EditorState.store (a single move) or a transaction's own running store
 * mid-batch (moveBlocksTo, view/editor.ts). */
export function resolveMoveTarget(store: Store, registry: Registry, id: string, target: MoveBlockTarget): { parentId: string | null; index: number } | null {
  if (id === target.targetId) return null;
  const rec = store.records.get(id);
  if (!rec || !store.records.has(target.targetId)) return null;
  if (ancestorChain(store, target.targetId).includes(id)) return null; // target is id itself or one of its descendants

  let parentId: string | null;
  let index: number;
  if (target.placement === "child") {
    parentId = target.targetId;
    index = store.records.get(parentId)!.childIds.filter((c) => c !== id).length; // append as its last child
  } else {
    const { parentId: pId, siblings } = siblingsOf(store, target.targetId);
    parentId = pId;
    const without = siblings.filter((s) => s !== id);
    const at = without.indexOf(target.targetId);
    index = target.placement === "before" ? at : at + 1;
  }

  const container = containerInfo(store, parentId, registry);
  if (!canAdmit(registry, rec.type, container.type, container.children)) return null;
  return { parentId, index };
}

export interface Transaction {
  insertBlock(parentId: string | null, index: number, block: Block): Transaction;
  removeBlock(id: string): Transaction;
  moveBlock(id: string, newParentId: string | null, index: number): Transaction;
  /** reparents/reorders `id` to sit before/after `target`'s
   * block or nested as its last child, resolved against THIS transaction's
   * own running store (so a caller batching several moves into one
   * transaction sees each move's siblings/indices already shifted by the
   * previous one). A silent no-op when the move is invalid -- dropping onto
   * itself, into its own descendant, or into a container its schema doesn't
   * admit (e.g. nesting under a codeBlock). */
  moveBlockTo(id: string, target: MoveBlockTarget): Transaction;
  setProps(id: string, patch: Record<string, Json | undefined>): Transaction;
  setType(id: string, blockType: string, props?: Record<string, Json>): Transaction;
  /** Wholesale swap of `id`'s own block (type/props/content/children), same
   * id/parent/position -- see store/types.ts's Op "replaceBlock" doc comment.
   * Unlike `setType`, never rejects for "would drop existing content" (a
   * caller reaches for this specifically to do that, e.g. converting a
   * non-empty paragraph straight into a void embed as one undo-safe step). */
  replaceBlock(id: string, block: Block): Transaction;
  replaceContent(id: string, from: number, to: number, inlines: NonNullable<Block["content"]>): Transaction;
  insertText(point: Point, text: string, marks?: Mark[]): Transaction;
  deleteRange(selection: Selection): Transaction;
  /** Splits the block at `point` (see edits.ts's buildSplitBlockOps).
   * `opts.type` gives the block created after the caret a different type
   * (Enter at the end of a heading starts a paragraph). */
  splitBlock(point: Point, opts?: { type?: string }): Transaction;
  mergeBackward(blockId: string): Transaction;
  indent(id: string): Transaction;
  outdent(id: string): Transaction;
  toggleMark(selection: Selection, markType: string, attrs?: Record<string, Json>): Transaction;
  setBlockType(ids: string[], blockType: string, props?: Record<string, Json>): Transaction;
  /** Paste/drop insertion: replaces `selection` with `fragment` (a
   * decoded clipboard/drop fragment's top-level blocks, each with its own
   * fresh id already assigned by the caller). A non-collapsed `selection` is
   * deleted first, then the fragment is inserted at the resulting point --
   * see store/edits.ts's buildInsertFragmentOps for the actual merge rules.
   * Also sets the resulting caret itself (an exception to every other method
   * here leaving selection to the caller): only this method knows the
   * synthesized tail block's id the caret needs to land in. */
  pasteFragment(selection: Selection, fragment: Block[]): Transaction;
  /** inserts a fresh rows x cols table at (parentId, index), caret in
   * its first cell. */
  insertTable(parentId: string | null, index: number, rows: number, cols: number, opts?: { headerRow?: boolean }): Transaction;
  /** Every method below resolves its own table/row/column context from
   * `cellId` (any cell in the row/column/table to act on) -- a no-op when
   * `cellId` doesn't resolve to a real tableCell. */
  addRowBefore(cellId: string): Transaction;
  addRowAfter(cellId: string): Transaction;
  addColumnBefore(cellId: string): Transaction;
  addColumnAfter(cellId: string): Transaction;
  /** Deletes the row/column containing `cellId`; deletes the whole table
   * instead when it's the last remaining row/column. */
  deleteRow(cellId: string): Transaction;
  deleteColumn(cellId: string): Transaction;
  deleteTable(tableId: string): Transaction;
  toggleHeaderRow(tableId: string): Transaction;
  /** merges the grid rectangle [r1..r2] x [c1..c2] of `tableId` into
   * one cell (content concatenated as separate lines); a no-op when the
   * rectangle is non-rectangular (a covered cell only partially inside it) or
   * already a single cell -- see store/table.ts's buildMergeCellsOps. */
  mergeCells(tableId: string, r1: number, c1: number, r2: number, c2: number): Transaction;
  /** splits a merged `cellId` back into its own 1x1 cells (the anchor
   * keeps its content, the rest start empty); a no-op when it isn't merged. */
  splitCell(cellId: string): Transaction;
  /** reorders row/grid-column `from` to land at index `to`; a no-op
   * when it would tear a rowspan/colspan crossing the moved range. */
  moveRow(tableId: string, from: number, to: number): Transaction;
  moveColumn(tableId: string, from: number, to: number): Transaction;
  setSelection(selection: Selection | null): Transaction;
  commit(): TransactionResult;
}

export function createTransaction(state: EditorState, registry: Registry): Transaction {
  let store: Store = state.store;
  let selection = state.selection;
  const changedIds = new Set<string>();
  const inverseOps: Op[] = [];

  function apply(op: Op): void {
    const result = applyOp(store, op, registry);
    store = result.store;
    for (const id of result.changedIds) changedIds.add(id);
    inverseOps.unshift(result.inverse);
  }
  function applyAll(ops: Op[]): void {
    for (const op of ops) apply(op);
  }

  /** Shared by every add/delete row|column|table method: a null `result`
   * means `cellId`/`tableId` didn't resolve (no-op); otherwise applies the
   * builder's ops and adopts its own resulting selection. */
  function runTableOp(result: TableOpResult | null): Transaction {
    if (!result) return tx;
    applyAll(result.ops);
    selection = result.selection;
    return tx;
  }

  const tx: Transaction = {
    insertBlock(parentId, index, block) {
      apply({ type: "insertBlock", parentId, index, block });
      return tx;
    },
    removeBlock(id) {
      apply({ type: "removeBlock", id });
      return tx;
    },
    moveBlock(id, newParentId, index) {
      apply({ type: "moveBlock", id, newParentId, index });
      return tx;
    },
    moveBlockTo(id, target) {
      const resolved = resolveMoveTarget(store, registry, id, target);
      if (!resolved) return tx; // invalid drop (self/descendant/schema) -- silent no-op
      apply({ type: "moveBlock", id, newParentId: resolved.parentId, index: resolved.index });
      return tx;
    },
    setProps(id, patch) {
      apply({ type: "setProps", id, patch });
      return tx;
    },
    setType(id, blockType, props) {
      apply({ type: "setType", id, blockType, props });
      return tx;
    },
    replaceBlock(id, block) {
      apply({ type: "replaceBlock", id, block });
      return tx;
    },
    replaceContent(id, from, to, inlines) {
      apply({ type: "replaceContent", id, from, to, inlines });
      return tx;
    },
    insertText(point, text, marks) {
      applyAll(buildInsertTextOps(point, text, marks));
      return tx;
    },
    deleteRange(sel) {
      applyAll(buildDeleteRangeOps(store, sel, registry));
      return tx;
    },
    splitBlock(point, opts) {
      applyAll(buildSplitBlockOps(store, point, opts));
      return tx;
    },
    mergeBackward(blockId) {
      applyAll(buildMergeBackwardOps(store, blockId, registry));
      return tx;
    },
    indent(id) {
      applyAll(buildIndentOps(store, id, registry));
      return tx;
    },
    outdent(id) {
      applyAll(buildOutdentOps(store, id, registry));
      return tx;
    },
    toggleMark(sel, markType, attrs) {
      applyAll(buildToggleMarkOps(store, sel, markType, attrs, registry));
      return tx;
    },
    setBlockType(ids, blockType, props) {
      applyAll(buildSetBlockTypeOps(ids, blockType, props));
      return tx;
    },
    pasteFragment(sel, fragment) {
      // a copied table pastes cell-by-cell starting at the anchor,
      // growing the target table as needed -- both for a cells rectangle
      // (paste starts at its own anchor corner) and a caret sitting inside a
      // single cell (paste starts there). Anything else keeps the earlier
      // behavior below (a cells target just clears; any other single/multi
      // block fragment merges via buildInsertFragmentOps).
      // A table-shaped copy round-tripped through the jul-editor-json clipboard
      // format (decodeClipboard -> fromJSON -> normalizeDoc) always gets a
      // SYNTHETIC empty trailing paragraph appended -- table has no cursor
      // slot of its own, so normalizeDoc's "doc must not end in a block a
      // caret can't land in" repair fires on the fragment exactly like it
      // would on a real document. `fragment.length === 1` alone would miss
      // every real-world jul-editor-json table paste; tolerate that ONE specific
      // trailing artifact (never a second real block) instead.
      const isSyntheticTrailingParagraph = (b?: Block) => b?.type === "paragraph" && (b.content ?? []).length === 0 && !b.children?.length;
      const only =
        fragment.length === 1 ? fragment[0] : fragment.length === 2 && isSyntheticTrailingParagraph(fragment[1]) ? fragment[0] : undefined;
      if (only?.type === "table") {
        if (sel.type === "cells") {
          const anchorRow = Math.min(sel.anchor[0], sel.focus[0]);
          const anchorCol = Math.min(sel.anchor[1], sel.focus[1]);
          const result = buildTablePasteOps(store, registry, sel.tableId, anchorRow, anchorCol, tableFragmentGrid(registry, only));
          applyAll(result.ops);
          selection = result.selection;
          return tx;
        }
        if (sel.type === "text" && sel.anchor.blockId === sel.focus.blockId && store.records.get(sel.anchor.blockId)?.type === "tableCell") {
          const pos = cellPosition(store, sel.anchor.blockId);
          if (pos) {
            const result = buildTablePasteOps(store, registry, pos.tableId, pos.row, pos.col, tableFragmentGrid(registry, only));
            applyAll(result.ops);
            selection = result.selection;
            return tx;
          }
        }
      }
      if (sel.type === "cells") {
        // Table-shaped paste is handled above -- anything else just clears
        // the selected cells, same as an ordinary delete there.
        applyAll(buildDeleteRangeOps(store, sel, registry));
        return tx;
      }
      if (sel.type === "block") {
        const first = sel.ids[0];
        if (!first) return tx;
        const { parentId, index } = siblingsOf(store, first);
        applyAll(buildDeleteRangeOps(store, sel, registry));
        applyAll(fragment.map((block, i): Op => ({ type: "insertBlock", parentId, index: index + i, block })));
        selection = fragment.length > 0 ? { type: "block", ids: fragment.map((b) => b.id) } : null;
        return tx;
      }
      const collapsed = sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
      let point: Point = sel.anchor;
      if (!collapsed) {
        point = orderPoints(store, sel.anchor, sel.focus)[0];
        applyAll(buildDeleteRangeOps(store, sel, registry));
      }
      const { ops, caret } = buildInsertFragmentOps(store, registry, point, fragment);
      applyAll(ops);
      selection = { type: "text", anchor: caret, focus: caret };
      return tx;
    },
    insertTable(parentId, index, rows, cols, opts) {
      const block = buildTableBlock(rows, cols, opts);
      apply({ type: "insertBlock", parentId, index, block });
      const firstCellId = block.children![0]!.children![0]!.id;
      const caret: Point = { blockId: firstCellId, offset: 0 };
      selection = { type: "text", anchor: caret, focus: caret };
      return tx;
    },
    addRowBefore(cellId) {
      return runTableOp(buildAddRowOps(store, registry, cellId, true));
    },
    addRowAfter(cellId) {
      return runTableOp(buildAddRowOps(store, registry, cellId, false));
    },
    addColumnBefore(cellId) {
      return runTableOp(buildAddColumnOps(store, registry, cellId, true));
    },
    addColumnAfter(cellId) {
      return runTableOp(buildAddColumnOps(store, registry, cellId, false));
    },
    deleteRow(cellId) {
      return runTableOp(buildDeleteRowOps(store, registry, cellId));
    },
    deleteColumn(cellId) {
      return runTableOp(buildDeleteColumnOps(store, registry, cellId));
    },
    deleteTable(tableId) {
      return runTableOp(buildDeleteTableOps(store, registry, tableId));
    },
    toggleHeaderRow(tableId) {
      applyAll(buildToggleHeaderRowOps(store, registry, tableId));
      return tx;
    },
    mergeCells(tableId, r1, c1, r2, c2) {
      return runTableOp(buildMergeCellsOps(store, registry, tableId, r1, c1, r2, c2));
    },
    splitCell(cellId) {
      return runTableOp(buildSplitCellOps(store, registry, cellId));
    },
    moveRow(tableId, from, to) {
      return runTableOp(buildMoveRowOps(store, registry, tableId, from, to));
    },
    moveColumn(tableId, from, to) {
      return runTableOp(buildMoveColumnOps(store, registry, tableId, from, to));
    },
    setSelection(sel) {
      selection = sel;
      return tx;
    },
    commit() {
      // a transaction must never leave the doc with no cursor slot at all
      // -- zero root blocks, or a root ending in a true void (content:'none'
      // AND children:'none', e.g. divider/image -- model/schema.ts's own
      // isVoidBlockSpec) -- Backspace on a full-doc block selection,
      // deleteTable, and cut can all reach either state. Repairs it IN THIS
      // SAME transaction/undo-step (never a second one) by appending an empty
      // paragraph and landing the caret there. Deliberately narrower than
      // model/canonical.ts's normalizeDoc load-time invariant (which also
      // repairs a doc ending in a container-only block like table): unlike a
      // fresh load, a mid-edit transaction (e.g. `insertTable` placing a
      // table as the doc's current last block) may still add more content
      // right after in a following step, so only a genuinely dead end (no
      // blocks, or a void with no content/children slot of its own at all)
      // is forced open here.
      const lastId = store.rootIds[store.rootIds.length - 1];
      const lastSpec = lastId ? registry.blocks.get(store.records.get(lastId)?.type ?? "") : undefined;
      const noCursorSlot = store.rootIds.length === 0 || isVoidBlockSpec(lastSpec);
      if (noCursorSlot) {
        const trailing: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
        apply({ type: "insertBlock", parentId: null, index: store.rootIds.length, block: trailing });
        selection = { type: "text", anchor: { blockId: trailing.id, offset: 0 }, focus: { blockId: trailing.id, offset: 0 } };
      }
      return { state: { store, selection }, changedIds, inverseOps };
    },
  };
  return tx;
}
