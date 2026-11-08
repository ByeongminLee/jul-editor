// Undo/redo stack. Depth cap 200, consecutive mergeable commits touching the
// same block within 500ms fold into one entry.

import type { Json } from "../model/types.js";
import { commitPatch } from "./store.js";
import type { EditorState, Store } from "./types.js";

export interface HistoryEntry {
  before: EditorState;
  after: EditorState;
  changedIds: Set<string>;
}

export interface PushOptions {
  /** The block a typing-style edit targeted -- consecutive pushes with the
   * same blockId (and `mergeable: true`) within the merge window fold together. */
  blockId?: string;
  mergeable?: boolean;
}

export interface History {
  push(entry: HistoryEntry, opts?: PushOptions): void;
  undo(): { state: EditorState; changedIds: Set<string> } | null;
  redo(): { state: EditorState; changedIds: Set<string> } | null;
  /** a system commit (dispatchSystem -- e.g. an image upload's own
   * completion patch) applies OUTSIDE history, but every undo/redo entry
   * recorded before it stores a whole-state snapshot -- undoing past it and
   * redoing back would otherwise resurrect the block's PRE-patch props (an
   * uploaded image's src reverting to "" forever). Patches `patch` onto
   * `blockId` in every stack entry's `before`/`after` that still contains it
   * (both stacks -- an entry already undone into the redo stack must stay
   * patched too), and folds `blockId` into that entry's own `changedIds` so a
   * later renderChanged() picks it up regardless of whether the original
   * edit touched it. A no-op entry (block absent from that snapshot) is left
   * alone. */
  patchSystemProps(blockId: string, patch: Record<string, Json | undefined>): void;
  /** Collaboration seam (plugins/collaboration): a REMOTE edit (applied via
   * editor.applyRemote, never pushed as an undo step) must survive a later
   * local undo/redo. Every entry stores whole-state snapshots, so without
   * this an undo would silently revert the remote edit along with the local
   * one. `map` re-applies the remote change to one snapshot's store and
   * `touchedIds` are the blocks it changes. It is applied LAZILY (only when
   * an entry is actually undone/redone), so a burst of remote typing costs
   * O(1) per remote commit instead of O(undo depth * doc size). Limit: `map`
   * runs against snapshots older than the remote edit's own coordinate
   * space, so a remote text edit inside the SAME block region as an undone
   * local edit can land at a slightly different offset (never lost, never
   * a crash: offsets clamp). */
  rebase(map: (store: Store) => Store, touchedIds: Iterable<string>): void;
  clear(): void;
}

const MERGE_WINDOW_MS = 500;

interface StackEntry extends HistoryEntry {
  blockId?: string;
  mergeable?: boolean;
  timestamp: number;
  /** how many `rebaseLog` items this entry's snapshots already include */
  rebased: number;
}

interface RebaseItem {
  map: (store: Store) => Store;
  touchedIds: string[];
}

// a runaway log (a very long session of remote edits with a deep, never-used
// undo stack) is flushed into every entry once it passes this size.
const REBASE_LOG_CAP = 2000;

/** Immutable-copy prop patch of one record inside `store` -- store.ts's
 * commitPatch path-copies the record AND every ancestor up to the root, so a
 * toDoc() call against the patched store (identity-keyed WeakMap cache) never
 * returns a stale cached Doc for an ancestor whose child just changed. A
 * no-op (same `store` back) when `blockId` isn't in this particular snapshot. */
function patchStoreProps(store: Store, blockId: string, patch: Record<string, Json | undefined>): Store {
  const rec = store.records.get(blockId);
  if (!rec) return store;
  const props = { ...rec.props };
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) delete props[k];
    else props[k] = patch[k]!;
  }
  return commitPatch(store, new Map([[blockId, { ...rec, props }]])).store;
}

export function createHistory(cap = 200): History {
  const undoStack: StackEntry[] = [];
  let redoStack: StackEntry[] = [];
  let rebaseLog: RebaseItem[] = [];

  function catchUp(entry: StackEntry): void {
    for (let i = entry.rebased; i < rebaseLog.length; i++) {
      const item = rebaseLog[i]!;
      entry.before = { ...entry.before, store: item.map(entry.before.store) };
      entry.after = { ...entry.after, store: item.map(entry.after.store) };
      for (const id of item.touchedIds) entry.changedIds.add(id);
    }
    entry.rebased = rebaseLog.length;
  }

  function patchEntry(entry: StackEntry, blockId: string, patch: Record<string, Json | undefined>): void {
    const before = patchStoreProps(entry.before.store, blockId, patch);
    const after = patchStoreProps(entry.after.store, blockId, patch);
    if (before === entry.before.store && after === entry.after.store) return; // neither snapshot contains this block
    entry.before = { ...entry.before, store: before };
    entry.after = { ...entry.after, store: after };
    entry.changedIds.add(blockId);
  }

  return {
    push(entry, opts = {}) {
      redoStack = []; // a new edit invalidates redo history
      const now = Date.now();
      const last = undoStack[undoStack.length - 1];
      if (last?.mergeable && opts.mergeable && opts.blockId !== undefined && last.blockId === opts.blockId && now - last.timestamp < MERGE_WINDOW_MS) {
        catchUp(last); // entry.after already includes every logged remote edit
        last.after = entry.after;
        for (const id of entry.changedIds) last.changedIds.add(id);
        last.timestamp = now;
        return;
      }
      undoStack.push({ before: entry.before, after: entry.after, changedIds: entry.changedIds, blockId: opts.blockId, mergeable: opts.mergeable, timestamp: now, rebased: rebaseLog.length });
      if (undoStack.length > cap) undoStack.shift();
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      catchUp(entry);
      redoStack.push(entry);
      return { state: entry.before, changedIds: entry.changedIds };
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      catchUp(entry);
      undoStack.push(entry);
      return { state: entry.after, changedIds: entry.changedIds };
    },
    patchSystemProps(blockId, patch) {
      for (const entry of undoStack) patchEntry(entry, blockId, patch);
      for (const entry of redoStack) patchEntry(entry, blockId, patch);
    },
    rebase(map, touchedIds) {
      if (undoStack.length === 0 && redoStack.length === 0) return; // nothing to keep consistent
      rebaseLog.push({ map, touchedIds: [...touchedIds] });
      if (rebaseLog.length > REBASE_LOG_CAP) {
        for (const e of undoStack) catchUp(e);
        for (const e of redoStack) catchUp(e);
        rebaseLog = [];
        for (const e of undoStack) e.rebased = 0;
        for (const e of redoStack) e.rebased = 0;
      }
    },
    clear() {
      undoStack.length = 0;
      redoStack = [];
      rebaseLog = [];
    },
  };
}
