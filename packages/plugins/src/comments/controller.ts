// Framework-agnostic comments controller: owns the thread cache, selection/hover/
// filter/draft UI state and every user action (create/reply/edit/delete/resolve).
// React (react.tsx) is a thin layer over `getState()/subscribe()`.
//
// Source of truth: threads come ONLY from the adapter (initial listThreads + its
// subscribe stream, which also echoes our own writes); anchors come ONLY from the doc
// (comment marks). `ThreadView` joins the two on every doc/adapter/selection change.

import { newId } from "@jul-editor/core";
import type { Editor, Registry, Selection } from "@jul-editor/core";
import type { CommentAdapter } from "./adapter.js";
import { addCommentMark, docOrder, findCommentRanges, quoteOfSelection, removeCommentMark, threadIdsAtPoint } from "./mark.js";
import type { ThreadRange } from "./mark.js";
import type { CommentAuthor, CommentThread } from "./types.js";

export type CommentFilter = "all" | "open" | "resolved";

export interface ThreadView {
  thread: CommentThread;
  /** True when the anchor is gone from the doc (text deleted / block removed).
   * The thread is kept; undoing the deletion reattaches it. */
  detached: boolean;
  /** Text anchors: where the mark currently sits (empty for block anchors / detached). */
  ranges: ThreadRange[];
}

/** An in-progress "Add comment": the selection is captured at begin time because
 * focusing the reply box collapses the editor's own selection. */
export type CommentDraft =
  | { type: "text"; selection: Extract<Selection, { type: "text" }>; quote: string }
  | { type: "block"; blockId: string };

export interface CommentsState {
  /** False until the first listThreads() resolved. */
  ready: boolean;
  /** Threads (all statuses, unfiltered) in document order, detached ones last. */
  threads: ThreadView[];
  selectedThreadId: string | null;
  hoveredThreadId: string | null;
  filter: CommentFilter;
  draft: CommentDraft | null;
  /** Mark thread ids present in the doc with no thread in the adapter (e.g. pasted from another doc). */
  orphanMarks: string[];
  /** A non-collapsed text selection exists (the "Add comment" button's enabled state). */
  canAdd: boolean;
}

export interface CommentsCallbacks {
  /** These fire for actions performed through THIS controller (not for remote adapter
   * pushes), so a host can persist/notify exactly once per user action. */
  onThreadCreated?(thread: CommentThread): void;
  onThreadUpdated?(thread: CommentThread): void;
  onThreadResolved?(thread: CommentThread): void;
  onThreadReopened?(thread: CommentThread): void;
  onThreadDeleted?(threadId: string): void;
}

export interface CommentsControllerOptions extends CommentsCallbacks {
  editor: Editor;
  adapter: CommentAdapter;
  author: CommentAuthor | (() => CommentAuthor);
  /** Only used to skip non-text blocks when marking a range; optional. */
  registry?: Registry;
}

