// Regression tests for a review-found bug: activeMarks() for a non-collapsed
// selection must only consider the text runs the selection actually
// OVERLAPS (sliced to the selection's own from/to), across every block the
// selection spans -- not "every run in the anchor's whole block".

import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Block } from "../model/types.js";
import { fromDoc } from "../store/store.js";
import { doc } from "../store/test-helpers.js";
import type { EditorState, Selection } from "../store/types.js";
import { activeMarks, createMarksRef } from "./marks.js";

function makeState(blocks: Block[], selection: Selection): EditorState {
  return { store: fromDoc(doc(blocks), coreRegistry), selection };
}

describe("activeMarks: non-collapsed selection considers only the OVERLAPPED runs", () => {
  it("a selection covering only the bold run's tail returns [bold]", () => {
    const block: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "AB", marks: [{ type: "bold" }] }, { type: "text", text: "CD" }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 2 } };
    const marks = activeMarks(makeState([block], sel), createMarksRef());
    expect(marks.map((m) => m.type)).toEqual(["bold"]);
  });

  it("a selection straddling the bold/plain boundary returns [] (not every overlapped run is bold)", () => {
    const block: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "AB", marks: [{ type: "bold" }] }, { type: "text", text: "CD" }] };
    // offset 1 (inside "AB", after 'A') .. offset 3 (inside "CD", after 'C')
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 3 } };
    const marks = activeMarks(makeState([block], sel), createMarksRef());
    expect(marks).toEqual([]);
  });

  it("a selection entirely inside the UNMARKED run returns [] even though the block also has a bold run elsewhere", () => {
    const block: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "AB", marks: [{ type: "bold" }] }, { type: "text", text: "CD" }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 4 } };
    const marks = activeMarks(makeState([block], sel), createMarksRef());
    expect(marks).toEqual([]);
  });

  it("cross-block selection: bold everywhere overlapped -> [bold]", () => {
    const p1: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }] };
    const p2: Block = { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "World", marks: [{ type: "bold" }] }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p2", offset: 3 } };
    const marks = activeMarks(makeState([p1, p2], sel), createMarksRef());
    expect(marks.map((m) => m.type)).toEqual(["bold"]);
  });

  it("cross-block selection: second block unmarked -> [] (not just the anchor block's own runs)", () => {
    const p1: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }] };
    const p2: Block = { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "World" }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p2", offset: 3 } };
    const marks = activeMarks(makeState([p1, p2], sel), createMarksRef());
    expect(marks).toEqual([]);
  });

  it("still returns marksAtPoint's result for a truly collapsed selection", () => {
    const block: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "AB", marks: [{ type: "bold" }] }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 2 } };
    const marks = activeMarks(makeState([block], sel), createMarksRef());
    expect(marks.map((m) => m.type)).toEqual(["bold"]);
  });

  it("a backward (right-to-left) selection inside a bold run returns [bold]", () => {
    const block: Block = { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "AB", marks: [{ type: "bold" }] }, { type: "text", text: "CD" }] };
    const sel: Selection = { type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 0 } };
    expect(activeMarks(makeState([block], sel), createMarksRef()).map((m) => m.type)).toEqual(["bold"]);
  });
});
