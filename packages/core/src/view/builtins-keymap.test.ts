// Unit tests for the tableCell/table keymap additions (Enter/Mod-Enter,
// column-wise ArrowUp/Down + last-row exit, Shift-Arrow starting a `cells`
// rectangle, and the whole-table keymap collapsing one back to a caret).
// codeBlock/todoListItem/tableCell's pre-existing Tab/Shift-Tab are
// covered by e2e, not duplicated here.

import { describe, expect, it } from "vitest";
import { codeBlock, table, tableCell } from "../model/builtins.js";
import { createTransaction } from "../store/transaction.js";
import { para, r, storeFrom } from "../store/test-helpers.js";
import type { EditorState } from "../store/types.js";
import { attachBuiltinKeymaps } from "./builtins-keymap.js";
import { armCodeBlockLangGrab } from "./input-rules.js";
import type { Keymap, KeymapCtx, KeymapFn } from "./keymap.js";

attachBuiltinKeymaps();
const cellKeymap = tableCell.keymap as Keymap;
const tableKeymap = table.keymap as Keymap;
const codeBlockKeymap = codeBlock.keymap as Keymap;

function cell(id: string, text = "") {
  return { id, type: "tableCell" as const, props: {}, content: text ? [{ type: "text" as const, text }] : [] };
}

function twoByTwoStore() {
  return storeFrom([
    {
      id: "t1",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A1"), cell("b1", "B1")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("a2", "A2"), cell("b2", "B2")] },
      ],
    },
    para("after", "after"),
  ]);
}

function run(fn: KeymapFn, state: EditorState, eventOver: Partial<KeyboardEvent> = {}): EditorState {
  let out = state;
  const ctx: KeymapCtx = {
    state,
    registry: r,
    root: null as unknown as HTMLElement, // unused by every handler under test here
    event: eventOver as KeyboardEvent,
    dispatch: (build) => {
      const result = build(createTransaction(state, r)).commit();
      out = result.state;
      return result;
    },
    marksRef: { stored: null },
    onLinkRequest: async () => null,
  };
  const handled = fn(ctx);
  if (!handled) throw new Error("handler returned false (unhandled)");
  return out;
}

describe("tableCell Enter/Mod-Enter", () => {
  it("Enter inserts a literal newline, doesn't split the cell", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 2 }, focus: { blockId: "a1", offset: 2 } } };
    const next = run(cellKeymap.Enter!, state);
    expect(next.store.records.get("a1")!.content).toEqual([{ type: "text", text: "A1\n" }]);
    expect(next.store.records.get("r1")!.childIds).toEqual(["a1", "b1"]); // still one cell, not split
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "a1", offset: 3 }, focus: { blockId: "a1", offset: 3 } });
  });

  it("Mod-Enter exits the WHOLE table to a fresh paragraph right after it", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "b2", offset: 0 }, focus: { blockId: "b2", offset: 0 } } };
    const next = run(cellKeymap["Mod-Enter"]!, state);
    // table (unchanged, at its original index 0) -> new paragraph -> "after"
    expect(next.store.rootIds).toHaveLength(3);
    expect(next.store.rootIds[0]).toBe("t1");
    expect(next.store.rootIds[2]).toBe("after");
    const newParagraphId = next.store.rootIds[1]!;
    expect(next.store.records.get(newParagraphId)!.type).toBe("paragraph");
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: newParagraphId, offset: 0 }, focus: { blockId: newParagraphId, offset: 0 } });
  });
});

describe("tableCell ArrowUp/ArrowDown (column navigation)", () => {
  it("ArrowDown moves to the same column in the next row", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 1 }, focus: { blockId: "a1", offset: 1 } } };
    const next = run(cellKeymap.ArrowDown!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "a2", offset: 1 }, focus: { blockId: "a2", offset: 1 } });
  });

  it("ArrowUp moves to the same column in the previous row", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "b2", offset: 2 }, focus: { blockId: "b2", offset: 2 } } };
    const next = run(cellKeymap.ArrowUp!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "b1", offset: 2 }, focus: { blockId: "b1", offset: 2 } });
  });

  it("ArrowUp from the top row is unhandled (false)", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    expect(cellKeymap.ArrowUp!({ state, registry: r } as KeymapCtx)).toBe(false);
  });

  it("ArrowDown from the last row exits the table to the block right after it", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a2", offset: 0 }, focus: { blockId: "a2", offset: 0 } } };
    const next = run(cellKeymap.ArrowDown!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "after", offset: 0 }, focus: { blockId: "after", offset: 0 } });
  });
});

