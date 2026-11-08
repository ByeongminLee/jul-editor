// Comment thread data model. Pure JSON so any backend (REST, Firestore, a CRDT
// map) can store it as-is. The anchor in the DOCUMENT is a `comment` mark
// carrying `{threadId}` (see mark.ts); the thread record only keeps a snapshot
// of what was commented on, so a detached thread still shows its context.

export interface CommentAuthor {
  id: string;
  name: string;
  /** Any CSS color, used for the avatar fallback circle. */
  color?: string;
  avatar?: string;
}

export interface Comment {
  id: string;
  author: CommentAuthor;
  body: string;
  /** Epoch ms. */
  createdAt: number;
  editedAt?: number;
}

/** What a thread is attached to.
 * - `text`: a range of text. The truth lives in the doc (a `comment` mark with this
 *   thread's id); `quote` is the text at creation time, for display/detached threads.
 * - `block`: a whole block, by block id (ids are stable across edits, moves, undo). */
export type CommentAnchor = { type: "text"; quote: string } | { type: "block"; blockId: string };

export type ThreadStatus = "open" | "resolved";

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  status: ThreadStatus;
  comments: Comment[];
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
}

export interface NewThreadInput {
  /** Caller-chosen id (the controller pre-generates it so the doc mark and the
   * thread agree); the adapter generates one when omitted. */
  id?: string;
  anchor: CommentAnchor;
  body: string;
  author: CommentAuthor;
}

/** Why a thread changed, as pushed to `CommentAdapter.subscribe` listeners. */
export type CommentChange =
  | { type: "created"; thread: CommentThread }
  | { type: "updated"; thread: CommentThread }
  | { type: "deleted"; threadId: string };
