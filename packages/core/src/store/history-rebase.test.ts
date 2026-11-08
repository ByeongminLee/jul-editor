import { describe, expect, it } from "vitest";
import { applyOp } from "./ops.js";
import { createHistory } from "./history.js";
import { para, r, storeFrom } from "./test-helpers.js";
import { createTransaction } from "./transaction.js";
import type { EditorState, Op } from "./types.js";

const textOf = (s: EditorState, id: string) => (s.store.records.get(id)?.content ?? []).map((i) => (i as { text: string }).text).join("");

describe("history.rebase (remote edits survive undo/redo)", () => {
  it("applies a logged remote op to a snapshot only when its entry is undone, and reports touched ids", () => {
    const history = createHistory();
    const s0: EditorState = { store: storeFrom([para("a", "x"), para("b", "y")]), selection: null };
    const local = createTransaction(s0, r).insertText({ blockId: "a", offset: 1 }, "!").commit();
    history.push({ before: s0, after: local.state, changedIds: local.changedIds });
    const remote: Op = { type: "replaceContent", id: "b", from: 1, to: 1, inlines: [{ type: "text", text: "?" }] };
    history.rebase((s) => applyOp(s, remote, r).store, ["b"]);
    const undone = history.undo()!;
    expect(textOf(undone.state, "a")).toBe("x"); // local edit undone
    expect(textOf(undone.state, "b")).toBe("y?"); // remote edit kept
    expect(undone.changedIds.has("b")).toBe(true); // so the view re-renders it
    const redone = history.redo()!;
    expect(textOf(redone.state, "a")).toBe("x!");
    expect(textOf(redone.state, "b")).toBe("y?");
  });

  it("is a no-op with an empty history and does not leak into entries pushed later", () => {
    const history = createHistory();
    const s0: EditorState = { store: storeFrom([para("a", "x")]), selection: null };
    history.rebase((s) => s, []);
    const tx = createTransaction(s0, r).insertText({ blockId: "a", offset: 1 }, "1").commit();
    history.push({ before: s0, after: tx.state, changedIds: tx.changedIds });
    const bump: Op = { type: "replaceContent", id: "a", from: 0, to: 0, inlines: [{ type: "text", text: ">" }] };
    history.rebase((s) => applyOp(s, bump, r).store, ["a"]);
    const e = history.undo()!;
    expect(textOf(e.state, "a")).toBe(">x"); // applied exactly once
  });
});
