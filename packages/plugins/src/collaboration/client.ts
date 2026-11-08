// The collaboration client: glue between one Editor and one CollabTransport.
//
//   local edit  -> store diff -> wire ops -> (leader: sequence now | follower:
//                  inflight/buffer -> authority) -> everyone applies in `seq` order
//   remote op   -> shadow `confirmed` store (the replayed sequence) + rebase of
//                  my unacknowledged ops (OT) + editor.applyRemote (no undo entry)
//
// Convergence argument (honest version):
//  1. Every client applies the identical sequenced stream to an identical
//     starting snapshot with the same deterministic applyOp, so `confirmed`
//     stores are equal at equal `version` (this does not depend on the OT).
//  2. The display store is `confirmed` + my pending ops, rebased by OT. When
//     the pending queue drains, the display is compared with `confirmed` and
//     repaired by applying their diff (stats.repairs). So at quiescence every
//     editor shows exactly the authority's document, even if a prediction was
//     imperfect. The OT therefore only affects intention preservation and
//     flicker while edits are in flight, never final convergence.
//
// Limits: see README.md (offline edits, no end-to-end undo transform, leader
// election is best effort for the serverless transports).

import { applyOp, fromDoc, newId, normalizeDoc } from "@jul-editor/core";
import type { Editor, EditorState, Op, Store } from "@jul-editor/core";
import { createAuthority } from "./authority.js";
import type { Authority } from "./authority.js";
import { mapPoint, mapSelectionOver, transformLists } from "./transform.js";
import type { CollabMessage, CollabPeer, CollabPresenceStatus, CollabSelection, CollabStatus, CollabTransport, CollabUser, WireOp } from "./types.js";
import { applyWireOps, diffStores, resolveWireOp, sameStore } from "./wire.js";

export interface CollaborationOptions {
  transport: CollabTransport;
  user: CollabUser;
  docId: string;
  /** Unique per tab/connection (default: a fresh id). The leader election picks the lowest id. */
  clientId?: string;
  /** How long a joining client waits for existing peers to answer `hello` (default 400ms). */
  joinTimeoutMs?: number;
  /** Presence heartbeat period (default 4000ms). */
  heartbeatMs?: number;
  /** A peer silent for this long is dropped (default 3.5 x heartbeat). */
  peerTimeoutMs?: number;
  /** No local activity for this long marks the user idle (default 30000ms). */
  idleMs?: number;
  /** Min gap between caret/selection broadcasts (default 50ms, 0 = immediate). */
  presenceThrottleMs?: number;
  now?: () => number;
}

export interface CollabClientStats {
  /** display store differed from the authority's at quiescence and was repaired */
  repairs: number;
  /** full snapshot resyncs after a gap/rejected batch */
  resyncs: number;
  sent: number;
  received: number;
}

export interface CollabClient {
  readonly clientId: string;
  getUser(): CollabUser;
  setUser(user: CollabUser): void;
  getStatus(): CollabStatus;
  getPeers(): CollabPeer[];
  /** Fires on every status or peer list change. */
  subscribe(listener: () => void): () => void;
  isLeader(): boolean;
  /** Last sequence number applied to the shadow store. */
  getVersion(): number;
  /** The authority-replayed document state (what the display converges to). */
  getConfirmedStore(): Store;
  /** True when no local edit is waiting for the authority. */
  isSettled(): boolean;
  stats: CollabClientStats;
  /** Sends presence now, bypassing the throttle. */
  flushPresence(): void;
  destroy(): void;
}

interface PeerRec extends CollabPeer {
  synced: boolean;
}

type Outbound = CollabMessage extends infer M ? (M extends CollabMessage ? Omit<M, "from"> : never) : never;
type AppliedMsg = Extract<CollabMessage, { t: "applied" }>;

