// createEditor: the vanilla single-root editing facade. Wraps createView with an injected
// createHistory() and a small `commands` convenience surface; createView
// itself stays history-free so a caller that doesn't want
// undo/redo can still use createView directly.

import { attachBuiltinKeymaps } from "./builtins-keymap.js";
import { getProp, normalizeDoc } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc, Json, Mark } from "../model/types.js";
import { createHistory } from "../store/history.js";
import { fromDoc, toDoc } from "../store/store.js";
import { cellGridPosition, cellIdAt, cellPosition } from "../store/table.js";
import { applyOp } from "../store/ops.js";
import { createTransaction, resolveMoveTarget } from "../store/transaction.js";
import type { MoveBlockTarget, Transaction, TransactionResult } from "../store/transaction.js";
import type { BlockRecord, EditorState, Op, Selection, Store } from "../store/types.js";
import { BLOCK_ATTR, ID_ATTR, TYPE_ATTR } from "./dom.js";
import type { Extensions } from "./interaction.js";
import type { InputRuleEntry } from "./input-rules.js";
import { buildDefaultKeymap } from "./keymap.js";
import type { Keymap, KeymapEntry } from "./keymap.js";
import { activeMarks, createMarksRef, textSelectionBlockIds, toggleMarkOrStore } from "./marks.js";
import { getCaretRect, getSelectionRect } from "./selection.js";
import { createSuggestionController } from "./suggestion.js";
import type { SuggestionConfig, SuggestionHandle } from "./suggestion.js";
import { createView } from "./";
import { createHighlightController } from "./highlight.js";
import type { Decoration } from "./inline-decorations.js";
import type { Highlighter } from "./highlight.js";
import type { RenderVoidFn } from "./render.js";
import type { UploadFn, UploadState, PendingUploadInfo } from "./upload.js";

export interface BlockTypeInfo {
  type: string;
  /** Every schema-declared prop, at its effective (default-filled) value. */
  props: Record<string, Json>;
}

// MoveBlockPlacement/MoveBlockTarget now live on
// store/transaction.ts (Transaction.moveBlockTo resolves them against its
// own running store -- needed so moveBlocksTo below can batch several moves
// into a single undo step); re-exported here for existing consumers of
// @jul-editor/core's public surface.
export type { MoveBlockPlacement, MoveBlockTarget } from "../store/transaction.js";

export interface CreateEditorOptions {
  element: HTMLElement;
  registry: Registry;
  defaultValue: Doc;
  renderVoid?: RenderVoidFn;
  /** Mod+K's link-URL prompt ("injectable ... default
   * window.prompt"). Returning null cancels; the returned href still goes
   * through sanitizeUrl before being stored. */
  onLinkRequest?: (currentHref: string | null) => Promise<string | null>;
  /** Pasted/dropped image files (and pasted `data:` images) are uploaded
   * through this hook -- see view/clipboard.ts/upload.ts. */
  onUpload?: UploadFn;
  /** Deferred mode previews locally; uploadPending() flushes files before saving JSON. */
  uploadMode?: "immediate" | "deferred";
  /** Opt in to non-image files; register the returned block type in the registry. */
  createFileBlock?: (file: File) => Block | null;
  /** A pasted external (http/https) `<img>`'s src is kept as-is by default;
   * this optionally re-hosts it once the image is already in the doc. */
  rehostExternalImages?: (url: string) => Promise<{ src: string; assetId?: string }>;
  /** a text block's placeholder text, written as `data-placeholder`
   * on its content element -- see view/render.ts's EMPTY_ATTR/FOCUSED_ATTR
   * doc comments for the CSS recipe a host uses to actually show it. */
  placeholder?: string | ((block: Block) => string);
}

export interface EditorPlugin {
  keymap?: Keymap;
  inputRules?: InputRuleEntry[];
  suggestions?: SuggestionConfig[];
  onCommit?: (info: { state: EditorState; changedIds: Set<string> }) => void;
}

attachBuiltinKeymaps(); // idempotent -- safe to call again if this module is imported more than once

const DEFAULT_KEYMAP_PRIORITY = -Infinity;