describe("Shift-Arrow at a cell edge starts a cells selection", () => {
  it("Shift-ArrowRight at the end of a cell selects it + the next cell", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 2 }, focus: { blockId: "a1", offset: 2 } } };
    const next = run(cellKeymap["Shift-ArrowRight"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 1] });
  });

  it("Shift-ArrowRight mid-cell (not at the end) is unhandled -- falls through to native text extension", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    expect(cellKeymap["Shift-ArrowRight"]!({ state, registry: r } as KeymapCtx)).toBe(false);
  });

  it("Shift-ArrowDown at the last cell's own model line selects it + the cell below", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 2 }, focus: { blockId: "a1", offset: 2 } } };
    const next = run(cellKeymap["Shift-ArrowDown"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 0] });
  });
});

describe("table keymap collapses a cells selection back to a caret", () => {
  it("plain ArrowRight moves the focus corner one cell right and collapses", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 0] } };
    const next = run(tableKeymap.ArrowRight!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "b1", offset: 0 }, focus: { blockId: "b1", offset: 0 } });
  });

  it("plain ArrowDown from a 2-cell rectangle collapses to below the focus corner", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 1] } };
    const next = run(tableKeymap.ArrowDown!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "b2", offset: 0 }, focus: { blockId: "b2", offset: 0 } });
  });
});

describe("table keymap Shift-Arrow extends an existing cells selection", () => {
  it("Shift-ArrowRight grows a 1x1 rectangle to 1x2, keeping the anchor fixed", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 0] } };
    const next = run(tableKeymap["Shift-ArrowRight"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 1] });
  });

  it("Shift-ArrowDown then Shift-ArrowRight grows to the full 2x2 rectangle over two presses", () => {
    const store = twoByTwoStore();
    let state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 0] } };
    state = run(tableKeymap["Shift-ArrowDown"]!, state);
    expect(state.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 0] });
    state = run(tableKeymap["Shift-ArrowRight"]!, state);
    expect(state.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 1] });
  });

  it("Shift-ArrowLeft shrinks a rectangle back toward (and past) the anchor", () => {
    const store = twoByTwoStore();
    let state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 1], focus: [0, 1] } };
    state = run(tableKeymap["Shift-ArrowLeft"]!, state);
    expect(state.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 1], focus: [0, 0] });
  });

  it("is unhandled (a no-op) once the focus corner would leave the table", () => {
    const store = twoByTwoStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 0] } };
    expect(tableKeymap["Shift-ArrowLeft"]!({ state, registry: r } as KeymapCtx)).toBe(false);
    expect(tableKeymap["Shift-ArrowUp"]!({ state, registry: r } as KeymapCtx)).toBe(false);
  });
});

describe("codeBlock space/Enter sets language from a typed lang token", () => {
  function codeBlockRecord(id: string, text: string, language = "") {
    const props: Record<string, string> = language ? { language } : {};
    return { id, type: "codeBlock" as const, props, content: text ? [{ type: "text" as const, text }] : [] };
  }

  it("' ' after a bare lang token sets props.language and clears the content", () => {
    const store = storeFrom([codeBlockRecord("c1", "ts")]);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "c1", offset: 2 }, focus: { blockId: "c1", offset: 2 } } };
    armCodeBlockLangGrab("c1"); // only armed right after a real "```" conversion
    const next = run(codeBlockKeymap[" "]!, state);
    const rec = next.store.records.get("c1")!;
    expect(rec.props.language).toBe("ts");
    expect(rec.content).toEqual([]);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "c1", offset: 0 }, focus: { blockId: "c1", offset: 0 } });
  });

  it("Enter after a bare lang token also sets the language instead of inserting a newline", () => {
    const store = storeFrom([codeBlockRecord("c1", "python")]);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "c1", offset: 6 }, focus: { blockId: "c1", offset: 6 } } };
    armCodeBlockLangGrab("c1"); // only armed right after a real "```" conversion
    const next = run(codeBlockKeymap.Enter!, state);
    expect(next.store.records.get("c1")!.props.language).toBe("python");
  });

  it("' ' inside real code (language already set) is a plain unhandled space, not re-triggered", () => {
    const store = storeFrom([codeBlockRecord("c1", "const x", "ts")]);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "c1", offset: 7 }, focus: { blockId: "c1", offset: 7 } } };
    expect(codeBlockKeymap[" "]!({ state, registry: r } as KeymapCtx)).toBe(false);
  });

  it("' ' mid-token (not at the content's own end) is unhandled -- a real space inside code", () => {
    const store = storeFrom([codeBlockRecord("c1", "tsx")]);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "c1", offset: 1 }, focus: { blockId: "c1", offset: 1 } } };
    expect(codeBlockKeymap[" "]!({ state, registry: r } as KeymapCtx)).toBe(false);
  });
});

