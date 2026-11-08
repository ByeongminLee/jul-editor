// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollabAvatars, initialsOf } from "./collab-avatars.js";
import { attachRemoteCursors } from "./remote-cursors.js";
import { createMemoryHub } from "./memory-transport.js";
import { connect, makeEditor, room, type as typeText, until } from "./test-utils.js";
import type { Peer } from "./test-utils.js";
import type { CollabPeer } from "./types.js";
import { useCollaboration } from "./use-collaboration.js";

const live: Peer[] = [];
afterEach(() => {
  cleanup();
  for (const p of live.splice(0)) p.client.destroy();
  document.body.innerHTML = "";
});

const peer = (id: string, name: string, status: "active" | "idle" = "active", avatarUrl?: string): CollabPeer => ({
  clientId: id,
  user: { id, name, color: "#ef4444", avatarUrl },
  selection: null,
  status,
  lastSeen: 0,
});

describe("<CollabAvatars>", () => {
  it("renders initials / photo, dims idle users, collapses overflow into +N", () => {
    const peers = [peer("1", "Ada Lovelace"), peer("2", "Bo", "idle"), peer("3", "Cy", "active", "https://example.test/c.png"), peer("4", "Di"), peer("5", "Ed"), peer("6", "Flo")];
    const { container } = render(<CollabAvatars peers={peers} max={4} />);
    const avatars = container.querySelectorAll("[data-jul-collab-avatar]");
    expect(avatars).toHaveLength(4);
    expect(avatars[0]!.textContent).toBe("AL");
    expect(avatars[1]!.getAttribute("data-status")).toBe("idle");
    expect((avatars[1] as HTMLElement).style.opacity).toBe("0.5");
    expect(avatars[2]!.querySelector("img")?.getAttribute("src")).toBe("https://example.test/c.png");
    const overflow = container.querySelector("[data-jul-collab-overflow]")!;
    expect(overflow.textContent).toBe("+2");
    expect(overflow.getAttribute("title")).toBe("Ed, Flo");
    expect(container.querySelector("[role=list]")?.getAttribute("aria-label")).toBe("People in this document");
  });

  it("can show the local user first and makes avatars clickable on request", () => {
    let clicked = "";
    const { container } = render(<CollabAvatars peers={[peer("1", "Ada")]} self={{ id: "me", name: "Me", color: "#000" }} onAvatarClick={(p) => (clicked = p.clientId)} />);
    const all = container.querySelectorAll("[data-jul-collab-avatar]");
    expect(all[0]!.getAttribute("data-jul-collab-avatar")).toBe("me");
    expect(all[0]!.getAttribute("title")).toBe("Me (you)");
    (all[1] as HTMLElement).click();
    expect(clicked).toBe("1");
  });

  it("initialsOf handles empty, single and multi-word names", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("ada")).toBe("A");
    expect(initialsOf("Grace Brewster Hopper")).toBe("GH");
    expect(initialsOf("이병민")).toBe("이");
  });
});

describe("remote cursors overlay", () => {
  it("draws a labelled caret and a selection tint per remote peer, and cleans up", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    const handle = attachRemoteCursors(a.editor, a.client);
    b.editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "a", offset: 1 }, focus: { blockId: "b", offset: 3 } }));
    await until(() => a.client.getPeers()[0]?.selection !== null, hub);
    handle.render();
    const overlay = a.editor.getRoot().parentElement!.querySelector("[data-jul-collab-overlay]")!;
    const group = overlay.querySelector("[data-jul-collab-peer='b']")!;
    expect(group).toBeTruthy();
    expect(group.querySelector("[data-jul-collab-caret]")).toBeTruthy();
    expect(group.querySelector("[data-jul-collab-label]")?.textContent).toBe("b");
    expect((group.querySelector("[data-jul-collab-caret]") as HTMLElement).style.background).not.toBe("");
    b.editor.update((tx) => tx.setSelection(null));
    await until(() => a.client.getPeers()[0]?.selection === null, hub);
    handle.render();
    expect(overlay.querySelector("[data-jul-collab-peer]")).toBeNull();
    handle.destroy();
    expect(a.editor.getRoot().parentElement!.querySelector("[data-jul-collab-overlay]")).toBeNull();
  });

  it("renders the label as text, never as markup", async () => {
    const hub = createMemoryHub();
    const a = connect(hub, makeEditor(), "a");
    const b = connect(hub, makeEditor(), "b", { user: { id: "b", name: "<img src=x onerror=alert(1)>", color: "red" } });
    live.push(a, b);
    await until(() => a.client.getStatus() === "connected" && b.client.getStatus() === "connected", hub);
    b.editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 0 } }));
    await until(() => a.client.getPeers()[0]?.selection != null, hub);
    const handle = attachRemoteCursors(a.editor, a.client);
    const label = a.editor.getRoot().parentElement!.querySelector("[data-jul-collab-label]")!;
    expect(label.querySelector("img")).toBeNull();
    expect(label.textContent).toBe("<img src=x onerror=alert(1)>");
    handle.destroy();
  });
});

describe("useCollaboration", () => {
  it("returns {status, peers}: connects, lists the other user, reflects leaving", async () => {
    const hub = createMemoryHub();
    const other = connect(hub, makeEditor(), "other");
    live.push(other);
    const editor = makeEditor();
    const transport = hub.createTransport();
    const user = { id: "me", name: "Me", color: "#10b981" };
    const { result, unmount } = renderHook(() => useCollaboration(editor, { transport, user, docId: "doc", clientId: "me", joinTimeoutMs: 5, presenceThrottleMs: 0, heartbeatMs: 60_000 }));
    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(result.current.peers.map((p) => p.user.name)).toEqual(["other"]));
    await act(async () => {
      typeText(other.editor, "a", 5, "!");
      await hub.idle();
    });
    expect(editor.getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "hello!" }]);
    await act(async () => {
      other.client.destroy();
      await hub.idle();
    });
    await waitFor(() => expect(result.current.peers).toHaveLength(0));
    unmount();
    expect(editor.getRoot().parentElement!.querySelector("[data-jul-collab-overlay]")).toBeNull();
  });
});