export interface Editor {
  /** The contenteditable root supplied at creation, for UI tied to this editor. */
  getRoot(): HTMLElement;
  getDoc(): Doc;
  setDoc(doc: Doc): void;
  getState(): EditorState;
  /** The schema registry this editor was created with (collaboration needs it
   * to replay ops against a shadow store without being handed it twice). */
  getRegistry(): Registry;
  /** Applies ops that originated elsewhere (a collaborator, a server push) as
   * a SYSTEM commit: never pushed to undo history (a local undo must not
   * revert someone else's edit), history snapshots are rebased so the remote
   * edit also survives a later undo/redo (store/history.ts `rebase`), and
   * `on("change")` listeners get `{ remote: true }` as a second argument so
   * a sync layer can tell it apart from a local edit. `opts.mapSelection`
   * lets the caller transform the local selection over the ops (e.g. shift
   * a caret right when a collaborator typed before it). The DOM selection is
   * only rewritten when this editor already has focus. Ops that no longer
   * apply (unknown ids, schema rejection) are skipped like any op. */
  applyRemote(ops: Op[], opts?: { mapSelection?: (selection: Selection | null) => Selection | null }): { changedIds: Set<string> };
  /** `opts.mergeable` opts THIS call into the same same-block/500ms merge
   * window typing already gets (history.ts) -- only when every resulting op
   * is a same-block `setProps` patching the same prop keys (a structural op,
   * or a patch touching different keys, always starts a fresh undo step
   * regardless). Off by default so every existing caller (toolbar commands,
   * `commands.*`) keeps its current one-call-one-undo-step behavior; a void
   * renderer's own per-keystroke `updateProps` (caption/alt/embed-title) is
   * the intended use (see react's VoidPortal). */
  update(build: (tx: Transaction) => Transaction, opts?: { mergeable?: boolean }): TransactionResult;
  on(event: "change" | "selection", listener: (state: EditorState, meta?: { remote: boolean }) => void): () => void;
  /** Fires whenever a block's getUploadState(blockId) would return something
   * new (start/success/failure) -- upload status is transient view-layer
   * state, not part of EditorState, so it never flows through `on("change")`.
   * A React (or other) consumer's re-render seam for e.g. an image's
   * uploading/error UI. */
  onUpload(listener: (blockId: string) => void): () => void;
  commands: {
    undo(): void;
    redo(): void;
    toggleMark(markType: string, attrs?: Record<string, Json>): void;
    setBlockType(blockType: string, props?: Record<string, Json>): void;
    insertBlock(block: Block): void;
    indent(): void;
    outdent(): void;
    /** inserts a fresh rows x cols table after the current selection's
     * block (or at the doc's end, same placement rule as insertBlock), caret
     * in its first cell. */
    insertTable(rows: number, cols: number, opts?: { headerRow?: boolean }): void;
    /** Every method below resolves its own row/column/table context from the
     * current selection (a caret inside a tableCell, or a cells rectangle) --
     * a no-op when the selection isn't inside a table at all. */
    addRowBefore(): void;
    addRowAfter(): void;
    addColumnBefore(): void;
    addColumnAfter(): void;
    deleteRow(): void;
    deleteColumn(): void;
    deleteTable(): void;
    toggleHeaderRow(): void;
    /** merges the current `cells` selection's rectangle into one cell;
     * a no-op when the selection isn't a `cells` rectangle, or the rectangle
     * is non-rectangular/already a single cell. */
    mergeCells(): void;
    /** splits the cell the current selection is in back into its own
     * 1x1 cells; a no-op when it isn't merged. */
    splitCell(): void;
    /** reorders the current cell's own row/column one step up/down or
     * left/right; a no-op outside a table, at an edge, or across a merge. */
    moveRowUp(): void;
    moveRowDown(): void;
    moveColumnLeft(): void;
    moveColumnRight(): void;
  };
  /** Extension points. */
  registerKeymap(keymap: Keymap, opts?: { priority?: number }): () => void;
  registerInputRule(rule: InputRuleEntry): () => void;
  registerSuggestion(config: SuggestionConfig): SuggestionHandle;
  use(plugin: EditorPlugin): () => void;
  getActiveMarks(): Mark[];
  /** Type + effective props of the block(s) touched by the current selection,
   * or null when there's no selection or the touched blocks don't all agree
   * (mixed types, or the same type with different prop values) -- for a
   * toolbar (e.g. @jul-editor/react) to reflect "heading level 2" vs a disabled/
   * indeterminate state, without re-deriving this from the store itself. */
  getBlockType(): BlockTypeInfo | null;
  getCaretRect(): DOMRect | null;
  getSelectionRect(): DOMRect | null;
  /** The block at a viewport point, or the nearest block when the point is
   * inside this editor's padding/gaps. Outside its canvas returns null.
   * A tableRow/tableCell resolves to its whole table. */
  getBlockAtPoint(x: number, y: number): { id: string; rect: DOMRect } | null;
  /** A block's current wrapper rect, or null once it's no longer rendered
   * (e.g. removed by a concurrent edit mid-drag). */
  getBlockRect(id: string): DOMRect | null;
  /** reparents/reorders `id` to sit before/after `target`'s
   * block or nested as its last child -- one undo step, selection left on the
   * moved block afterward (block selection). A silent no-op when the move is
   * invalid: dropping onto itself, into its own descendant, or somewhere its
   * schema doesn't admit it (e.g. into a codeBlock). */
  moveBlockTo(id: string, target: MoveBlockTarget): void;
  /** the multi-block-selection drag case -- moves every id in
   * `ids` (already in doc order) to land consecutively at `target`, in
   * order, as ONE undo step (not one per id). The first id goes to `target`
   * itself; each following id chains as "right after the previous one",
   * reproducing their original relative order regardless of whether
   * `target` sits above or below them. Ends with a block selection on the
   * whole moved set. An id whose own move is invalid is silently skipped
   * (same per-id rule as moveBlockTo) without aborting the rest. */
  moveBlocksTo(ids: string[], target: MoveBlockTarget): void;
  /** Transient (non-doc-model) upload status for a pasted/dropped image block. */
  getUploadState(blockId: string): UploadState | undefined;
  /** Re-attempts a failed upload with the same File. */
  retryUpload(blockId: string): void;
  /** Shared file-input/paste/drop insertion path. Returns inserted block IDs. */
  insertFiles(files: File[]): string[];
  getUploadPreview(blockId: string): string | undefined;
  getPendingUploads(): PendingUploadInfo[];
  /** Flush queued/error/in-flight uploads. Save the latest document only when failed is empty. */
  uploadPending(): Promise<{uploaded: string[]; failed: string[]}>;
  /** P2: syntax-highlights every codeBlock (CSS Custom Highlight API, view/
   * highlight.ts -- a no-op in an unsupported browser). Replaces any
   * previously registered highlighter; the returned unregister clears
   * highlighting entirely (only meaningful if nothing else re-registered
   * since). */
  registerHighlighter(highlighter: Highlighter): () => void;
  /** View-only inline decorations (range highlights and DOM widgets) grouped by `key`: an empty
   * list clears that key. Never enters the model, undo history or serialization, and is safe for
   * IME/selection (see view/inline-decorations.ts). */
  setDecorations(key: string, decorations: readonly Decoration[]): void;
  getDecorations(key: string): readonly Decoration[];
  destroy(): void;
}

