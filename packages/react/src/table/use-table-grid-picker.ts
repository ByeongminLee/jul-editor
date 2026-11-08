// Notion-style drag/hover grid table insertion. Pure local UI state
// (the hover cursor lives only in this component instance, never the doc
// model) + a single `insertTable` call on release/click -- matches every
// other @jul-editor/react hook's own "no editing behavior beyond one existing
// core command" rule.

import { useCallback, useState } from "react";
import { useCommands } from "../hooks.js";

export interface TableGridPicker {
  maxRows: number;
  maxCols: number;
  /** The currently-hovered cell (0-based), or null before any hover. */
  hover: [number, number] | null;
  /** Spread onto each picker cell -- `onMouseEnter` reports the hover,
   * `data-active` is present (no value) for every cell within the hovered
   * rectangle (row 0..hover row, col 0..hover col), same "presence-only, no
   * styles implied" convention as core's own SELECTED_ATTR. A host's CSS
   * decides what an active cell looks like. */
  getCellProps(row: number, col: number): { onMouseEnter: () => void; "data-row": number; "data-col": number; "data-active"?: "" };
  /** Inserts a table sized by the current hover (or an explicit rows/cols,
   * e.g. a keyboard-driven picker that never hovers at all) and resets the
   * hover back to none. A no-op when neither a hover nor explicit size is
   * available. */
  insert(rows?: number, cols?: number): void;
}

export function useTableGridPicker(opts?: { maxRows?: number; maxCols?: number }): TableGridPicker {
  const maxRows = opts?.maxRows ?? 10;
  const maxCols = opts?.maxCols ?? 10;
  const [hover, setHover] = useState<[number, number] | null>(null);
  const commands = useCommands();

  const getCellProps = useCallback(
    (row: number, col: number) => ({
      onMouseEnter: () => setHover([row, col]),
      "data-row": row,
      "data-col": col,
      ...(hover && row <= hover[0] && col <= hover[1] ? { "data-active": "" as const } : {}),
    }),
    [hover],
  );

  const insert = useCallback(
    (rows?: number, cols?: number) => {
      const r = rows ?? (hover ? hover[0] + 1 : null);
      const c = cols ?? (hover ? hover[1] + 1 : null);
      if (r === null || c === null) return;
      commands.insertTable(r, c);
      setHover(null);
    },
    [hover, commands],
  );

  return { maxRows, maxCols, hover, getCellProps, insert };
}
