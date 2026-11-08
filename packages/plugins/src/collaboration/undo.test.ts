// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { docJson, room, text, type } from "./test-utils.js";
import type { Peer } from "./test-utils.js";

const live: Peer[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.client.destroy();
  document.body.innerHTML = "";
});

describe("remote ops and local undo history", () => {
  it("a purely remote edit is not undoable locally", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    type(b.editor, "b", 5, "!!");
    await hub.idle();
    expect(text(a.editor, "b")).toBe("world!!");
    a.editor.commands.undo(); // a never edited anything: nothing to undo
    await hub.idle();
    expect(text(a.editor, "b")).toBe("world!!");
    expect(text(b.editor, "b")).toBe("world!!");
  });

  it("undo reverts only my edit, keeping a remote edit made in between (other block)", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    type(a.editor, "a", 5, "?");
    type(b.editor, "b", 5, "!");
    await hub.idle();
    expect(text(a.editor, "a")).toBe("hello?");
    expect(text(a.editor, "b")).toBe("world!");
    a.editor.commands.undo();
    expect(text(a.editor, "a")).toBe("hello");
    expect(text(a.editor, "b")).toBe("world!"); // the collaborator's text survived my undo
    await hub.idle();
    // the undo itself is a normal local edit and replicates
    expect(text(b.editor, "a")).toBe("hello");
    expect(text(b.editor, "b")).toBe("world!");
    expect(docJson(a.editor)).toBe(docJson(b.editor));
  });

  it("undo then redo round-trips and replicates, remote text in the same block survives", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    type(a.editor, "a", 0, ">>");
    await hub.idle();
    type(b.editor, "a", text(b.editor, "a").length, "<<"); // remote edit to the same block
    await hub.idle();
    expect(text(a.editor, "a")).toBe(">>hello<<");
    a.editor.commands.undo();
    expect(text(a.editor, "a")).toBe("hello<<");
    await hub.idle();
    expect(docJson(b.editor)).toBe(docJson(a.editor));
    a.editor.commands.redo();
    await hub.idle();
    expect(text(a.editor, "a")).toBe(">>hello<<");
    expect(docJson(b.editor)).toBe(docJson(a.editor));
  });

  it("a burst of remote edits never creates an undo entry", async () => {
    const { hub, peers } = await room(["a", "b"]);
    live.push(...peers);
    const [a, b] = peers as [Peer, Peer];
    for (let i = 0; i < 5; i++) type(b.editor, "b", 5 + i, "r");
    await hub.idle();
    expect(text(a.editor, "b")).toBe("worldrrrrr");
    a.editor.commands.undo();
    expect(text(a.editor, "b")).toBe("worldrrrrr");
  });
});