/** A dispatch's forward ops are mergeable into the previous undo entry only
 * when BOTH: the interaction layer flagged it as a genuine typing-burst
 * character (Extensions.mergeIntent -- ordinary typing, Backspace/Delete of
 * one grapheme, Shift+Enter's '\n', IME/absorbed composition text; never a
 * mark toggle, paste, or input-rule/suggestion conversion, even though those
 * can ALSO produce a same-block replaceContent-shaped op list), AND every one
 * of its ops is a same-block replaceContent (store/history.ts's 500ms
 * window) -- any structural op (split/merge/setType/indent/insertBlock/
 * removeBlock/moveBlock/setProps) always starts a fresh undo step regardless
 * of the flag. A selection-only dispatch (no ops at all) is never pushed to
 * history -- nothing to undo. */
// (drag-handle drop resolution -- targetId/placement -> concrete
// (parentId, index) -- now lives on store/transaction.ts's exported
// resolveMoveTarget, reused below both for a single moveBlockTo's pre-check
// (so a fully invalid drop stays a true no side effect at all no-op, same as
// before) and by Transaction.moveBlockTo itself, which moveBlocksTo chains
// inside one transaction to batch several moves into one undo step.)

function mergeInfo(result: TransactionResult, typingIntent: boolean, callerMergeable?: boolean): { blockId?: string; mergeable?: boolean } {
  if (typingIntent) {
    const ids = new Set<string>();
    for (const op of result.inverseOps) {
      if (op.type !== "replaceContent") return { mergeable: false };
      ids.add(op.id);
    }
    if (ids.size !== 1) return { mergeable: false };
    return { blockId: [...ids][0], mergeable: true };
  }
  // `editor.update(build, { mergeable: true })`'s own opt-in (Editor's
  // own doc comment) -- every resulting op must be a same-block `setProps`
  // patching the exact same prop keys as each other (never a structural op,
  // and never a differently-keyed patch, e.g. typing a caption then clicking
  // align must NOT fold into one undo step). The key set is folded into the
  // synthetic "blockId" history.ts merges on, so its own plain `blockId ===
  // blockId` + 500ms-window check (unchanged) does the rest.
  if (callerMergeable) {
    const ids = new Set<string>();
    let keys: string[] | null = null;
    for (const op of result.inverseOps) {
      if (op.type !== "setProps") return { mergeable: false };
      ids.add(op.id);
      const opKeys = Object.keys(op.patch).sort();
      if (keys === null) keys = opKeys;
      else if (keys.join(",") !== opKeys.join(",")) return { mergeable: false };
    }
    if (ids.size !== 1 || !keys) return { mergeable: false };
    return { blockId: `${[...ids][0]}\u0000props\u0000${keys.join(",")}`, mergeable: true };
  }
  return { mergeable: false };
}

