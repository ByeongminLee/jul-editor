// Public types of the collaboration plugin: user/presence shapes, the wire
// protocol (CollabMessage) and the CollabTransport adapter a host implements.
//
// Design in one paragraph (details in README.md): the core store is op-based
// and every block has a stable id, so a sync layer needs no CRDT. One
// AUTHORITY (a server, or an elected leader tab when the transport has no
// server) assigns a total order (`seq`) to batches of ops. Clients apply their
// own edits optimistically, send them with the version they were based on,
// and rebase their unacknowledged edits over incoming remote ops (OT on text
// offsets, id/anchor addressing for structure). Everyone replays the same
// sequenced stream into a shadow "confirmed" store, so when a client's
// pending queue drains its display store is verified against it and repaired
// if a prediction was off. No Yjs, no network code in this package: the host
// supplies a transport.

import type { Block, Doc, Json, Op, Point } from "@jul-editor/core";

// ---- users & presence -------------------------------------------------------

export interface CollabUser {
  /** Stable identity of the human (survives reconnects, unlike clientId). */
  id: string;
  name: string;
  /** Any CSS color; used for the caret, selection tint and avatar ring. */
  color: string;
  avatarUrl?: string;
}

/** A text selection as plain points (block id + UTF-16 offset), the same
 * model the core's text Selection uses. Block/cell selections are not shared. */
export interface CollabSelection {
  anchor: Point;
  focus: Point;
}

export type CollabPresenceStatus = "active" | "idle";

/** One remote participant as seen by this client (never includes self). */
export interface CollabPeer {
  clientId: string;
  user: CollabUser;
  selection: CollabSelection | null;
  status: CollabPresenceStatus;
  /** Local timestamp (ms) of the last message heard from this peer. */
  lastSeen: number;
}

export type CollabStatus = "connecting" | "syncing" | "connected" | "disconnected";

// ---- wire ops -----------------------------------------------------------------
// Local edits are turned into WIRE ops (wire.ts diffStores). They are plain
// core Ops except where an index would be fragile under concurrency or where
// JSON would lose information:
//  - insertBlock/moveBlock carry sibling ANCHORS (`after`, fallback `before`)
//    instead of a numeric index, resolved against the receiver's store;
//  - setProps carries removed keys in `unset` (JSON drops `undefined`);
//  - text edits are atoms: a pure delete (replaceContent with no inlines) or a
//    pure insert (from === to), which is what the OT in transform.ts handles.

export type WireOp =
  | { type: "insertBlock"; parentId: string | null; after: string | null; before: string | null; block: Block }
  | { type: "moveBlock"; id: string; newParentId: string | null; after: string | null; before: string | null }
  | { type: "setProps"; id: string; patch: Record<string, Json>; unset?: string[] }
  | Exclude<Op, { type: "insertBlock" | "moveBlock" | "setProps" }>;

// ---- protocol -------------------------------------------------------------------
// Every message carries `from` (clientId, or "server" for a hosted authority)
// and may carry `to` (a clientId) when it is addressed to one peer; transports
// deliver everything to everyone else and the client drops messages whose `to`
// is not itself. All messages are JSON-serializable.

export type CollabMessage = { from: string; to?: string } & (
  | { t: "hello"; user: CollabUser }
  | { t: "welcome"; user: CollabUser; leader: string | null }
  | { t: "leader"; version: number }
  | { t: "sync-request" }
  | { t: "snapshot"; version: number; doc: Doc }
  | { t: "ops"; base: number; batch: number; ops: WireOp[] }
  | { t: "applied"; seq: number; origin: string; batch: number; ops: WireOp[] }
  | { t: "presence"; user: CollabUser; selection: CollabSelection | null; status: CollabPresenceStatus; synced: boolean }
  | { t: "leave" }
);

// ---- transport adapter ------------------------------------------------------------

export type CollabTransportStatus = "connected" | "disconnected";

/**
 * The only thing a host app has to provide. A transport is a dumb pipe for ONE
 * document: it joins a room, broadcasts messages to the other members and
 * reports what it receives. Implementing one for a WebSocket / SSE / WebRTC /
 * long-polling backend is ~40 lines (see websocket-transport.ts).
 *
 * Contract:
 *  - `send` delivers to every OTHER member of the room (never back to the
 *    sender), in order, reliably while connected. A message with `to` is only
 *    consumed by that client but may be physically broadcast.
 *  - `authority`: "peer" (default) means there is no server logic: members
 *    elect a leader tab that sequences ops. "server" means the backend runs
 *    the authority (see createAuthority) and answers `sync-request` with a
 *    `snapshot` and every `ops` with a broadcast `applied` (also to the sender).
 *  - `onStatus` (optional) reports connection drops/recoveries.
 */
export interface CollabTransport {
  readonly authority?: "peer" | "server";
  connect(docId: string, clientId: string): void | Promise<void>;
  send(message: CollabMessage): void;
  onMessage(handler: (message: CollabMessage) => void): () => void;
  onStatus?(handler: (status: CollabTransportStatus) => void): () => void;
  disconnect(): void;
}
