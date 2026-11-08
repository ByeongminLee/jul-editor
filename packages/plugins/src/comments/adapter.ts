// CommentAdapter: the ONE seam between the comments plugin and wherever the
// threads actually live. A host implements these 9 methods against its own API
// (and calls `onChange` when the server pushes a change); the plugin never
// does network or storage itself. Two reference implementations ship here:
//   - createMemoryCommentAdapter: in-process (demos, tests, single user)
//   - createBroadcastCommentAdapter: memory + BroadcastChannel, so two tabs of the
//     same origin stay in sync (pairs with the collaboration plugin's doc sync).

import { newId } from "@jul-editor/core";
import type { CommentAuthor, CommentChange, CommentThread, NewThreadInput } from "./types.js";

export interface CommentAdapter {
  listThreads(): Promise<CommentThread[]>;
  createThread(input: NewThreadInput): Promise<CommentThread>;
  addReply(threadId: string, input: { body: string; author: CommentAuthor }): Promise<CommentThread>;
  editComment(threadId: string, commentId: string, body: string): Promise<CommentThread>;
  /** Deleting a thread's LAST comment deletes the thread (resolves to null). */
  deleteComment(threadId: string, commentId: string): Promise<CommentThread | null>;
  deleteThread(threadId: string): Promise<void>;
  resolveThread(threadId: string, by?: CommentAuthor): Promise<CommentThread>;
  reopenThread(threadId: string): Promise<CommentThread>;
  /** Called for EVERY change (local calls too, not just remote ones), so a
   * subscriber can treat the adapter as its single source of truth. Returns unsubscribe. */
  subscribe(onChange: (change: CommentChange) => void): () => void;
}

export interface MemoryCommentAdapterOptions {
  initialThreads?: CommentThread[];
  /** Injectable for deterministic tests. */
  now?: () => number;
  makeId?: () => string;
}

/** The in-memory store behind both adapters; `apply` lets the broadcast adapter
 * feed remote changes in without re-broadcasting them. */
export interface MemoryCommentAdapter extends CommentAdapter {
  /** Applies a change coming from elsewhere (a remote tab): updates state and notifies subscribers. */
  apply(change: CommentChange): void;
  /** Current threads, synchronously (tests, SSR snapshots). */
  snapshot(): CommentThread[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMemoryCommentAdapter(opts: MemoryCommentAdapterOptions = {}): MemoryCommentAdapter {
  const now = opts.now ?? Date.now;
  const makeId = opts.makeId ?? newId;
  const threads = new Map<string, CommentThread>((opts.initialThreads ?? []).map((t) => [t.id, clone(t)]));
  const listeners = new Set<(c: CommentChange) => void>();
  const emit = (c: CommentChange): void => {
    for (const l of [...listeners]) l(clone(c));
  };
  const need = (id: string): CommentThread => {
    const t = threads.get(id);
    if (!t) throw new Error(`comment thread not found: ${id}`);
    return t;
  };
  const update = (t: CommentThread): CommentThread => {
    threads.set(t.id, t);
    emit({ type: "updated", thread: t });
    return clone(t);
  };

  return {
    async listThreads() {
      return [...threads.values()].map(clone);
    },
    async createThread({ id, anchor, body, author }) {
      const t: CommentThread = {
        id: id ?? makeId(),
        anchor: clone(anchor),
        status: "open",
        createdAt: now(),
        comments: [{ id: makeId(), author: clone(author), body, createdAt: now() }],
      };
      threads.set(t.id, t);
      emit({ type: "created", thread: t });
      return clone(t);
    },
    async addReply(threadId, { body, author }) {
      const t = need(threadId);
      return update({ ...t, comments: [...t.comments, { id: makeId(), author: clone(author), body, createdAt: now() }] });
    },
    async editComment(threadId, commentId, body) {
      const t = need(threadId);
      if (!t.comments.some((c) => c.id === commentId)) throw new Error(`comment not found: ${commentId}`);
      return update({ ...t, comments: t.comments.map((c) => (c.id === commentId ? { ...c, body, editedAt: now() } : c)) });
    },
    async deleteComment(threadId, commentId) {
      const t = need(threadId);
      const rest = t.comments.filter((c) => c.id !== commentId);
      if (rest.length === t.comments.length) throw new Error(`comment not found: ${commentId}`);
      if (rest.length === 0) {
        threads.delete(threadId);
        emit({ type: "deleted", threadId });
        return null;
      }
      return update({ ...t, comments: rest });
    },
    async deleteThread(threadId) {
      if (threads.delete(threadId)) emit({ type: "deleted", threadId });
    },
    async resolveThread(threadId, by) {
      const t = need(threadId);
      return update({ ...t, status: "resolved", resolvedAt: now(), ...(by ? { resolvedBy: clone(by) } : {}) });
    },
    async reopenThread(threadId) {
      const { resolvedAt: _a, resolvedBy: _b, ...t } = need(threadId);
      return update({ ...t, status: "open" });
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    apply(change) {
      if (change.type === "deleted") threads.delete(change.threadId);
      else threads.set(change.thread.id, clone(change.thread));
      emit(change);
    },
    snapshot() {
      return [...threads.values()].map(clone);
    },
  };
}

type BroadcastMessage = { kind: "change"; change: CommentChange } | { kind: "hello" } | { kind: "sync"; threads: CommentThread[] };

/** Memory adapter whose writes are mirrored to every other tab/window on the same
 * `BroadcastChannel(channelName)`. A tab opening later asks peers for their threads
 * ("hello"), so late joiners catch up. Last-writer-wins per thread, which is
 * enough for comments; use a server-backed adapter for stronger guarantees.
 * Falls back to plain memory behavior where BroadcastChannel is unavailable (SSR). */
export function createBroadcastCommentAdapter(channelName: string, opts: MemoryCommentAdapterOptions = {}): MemoryCommentAdapter & { close(): void } {
  const mem = createMemoryCommentAdapter(opts);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  // changes that arrived FROM the channel must not be echoed back out
  let applyingRemote = false;

  mem.subscribe((change) => {
    if (!applyingRemote) channel?.postMessage({ kind: "change", change } satisfies BroadcastMessage);
  });

  if (channel) {
    channel.onmessage = (e: MessageEvent<BroadcastMessage>) => {
      const msg = e.data;
      applyingRemote = true;
      try {
        if (msg.kind === "change") mem.apply(msg.change);
        else if (msg.kind === "hello") channel.postMessage({ kind: "sync", threads: mem.snapshot() } satisfies BroadcastMessage);
        else if (msg.kind === "sync") {
          const have = new Set(mem.snapshot().map((t) => t.id));
          for (const thread of msg.threads) if (!have.has(thread.id)) mem.apply({ type: "created", thread });
        }
      } finally {
        applyingRemote = false;
      }
    };
    channel.postMessage({ kind: "hello" } satisfies BroadcastMessage);
  }

  return { ...mem, close: () => channel?.close() };
}