export function createCollaboration(editor: Editor, options: CollaborationOptions): CollabClient {
  const { transport, docId } = options;
  const registry = editor.getRegistry();
  const clientId = options.clientId ?? newId();
  const serverMode = transport.authority === "server";
  const joinTimeoutMs = options.joinTimeoutMs ?? 400;
  const heartbeatMs = options.heartbeatMs ?? 4000;
  const peerTimeoutMs = options.peerTimeoutMs ?? Math.round(heartbeatMs * 3.5);
  const idleMs = options.idleMs ?? 30000;
  const throttleMs = options.presenceThrottleMs ?? 50;
  const now = options.now ?? (() => Date.now());

  let user = options.user;
  let status: CollabStatus = "connecting";
  let destroyed = false;
  let leaderId: string | null = null;
  let authority: Authority | null = null;

  // shadow store = the authority's document as this client has replayed it
  let confirmed: Store = editor.getState().store;
  let version = 0;
  // my unacknowledged edits: one batch in flight, the rest buffered (Jupiter style)
  let inflight: { batch: number; ops: WireOp[] } | null = null;
  let buffer: WireOp[] = [];
  let nextBatch = 1;
  // display store as of the last diff, so a local commit is diffed against it
  let lastStore: Store = editor.getState().store;
  let dirty = false;

  const stats: CollabClientStats = { repairs: 0, resyncs: 0, sent: 0, received: 0 };
  const peers = new Map<string, PeerRec>();
  let peersView: CollabPeer[] = [];
  const listeners = new Set<() => void>();

  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let leaderTimer: ReturnType<typeof setTimeout> | null = null;
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let welcomeLeader: string | null = null;
  let localStatus: CollabPresenceStatus = "active";
  let lastActive = now();
  let lastBeat = 0;
  let lastPresenceJson = "";

  // ---- plumbing ---------------------------------------------------------------

  const notify = () => listeners.forEach((l) => l());

  function setStatus(next: CollabStatus): void {
    if (status === next) return;
    status = next;
    notify();
  }

  function rebuildPeers(): void {
    peersView = [...peers.values()]
      .sort((a, b) => (a.clientId < b.clientId ? -1 : 1))
      .map(({ synced: _synced, ...p }) => p);
    notify();
  }

  function send(message: Outbound): void {
    if (destroyed) return;
    stats.sent += 1;
    transport.send({ from: clientId, ...message } as CollabMessage);
  }

  const alive = (id: string): boolean => editor.getState().store.records.has(id);

  /** Applies wire ops to the editor as a remote (non-undoable) commit, mapping the local caret. */
  function applyToDisplay(ops: WireOp[]): void {
    if (ops.length === 0) return;
    let st = editor.getState().store;
    const core: Op[] = [];
    for (const w of ops) {
      const op = resolveWireOp(st, w);
      if (!op) continue;
      st = applyOp(st, op, registry).store;
      core.push(op);
    }
    if (core.length === 0) return;
    editor.applyRemote(core, { mapSelection: (sel) => mapSelectionOver(sel, ops, (id) => st.records.has(id)) });
    lastStore = editor.getState().store;
  }

  function mapPeerSelections(ops: WireOp[]): void {
    if (ops.length === 0 || peers.size === 0) return;
    let changed = false;
    for (const peer of peers.values()) {
      const sel = peer.selection;
      if (!sel) continue;
      const anchor = mapPoint(sel.anchor, ops, alive);
      const focus = mapPoint(sel.focus, ops, alive);
      const next = anchor && focus ? { anchor, focus } : null;
      if (JSON.stringify(next) !== JSON.stringify(sel)) {
        peer.selection = next;
        changed = true;
      }
    }
    if (changed) rebuildPeers();
  }

  // ---- presence ----------------------------------------------------------------

  function currentSelection(): CollabSelection | null {
    const sel = editor.getState().selection;
    return sel && sel.type === "text" ? { anchor: sel.anchor, focus: sel.focus } : null;
  }

  function sendPresence(force = false): void {
    if (status !== "connected") return;
    const msg = { t: "presence" as const, user, selection: currentSelection(), status: localStatus, synced: true };
    const json = JSON.stringify(msg);
    if (!force && json === lastPresenceJson) return;
    lastPresenceJson = json;
    send(msg);
  }

  function schedulePresence(): void {
    if (throttleMs <= 0) return sendPresence();
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      sendPresence();
    }, throttleMs);
  }

  function markActive(): void {
    lastActive = now();
    if (localStatus === "idle") {
      localStatus = "active";
      sendPresence();
    }
  }

  function tick(): void {
    const t = now();
    if (localStatus === "active" && t - lastActive > idleMs) {
      localStatus = "idle";
      sendPresence();
    }
    if (t - lastBeat >= heartbeatMs) {
      lastBeat = t;
      sendPresence(true);
    }
    let removedLeader = false;
    for (const [id, p] of peers) {
      if (t - p.lastSeen > peerTimeoutMs) {
        peers.delete(id);
        if (id === leaderId) removedLeader = true;
        rebuildPeers();
      }
    }
    if (removedLeader && !serverMode) electLeader();
  }

  // ---- sequencing ----------------------------------------------------------------

  function submitLocal(ops: WireOp[]): void {
    if (authority) {
      const applied = authority.submit(clientId, authority.getVersion(), nextBatch++, ops);
      if (!applied) return;
      version = applied.seq;
      confirmed = authority.getStore();
      stats.sent += 1;
      transport.send(applied);
      mapPeerSelections(applied.ops); // my edit moves everyone else's carets too
      return;
    }
    buffer.push(...ops);
    pump();
  }

  function sendInflight(): void {
    if (!inflight) return;
    send({ t: "ops", base: version, batch: inflight.batch, ops: inflight.ops, ...(serverMode || !leaderId ? {} : { to: leaderId }) });
  }

  function pump(): void {
    if (inflight || buffer.length === 0 || status !== "connected" || (!serverMode && !leaderId)) return;
    inflight = { batch: nextBatch++, ops: buffer };
    buffer = [];
    sendInflight();
  }

  /** At quiescence the display must equal the replayed authority state; repair if a prediction was off. */
  function verify(): void {
    if (!dirty || inflight || buffer.length > 0) return;
    dirty = false;
    const display = editor.getState().store;
    if (sameStore(display, confirmed)) return;
    const ops = diffStores(display, confirmed);
    if (ops.length === 0) return;
    stats.repairs += 1;
    applyToDisplay(ops);
  }

  function handleApplied(msg: AppliedMsg): void {
    if (msg.seq <= version) return; // duplicate
    if (msg.seq !== version + 1) return requestResync(); // gap: we missed a batch
    editor.applyRemote([]); // flush a pending IME composition (its commit is diffed first)
    stats.received += 1;
    if (authority) {
      // leader: the authority already applied it (inside handleOps); only the display is behind
      version = authority.getVersion();
      confirmed = authority.getStore();
      applyToDisplay(msg.ops);
    } else {
      confirmed = applyWireOps(confirmed, msg.ops, registry).store;
      version = msg.seq;
      if (msg.origin === clientId && inflight && inflight.batch === msg.batch) {
        inflight = null; // ack; the server's rebased form is what `confirmed` just replayed
      } else {
        let remote = msg.ops;
        if (inflight) [inflight.ops, remote] = transformLists(inflight.ops, remote, false);
        if (buffer.length) [buffer, remote] = transformLists(buffer, remote, false);
        applyToDisplay(remote);
      }
    }
    dirty = true;
    mapPeerSelections(msg.ops);
    pump();
    verify();
  }

  function requestResync(): void {
    stats.resyncs += 1;
    inflight = null;
    buffer = [];
    setStatus("syncing");
    send({ t: "sync-request", ...(serverMode || !leaderId ? {} : { to: leaderId }) });
  }

  function handleSnapshot(msg: Extract<CollabMessage, { t: "snapshot" }>): void {
    const next = fromDoc(normalizeDoc(msg.doc, registry), registry);
    confirmed = next;
    version = msg.version;
    inflight = null;
    buffer = [];
    applyToDisplay(diffStores(editor.getState().store, next));
    lastStore = editor.getState().store;
    dirty = true;
    verify();
    if (joinTimer) clearTimeout(joinTimer);
    if (leaderTimer) clearTimeout(leaderTimer);
    setStatus("connected");
    sendPresence(true);
    pump();
  }

  // ---- roles ------------------------------------------------------------------------

  function becomeLeader(initial: boolean): void {
    if (leaderTimer) clearTimeout(leaderTimer);
    if (initial) {
      confirmed = editor.getState().store; // the room's document is whatever the first member opened
      lastStore = confirmed;
      version = 0;
    }
    authority = createAuthority({ registry, store: confirmed, version, id: clientId });
    leaderId = clientId;
    send({ t: "leader", version });
    setStatus("connected");
    const pending = inflight ? [...inflight.ops, ...buffer] : buffer;
    inflight = null;
    buffer = [];
    if (pending.length) submitLocal(pending);
    sendPresence(true);
  }

  function electLeader(): void {
    // lowest clientId among the members that are synced (so a half-joined tab never wins)
    const candidates = [clientId, ...[...peers.values()].filter((p) => p.synced).map((p) => p.clientId)].sort();
    const winner = candidates[0]!;
    if (winner === clientId) return becomeLeader(false);
    leaderId = winner;
    if (leaderTimer) clearTimeout(leaderTimer);
    leaderTimer = setTimeout(() => {
      if (leaderId === winner && !destroyed && !authority) becomeLeader(false);
    }, joinTimeoutMs);
  }

  function decideRole(): void {
    joinTimer = null;
    if (destroyed || status !== "connecting" || serverMode) return;
    if (welcomeLeader) {
      leaderId = welcomeLeader;
      setStatus("syncing");
      send({ t: "sync-request", to: leaderId });
      return;
    }
    // nobody has a leader yet: every known peer is a fellow joiner, lowest id leads
    const winner = [clientId, ...peers.keys()].sort()[0]!;
    if (winner === clientId) return becomeLeader(true);
    leaderId = winner;
    leaderTimer = setTimeout(() => {
      if (!destroyed && !authority && status === "connecting") becomeLeader(true);
    }, joinTimeoutMs);
  }

  function join(): void {
    welcomeLeader = null;
    authority = null;
    leaderId = null;
    inflight = null;
    buffer = [];
    setStatus("connecting");
    send({ t: "hello", user });
    if (serverMode) {
      setStatus("syncing");
      send({ t: "sync-request" });
    } else {
      joinTimer = setTimeout(decideRole, joinTimeoutMs);
    }
  }

  // ---- inbound -------------------------------------------------------------------------

  function touchPeer(from: string, patch: Partial<PeerRec> & { user?: CollabUser }): PeerRec {
    let p = peers.get(from);
    if (!p) {
      p = { clientId: from, user: patch.user ?? { id: from, name: "Anonymous", color: "#888" }, selection: null, status: "active", lastSeen: now(), synced: false };
      peers.set(from, p);
    }
    Object.assign(p, patch, { lastSeen: now() });
    return p;
  }

  function onMessage(msg: CollabMessage): void {
    if (destroyed || msg.from === clientId) return;
    if (msg.to && msg.to !== clientId) return;
    switch (msg.t) {
      case "hello":
        touchPeer(msg.from, { user: msg.user });
        rebuildPeers();
        send({ t: "welcome", to: msg.from, user, leader: leaderId && status === "connected" ? leaderId : null });
        break;
      case "welcome":
        touchPeer(msg.from, { user: msg.user, synced: !!msg.leader });
        rebuildPeers();
        if (msg.leader && status === "connecting") {
          welcomeLeader = msg.leader;
          if (joinTimer) clearTimeout(joinTimer);
          decideRole();
        }
        break;
      case "leader":
        if (authority && msg.from > clientId) break; // we already lead and outrank the claimant
        authority = null;
        leaderId = msg.from;
        touchPeer(msg.from, { synced: true });
        if (leaderTimer) clearTimeout(leaderTimer);
        if (status !== "connected") {
          setStatus("syncing");
          send({ t: "sync-request", to: msg.from });
        } else if (msg.version > version) requestResync();
        else sendInflight(); // resend what the previous leader may never have sequenced
        break;
      case "sync-request":
        if (authority) {
          const { version: v, doc } = authority.snapshot();
          send({ t: "snapshot", to: msg.from, version: v, doc });
        }
        break;
      case "snapshot":
        handleSnapshot(msg);
        break;
      case "ops":
        if (!authority) break;
        for (const out of authority.handle(msg)) {
          if (out.t === "applied") {
            stats.sent += 1;
            transport.send(out);
            handleApplied(out);
          } else transport.send(out);
        }
        break;
      case "applied":
        if (status === "connected") handleApplied(msg);
        break;
      case "presence": {
        touchPeer(msg.from, { user: msg.user, selection: msg.selection, status: msg.status, synced: msg.synced });
        rebuildPeers();
        break;
      }
      case "leave":
        if (peers.delete(msg.from)) rebuildPeers();
        if (msg.from === leaderId && !serverMode && !authority) electLeader();
        break;
    }
  }

  // ---- local changes ----------------------------------------------------------------------

  function onEditorChange(state: EditorState, meta?: { remote: boolean }): void {
    if (destroyed) return;
    if (meta?.remote) {
      lastStore = state.store;
      return;
    }
    markActive();
    if (state.store !== lastStore) {
      const ops = diffStores(lastStore, state.store);
      lastStore = state.store;
      if (ops.length > 0 && status === "connected") submitLocal(ops);
    }
    schedulePresence();
  }

  const offChange = editor.on("change", onEditorChange);
  const offMessages = transport.onMessage(onMessage);
  const offStatus = transport.onStatus?.((s) => {
    if (destroyed) return;
    if (s === "disconnected") {
      setStatus("disconnected");
      authority = null;
    } else if (status === "disconnected") {
      join(); // a fresh join: offline edits are replaced by the room's state (README: limits)
    }
  });

  tickTimer = setInterval(tick, Math.max(10, Math.min(heartbeatMs, Math.floor(idleMs / 2))));

  Promise.resolve(transport.connect(docId, clientId)).then(
    () => {
      if (!destroyed) join();
    },
    () => setStatus("disconnected"),
  );

  return {
    clientId,
    getUser: () => user,
    setUser(next) {
      user = next;
      sendPresence(true);
    },
    getStatus: () => status,
    getPeers: () => peersView,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isLeader: () => authority !== null,
    getVersion: () => version,
    getConfirmedStore: () => confirmed,
    isSettled: () => !inflight && buffer.length === 0,
    stats,
    flushPresence: () => sendPresence(true),
    destroy() {
      if (destroyed) return;
      if (status === "connected" || status === "syncing") send({ t: "leave" });
      destroyed = true;
      offChange();
      offMessages();
      offStatus?.();
      for (const t of [joinTimer, leaderTimer, presenceTimer]) if (t) clearTimeout(t);
      if (tickTimer) clearInterval(tickTimer);
      peers.clear();
      peersView = [];
      status = "disconnected";
      transport.disconnect();
      notify();
    },
  };
}
