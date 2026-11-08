// The `table` block's own
// toMarkdown/toHTML/toText hooks, attached onto the SAME spec object
// model/builtins.ts exports (defineBlock returns its own argument -- see
// builtins-serde.ts's own header comment for why hooks live in serde/ and
// not model/). Split into its own file -- see
// the side-effecting `import "./table-serde.js"` at the bottom of
// builtins-serde.ts (same pattern as media-serde.ts).
//
// colspan/rowspan-aware: GFM markdown tables have no way to express spans
// (toMarkdown writes the anchor's content in the anchor's own position and
// leaves every position its span covers blank, reporting the lossy
// 'table-span'); toHTML emits real colspan/rowspan attributes (only when
// >1, clamped/validated -- see clampSpan) and skips a covered position
// entirely (no <td>/<th> of its own, exactly like real HTML); toText lays
// out the same grid (tab-joined, blank at a covered position).

import { table } from "../model/builtins.js";
import { getProp } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline } from "../model/types.js";
import { renderInlineListHtml } from "./inline-html.js";
import { renderInlineListMd } from "./inline-md.js";

function pad(ctx: { indent: number }): string {
  return "  ".repeat(ctx.indent);
}

const MAX_SPAN = 100;
function clampSpan(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_SPAN);
}

interface GridCell {
  cellId: string;
  content: Inline[];
  isAnchor: boolean;
  colspan: number;
  rowspan: number;
}

/** Same HTML-table-layout-algorithm grid store/table.ts's `tableGrid`
 * computes over a normalized Store, but over a plain Block tree instead (a
 * `table` Block handed to toMarkdown/toHTML/toText is already the whole
 * materialized tree, not a Store) -- kept as its own small copy rather than
 * importing store/ from serde/ (serde only ever depends on model/, by
 * design: it must stay usable from plain node with no Store/view at all). */
function blockTableGrid(tableBlock: Block, registry: Registry): (GridCell | null)[][] {
  const rows = tableBlock.children ?? [];
  const grid: (GridCell | null)[][] = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    let col = 0;
    for (const cell of row.children ?? []) {
      while (grid[r]![col]) col++;
      const colspan = clampSpan(getProp<number>(cell, "colspan", registry));
      const rowspan = Math.min(clampSpan(getProp<number>(cell, "rowspan", registry)), rows.length - r);
      for (let rr = r; rr < r + rowspan; rr++) {
        (grid[rr] ??= []);
        for (let cc = col; cc < col + colspan; cc++) {
          grid[rr]![cc] = { cellId: cell.id, content: cell.content ?? [], isAnchor: rr === r && cc === col, colspan, rowspan };
        }
      }
      col += colspan;
    }
  }
  const width = grid.reduce((m, row) => Math.max(m, row.length), 0);
  for (const row of grid) for (let c = 0; c < width; c++) if (row[c] === undefined) row[c] = null;
  return grid;
}

table.toMarkdown = (block, ctx) => {
  const headerRow = getProp<boolean>(block, "headerRow", ctx.registry) ?? true;
  const rows = block.children ?? [];
  if (rows.length === 0) return "";
  if (!headerRow) ctx.lossy("no-header-row");

  const grid = blockTableGrid(block, ctx.registry);
  const cols = grid[0]?.length ?? 0;
  let hasSpan = false;
  for (const row of grid) for (const g of row) if (g && (g.colspan > 1 || g.rowspan > 1)) hasSpan = true;
  if (hasSpan) ctx.lossy("table-span");

  const cellText = (g: GridCell): string => {
    let text = renderInlineListMd(g.content, ctx.registry, ctx).replace(/\|/g, "\\|");
    if (/\n/.test(text)) {
      ctx.pushLossy(g.cellId, "tableCell", "cell-newline");
      text = text.replace(/\s*\n+\s*/g, " ");
    }
    return text.trim();
  };

  const rowLine = (r: number): string => {
    const texts: string[] = [];
    for (let c = 0; c < cols; c++) {
      const g = grid[r]?.[c];
      texts.push(g && g.isAnchor ? cellText(g) : "");
    }
    return `| ${texts.join(" | ")} |`;
  };

  const lines = [rowLine(0), `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`];
  for (let i = 1; i < rows.length; i++) lines.push(rowLine(i));
  return lines.join("\n");
};

table.toHTML = (block, ctx) => {
  const headerRow = getProp<boolean>(block, "headerRow", ctx.registry) ?? true;
  const rows = block.children ?? [];
  if (rows.length === 0) return `<table data-jul-editor-type="table"></table>`;
  const grid = blockTableGrid(block, ctx.registry);

  const renderRow = (r: number, cellTag: string): string => {
    const row = grid[r] ?? [];
    const cells: string[] = [];
    for (const g of row) {
      if (!g || !g.isAnchor) continue;
      const attrs = (g.colspan > 1 ? ` colspan="${g.colspan}"` : "") + (g.rowspan > 1 ? ` rowspan="${g.rowspan}"` : "");
      cells.push(`<${cellTag}${attrs}>${renderInlineListHtml(g.content, ctx.registry, ctx)}</${cellTag}>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  };

  const thead = headerRow ? `<thead>${renderRow(0, "th")}</thead>` : "";
  const startBody = headerRow ? 1 : 0;
  let bodyRows = "";
  for (let r = startBody; r < rows.length; r++) bodyRows += renderRow(r, "td");
  return `<table data-jul-editor-type="table">${thead}<tbody>${bodyRows}</tbody></table>`;
};

table.toText = (block, ctx) => {
  const p = pad(ctx);
  const grid = blockTableGrid(block, ctx.registry);
  return grid.map((row) => p + row.map((g) => (g && g.isAnchor ? ctx.inlines(g.content) : "")).join("\t")).join("\n");
};
