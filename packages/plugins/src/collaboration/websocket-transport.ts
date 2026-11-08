// EXAMPLE ADAPTER, NOT TESTED AGAINST A REAL SERVER. It shows how little a
// host needs to write to put the collaboration plugin on a WebSocket backend.
// It is exercised in websocket-transport.test.ts only with a fake socket class.
//
// What the SERVER has to do (pseudo-code, any runtime):
//
//   import { createAuthority } from "@jul-editor/plugins/collaboration";
//   const rooms = new Map<string, { sockets: Set<WebSocket>; authority: Authority }>();
//   onConnection(socket, { doc }) {
//     const room = rooms.get(doc) ?? create({ authority: createAuthority({ registry, doc: await load(doc) }) });
//     room.sockets.add(socket);
//     socket.onmessage = (e) => {
//       const msg = JSON.parse(e.data);
//       // 1. relay presence/hello/welcome/leave to the OTHER sockets of the room
//       // 2. let the authority sequence "ops" and answer "sync-request":
//       for (const out of room.authority.handle(msg)) {
//         const frame = JSON.stringify(out);
//         // "applied" goes to EVERY socket (the sender uses it as its ack);
//         // "snapshot" has `to`: broadcast it, clients drop messages not for them
//         room.sockets.forEach((s) => s.send(frame));
//       }
//       persist(doc, room.authority.snapshot()); // debounce in real life
//     };
//     socket.onclose = () => room.sockets.delete(socket);
//   }
//
// Auth: put your token in `buildUrl` (or use a cookie / subprotocol); this file
// never sees credentials.

import type { CollabMessage, CollabTransport, CollabTransportStatus } from "./types.js";

export interface WebSocketTransportOptions {
  /** e.g. "wss://example.com/collab". The room is added by `buildUrl`. */
  url: string;
  /** Default: `${url}?doc=${docId}&client=${clientId}`. Add your auth token here. */
  buildUrl?: (url: string, docId: string, clientId: string) => string;
  protocols?: string | string[];
  /** Override the constructor (tests, Node `ws`). Defaults to globalThis.WebSocket. */
  WebSocketImpl?: new (url: string, protocols?: string | string[]) => WebSocketLike;
  /** Reconnect with exponential backoff (default true; delay doubles up to maxDelayMs). */
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxDelayMs?: number;
}

/** The slice of the WebSocket API used here (structural, so `ws` also fits). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
  readyState: number;
}

const OPEN = 1;

export function createWebSocketTransport(options: WebSocketTransportOptions): CollabTransport {
  const handlers = new Set<(m: CollabMessage) => void>();
  const statusHandlers = new Set<(s: CollabTransportStatus) => void>();
  let socket: WebSocketLike | null = null;
  let closedByUs = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const queue: string[] = []; // sent before the socket opened

  const emitStatus = (s: CollabTransportStatus) => statusHandlers.forEach((h) => h(s));

  function open(docId: string, clientId: string, onFirstOpen?: () => void, onFirstFail?: (e: unknown) => void): void {
    const Impl = options.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketTransportOptions["WebSocketImpl"] }).WebSocket;
    if (!Impl) throw new Error("WebSocket is not available in this environment");
    const url = options.buildUrl ? options.buildUrl(options.url, docId, clientId) : `${options.url}?doc=${encodeURIComponent(docId)}&client=${encodeURIComponent(clientId)}`;
    const ws = new Impl(url, options.protocols);
    socket = ws;
    ws.onopen = () => {
      const wasRetry = attempt > 0;
      attempt = 0;
      for (const frame of queue.splice(0)) ws.send(frame);
      onFirstOpen?.();
      onFirstOpen = undefined;
      if (wasRetry) emitStatus("connected");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as CollabMessage;
        handlers.forEach((h) => h(msg));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = (e) => {
      onFirstFail?.(e);
      onFirstFail = undefined;
    };
    ws.onclose = () => {
      if (closedByUs) return;
      emitStatus("disconnected");
      if (options.reconnect === false) return;
      const delay = Math.min(options.maxDelayMs ?? 15000, (options.reconnectDelayMs ?? 500) * 2 ** attempt++);
      retry = setTimeout(() => open(docId, clientId), delay);
    };
  }

  return {
    authority: "server",
    connect(docId, clientId) {
      closedByUs = false;
      return new Promise<void>((resolve, reject) => open(docId, clientId, resolve, reject));
    },
    send(message) {
      const frame = JSON.stringify(message);
      if (socket && socket.readyState === OPEN) socket.send(frame);
      else queue.push(frame);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    disconnect() {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    },
  };
}
