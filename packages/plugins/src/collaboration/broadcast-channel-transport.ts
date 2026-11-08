// Same-origin, same-browser transport (tabs/windows/iframes of one site) over
// the BroadcastChannel API. No server needed: the clients elect a leader tab
// as the sequencing authority. Messages are never delivered back to the
// sending channel instance, which matches the CollabTransport contract.
// Limits: it does not cross browsers or devices and nothing persists once all
// tabs close, so it is a demo/offline-first transport, not a sync backend.

import type { CollabMessage, CollabTransport } from "./types.js";

export interface BroadcastChannelTransportOptions {
  /** Channel name prefix; the document id is appended (default "jul-collab:"). */
  prefix?: string;
  /** Override the constructor (tests, polyfills). Defaults to globalThis.BroadcastChannel. */
  BroadcastChannelImpl?: typeof BroadcastChannel;
}

export function createBroadcastChannelTransport(options: BroadcastChannelTransportOptions = {}): CollabTransport {
  const prefix = options.prefix ?? "jul-collab:";
  let channel: BroadcastChannel | null = null;
  const handlers = new Set<(m: CollabMessage) => void>();
  return {
    authority: "peer",
    connect(docId) {
      const Impl = options.BroadcastChannelImpl ?? (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
      if (!Impl) throw new Error("BroadcastChannel is not available in this environment");
      channel = new Impl(prefix + docId);
      channel.onmessage = (e: MessageEvent) => handlers.forEach((h) => h(e.data as CollabMessage));
    },
    send(message) {
      channel?.postMessage(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    disconnect() {
      channel?.close();
      channel = null;
    },
  };
}
