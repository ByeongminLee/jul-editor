// "@jul-editor/plugins/collaboration": real-time co-editing as a plugin.
// A host app only connects a transport: useCollaboration(editor, { transport, user, docId }).
// See README.md for the protocol, convergence guarantees and limits.

export { createCollaboration } from "./client.js";
export type { CollabClient, CollabClientStats, CollaborationOptions } from "./client.js";
export { createAuthority } from "./authority.js";
export type { Authority, AuthorityOptions } from "./authority.js";
export { createBroadcastChannelTransport } from "./broadcast-channel-transport.js";
export type { BroadcastChannelTransportOptions } from "./broadcast-channel-transport.js";
export { createMemoryHub, createMemoryTransport } from "./memory-transport.js";
export type { MemoryHub, MemoryHubOptions, MemoryTransport } from "./memory-transport.js";
export { createWebSocketTransport } from "./websocket-transport.js";
export type { WebSocketLike, WebSocketTransportOptions } from "./websocket-transport.js";
export { attachRemoteCursors } from "./remote-cursors.js";
export type { RemoteCursorsHandle, RemoteCursorsOptions } from "./remote-cursors.js";
export { CollabAvatars, initialsOf } from "./collab-avatars.js";
export type { CollabAvatarsProps } from "./collab-avatars.js";
export { useCollaboration } from "./use-collaboration.js";
export type { UseCollaborationOptions, UseCollaborationResult } from "./use-collaboration.js";
export { diffStores, applyWireOps, resolveWireOp } from "./wire.js";
export { transformLists, mapOffset, mapPoint, mapSelectionOver } from "./transform.js";
export type {
  CollabMessage,
  CollabPeer,
  CollabPresenceStatus,
  CollabSelection,
  CollabStatus,
  CollabTransport,
  CollabTransportStatus,
  CollabUser,
  WireOp,
} from "./types.js";