// a 2x2 merged cell (a1, colspan=2 rowspan=2) in the top-left of an
// otherwise-plain 3x3 table -- grid:
//   row0: a1   a1   c1
//   row1: a1   a1   c2
//   row2: e1   f1   g1
// (row0's own childIds are [a1, c1], row1's are [c2] alone -- exactly the
// "only an anchor gets a childIds entry" shape store/table.ts's tableGrid
// module comment describes.)
function mergedThreeByThreeStore() {
  return storeFrom([
    {
      id: "t1",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [{ id: "a1", type: "tableCell", props: { colspan: 2, rowspan: 2 }, content: [] }, cell("c1", "C1")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("c2", "C2")] },
        { id: "r3", type: "tableRow", props: {}, children: [cell("e1", "E1"), cell("f1", "F1"), cell("g1", "G1")] },
      ],
    },
    para("after", "after"),
  ]);
}

describe("tableCell ArrowUp/ArrowDown are grid-aware across a 2x2 merged cell", () => {
  it("ArrowDown from inside the merged cell skips its OWN covered row (grid row 1) and lands in grid row 2, same column", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    const next = run(cellKeymap.ArrowDown!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "e1", offset: 0 }, focus: { blockId: "e1", offset: 0 } });
  });

  it("ArrowUp from grid row 2 lands back in the merged cell, whichever of its own covered rows the lookup resolves through", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "e1", offset: 0 }, focus: { blockId: "e1", offset: 0 } } };
    const next = run(cellKeymap.ArrowUp!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } });
  });

  it("Shift-ArrowRight from the merged cell selects it + the next DISTINCT cell (grid column 2, past its own colspan)", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    const next = run(cellKeymap["Shift-ArrowRight"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [0, 2] });
  });

  it("Shift-ArrowDown from the merged cell selects it + grid row 2 (past its own rowspan)", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    const next = run(cellKeymap["Shift-ArrowDown"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [2, 0] });
  });

  it("Shift-ArrowLeft from row1's real cell (grid column 2, alone in row1's own childIds) selects into the merge's own covered column", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "c2", offset: 0 }, focus: { blockId: "c2", offset: 0 } } };
    const next = run(cellKeymap["Shift-ArrowLeft"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [1, 2], focus: [1, 1] });
  });
});

describe("table keymap collapse/extend of a cells selection are grid-aware across a merge", () => {
  it("collapsing ArrowUp from grid row 2 into row 1 (entirely covered by the merge) resolves the merged anchor, not row1's own (unrelated) childIds[0]", () => {
    // Earlier bug this guards against: row1's OWN childIds is [c2] alone
    // (length 1) -- a childIds-index read of "row1, column 0" would
    // (wrongly) clamp to childIds[0] === c2, when grid column 0 of row 1 is
    // really covered by the merged cell a1.
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [2, 0], focus: [2, 0] } };
    const next = run(tableKeymap.ArrowUp!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } });
  });

  it("extending Shift-ArrowUp from grid column 2 into row 1 succeeds (grid width 3), not rejected by row1's own shorter childIds length (1)", () => {
    const store = mergedThreeByThreeStore();
    const state: EditorState = { store, selection: { type: "cells", tableId: "t1", anchor: [2, 2], focus: [2, 2] } };
    const next = run(tableKeymap["Shift-ArrowUp"]!, state);
    expect(next.selection).toEqual({ type: "cells", tableId: "t1", anchor: [2, 2], focus: [1, 2] });
  });
});

describe("Tab navigation skips covered (merged-away) positions", () => {
  it("Tab from the merged cell lands on the next surviving anchor, not a stale grid slot", () => {
    // 2x2 merged into one cell (a1..b2 -> just a1, colspan=2 rowspan=2), a
    // trailing 3rd column (c1/c2) survives untouched.
    const store = storeFrom([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          { id: "r1", type: "tableRow", props: { }, children: [{ id: "a1", type: "tableCell", props: { colspan: 2, rowspan: 2 }, content: [] }, cell("c1", "C1")] },
          { id: "r2", type: "tableRow", props: {}, children: [cell("c2", "C2")] },
        ],
      },
      para("after", "after"),
    ]);
    const state: EditorState = { store, selection: { type: "text", anchor: { blockId: "a1", offset: 0 }, focus: { blockId: "a1", offset: 0 } } };
    const next = run(cellKeymap.Tab!, state);
    expect(next.selection).toEqual({ type: "text", anchor: { blockId: "c1", offset: 0 }, focus: { blockId: "c1", offset: 0 } });
  });
});