export interface CommentsController {
  readonly editor: Editor;
  getState(): CommentsState;
  subscribe(listener: () => void): () => void;
  /** Starts a draft from the editor's current non-collapsed text selection. false if there is none. */
  beginDraft(): boolean;
  /** Starts a draft for a whole block. */
  beginBlockDraft(blockId: string): boolean;
  cancelDraft(): void;
  /** Creates the thread for the current draft (mark in doc + thread in adapter). */
  submitDraft(body: string): Promise<CommentThread | null>;
  /** One-shot command: begin a draft from the selection and submit it. */
  addComment(body: string): Promise<CommentThread | null>;
  reply(threadId: string, body: string): Promise<CommentThread | null>;
  editComment(threadId: string, commentId: string, body: string): Promise<CommentThread | null>;
  deleteComment(threadId: string, commentId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  resolve(threadId: string): Promise<CommentThread | null>;
  reopen(threadId: string): Promise<CommentThread | null>;
  select(threadId: string | null, opts?: { scroll?: boolean }): void;
  hover(threadId: string | null): void;
  setFilter(filter: CommentFilter): void;
  /** Re-reads the doc anchors (called automatically on editor change). */
  refresh(): void;
  destroy(): void;
}

const THREAD_ATTR = "data-mark-thread-id";

export function createCommentsController(options: CommentsControllerOptions): CommentsController {
  const { editor, adapter, registry } = options;
  const threads = new Map<string, CommentThread>();
  const listeners = new Set<() => void>();
  let destroyed = false;

  let state: CommentsState = { ready: false, threads: [], selectedThreadId: null, hoveredThreadId: null, filter: "all", draft: null, orphanMarks: [], canAdd: false };

  const author = (): CommentAuthor => (typeof options.author === "function" ? options.author() : options.author);

  function compute(): Pick<CommentsState, "threads" | "orphanMarks"> {
    const store = editor.getState().store;
    const ranges = findCommentRanges(store);
    const order = docOrder(store);
    const keyOf = (v: ThreadView): [number, number] => {
      if (v.detached) return [Infinity, v.thread.createdAt];
      if (v.thread.anchor.type === "block") return [order.get(v.thread.anchor.blockId) ?? Infinity, -1];
      const r = v.ranges[0]!;
      return [order.get(r.blockId) ?? Infinity, r.from];
    };
    const views: ThreadView[] = [...threads.values()].map((thread) => {
      if (thread.anchor.type === "block") return { thread, detached: !store.records.has(thread.anchor.blockId), ranges: [] };
      const r = ranges.get(thread.id) ?? [];
      return { thread, detached: r.length === 0, ranges: r };
    });
    views.sort((a, b) => {
      const [a0, a1] = keyOf(a);
      const [b0, b1] = keyOf(b);
      return a0 !== b0 ? (a0 < b0 ? -1 : 1) : a1 - b1;
    });
    return { threads: views, orphanMarks: [...ranges.keys()].filter((id) => !threads.has(id)) };
  }

  function sameViews(a: ThreadView[], b: ThreadView[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v.thread === b[i]!.thread && v.detached === b[i]!.detached && JSON.stringify(v.ranges) === JSON.stringify(b[i]!.ranges));
  }

  function set(patch: Partial<CommentsState>): void {
    const next = { ...state, ...patch };
    // keep references stable when nothing visible changed (cheap re-render guard)
    if (patch.threads && sameViews(state.threads, patch.threads)) next.threads = state.threads;
    if (patch.orphanMarks && patch.orphanMarks.join() === state.orphanMarks.join()) next.orphanMarks = state.orphanMarks;
    if (Object.keys(next).every((k) => (next as Record<string, unknown>)[k] === (state as unknown as Record<string, unknown>)[k])) return;
    state = next;
    for (const l of [...listeners]) l();
  }

  function refresh(): void {
    if (destroyed) return;
    const c = compute();
    // a deleted/vanished selected thread clears the selection
    const sel = state.selectedThreadId && !threads.has(state.selectedThreadId) ? { selectedThreadId: null } : {};
    set({ ...c, ...sel });
  }

  // ---- wiring ---------------------------------------------------------------------
  const rangeSelected = (s: { selection: Selection | null }): boolean =>
    !!s.selection && s.selection.type === "text" && (s.selection.anchor.blockId !== s.selection.focus.blockId || s.selection.anchor.offset !== s.selection.focus.offset);
  const offChange = editor.on("change", (s) => {
    set({ canAdd: rangeSelected(s) });
    refresh();
  });
  const offSelection = editor.on("selection", (s) => {
    set({ canAdd: rangeSelected(s) });
    const ids = threadIdsAtPoint(s).filter((id) => threads.has(id));
    if (ids.length === 0) {
      if (state.selectedThreadId !== null && !state.draft) set({ selectedThreadId: null });
      return;
    }
    if (state.selectedThreadId && ids.includes(state.selectedThreadId)) return;
    set({ selectedThreadId: ids[ids.length - 1]! });
  });
  const offAdapter = adapter.subscribe((change) => {
    if (change.type === "deleted") threads.delete(change.threadId);
    else threads.set(change.thread.id, change.thread);
    refresh();
  });
  adapter
    .listThreads()
    .then((list) => {
      if (destroyed) return;
      for (const t of list) if (!threads.has(t.id)) threads.set(t.id, t);
      set({ ready: true, ...compute() });
    })
    .catch(() => set({ ready: true }));

  // ---- actions --------------------------------------------------------------------
  async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null; // adapter failure: state is unchanged (events drive state), caller sees null
    }
  }

  function beginDraft(): boolean {
    const sel = editor.getState().selection;
    if (!sel || sel.type !== "text") return false;
    if (sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset) return false;
    const quote = quoteOfSelection(editor.getState().store, registry, sel);
    if (!quote) return false;
    set({ draft: { type: "text", selection: sel, quote } });
    return true;
  }

  async function submitDraft(body: string): Promise<CommentThread | null> {
    const draft = state.draft;
    const text = body.trim();
    if (!draft || !text) return null;
    const id = newId();
    if (draft.type === "text") {
      // the doc may have moved on while the box was open: only mark if the same text is still there
      if (quoteOfSelection(editor.getState().store, registry, draft.selection) !== draft.quote) {
        set({ draft: null });
        return null;
      }
      const thread = await guarded(() => adapter.createThread({ id, anchor: { type: "text", quote: draft.quote }, body: text, author: author() }));
      if (!thread) return null;
      addCommentMark(editor, registry, draft.selection, id);
      set({ draft: null, selectedThreadId: id });
      refresh();
      options.onThreadCreated?.(thread);
      return thread;
    }
    if (!editor.getState().store.records.has(draft.blockId)) {
      set({ draft: null });
      return null;
    }
    const thread = await guarded(() => adapter.createThread({ id, anchor: { type: "block", blockId: draft.blockId }, body: text, author: author() }));
    if (!thread) return null;
    set({ draft: null, selectedThreadId: id });
    refresh();
    options.onThreadCreated?.(thread);
    return thread;
  }

  async function changed(p: Promise<CommentThread | null>, cb?: (t: CommentThread) => void): Promise<CommentThread | null> {
    const t = await guarded(() => p);
    if (t) {
      refresh();
      cb?.(t);
    }
    return t;
  }

  async function removeThread(threadId: string): Promise<void> {
    const ok = await guarded(async () => {
      await adapter.deleteThread(threadId);
      return true;
    });
    if (!ok) return;
    removeCommentMark(editor, threadId);
    threads.delete(threadId);
    refresh();
    options.onThreadDeleted?.(threadId);
  }

  const controller: CommentsController = {
    editor,
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    beginDraft,
    beginBlockDraft(blockId) {
      if (!editor.getState().store.records.has(blockId)) return false;
      set({ draft: { type: "block", blockId } });
      return true;
    },
    cancelDraft: () => set({ draft: null }),
    submitDraft,
    async addComment(body) {
      return beginDraft() ? submitDraft(body) : null;
    },
    reply: (id, body) => (body.trim() ? changed(adapter.addReply(id, { body: body.trim(), author: author() }), (t) => options.onThreadUpdated?.(t)) : Promise.resolve(null)),
    editComment: (id, cid, body) => (body.trim() ? changed(adapter.editComment(id, cid, body.trim()), (t) => options.onThreadUpdated?.(t)) : Promise.resolve(null)),
    async deleteComment(threadId, commentId) {
      const before = threads.get(threadId);
      const t = await guarded(async () => ({ t: await adapter.deleteComment(threadId, commentId) }));
      if (!t) return;
      if (t.t === null) {
        // last comment gone: the adapter deleted the thread, so drop its anchor too
        removeCommentMark(editor, threadId);
        threads.delete(threadId);
        refresh();
        if (before) options.onThreadDeleted?.(threadId);
      } else {
        refresh();
        options.onThreadUpdated?.(t.t);
      }
    },
    deleteThread: removeThread,
    resolve: (id) => changed(adapter.resolveThread(id, author()), (t) => (options.onThreadResolved?.(t), options.onThreadUpdated?.(t))),
    reopen: (id) => changed(adapter.reopenThread(id), (t) => (options.onThreadReopened?.(t), options.onThreadUpdated?.(t))),
    select(threadId, opts) {
      set({ selectedThreadId: threadId });
      if (threadId && opts?.scroll) {
        const root = editor.getRoot();
        const el = Array.from(root.querySelectorAll(`[${THREAD_ATTR}]`)).find((e) => e.getAttribute(THREAD_ATTR) === threadId);
        el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
    },
    hover: (id) => set({ hoveredThreadId: id }),
    setFilter: (filter) => set({ filter }),
    refresh,
    destroy() {
      destroyed = true;
      offChange();
      offSelection();
      offAdapter();
      listeners.clear();
    },
  };
  return controller;
}

/** The thread views a panel should list for a filter (detached threads always shown under "all"/their status). */
export function filterThreads(views: ThreadView[], filter: CommentFilter): ThreadView[] {
  return filter === "all" ? views : views.filter((v) => v.thread.status === filter);
}

export { THREAD_ATTR as COMMENT_THREAD_ATTR };
