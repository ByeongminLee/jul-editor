// In-memory transport for tests and demos: any number of editors in ONE page
// (or one test) talk through a MemoryHub. Delivery is asynchronous (a
// microtask per message, like a real socket) and per-sender ordered, so the
// sync code is exercised with real interleavings. `await hub.idle()` waits
// until every queued message has been delivered and handled.
//
// Two modes:
//  - default ("peer"): the hub is a dumb relay and the clients elect a leader;
//  - `{ authority }`: the hub embeds a createAuthority(), i.e. it behaves like
//    a real backend room (transport.authority === "server"), which is how the
//    server path is tested without a server.

import { createAuthority } from "./authority.js";
import type { AuthorityOptions } from "./authority.js";
import type { CollabMessage, CollabTransport, CollabTransportStatus } from "./types.js";

export interface MemoryHubOptions {
  /** Host a server-style authority in the hub (omit for a plain relay). */
  authority?: AuthorityOptions;
}

export interface MemoryTransport extends CollabTransport {
  /** Test helper: act as if the connection dropped (no delivery in or out). */
  simulateDisconnect(): void;
  /** Test helper: bring the connection back (clients re-join). */
  simulateReconnect(): void;
}

export interface MemoryHub {
  createTransport(): MemoryTransport;
  /** Resolves once every queued message has been delivered and processed. */
  idle(): Promise<void>;
  /** The embedded authority (server mode only). */
  readonly authority: ReturnType<typeof createAuthority> | null;
}

interface Member {
  docId: string;
  clientId: string;
  online: boolean;
  deliver(message: CollabMessage): void;
}

export function createMemoryHub(options: MemoryHubOptions = {}): MemoryHub {
  const members = new Set<Member>();
  const server = options.authority ? createAuthority(options.authority) : null;
  let pending = 0;

  function deliver(member: Member, message: CollabMessage): void {
    pending += 1;
    queueMicrotask(() => {
      pending -= 1;
      if (member.online && members.has(member)) member.deliver(structuredClone(message)); // a real wire never shares references
    });
  }

  function broadcast(from: Member | null, docId: string, message: CollabMessage): void {
    for (const m of members) if (m !== from && m.docId === docId && m.online) deliver(m, message);
  }

  function route(from: Member, message: CollabMessage): void {
    const toAuthority = message.t === "ops" || message.t === "sync-request";
    if (!(server && toAuthority)) broadcast(from, from.docId, message);
    if (server && toAuthority) {
      // the hub is the authority: its answers go to everyone (applied) or to the asker (snapshot)
      for (const out of server.handle(message)) broadcast(null, from.docId, out);
    }
  }

  return {
    authority: server,
    createTransport() {
      let handlers = new Set<(m: CollabMessage) => void>();
      let statusHandlers = new Set<(s: CollabTransportStatus) => void>();
      const member: Member = {
        docId: "",
        clientId: "",
        online: false,
        deliver: (m) => handlers.forEach((h) => h(m)),
      };
      const emitStatus = (s: CollabTransportStatus) => statusHandlers.forEach((h) => h(s));
      return {
        authority: server ? "server" : "peer",
        connect(docId, clientId) {
          member.docId = docId;
          member.clientId = clientId;
          member.online = true;
          members.add(member);
        },
        send(message) {
          if (member.online) route(member, message);
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
          member.online = false;
          members.delete(member);
          handlers = new Set();
          statusHandlers = new Set();
        },
        simulateDisconnect() {
          member.online = false;
          emitStatus("disconnected");
        },
        simulateReconnect() {
          member.online = true;
          emitStatus("connected");
        },
      };
    },
    async idle() {
      // timers can still enqueue work (join timeouts), but microtask chains settle within a few turns
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (pending === 0) {
          await Promise.resolve();
          if (pending === 0) return;
        }
      }
    },
  };
}

/** Shorthand for tests: a hub plus a transport factory. */
export function createMemoryTransport(hub: MemoryHub = createMemoryHub()): MemoryTransport {
  return hub.createTransport();
}