export function createEditor(options: CreateEditorOptions): Editor {
  const { element, registry, renderVoid } = options;
  const history = createHistory();
  // defaultValue is untrusted input (server-stored JSON, another
  // client's doc, a caller-constructed literal) just like setDoc's `doc`
  // below -- fromDoc itself only trusts its caller (see store/store.ts's own
  // doc comment), so this is the one normalization pass (sanitizeUrl on
  // every href/src, schema defaults, the trailing-cursor-slot invariant for
  // a void-only doc) it actually gets before becoming the live store.
  let state: EditorState = { store: fromDoc(normalizeDoc(options.defaultValue, registry), registry), selection: null };

  // The raw history-recording step. This is also handed to createView as its
  // `dispatch` -- when the VIEW's own interaction layer calls it (typing,
  // keydown, IME absorb...), the view's internal runDispatch wrapper already
  // does its own render/restoreSelection/emit right after. A *programmatic*
  // caller (`update`/`commands.*` below) bypasses that wrapper, so those call
  // `commitAndSync` instead, which does the same follow-up via `setState`.
  // one-shot "the interaction layer's NEXT dispatch is a typing burst
  // character" signal -- see Extensions.mergeIntent's own doc comment.
  const mergeIntent = { current: false };

  function dispatch(build: (tx: Transaction) => Transaction, opts?: { mergeable?: boolean }): TransactionResult {
    const before = state;
    const tx = createTransaction(before, registry);
    const result = build(tx).commit();
    state = result.state;
    const typingIntent = mergeIntent.current;
    mergeIntent.current = false; // one-shot: never leaks into a later, unrelated dispatch
    if (result.changedIds.size > 0) history.push({ before, after: result.state, changedIds: result.changedIds }, mergeInfo(result, typingIntent, opts?.mergeable));
    return result;
  }

  // An upload's own completion patch (fill in src/assetId once onUpload
  // resolves) commits WITHOUT pushing a new undo step -- one undo of the
  // insertion must remove the whole image, not leave an empty-src ghost
  // behind as a second step. Passed to createView as
  // `dispatchSystem`; view/clipboard.ts is the only caller.
  function dispatchSystem(build: (tx: Transaction) => Transaction): TransactionResult {
    const before = state;
    const tx = createTransaction(before, registry);
    const result = build(tx).commit();
    state = result.state;
    // this commit never goes through history.push, but every undo/redo
    // entry already on the stack stores a whole-state snapshot -- one that
    // still contains the block this setProps just touched (e.g. the paste
    // that inserted the still-uploading image) would otherwise replay the
    // PRE-patch props (src "") on a later undo+redo. `dispatchSystem` is only
    // ever called with a single tx.setProps(blockId, patch) (see
    // view/clipboard.ts's beginUpload/rehostExternalImagesIn), so its inverse
    // is always exactly one `setProps` op; patch the same (already-committed,
    // already-normalized) prop values onto every stack snapshot that has it.
    for (const inv of result.inverseOps) {
      if (inv.type !== "setProps") continue;
      const patch: Record<string, Json | undefined> = {};
      for (const k of Object.keys(inv.patch)) patch[k] = result.state.store.records.get(inv.id)?.props[k];
      history.patchSystemProps(inv.id, patch);
    }
    return result;
  }

  function commitAndSync(build: (tx: Transaction) => Transaction, opts?: { mergeable?: boolean }): TransactionResult {
    // a programmatic command (a toolbar button's click handler
    // calling `commands.*`/`update` directly) never fires a beforeinput/
    // keydown of its own, so it would otherwise bypass the pending-
    // composition flush every REAL keyboard/input event gets for free --
    // flush first so `build` always sees the composed text already landed.
    view.flushPendingComposition();
    const result = dispatch(build, opts);
    view.setState(result.state, result.changedIds);
    // interaction.ts's own runDispatch wrapper (typing/deleting via the
    // DOM) re-evaluates every open slash/mention suggestion after each
    // commit -- a programmatic commitAndSync (toolbar buttons, `editor.update`)
    // bypasses that wrapper entirely, so it needs the same re-evaluation here.
    extensions.suggestions.notifyTextChange();
    return result;
  }

  const marksRef = createMarksRef();

  const commands: Editor["commands"] = {
    undo() {
      const entry = history.undo();
      if (!entry) return;
      state = entry.state;
      view.setState(entry.state, entry.changedIds);
      // undo can remove (or change) the very trigger text an open slash/
      // mention suggestion is tracking -- re-evaluate it against the restored
      // state instead of leaving it open with a now-stale range.
      extensions.suggestions.notifyTextChange();
    },
    redo() {
      const entry = history.redo();
      if (!entry) return;
      state = entry.state;
      view.setState(entry.state, entry.changedIds);
      extensions.suggestions.notifyTextChange();
    },
    toggleMark(markType, attrs) {
      // Collapsed selection: no range to flip yet -- records a stored mark
      // instead, applied to the next actually-typed text.
      toggleMarkOrStore(view.getState(), marksRef, commitAndSync, markType, attrs);
    },
    setBlockType(blockType, props) {
      const ids = currentBlockIds();
      if (ids.length === 0) return;
      commitAndSync((tx) => tx.setBlockType(ids, blockType, props));
    },
    insertBlock(block) {
      const { parentId, index } = insertPosition();
      commitAndSync((tx) => tx.insertBlock(parentId, index, block));
    },
    indent() {
      const id = currentBlockIds()[0];
      if (id) commitAndSync((tx) => tx.indent(id));
    },
    outdent() {
      const id = currentBlockIds()[0];
      if (id) commitAndSync((tx) => tx.outdent(id));
    },
    insertTable(rows, cols, opts) {
      const { parentId, index } = insertPosition();
      commitAndSync((tx) => tx.insertTable(parentId, index, rows, cols, opts));
    },
    addRowBefore() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.addRowBefore(cellId));
    },
    addRowAfter() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.addRowAfter(cellId));
    },
    addColumnBefore() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.addColumnBefore(cellId));
    },
    addColumnAfter() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.addColumnAfter(cellId));
    },
    deleteRow() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.deleteRow(cellId));
    },
    deleteColumn() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.deleteColumn(cellId));
    },
    deleteTable() {
      const tableId = currentTableId();
      if (tableId) commitAndSync((tx) => tx.deleteTable(tableId));
    },
    toggleHeaderRow() {
      const tableId = currentTableId();
      if (tableId) commitAndSync((tx) => tx.toggleHeaderRow(tableId));
    },
    mergeCells() {
      const sel = view.getState().selection;
      if (sel?.type !== "cells") return;
      const r1 = Math.min(sel.anchor[0], sel.focus[0]);
      const c1 = Math.min(sel.anchor[1], sel.focus[1]);
      const r2 = Math.max(sel.anchor[0], sel.focus[0]);
      const c2 = Math.max(sel.anchor[1], sel.focus[1]);
      commitAndSync((tx) => tx.mergeCells(sel.tableId, r1, c1, r2, c2));
    },
    splitCell() {
      const cellId = currentCellId();
      if (cellId) commitAndSync((tx) => tx.splitCell(cellId));
    },
    moveRowUp() {
      const pos = currentGridPos();
      if (pos && pos.row > 0) commitAndSync((tx) => tx.moveRow(pos.tableId, pos.row, pos.row - 1));
    },
    moveRowDown() {
      const pos = currentGridPos();
      if (pos && pos.row + pos.rowspan < pos.rows) commitAndSync((tx) => tx.moveRow(pos.tableId, pos.row, pos.row + 1));
    },
    moveColumnLeft() {
      const pos = currentGridPos();
      if (pos && pos.col > 0) commitAndSync((tx) => tx.moveColumn(pos.tableId, pos.col, pos.col - 1));
    },
    moveColumnRight() {
      const pos = currentGridPos();
      if (pos && pos.col + pos.colspan < pos.cols) commitAndSync((tx) => tx.moveColumn(pos.tableId, pos.col, pos.col + 1));
    },
  };

  function currentBlockIds(): string[] {
    const sel = view.getState().selection;
    if (!sel) return [];
    if (sel.type === "block") return sel.ids;
    if (sel.type === "text") return [sel.anchor.blockId];
    return [];
  }

  /** Where insertBlock/insertTable place a fresh top-level block: right after
   * the current selection's (first) block, or at the doc's end when there's
   * no selection. */
  function insertPosition(): { parentId: string | null; index: number } {
    const store = view.getState().store;
    const anchorId = currentBlockIds()[0];
    let parentId: string | null = null;
    let index = store.rootIds.length;
    if (anchorId) {
      const rec = store.records.get(anchorId);
      parentId = rec?.parentId ?? null;
      const siblings = parentId ? (store.records.get(parentId)?.childIds ?? []) : store.rootIds;
      index = siblings.indexOf(anchorId) + 1;
    }
    return { parentId, index };
  }

  /** The tableCell the current selection is "in" -- either a text caret whose
   * own block IS a tableCell, or a cells rectangle's anchor cell. Null when
   * the selection isn't inside a table at all. */
  function currentCellId(): string | null {
    const state = view.getState();
    const sel = state.selection;
    if (!sel) return null;
    if (sel.type === "text") {
      return state.store.records.get(sel.anchor.blockId)?.type === "tableCell" ? sel.anchor.blockId : null;
    }
    if (sel.type === "cells") return cellIdAt(state.store, registry, sel.tableId, sel.anchor[0], sel.anchor[1]);
    return null;
  }

  /** the current cell's own grid position (anchor row/col + span +
   * table dimensions) -- moveRow/moveColumn's own no-op-at-the-edge checks. */
  function currentGridPos() {
    const cellId = currentCellId();
    return cellId ? cellGridPosition(view.getState().store, registry, cellId) : null;
  }

  /** The block wrapper nearest a point inside the editor canvas. Table
   * internals resolve up to their enclosing table. */
  function blockElementAt(x: number, y: number): HTMLElement | null {
    const doc = element.ownerDocument;
    const hit = doc.elementFromPoint?.(x, y) ?? null;
    let el = hit?.closest(`[${BLOCK_ATTR}]`) as HTMLElement | null;
    if (el && element.contains(el)) {
      while (el && (el.getAttribute(TYPE_ATTR) === "tableRow" || el.getAttribute(TYPE_ATTR) === "tableCell")) {
        el = el.parentElement?.closest(`[${BLOCK_ATTR}]`) as HTMLElement | null;
      }
      return el;
    }
    const canvas = element.getBoundingClientRect();
    if (x < canvas.left || x > canvas.right || y < canvas.top || y > canvas.bottom) return null;
    // A pointer over editor padding has no block under elementFromPoint;
    // scan rendered blocks only on that fallback path, upgrade if large-doc drag profiling needs it.
    let nearest: HTMLElement | null = null;
    let distance = Infinity;
    for (const candidate of element.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`)) {
      if (candidate.getAttribute(TYPE_ATTR) === "tableRow" || candidate.getAttribute(TYPE_ATTR) === "tableCell") continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.height === 0) continue;
      const next = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (next <= distance) {
        nearest = candidate;
        distance = next;
      }
    }
    return nearest;
  }

  function currentTableId(): string | null {
    const sel = view.getState().selection;
    if (sel?.type === "cells") return sel.tableId;
    const cellId = currentCellId();
    return cellId ? (cellPosition(view.getState().store, cellId)?.tableId ?? null) : null;
  }

  function effectiveProps(rec: BlockRecord): Record<string, Json> {
    const spec = registry.blocks.get(rec.type);
    const out: Record<string, Json> = {};
    for (const key of Object.keys(spec?.props ?? {})) out[key] = getProp({ id: rec.id, type: rec.type, props: rec.props }, key, registry) as Json;
    return out;
  }

  function getBlockTypeUncached(): BlockTypeInfo | null {
    const state = view.getState();
    const sel = state.selection;
    if (!sel) return null;
    if (sel.type === "cells") return sel.tableId ? { type: "tableCell", props: {} } : null; // every cell is always this type
    const ids = sel.type === "block" ? sel.ids : textSelectionBlockIds(state.store, sel);
    const recs = ids.map((id) => state.store.records.get(id)).filter((r): r is BlockRecord => !!r);
    if (recs.length === 0) return null;
    const first = { type: recs[0]!.type, props: effectiveProps(recs[0]!) };
    const same = recs.every((r) => r.type === first.type && JSON.stringify(effectiveProps(r)) === JSON.stringify(first.props));
    return same ? first : null;
  }

  // getActiveMarks/getBlockType are natural things to poll from a React
  // selector (useSyncExternalStore-style) after every commit, including a
  // plain keystroke that changes nothing about either -- a fresh array/object
  // literal every call would make ANY naive reference-equality consumer
  // (Object.is, the common default) re-render every keystroke even though
  // nothing it cares about changed. Cache-by-JSON-key so an unchanged result
  // is the exact same reference back.
  //
  // On top of that, every toolbar button polls these after each commit, so
  // the scan + stringify is skipped entirely while the (immutable) state
  // object and the stored-marks array (always replaced, never mutated) are
  // the same references as on the previous call.
  let marksCache: { key: string; value: Mark[]; state: EditorState; stored: Mark[] | null } | null = null;
  let blockTypeCache: { key: string; value: BlockTypeInfo | null; state: EditorState } | null = null;

  function getActiveMarksCached(): Mark[] {
    const state = view.getState();
    if (marksCache && marksCache.state === state && marksCache.stored === marksRef.stored) return marksCache.value;
    const value = activeMarks(state, marksRef);
    const key = JSON.stringify(value);
    if (!marksCache || marksCache.key !== key) marksCache = { key, value, state, stored: marksRef.stored };
    else {
      marksCache.state = state;
      marksCache.stored = marksRef.stored;
    }
    return marksCache.value;
  }

  function getBlockTypeCached(): BlockTypeInfo | null {
    const state = view.getState();
    if (blockTypeCache && blockTypeCache.state === state) return blockTypeCache.value;
    const value = getBlockTypeUncached();
    const key = JSON.stringify(value);
    if (!blockTypeCache || blockTypeCache.key !== key) blockTypeCache = { key, value, state };
    else blockTypeCache.state = state;
    return blockTypeCache.value;
  }

  const keymaps: KeymapEntry[] = [{ keymap: buildDefaultKeymap(), priority: DEFAULT_KEYMAP_PRIORITY }];
  const inputRules: InputRuleEntry[] = [];
  const onLinkRequest = options.onLinkRequest ?? (async (currentHref) => (typeof window === "undefined" ? null : window.prompt("Link URL", currentHref ?? "")));
  const suggestions = createSuggestionController({ getState: () => view.getState(), dispatch: commitAndSync, getCaretRect });
  const extensions: Extensions = { keymaps, inputRules, suggestions, marksRef, onLinkRequest, mergeIntent };

  function registerKeymap(keymap: Keymap, opts?: { priority?: number }): () => void {
    const entry: KeymapEntry = { keymap, priority: opts?.priority ?? 0 };
    keymaps.push(entry);
    return () => {
      const i = keymaps.indexOf(entry);
      if (i >= 0) keymaps.splice(i, 1);
    };
  }

  function registerInputRule(rule: InputRuleEntry): () => void {
    inputRules.push(rule);
    return () => {
      const i = inputRules.indexOf(rule);
      if (i >= 0) inputRules.splice(i, 1);
    };
  }

  function use(plugin: EditorPlugin): () => void {
    const unregisters: Array<() => void> = [];
    if (plugin.keymap) unregisters.push(registerKeymap(plugin.keymap));
    for (const rule of plugin.inputRules ?? []) unregisters.push(registerInputRule(rule));
    for (const config of plugin.suggestions ?? []) {
      const handle = suggestions.register(config);
      unregisters.push(() => handle.destroy());
    }
    if (plugin.onCommit) unregisters.push(view.onCommit(plugin.onCommit));
    return () => {
      for (const fn of unregisters) fn();
    };
  }

  const view = createView({
    element,
    state,
    registry,
    dispatch,
    dispatchSystem,
    renderVoid,
    extensions,
    onHistory: (direction) => (direction === "undo" ? commands.undo() : commands.redo()),
    onUpload: options.onUpload,
    uploadMode: options.uploadMode,
    createFileBlock: options.createFileBlock,
    rehostExternalImages: options.rehostExternalImages,
    placeholder: options.placeholder,
  });

  // P2: view.onCommit already fires for every commit path (runDispatch/
  // runDispatchSystem/setState -- typing, undo/redo, setDoc alike), so
  // hooking here (rather than duplicating that at each call site) covers
  // "after commits that change a codeBlock" and "on mount" (setHighlighter's
  // own initial full scan) both, with a single subscription.
  const highlightController = createHighlightController({ root: element, registry, getState: () => view.getState(), isComposing: view.isComposing });
  view.onCommit((info) => highlightController.onCommit(info.changedIds));

  // true only while applyRemote's own view.setState runs, so `on("change")`
  // listeners can distinguish a remote commit from a local one.
  let applyingRemote = false;

  return {
    getRoot: () => element,
    getRegistry: () => registry,
    applyRemote(ops, opts) {
      // land any pending IME text FIRST (its own commit is a normal local one)
      // so the remote ops apply on top of the composed text.
      view.flushPendingComposition();
      const before = state;
      let store: Store = before.store;
      const changedIds = new Set<string>();
      for (const op of ops) {
        const r = applyOp(store, op, registry);
        store = r.store;
        for (const id of r.changedIds) changedIds.add(id);
      }
      if (changedIds.size === 0) return { changedIds };
      const selection = opts?.mapSelection ? opts.mapSelection(before.selection) : before.selection;
      history.rebase((s) => ops.reduce((acc, op) => applyOp(acc, op, registry).store, s), changedIds);
      state = { store, selection };
      applyingRemote = true;
      try {
        view.setState(state, changedIds, { requireFocus: true });
      } finally {
        applyingRemote = false;
      }
      extensions.suggestions.notifyTextChange();
      return { changedIds };
    },
    getDoc: () => toDoc(view.getState().store),
    setDoc(doc) {
      // same untrusted-input normalization as the defaultValue above.
      state = { store: fromDoc(normalizeDoc(doc, registry), registry), selection: null };
      history.clear();
      view.setState(state);
      // view.setState's own `changedIds` (undefined here) can't
      // reach the highlight controller as "undefined" through view.onCommit
      // -- its emitter always hands out a real (defaulted-to-empty) Set, so
      // a whole-doc replacement's own codeBlocks would otherwise never get
      // their first highlight pass. Force the full rescan directly instead
      // of widening that Set-typed plumbing just for this one caller.
      highlightController.onCommit(undefined);
      // a whole-doc replacement invalidates any open slash/mention
      // suggestion's tracked block/range just as thoroughly as an undo would.
      extensions.suggestions.notifyTextChange();
    },
    getState: () => view.getState(),
    update: (build, opts) => commitAndSync(build, opts),
    on(event, listener) {
      // "change" and "selection" both fire off the same onCommit stream today
      // (every commit updates both store and selection together) -- kept as
      // two event names because callers reason about them separately.
      void event;
      return view.onCommit((info) => listener(info.state, { remote: applyingRemote }));
    },
    onUpload: (listener) => view.onUpload(listener),
    commands,
    registerKeymap,
    registerInputRule,
    registerSuggestion: (config) => suggestions.register(config),
    use,
    getActiveMarks: getActiveMarksCached,
    getBlockType: getBlockTypeCached,
    getCaretRect,
    getSelectionRect,
    getBlockAtPoint(x, y) {
      const el = blockElementAt(x, y);
      const id = el?.getAttribute(ID_ATTR);
      return id ? { id, rect: el!.getBoundingClientRect() } : null;
    },
    getBlockRect(id) {
      const el = element.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${id}"]`);
      return el ? el.getBoundingClientRect() : null;
    },
    moveBlockTo(id, target) {
      const resolved = resolveMoveTarget(view.getState().store, registry, id, target);
      if (!resolved) return; // invalid drop (self/descendant/schema) -- silent no-op, no history entry
      commitAndSync((tx) => tx.moveBlock(id, resolved.parentId, resolved.index).setSelection({ type: "block", ids: [id] }));
    },
    moveBlocksTo(ids, target) {
      commitAndSync((tx) => {
        let chained = target;
        for (const id of ids) {
          tx.moveBlockTo(id, chained);
          chained = { targetId: id, placement: "after" };
        }
        return tx.setSelection({ type: "block", ids });
      });
    },
    getUploadState: (blockId) => view.getUploadState(blockId),
    retryUpload: (blockId) => view.retryUpload(blockId),
    insertFiles: (files) => view.insertFiles(files),
    getUploadPreview: (id) => view.getUploadPreview(id),
    getPendingUploads: () => view.getPendingUploads(),
    uploadPending: () => view.uploadPending(),
    setDecorations: (key, decorations) => view.setDecorations(key, decorations),
    getDecorations: (key) => view.getDecorations(key),
    registerHighlighter(highlighter) {
      highlightController.setHighlighter(highlighter);
      return () => highlightController.setHighlighter(null);
    },
    destroy() {
      highlightController.destroy();
      view.destroy();
    },
  };
}
