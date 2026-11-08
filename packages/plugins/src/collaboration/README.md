# Collaboration plugin (`@jul-editor/plugins/collaboration`)

Real-time co-editing for a JulEditor, built on the core's op model (no Yjs).
The host app only supplies a transport.

```tsx
import { CollabAvatars, createBroadcastChannelTransport, useCollaboration } from "@jul-editor/plugins/collaboration";

const transport = createBroadcastChannelTransport(); // module scope: must be stable
const user = { id: "u1", name: "Ada", color: "#3b82f6" };

function Page({ editor }) {
  const { status, peers } = useCollaboration(editor, { transport, user, docId: "page-1" });
  return <CollabAvatars peers={peers} />; // remote carets are drawn automatically
}
```

Vanilla: `createCollaboration(editor, { transport, user, docId })` returns a client
(`getStatus`, `getPeers`, `subscribe`, `destroy`, ...); `attachRemoteCursors(editor, client)` draws carets.

## Transports (the only host-supplied piece)

`CollabTransport` = `connect(docId, clientId)`, `send(message)`, `onMessage(handler)`, `disconnect()`
and optional `onStatus`, plus `authority: "peer" | "server"`. All messages are JSON.

| transport | use | authority |
|---|---|---|
| `createBroadcastChannelTransport()` | tabs of one browser, demos | peer (a leader tab sequences) |
| `createMemoryHub().createTransport()` | tests, two editors in one page | peer, or server-style with `{ authority }` |
| `createWebSocketTransport({ url })` | example adapter, NOT tested against a real server | server |

Writing your own (SSE, WebRTC, Socket.IO, ...) is ~40 lines: broadcast `send` to the other
members of the room, in order, and report incoming messages. For `authority: "server"` the
backend must host `createAuthority({ registry, doc })` per room: forward received messages to
`authority.handle(msg)`, broadcast the returned messages (`applied` to everyone, `snapshot`
is addressed with `to`), relay `hello/welcome/presence/leave` to the other sockets, and
persist `authority.snapshot()`. See the header of `websocket-transport.ts`.

## How sync works

1. **Local edit -> wire ops.** Any store change (typing, commands, undo, setDoc) is turned into
   ops by diffing the before/after stores (`wire.ts`). Text becomes minimal insert/delete atoms,
   block insert/move use sibling anchors (`after`/`before` ids) instead of indexes.
2. **Sequencing.** One authority (server, or an elected leader tab) assigns a total order
   `seq` to batches. A batch sent against `base` is rebased over batches sequenced after
   `base` (`transform.ts`: insert/delete OT for text offsets; last-write-wins for props/type/move;
   edits to a replaced or removed block are dropped).
3. **Optimistic client.** One batch in flight, further edits buffered. Incoming remote batches
   transform both and are applied with `editor.applyRemote` (core): never an undo entry,
   caret mapped, DOM selection untouched unless focused.
4. **Late joiners** send `sync-request`; the authority answers with a snapshot (doc + version).
5. **Undo/redo** stay local: history snapshots are lazily rebased with the remote ops
   (`history.rebase`), so undoing my edit does not revert a collaborator's.

### Guarantees

- Every client replays the same sequenced stream into a shadow store. When a client's pending
  queue drains, its editor is compared with that store and repaired by the diff if a
  prediction was off (`client.stats.repairs`). So **at quiescence all editors show exactly
  the authority's document**, independent of OT quality. OT only preserves intent and avoids
  flicker while edits are in flight (the text OT is fuzz-tested for TP1).
- Concurrent edits to different blocks, block inserts/deletes/moves and typing in one block
  all converge (see `sync.test.ts`, including a randomized soak).

### Limits (be honest with users)

- **Offline edits are not merged.** While `status !== "connected"` local edits are not
  sent; on (re)join the room's snapshot replaces the local document. A CRDT (Yjs) would
  merge them; this design does not.
- **Serverless leader election is best effort** (BroadcastChannel, memory): lowest client id
  among synced peers, heartbeat expiry after ~3.5 heartbeats, no persistence once all tabs close.
  A hand-off while a batch is in flight resends it; delivery is assumed reliable and ordered.
  For production use a server authority.
- **Undo across remote edits to the same text region** restores a snapshot rebased with
  clamped offsets: nothing is lost, but the remote text can land a few characters off.
- A collaborator's text typed *inside* a range you delete survives (insert beats delete); a
  concurrent move/props/type change on the same block resolves last-write-wins by sequence order.
- Block/cell selections are not shared, only text carets and ranges.
- The diff is O(records) per local commit (same order as the core's own commit copy).
- The default authority document (no `doc` given) is one empty paragraph with id `root`.
