import { describe, expect, it } from "vitest";
import { createBroadcastChannelTransport } from "./broadcast-channel-transport.js";
import { createWebSocketTransport } from "./websocket-transport.js";
import type { WebSocketLike } from "./websocket-transport.js";
import type { CollabMessage } from "./types.js";

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

describe("createWebSocketTransport (fake socket; not verified against a real server)", () => {
  it("builds the room url, queues sends until open, parses frames, ignores junk", async () => {
    FakeSocket.all = [];
    const t = createWebSocketTransport({ url: "wss://example.test/collab", WebSocketImpl: FakeSocket as never });
    const got: CollabMessage[] = [];
    t.onMessage((m) => got.push(m));
    const connecting = t.connect("doc 1", "c1");
    const sock = FakeSocket.all[0]!;
    expect(sock.url).toBe("wss://example.test/collab?doc=doc%201&client=c1");
    t.send({ t: "leave", from: "c1" }); // before open: queued
    expect(sock.sent).toEqual([]);
    sock.open();
    await connecting;
    expect(sock.sent).toEqual([JSON.stringify({ t: "leave", from: "c1" })]);
    sock.onmessage?.({ data: JSON.stringify({ t: "leader", from: "s", version: 3 }) });
    sock.onmessage?.({ data: "not json" });
    expect(got).toEqual([{ t: "leader", from: "s", version: 3 }]);
    expect(t.authority).toBe("server");
  });

  it("reports disconnect, reconnects with backoff and announces the recovery", async () => {
    FakeSocket.all = [];
    const t = createWebSocketTransport({ url: "wss://x.test", WebSocketImpl: FakeSocket as never, reconnectDelayMs: 5 });
    const statuses: string[] = [];
    t.onStatus!((s) => statuses.push(s));
    const p = t.connect("d", "c");
    FakeSocket.all[0]!.open();
    await p;
    FakeSocket.all[0]!.onclose?.({});
    expect(statuses).toEqual(["disconnected"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    expect(statuses).toEqual(["disconnected", "connected"]);
    t.disconnect();
    FakeSocket.all[1]!.onclose?.({});
    expect(FakeSocket.all).toHaveLength(2); // closed by us: no reconnect
  });
});

describe("createBroadcastChannelTransport", () => {
  it.skipIf(typeof BroadcastChannel === "undefined")("delivers to the other channel instance only, per document", async () => {
    const a = createBroadcastChannelTransport();
    const b = createBroadcastChannelTransport();
    const other = createBroadcastChannelTransport();
    const gotA: CollabMessage[] = [];
    const gotB: CollabMessage[] = [];
    const gotOther: CollabMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    other.onMessage((m) => gotOther.push(m));
    await a.connect("doc-1", "a");
    await b.connect("doc-1", "b");
    await other.connect("doc-2", "o");
    a.send({ t: "leave", from: "a" });
    await new Promise((r) => setTimeout(r, 30));
    expect(gotB).toEqual([{ t: "leave", from: "a" }]);
    expect(gotA).toEqual([]);
    expect(gotOther).toEqual([]);
    a.disconnect();
    b.disconnect();
    other.disconnect();
  });
});
