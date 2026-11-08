// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { connect, docJson, makeEditor, room, text, type, until } from "./test-utils.js";
import type { Peer } from "./test-utils.js";
import { createMemoryHub } from "./memory-transport.js";

const live: Peer[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.client.destroy();
  document.body.innerHTML = "";
});

const caret = (blockId: string, offset: number) => ({ type: "text" as const, anchor: { blockId, offset }, focus: { blockId, offset } });

describe("presence", () => {
  it("peers appear on join with their user, and disappear on leave", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    await until(() => a.client.getPeers().length === 1 && b.client.getPeers().length === 1, hub);
    expect(a.client.getPeers()[0]!.user).toEqual({ id: "b", name: "b", color: "#3b82f6" });
    expect(b.client.getPeers()[0]!.clientId).toBe("a");
    const seen: number[] = [];
    a.client.subscribe(() => seen.push(a.client.getPeers().length));
    b.client.destroy();
    await hub.idle();
    expect(a.client.getPeers()).toHaveLength(0);
    expect(seen).toContain(0);
  });

  it("shares the caret/selection and keeps it attached to the text as the doc changes", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    b.editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "a", offset: 3 }, focus: { blockId: "a", offset: 5 } }));
    await hub.idle();
    expect(a.client.getPeers()[0]!.selection).toEqual({ anchor: { blockId: "a", offset: 3 }, focus: { blockId: "a", offset: 5 } });
    type(a.editor, "a", 0, ">>"); // a types before b's selection: it shifts right
    await hub.idle();
    expect(a.client.getPeers()[0]!.selection).toEqual({ anchor: { blockId: "a", offset: 5 }, focus: { blockId: "a", offset: 7 } });
    a.editor.update((tx) => tx.removeBlock("a")); // block gone: selection cleared
    await hub.idle();
    expect(a.client.getPeers()[0]!.selection).toBeNull();
  });

  it("local caret is mapped over a collaborator's insert before it", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.setSelection(caret("a", 4)));
    type(b.editor, "a", 0, "123");
    await hub.idle();
    const sel = a.editor.getState().selection;
    expect(sel?.type === "text" && sel.focus.offset).toBe(7);
  });

  it("marks a user idle after inactivity and active again on the next action", async () => {
    const hub = createMemoryHub();
    const a = connect(hub, makeEditor(), "a", { idleMs: 40 });
    const b = connect(hub, makeEditor(), "b", { idleMs: 40 });
    live.push(a, b);
    await until(() => a.client.getStatus() === "connected" && b.client.getStatus() === "connected", hub);
    await until(() => a.client.getPeers()[0]?.status === "idle", hub);
    type(b.editor, "b", 5, "!");
    await until(() => a.client.getPeers()[0]?.status === "active", hub);
  });

  it("drops a peer that stops sending heartbeats (crashed tab) without a leave message", async () => {
    const hub = createMemoryHub();
    const a = connect(hub, makeEditor(), "a", { heartbeatMs: 20, peerTimeoutMs: 120 });
    const bTransport = hub.createTransport();
    const send = bTransport.send.bind(bTransport);
    let muted = false;
    bTransport.send = (m) => void (muted || send(m));
    const b = connect(hub, makeEditor(), "b", { transport: bTransport, heartbeatMs: 20, peerTimeoutMs: 120 });
    live.push(a, b);
    await until(() => a.client.getPeers().length === 1, hub);
    muted = true; // b "crashes": nothing it sends (not even leave) reaches a any more
    await until(() => a.client.getPeers().length === 0, hub);
  });

  it("setUser rebroadcasts the new name/color", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    b.client.setUser({ id: "b", name: "Bea", color: "#ef4444" });
    await until(() => a.client.getPeers()[0]?.user.name === "Bea", hub);
    expect(a.client.getPeers()[0]!.user.color).toBe("#ef4444");
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(text(a.editor, "a")).toBe("hello");
  });
});
