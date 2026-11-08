// Toolbar atoms for table structure commands. Same shape as toolbar.tsx's
// button atoms (asChild/aria, a thin useCommands() wrapper, no editing
// behavior of their own -- every one is a single existing core command call)
// -- kept in their own file/module (not toolbar.tsx) since they're
// table-specific, not part of the baseline toolbar.

import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useContext } from "react";
import { LabelsContext } from "../context.js";
import { Slot } from "../slot.js";
import { useCommands } from "../hooks.js";
import type { Labels } from "../labels.js";
import { useTableState } from "./use-table-state.js";

const TOOLBAR_ITEM_ATTR = "data-jul-editor-toolbar-item";
const toolbarItemAttrs = { [TOOLBAR_ITEM_ATTR]: "" };

export interface TableButtonProps extends ComponentPropsWithoutRef<"button"> {
  asChild?: boolean;
}

/** `run` is called with `useCommands()` on click; `disabled` follows
 * `useTableState().inTable` unless the caller passes their own.
 * `labelKey` (not a fixed string) so the fallback text follows `<Editor
 * locale>`/`<Editor labels>`, same convention as toolbar.tsx's own atoms. */
function createTableButton(run: (commands: ReturnType<typeof useCommands>) => void, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, TableButtonProps>(function TableButton({ asChild, children, onClick, disabled, ...props }, ref) {
    const { inTable } = useTableState();
    const commands = useCommands();
    const label = useContext(LabelsContext)[labelKey];
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        disabled={disabled ?? !inTable}
        {...toolbarItemAttrs}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) run(commands);
        }}
        {...props}
      >
        {children ?? label}
      </Comp>
    );
  });
}

export interface InsertTableButtonProps extends TableButtonProps {
  rows?: number;
  cols?: number;
  headerRow?: boolean;
}

/** Unlike every other atom here, InsertTable is never disabled by
 * `useTableState` (it's how you GET into a table in the first place). */
export const InsertTable = /* @__PURE__ */ forwardRef<HTMLButtonElement, InsertTableButtonProps>(function InsertTable(
  { asChild, children, onClick, rows = 3, cols = 3, headerRow, ...props },
  ref,
) {
  const commands = useCommands();
  const label = useContext(LabelsContext).tableInsertTable;
  const Comp = (asChild ? Slot : "button") as "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      {...toolbarItemAttrs}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) commands.insertTable(rows, cols, headerRow !== undefined ? { headerRow } : undefined);
      }}
      {...props}
    >
      {children ?? label}
    </Comp>
  );
});

export const AddRowBefore = /* @__PURE__ */ createTableButton((c) => c.addRowBefore(), "tableAddRowBefore");
export const AddRowAfter = /* @__PURE__ */ createTableButton((c) => c.addRowAfter(), "tableAddRowAfter");
export const AddColumnBefore = /* @__PURE__ */ createTableButton((c) => c.addColumnBefore(), "tableAddColumnBefore");
export const AddColumnAfter = /* @__PURE__ */ createTableButton((c) => c.addColumnAfter(), "tableAddColumnAfter");
export const DeleteRow = /* @__PURE__ */ createTableButton((c) => c.deleteRow(), "tableDeleteRow");
export const DeleteColumn = /* @__PURE__ */ createTableButton((c) => c.deleteColumn(), "tableDeleteColumn");
export const DeleteTable = /* @__PURE__ */ createTableButton((c) => c.deleteTable(), "tableDeleteTable");

// ---- merge/split/move -------------------------------------------------
// Same shape as `createTableButton` above, but `disabled` follows a
// TableState-derived predicate instead of plain `inTable` (e.g. SplitCell is
// disabled even INSIDE a table when the current cell isn't actually merged).

function createTableStateButton(disabledWhen: (s: ReturnType<typeof useTableState>) => boolean, run: (commands: ReturnType<typeof useCommands>) => void, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, TableButtonProps>(function TableStateButton({ asChild, children, onClick, disabled, ...props }, ref) {
    const state = useTableState();
    const commands = useCommands();
    const label = useContext(LabelsContext)[labelKey];
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        disabled={disabled ?? disabledWhen(state)}
        {...toolbarItemAttrs}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) run(commands);
        }}
        {...props}
      >
        {children ?? label}
      </Comp>
    );
  });
}

/** Merges the current `cells` rectangle selection into one cell; disabled
 * unless the current selection actually IS a rectangle (a single-cell caret
 * has nothing to merge). */
export const MergeCells = /* @__PURE__ */ createTableStateButton((s) => !s.selection, (c) => c.mergeCells(), "tableMergeCells");
/** Splits the current (merged) cell back apart; disabled unless it's
 * actually merged (colspan/rowspan > 1). */
export const SplitCell = /* @__PURE__ */ createTableStateButton((s) => !s.inTable || (s.colspan <= 1 && s.rowspan <= 1), (c) => c.splitCell(), "tableSplitCell");
export const MoveRowUp = /* @__PURE__ */ createTableStateButton((s) => !s.inTable || s.row <= 0, (c) => c.moveRowUp(), "tableMoveRowUp");
export const MoveRowDown = /* @__PURE__ */ createTableStateButton((s) => !s.inTable || s.row + s.rowspan >= s.rows, (c) => c.moveRowDown(), "tableMoveRowDown");
export const MoveColumnLeft = /* @__PURE__ */ createTableStateButton((s) => !s.inTable || s.col <= 0, (c) => c.moveColumnLeft(), "tableMoveColumnLeft");
export const MoveColumnRight = /* @__PURE__ */ createTableStateButton((s) => !s.inTable || s.col + s.colspan >= s.cols, (c) => c.moveColumnRight(), "tableMoveColumnRight");

export const ToggleHeaderRow = /* @__PURE__ */ forwardRef<HTMLButtonElement, TableButtonProps>(function ToggleHeaderRow({ asChild, children, onClick, disabled, ...props }, ref) {
  const { inTable, headerRow } = useTableState();
  const commands = useCommands();
  const label = useContext(LabelsContext).tableHeaderRow;
  const Comp = (asChild ? Slot : "button") as "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      disabled={disabled ?? !inTable}
      aria-pressed={headerRow}
      data-active={headerRow ? "" : undefined}
      {...toolbarItemAttrs}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) commands.toggleHeaderRow();
      }}
      {...props}
    >
      {children ?? label}
    </Comp>
  );
});
