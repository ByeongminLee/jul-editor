import type { Doc, Editor as CoreEditor, EditorState, Transaction } from "@jul-editor/core";
import { coreRegistry, createTransaction, fromDoc, toDoc } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { selectMentionItem } from "./mention-select.js";

function fakeEditor(doc: Doc): { editor: CoreEditor; getDoc: () => Doc; getState: () => EditorState } {
  let state: EditorState = { store: fromDoc(doc, coreRegistry), selection: null };
  const editor: Pick<CoreEditor, "getState" | "update"> = {
    getState: () => state,
    update: (build: (tx: Transaction) => Transaction) => {
      const tx = createTransaction(state, coreRegistry);
      const result = build(tx).commit();
      state = result.state;
      return result;
    },
  };
  return { editor: editor as unknown as CoreEditor, getDoc: () => toDoc(state.store), getState: () => state };
}

describe("selectMentionItem", () => {
  it("replaces the '@query' range with a mention inline + a trailing space, caret after both", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi @gil" }] }] };
    const { editor, getDoc, getState } = fakeEditor(doc);
    selectMentionItem(
      { id: "u1", label: "홍길동", kind: "user" },
      { editor, range: { blockId: "p1", from: 3, to: 7 }, close: () => {} },
    );
    const content = getDoc().blocks[0]!.content!;
    expect(content).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", attrs: { kind: "user", id: "u1", label: "홍길동" } },
      { type: "text", text: " " },
    ]);
    // mention counts as 1 unit -> caret sits at from(3) + 1(mention) + 1(space) = 5
    expect(getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } });
  });
});
