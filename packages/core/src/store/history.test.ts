import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { para, r, storeFrom } from "./test-helpers.js";
import { createHistory } from "./history.js";
import { createTransaction } from "./transaction.js";
import type { EditorState } from "./types.js";

function typeChar(state: EditorState, blockId: string, offset: number, ch: string) {
  return createTransaction(state, r).insertText({ blockId, offset }, ch).commit();
}

describe("history: typing merge within 500ms (mergeable, same block)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges consecutive mergeable pushes for the same block into one undo step", () => {
    const history = createHistory();
    let state: EditorState = { store: storeFrom([para("p1", "")]), selection: null };

    let pos = 0;
    for (const ch of ["h", "e", "l", "l", "o"]) {
      const before = state;
      const result = typeChar(state, "p1", pos, ch);
      history.push({ before, after: result.state, changedIds: result.changedIds }, { blockId: "p1", mergeable: true });
      state = result.state;
      pos += ch.length;
      vi.advanceTimersByTime(100); // well within the 500ms merge window
    }

    expect(state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "hello" }]);

    const undone = history.undo();
    expect(undone).not.toBeNull();
    // one merged undo step takes it all the way back to the empty paragraph
    expect(undone!.state.store.records.get("p1")!.content).toEqual([]);
    expect(history.undo()).toBeNull(); // only one merged entry existed
  });

  it("does not merge across the 500ms window: a pause starts a new undo step", () => {
    const history = createHistory();
    let state: EditorState = { store: storeFrom([para("p1", "")]), selection: null };

    let result = typeChar(state, "p1", 0, "a");
    history.push({ before: state, after: result.state, changedIds: result.changedIds }, { blockId: "p1", mergeable: true });
    state = result.state;

    vi.advanceTimersByTime(600); // past the merge window

    result = typeChar(state, "p1", 1, "b");
    history.push({ before: state, after: result.state, changedIds: result.changedIds }, { blockId: "p1", mergeable: true });
    state = result.state;

    expect(state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "ab" }]);

    const undo1 = history.undo();
    expect(undo1!.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "a" }]);
    const undo2 = history.undo();
    expect(undo2!.state.store.records.get("p1")!.content).toEqual([]);
    expect(history.undo()).toBeNull();
  });

  it("does not merge across different blocks even within the window", () => {
    const history = createHistory();
    let state: EditorState = { store: storeFrom([para("p1", ""), para("p2", "")]), selection: null };

    let result = typeChar(state, "p1", 0, "a");
    history.push({ before: state, after: result.state, changedIds: result.changedIds }, { blockId: "p1", mergeable: true });
    state = result.state;

    result = typeChar(state, "p2", 0, "b");
    history.push({ before: state, after: result.state, changedIds: result.changedIds }, { blockId: "p2", mergeable: true });
    state = result.state;

    const undoB = history.undo()!; // undoes "b" (a separate step from "a")
    expect(undoB.state.store.records.get("p2")!.content).toEqual([]);
    expect(undoB.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "a" }]);
    const undoA = history.undo()!;
    expect(undoA.state.store.records.get("p1")!.content).toEqual([]);
    expect(history.undo()).toBeNull();
  });

  it("redo replays an undone entry, and a new push clears the redo stack", () => {
    const history = createHistory();
    const state0: EditorState = { store: storeFrom([para("p1", "")]), selection: null };
    const result = typeChar(state0, "p1", 0, "a");
    history.push({ before: state0, after: result.state, changedIds: result.changedIds });

    const undone = history.undo()!;
    expect(undone.state.store.records.get("p1")!.content).toEqual([]);
    const redone = history.redo()!;
    expect(redone.state.store.records.get("p1")!.content).toEqual([{ type: "text", text: "a" }]);
    expect(history.redo()).toBeNull();
  });
});

describe("history: patchSystemProps (a system commit outside history)", () => {
  it("patches the block's props onto every undo/redo snapshot that still contains it, so undo+redo keeps the system commit", () => {
    const history = createHistory();
    // Simulates: insert an image block with src "" (a real undo step)...
    const before0: EditorState = { store: storeFrom([para("p1", "")]), selection: null };
    const inserted = createTransaction(before0, r)
      .insertBlock(null, 1, { id: "img1", type: "image", props: { src: "" } })
      .commit();
    history.push({ before: before0, after: inserted.state, changedIds: inserted.changedIds }, { blockId: "img1", mergeable: false });

    // ...then the upload resolves (a dispatchSystem commit, never pushed) and
    // patches the SAME entry's `after` snapshot directly.
    history.patchSystemProps("img1", { src: "https://cdn.example/x.png" });

    const undone = history.undo()!;
    expect(undone.state.store.records.has("img1")).toBe(false); // before the insert: no image at all

    const redone = history.redo()!;
    expect(redone.state.store.records.get("img1")!.props.src).toBe("https://cdn.example/x.png"); // not the stale ""
  });

  it("is a no-op for a stack entry whose snapshots never contained the block", () => {
    const history = createHistory();
    const state0: EditorState = { store: storeFrom([para("p1", "")]), selection: null };
    const result = typeChar(state0, "p1", 0, "a");
    history.push({ before: state0, after: result.state, changedIds: result.changedIds }, { blockId: "p1", mergeable: false });

    expect(() => history.patchSystemProps("does-not-exist", { src: "x" })).not.toThrow();
    const undone = history.undo()!;
    expect(undone.state.store.records.get("p1")!.content).toEqual([]);
  });
});

describe("history: depth cap", () => {
  it("caps the undo stack at the given depth, dropping the oldest entries", () => {
    const history = createHistory(3);
    let state: EditorState = { store: storeFrom([para("p1", "")]), selection: null };
    for (let i = 0; i < 5; i++) {
      const before = state;
      const result = typeChar(state, "p1", i, String(i));
      // mergeable:false (or a different blockId each time) so every push is its own entry
      history.push({ before, after: result.state, changedIds: result.changedIds }, { blockId: `block-${i}` });
      state = result.state;
    }
    let undoCount = 0;
    while (history.undo()) undoCount++;
    expect(undoCount).toBe(3);
  });
});
