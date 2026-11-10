import type { Doc } from "@jul-editor/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, useEditor } from "..";
import {
  AddColumnAfter,
  AddRowAfter,
  DeleteColumn,
  DeleteRow,
  DeleteTable,
  InsertTable,
  MergeCells,
  MoveColumnRight,
  MoveRowDown,
  SplitCell,
  ToggleHeaderRow,
  useTableGridPicker,
  useTableHover,
  useTableState,
} from "./";
import type { TableState } from "./";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testTableState?: unknown }).__testTableState;
});

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const table = useTableState();
  (globalThis as { __testTableState?: unknown }).__testTableState = table;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}
function testTableState(): TableState {
  return (globalThis as { __testTableState?: TableState }).__testTableState!;
}

function docWithTable(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "before" }] },
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          {
            id: "r1",
            type: "tableRow",
            props: {},
            children: [
              { id: "a1", type: "tableCell", props: {}, content: [{ type: "text", text: "A1" }] },
              { id: "b1", type: "tableCell", props: {}, content: [{ type: "text", text: "B1" }] },
            ],
          },
        ],
      },
    ],
  };
}

describe("useTableState", () => {
  it("reports not-in-table for an ordinary caret", () => {
    render(
      <Editor defaultValue={docWithTable()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "p1", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    expect(testTableState().inTable).toBe(false);
  });

  it("reports row/col/rows/cols/headerRow for a caret inside a cell", () => {
    render(
      <Editor defaultValue={docWithTable()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "b1", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    const state = testTableState();
    expect(state).toMatchObject({ inTable: true, row: 0, col: 1, rows: 1, cols: 2, headerRow: true, tableId: "t1" });
  });

  it("resolves the anchor cell for a cells rectangle selection", () => {
    render(
      <Editor defaultValue={docWithTable()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => {
      testEditor().update((tx) => tx.setSelection({ type: "cells", tableId: "t1", anchor: [0, 1], focus: [0, 0] }));
    });
    const state = testTableState();
    expect(state).toMatchObject({ inTable: true, row: 0, col: 1 });
    expect(state.selection).toEqual({ type: "cells", tableId: "t1", anchor: [0, 1], focus: [0, 0] });
  });
});

describe("table toolbar atoms", () => {
  it("InsertTable inserts a table and is never disabled", () => {
    render(
      <Editor defaultValue={{ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] }}>
        <Editor.Content />
        <InsertTable rows={2} cols={2} data-testid="insert-table" />
        <Probe />
      </Editor>,
    );
    const btn = screen.getByTestId("insert-table");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(testEditor().getDoc().blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("row/column atoms are disabled outside a table and enabled with a caret inside one", () => {
    render(
      <Editor defaultValue={docWithTable()}>
        <Editor.Content />
        <AddRowAfter data-testid="add-row" />
        <AddColumnAfter data-testid="add-col" />
        <DeleteRow data-testid="del-row" />
        <DeleteColumn data-testid="del-col" />
        <DeleteTable data-testid="del-table" />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "p1", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    expect((screen.getByTestId("add-row") as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      const point = { blockId: "a1", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    expect((screen.getByTestId("add-row") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("add-col"));
    expect(testEditor().getDoc().blocks[1]!.children![0]!.children).toHaveLength(3);

    fireEvent.click(screen.getByTestId("del-col"));
    expect(testEditor().getDoc().blocks[1]!.children![0]!.children).toHaveLength(2);

    fireEvent.click(screen.getByTestId("del-table"));
    expect(testEditor().getDoc().blocks.some((b) => b.id === "t1")).toBe(false);
  });

  it("ToggleHeaderRow reflects and flips the table's headerRow prop", () => {
    render(
      <Editor defaultValue={docWithTable()}>
        <Editor.Content />
        <ToggleHeaderRow data-testid="toggle-header" />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "a1", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    const btn = screen.getByTestId("toggle-header");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(testEditor().getDoc().blocks[1]!.props.headerRow).toBe(false);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("ToggleHeaderRow keeps editor focus on a press and still calls the consumer's onMouseDown", () => {
    const onMouseDown = vi.fn();
    render(<Editor defaultValue={docWithTable()}><Editor.Content /><ToggleHeaderRow disabled={false} onMouseDown={onMouseDown} data-testid="toggle-header" /></Editor>);
    expect(fireEvent.mouseDown(screen.getByTestId("toggle-header"))).toBe(false);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

/** A 3x3 table (rows r1/r2/r3, cells c<row><col>, 1-based). */
function doc3x3(): Doc {
  const mkRow = (row: number) => ({
    id: `row${row}`,
    type: "tableRow" as const,
    props: {},
    children: [0, 1, 2].map((col) => ({ id: `c${row}${col}`, type: "tableCell" as const, props: {}, content: [{ type: "text" as const, text: `C${row}${col}` }] })),
  });
  return {
    version: 1,
    blocks: [{ id: "t1", type: "table", props: {}, children: [mkRow(0), mkRow(1), mkRow(2)] }],
  };
}

describe("MergeCells / SplitCell", () => {
  it("MergeCells is disabled without a cells rectangle selection, merges one when present, SplitCell restores it", () => {
    render(
      <Editor defaultValue={doc3x3()}>
        <Editor.Content />
        <MergeCells data-testid="merge" />
        <SplitCell data-testid="split" />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "c00", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    expect((screen.getByTestId("merge") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("split") as HTMLButtonElement).disabled).toBe(true); // not merged yet

    act(() => {
      testEditor().update((tx) => tx.setSelection({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 1] }));
    });
    expect((screen.getByTestId("merge") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("merge"));
    const table = testEditor().getDoc().blocks[0]!;
    expect(table.children![0]!.children).toHaveLength(2); // merged anchor + untouched c02
    expect(table.children![0]!.children![0]!.props).toMatchObject({ colspan: 2, rowspan: 2 });

    expect((screen.getByTestId("split") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("split"));
    expect(testEditor().getDoc().blocks[0]!.children![0]!.children).toHaveLength(3);
  });
});

describe("MoveRowDown / MoveColumnRight", () => {
  it("reorder rows/columns around the current cell", () => {
    render(
      <Editor defaultValue={doc3x3()}>
        <Editor.Content />
        <MoveRowDown data-testid="move-row-down" />
        <MoveColumnRight data-testid="move-col-right" />
        <Probe />
      </Editor>,
    );
    act(() => {
      const point = { blockId: "c00", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    fireEvent.click(screen.getByTestId("move-row-down"));
    expect(testEditor().getDoc().blocks[0]!.children![1]!.id).toBe("row0");

    act(() => {
      const point = { blockId: "c00", offset: 0 };
      testEditor().update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    });
    fireEvent.click(screen.getByTestId("move-col-right"));
    expect(testEditor().getDoc().blocks[0]!.children![1]!.children![1]!.id).toBe("c00");
  });
});

describe("useTableGridPicker", () => {
  function Picker() {
    const picker = useTableGridPicker({ maxRows: 3, maxCols: 3 });
    (globalThis as { __testPicker?: unknown }).__testPicker = picker;
    return (
      <div>
        {Array.from({ length: picker.maxRows }, (_v, row) =>
          Array.from({ length: picker.maxCols }, (_v2, col) => <div key={`${row}-${col}`} data-testid={`cell-${row}-${col}`} {...picker.getCellProps(row, col)} />),
        )}
      </div>
    );
  }

  it("hovering a cell marks the rectangle up to it active, insert() creates a table sized by the hover", () => {
    render(
      <Editor defaultValue={{ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] }}>
        <Editor.Content />
        <Picker />
        <Probe />
      </Editor>,
    );
    fireEvent.mouseEnter(screen.getByTestId("cell-1-2"));
    expect(screen.getByTestId("cell-0-0").hasAttribute("data-active")).toBe(true);
    expect(screen.getByTestId("cell-1-2").hasAttribute("data-active")).toBe(true);
    expect(screen.getByTestId("cell-2-2").hasAttribute("data-active")).toBe(false);

    act(() => {
      (globalThis as { __testPicker?: { insert(): void } }).__testPicker!.insert();
    });
    const table = testEditor().getDoc().blocks.find((b) => b.type === "table")!;
    expect(table.children).toHaveLength(2); // hover row 1 -> 2 rows
    expect(table.children![0]!.children).toHaveLength(3); // hover col 2 -> 3 cols
    delete (globalThis as { __testPicker?: unknown }).__testPicker;
  });
});

describe("useTableHover", () => {
  function HoverProbe({ tableId }: { tableId: string }) {
    const hover = useTableHover(tableId);
    (globalThis as { __testHover?: unknown }).__testHover = hover;
    return null;
  }

  it("reports the hovered row/col (via setHoverRow/setHoverColumn) and its live rect", () => {
    render(
      <Editor defaultValue={doc3x3()}>
        <Editor.Content />
        <HoverProbe tableId="t1" />
        <Probe />
      </Editor>,
    );
    const hover = () => (globalThis as { __testHover?: ReturnType<typeof useTableHover> }).__testHover!;
    expect(hover().row).toBeNull();
    act(() => hover().setHoverRow(1));
    expect(hover().row).toBe(1);
    expect(hover().rowRect).not.toBeNull();

    act(() => hover().insertRowBelow());
    expect(testEditor().getDoc().blocks[0]!.children).toHaveLength(4);

    delete (globalThis as { __testHover?: unknown }).__testHover;
  });

  // Row/col -> cellId resolution now goes through `tableGrid`
  // (@jul-editor/core), not a raw childIds index.
  it("insertColumnRight at grid column 2 still resolves that column's real anchor cell after merging (0,0)-(1,1) shortens row0's own childIds to 2", () => {
    render(
      <Editor defaultValue={doc3x3()}>
        <Editor.Content />
        <MergeCells data-testid="merge" />
        <HoverProbe tableId="t1" />
        <Probe />
      </Editor>,
    );
    act(() => {
      testEditor().update((tx) => tx.setSelection({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 1] }));
    });
    fireEvent.click(screen.getByTestId("merge"));
    // row0's OWN childIds is now only 2 long (the merged anchor + c02) --
    // a childIds-index read of "row 0, column 2" would miss entirely, even
    // though grid column 2 is a perfectly real, un-covered column.
    expect(testEditor().getDoc().blocks[0]!.children![0]!.children).toHaveLength(2);

    const hover = () => (globalThis as { __testHover?: ReturnType<typeof useTableHover> }).__testHover!;
    act(() => hover().setHoverColumn(2));
    act(() => hover().insertColumnRight());

    const table = testEditor().getDoc().blocks[0]!;
    expect(table.children![0]!.children).toHaveLength(3); // merged anchor + c02 + the new column
    expect(table.children![2]!.children).toHaveLength(4); // row2 (unmerged) grew 3 -> 4 columns too

    delete (globalThis as { __testHover?: unknown }).__testHover;
  });
});
