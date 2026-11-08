// @vitest-environment jsdom
import { toDoc } from "@jul-editor/core";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHub } from "./memory-transport.js";
import { connect, docJson, docOf, makeEditor, para, room, text, type, until } from "./test-utils.js";
import type { Peer } from "./test-utils.js";

const live: Peer[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.client.destroy();
  document.body.innerHTML = "";
});
const track = (peers: Peer[]) => (live.push(...peers), peers);

describe("join / initial sync", () => {
  it("first client leads, a late joiner receives the snapshot instead of its own default doc", async () => {
    const { hub, peers } = await room(["a"]);
    track(peers);
    type(peers[0]!.editor, "a", 5, "!");
    await hub.idle();
    // the late joiner opens with a DIFFERENT local document
    const late = connect(hub, makeEditor(docOf(para("zzz", "local default"))), "b");
    track([late]);
    expect(late.client.getStatus()).not.toBe("connected");
    await until(() => late.client.getStatus() === "connected", hub);
    expect(peers[0]!.client.isLeader()).toBe(true);
    expect(late.client.isLeader()).toBe(false);
    expect(late.client.getStatus()).toBe("connected");
    expect(docJson(late.editor)).toBe(docJson(peers[0]!.editor));
    expect(text(late.editor, "a")).toBe("hello!");
    expect(late.editor.getState().store.records.has("zzz")).toBe(false);
  });

  it("two clients opening at the same instant elect the lowest id and converge", async () => {
    const hub = createMemoryHub();
    const x = connect(hub, makeEditor(), "x");
    const y = connect(hub, makeEditor(), "y");
    track([x, y]);
    await until(() => x.client.getStatus() === "connected" && y.client.getStatus() === "connected", hub);
    expect(x.client.isLeader()).toBe(true);
    expect(y.client.isLeader()).toBe(false);
    expect(x.client.getStatus()).toBe("connected");
    expect(y.client.getStatus()).toBe("connected");
    expect(docJson(x.editor)).toBe(docJson(y.editor));
  });
});

describe("concurrent edits converge", () => {
  it("typing in the SAME block at the same offset on both sides", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    type(a.editor, "a", 5, " AAA"); // concurrent: neither has seen the other
    type(b.editor, "a", 5, " BBB");
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    const t = text(a.editor, "a");
    expect(t).toContain("AAA");
    expect(t).toContain("BBB");
    expect(t.length).toBe("hello".length + 8);
    expect(a.client.isSettled() && b.client.isSettled()).toBe(true);
    // the OT predicted the authority's result: no repair was needed
    expect(a.client.stats.repairs + b.client.stats.repairs).toBe(0);
  });

  it("many interleaved keystrokes in the same block from three clients", async () => {
    const { hub, peers } = await room(["a", "b", "c"]);
    track(peers);
    const [a, b, c] = peers as [Peer, Peer, Peer];
    for (let i = 0; i < 8; i++) {
      type(a.editor, "a", 0, "A");
      type(b.editor, "a", text(b.editor, "a").length, "B");
      type(c.editor, "a", 2, "C");
      if (i % 3 === 0) await hub.idle();
    }
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(docJson(b.editor)).toBe(docJson(c.editor));
    expect(text(a.editor, "a").length).toBe("hello".length + 24);
    expect((text(a.editor, "a").match(/A/g) ?? []).length).toBe(8);
  });

  it("typing in DIFFERENT blocks", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    type(a.editor, "a", 5, "1");
    type(b.editor, "b", 5, "2");
    await hub.idle();
    expect(text(a.editor, "a")).toBe("hello1");
    expect(text(a.editor, "b")).toBe("world2");
    expect(docJson(a.editor)).toBe(docJson(b.editor));
  });

  it("concurrent delete over an insert keeps the inserted text", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.replaceContent("a", 1, 4, [])); // "hello" -> "ho"
    type(b.editor, "a", 2, "XY"); // inside the deleted range
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(text(a.editor, "a")).toBe("hXYo");
    expect(a.client.stats.repairs + b.client.stats.repairs).toBe(0);
  });

  it("block insert and block delete from different clients", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.insertBlock(null, 1, para("new", "inserted")));
    b.editor.update((tx) => tx.removeBlock("b"));
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(a.editor.getState().store.rootIds.includes("new")).toBe(true);
    expect(a.editor.getState().store.records.has("b")).toBe(false);
  });

  it("both sides insert after the same block: same final order everywhere", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.insertBlock(null, 1, para("n1", "from a")));
    b.editor.update((tx) => tx.insertBlock(null, 1, para("n2", "from b")));
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(a.editor.getState().store.rootIds).toHaveLength(4);
  });

  it("typing into a block another client deletes does not crash and converges", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.removeBlock("a"));
    type(b.editor, "a", 5, "lost");
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(a.editor.getState().store.records.has("a")).toBe(false);
  });

  it("move + type + props change converge", async () => {
    const { hub, peers } = await room(["a", "b"]);
    track(peers);
    const [a, b] = peers as [Peer, Peer];
    a.editor.update((tx) => tx.moveBlock("b", null, 0));
    b.editor.update((tx) => tx.setBlockType(["a"], "heading", { level: 2 }));
    await hub.idle();
    expect(docJson(a.editor)).toBe(docJson(b.editor));
    expect(a.editor.getState().store.rootIds).toEqual(["b", "a"]);
    expect(a.editor.getState().store.records.get("a")?.type).toBe("heading");
  });

  it("randomized soak: three clients, mixed edits, always converge", async () => {
    const { hub, peers } = await room(["a", "b", "c"]);
    track(peers);
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    let nid = 0;
    for (let step = 0; step < 120; step++) {
      const p = peers[rnd(3)]!;
      const st = p.editor.getState().store;
      const ids = st.rootIds;
      const pick = ids[rnd(ids.length)]!;
      const r = rnd(10);
      if (r < 6) {
        const len = (st.records.get(pick)?.content ?? []).reduce((n, i) => n + (i.type === "text" ? (i as { text: string }).text.length : 1), 0);
        type(p.editor, pick, rnd(len + 1), String.fromCharCode(97 + rnd(26)));
      } else if (r < 7) p.editor.update((tx) => tx.insertBlock(null, rnd(ids.length + 1), para(`n${p.client.clientId}${nid++}`, "x")));
      else if (r < 8 && ids.length > 2) p.editor.update((tx) => tx.removeBlock(pick));
      else if (r < 9 && ids.length > 1) p.editor.update((tx) => tx.moveBlock(pick, null, rnd(ids.length)));
      else if ((st.records.get(pick)?.content ?? []).length) p.editor.update((tx) => tx.replaceContent(pick, 0, 1, []));
      if (step % 7 === 0) await hub.idle();
    }
    await hub.idle();
    const j = docJson(peers[0]!.editor);
    expect(docJson(peers[1]!.editor)).toBe(j);
    expect(docJson(peers[2]!.editor)).toBe(j);
    // the replayed authority state is exactly what every editor shows
    for (const p of peers) expect(JSON.stringify(toDoc(p.client.getConfirmedStore()))).toBe(j);
  });
});
