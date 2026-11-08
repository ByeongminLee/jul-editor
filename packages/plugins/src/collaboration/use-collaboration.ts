"use client";

// useCollaboration(editor, { transport, user, docId }) -> { status, peers, client }
//
// The one call a host app needs: give it the editor, a transport and the
// current user. It joins the room, keeps the document in sync, draws remote
// carets (disable with cursors: false) and tears everything down on unmount.
// `transport` must be referentially stable (create it once, e.g. useMemo or
// module scope); a changed transport/docId/user.id reconnects.

import type { Editor } from "@jul-editor/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createCollaboration } from "./client.js";
import type { CollabClient, CollaborationOptions } from "./client.js";
import { attachRemoteCursors } from "./remote-cursors.js";
import type { RemoteCursorsOptions } from "./remote-cursors.js";
import type { CollabPeer, CollabStatus } from "./types.js";

export interface UseCollaborationOptions extends CollaborationOptions {
  /** Remote caret/selection overlay: true (default), false, or its options. */
  cursors?: boolean | RemoteCursorsOptions;
}

export interface UseCollaborationResult {
  status: CollabStatus;
  /** Everyone else in the document (stable array identity until something changes). */
  peers: CollabPeer[];
  /** The underlying client once connected (null before the effect ran). */
  client: CollabClient | null;
}

const NO_PEERS: CollabPeer[] = [];
const noopSubscribe = () => () => {};

export function useCollaboration(editor: Editor | null | undefined, options: UseCollaborationOptions): UseCollaborationResult {
  const [client, setClient] = useState<CollabClient | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { transport, docId, clientId } = options;
  const userId = options.user.id;

  useEffect(() => {
    if (!editor) return;
    const { cursors, ...rest } = latest.current;
    const c = createCollaboration(editor, rest);
    const handle = cursors !== false && typeof document !== "undefined" ? attachRemoteCursors(editor, c, cursors === true || cursors === undefined ? {} : cursors) : null;
    setClient(c);
    return () => {
      handle?.destroy();
      c.destroy();
      setClient(null);
    };
  }, [editor, transport, docId, clientId, userId]);

  const { name, color, avatarUrl } = options.user;
  useEffect(() => {
    if (client && (client.getUser().name !== name || client.getUser().color !== color || client.getUser().avatarUrl !== avatarUrl)) client.setUser({ id: userId, name, color, avatarUrl });
  }, [client, userId, name, color, avatarUrl]);

  const subscribe = client ? (cb: () => void) => client.subscribe(cb) : noopSubscribe;
  const status = useSyncExternalStore(subscribe, () => client?.getStatus() ?? "connecting", () => "connecting" as CollabStatus);
  const peers = useSyncExternalStore(subscribe, () => client?.getPeers() ?? NO_PEERS, () => NO_PEERS);
  return { status, peers, client };
}
