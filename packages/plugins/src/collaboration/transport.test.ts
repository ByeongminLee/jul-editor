// @vitest-environment jsdom
import { coreRegistry } from "@jul-editor/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHub } from "./memory-transport.js";
import type { MemoryTransport } from "./memory-transport.js";
import { connect, docJson, docOf, makeEditor, para, room, text, type, until } from "./test-utils.js";
import type { Peer } from "./test-utils.js";

const live: Peer[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.client.destroy();
  document.body.innerHTML = "";
});

describe("leader hand-off (serverless transports)", () => {
  it("another tab takes over sequencing when the leader leaves, including in-flight edits", async () => {
    const { hub, peers } = await room(["a", "b", "c"]);
    live.push(...peers);
    const [a, b, c] = peers as [Peer, Peer, Peer];
    expect(a.client.isLeader()).toBe(true);
    type(c.editor, "b", 5, "1");
    a.client.destroy(); // leader closes the tab right after c typed
    await until(() => b.client.isLeader(), hub);
    expect(c.client.isLeader()).toBe(false);
    type(c.editor, "b", 6, "2");
    type(b.editor, "a", 5, "!");
    await until(() => b.client.isSettled() && c.client.isSettled(), hub);
    await hub.idle();
    expect(docJson(b.editor)).toBe(docJson(c.editor));
    expect(text(b.editor, "a")).toBe("hello!");
    expect(text(c.editor, "b")).toMatch(/^world[12]{1,2}$/);
  });
});

describe("hosted authority (transport.authority = server)", () => {
  it("syncs through a server-style room: concurrent edits, late joiner, version counter", async () => {
    const { hub, peers } = await room(["a", "b"], { authority: { registry: coreRegistry, doc: docOf(para("a", "hello"), para("b", "world")) } });
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    expect(a.client.isLeader() || b.client.isLeader()).toBe(false); // nobody is elected: the server sequences
    type(a.editor, "a", 5, " A");
    type(b.editor, "a", 5, " B");
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(text(a.editor, "a")).toHaveLength("hello".length + 4);
    expect(hub.authority!.getVersion()).toBe(2);
    const late = connect(hub, makeEditor(docOf(para("x", "stale"))), "c");
    live.push(late);
    await until(() => late.client.getStatus() === "connected", hub);
    expect(docJson(late.editor)).toBe(docJson(a.editor));
  });

  it("a disconnected client re-syncs from the server on reconnect", async () => {
    const hub = createMemoryHub({ authority: { registry: coreRegistry, doc: docOf(para("a", "hello")) } });
    const a = connect(hub, makeEditor(), "a");
    const tb = hub.createTransport() as MemoryTransport;
    const b = connect(hub, makeEditor(), "b", { transport: tb });
    live.push(a, b);
    await until(() => a.client.getStatus() === "connected" && b.client.getStatus() === "connected", hub);
    tb.simulateDisconnect();
    expect(b.client.getStatus()).toBe("disconnected");
    type(a.editor, "a", 5, "+");
    await hub.idle();
    expect(text(b.editor, "a")).toBe("hello");
    tb.simulateReconnect();
    await until(() => b.client.getStatus() === "connected", hub);
    expect(text(b.editor, "a")).toBe("hello+");
    expect(docJson(a.editor)).toBe(docJson(b.editor));
  });

  it("a stale or future base version is answered with a snapshot (resync), not applied blindly", async () => {
    const hub = createMemoryHub({ authority: { registry: coreRegistry, doc: docOf(para("a", "hello")) } });
    const out = hub.authority!.handle({ t: "ops", from: "z", base: 99, batch: 1, ops: [] });
    expect(out).toHaveLength(1);
    expect(out[0]!.t).toBe("snapshot");
  });
});

describe("status", () => {
  it("goes connecting -> connected and back to disconnected on destroy", async () => {
    const hub = createMemoryHub();
    const a = connect(hub, makeEditor(), "a");
    const seen: string[] = [a.client.getStatus()];
    a.client.subscribe(() => seen.push(a.client.getStatus()));
    await until(() => a.client.getStatus() === "connected", hub);
    a.client.destroy();
    expect(seen).toEqual(["connecting", "connected", "disconnected"]);
  });
});
