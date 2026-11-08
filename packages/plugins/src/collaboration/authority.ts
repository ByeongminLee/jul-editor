// The sequencer. It owns the authoritative store of one document and turns
// client batches into a single total order:
//
//   client --ops{base,batch}--> authority --applied{seq}--> everyone
//
// A batch sent against `base` may be concurrent with batches sequenced after
// `base`; the authority rewrites it over them (transform.ts) before applying.
// The same class runs inside a leader browser tab (transport authority
// "peer") or inside a backend process (authority "server": host it behind a
// WebSocket room and forward every received CollabMessage to `handle`, then
// broadcast whatever it returns). It is pure and synchronous: no timers, no I/O.

import { fromDoc, normalizeDoc, toDoc } from "@jul-editor/core";
import type { Doc, Registry, Store } from "@jul-editor/core";
import { transformLists } from "./transform.js";
import type { CollabMessage, WireOp } from "./types.js";
import { applyWireOps } from "./wire.js";

export interface AuthorityOptions {
  registry: Registry;
  /** Initial document (untrusted JSON is normalized). Ignored when `store` is given. */
  doc?: Doc;
  /** Take over an existing store/version (leader hand-off). */
  store?: Store;
  version?: number;
  /** Authority id used as `from` (default "server"). */
  id?: string;
  /** How many sequenced batches are kept to rebase late client batches (default 1000). */
  logLimit?: number;
}

export interface Authority {
  readonly id: string;
  getVersion(): number;
  getStore(): Store;
  snapshot(): { version: number; doc: Doc };
  /** Sequences one client batch. `null` means the batch is too old (or from the
   * future) to rebase: the sender must resync from a snapshot. */
  submit(from: string, base: number, batch: number, ops: WireOp[]): Extract<CollabMessage, { t: "applied" }> | null;
  /** Protocol entry point for a hosted authority: feed it received messages,
   * broadcast (or address, see `to`) everything it returns. Handles `ops`
   * and `sync-request`; other messages (presence, hello...) return [] and are
   * expected to be relayed by the host. */
  handle(message: CollabMessage): CollabMessage[];
}

export function createAuthority(options: AuthorityOptions): Authority {
  const { registry } = options;
  const id = options.id ?? "server";
  const limit = options.logLimit ?? 1000;
  let store: Store = options.store ?? fromDoc(normalizeDoc(options.doc ?? { version: 1, blocks: [{ id: "root", type: "paragraph", props: {}, content: [] }] }, registry), registry);
  let version = options.version ?? 0;
  const log: { seq: number; ops: WireOp[] }[] = [];

  function snapshot() {
    return { version, doc: toDoc(store) };
  }

  function submit(from: string, base: number, batch: number, ops: WireOp[]) {
    if (base > version) return null;
    const oldest = log.length ? log[0]!.seq : version + 1;
    if (base < oldest - 1) return null; // fell out of the rebase window
    let rebased = ops;
    for (const entry of log) {
      if (entry.seq <= base) continue;
      rebased = transformLists(rebased, entry.ops, false)[0]; // earlier-sequenced side wins ties
    }
    const result = applyWireOps(store, rebased, registry);
    store = result.store;
    version += 1;
    log.push({ seq: version, ops: rebased });
    if (log.length > limit) log.shift();
    return { t: "applied" as const, from: id, seq: version, origin: from, batch, ops: rebased };
  }

  return {
    id,
    getVersion: () => version,
    getStore: () => store,
    snapshot,
    submit,
    handle(message) {
      if (message.t === "sync-request") {
        const { version: v, doc } = snapshot();
        return [{ t: "snapshot", from: id, to: message.from, version: v, doc }];
      }
      if (message.t === "ops") {
        const applied = submit(message.from, message.base, message.batch, message.ops);
        if (applied) return [applied];
        const { version: v, doc } = snapshot();
        return [{ t: "snapshot", from: id, to: message.from, version: v, doc }]; // resync the sender
      }
      return [];
    },
  };
}
