// The dataTable void block's renderer -- a plain <table> of resolved
// (+ ranged, for an inline source) rows, capped to the first 500 with a
// trailing "n more" note (no virtualization; the scope is a
// read view over a resolved dataset, not a spreadsheet).
import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Json } from "@jul-editor/core";
import { MissingResolverError, MissingUrlResolverError, applyRange, readDataSource, type CellValue, type RangeSpec, type Table } from "./data";
import { useResolveData } from "./resolve-data-context.js";
import type { PluginViewProps } from "./view-props.js";

const ROW_CAP = 500;

function readRange(v: Json | undefined): RangeSpec | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) return v as unknown as RangeSpec;
  return null;
}

function formatCell(v: CellValue): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

type Status = "loading" | "ready" | "missing-resolver" | "error";
interface State {
  status: Status;
  table?: Table;
  message?: string;
}

export interface DataTableViewClassNames {
  container?: string;
  table?: string;
  head?: string;
  row?: string;
  headerCell?: string;
  cell?: string;
  controls?: string;
  source?: string;
  range?: string;
  status?: string;
  more?: string;
}

export interface DataTableViewProps extends PluginViewProps {
  className?: string | DataTableViewClassNames;
}

export function DataTableView({ block, selected, updateProps, readOnly, locale = "en", className }: DataTableViewProps): ReactNode {
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const ko = locale === "ko";
  const source = readDataSource(block.props.source);
  const range = readRange(block.props.range);
  const resolveData = useResolveData();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, status: "loading" }));
    resolveData(source)
      .then((table) => {
        if (cancelled) return;
        const ranged = source.type === "inline" ? applyRange(table, range) : table;
        setState({ status: "ready", table: ranged });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MissingResolverError || err instanceof MissingUrlResolverError) setState({ status: "missing-resolver", message: err.message });
        else setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveData, JSON.stringify(source), JSON.stringify(range)]);

  const table = state.table;
  const rows = table?.rows.slice(0, ROW_CAP) ?? [];
  const more = (table?.rows.length ?? 0) - rows.length;

  return (
    <div className={classes.container} data-jul-editor-plugin="dataTable">
      {state.status === "loading" && <div className={classes.status} data-jul-editor-plugin="dataTable-loading" role="status">{ko ? "표 불러오는 중…" : "Loading table…"}</div>}
      {state.status === "missing-resolver" && <div className={classes.status} data-jul-editor-plugin="missing-resolver">{state.message}</div>}
      {state.status === "error" && <div className={classes.status} data-jul-editor-plugin="dataTable-error">{state.message}</div>}
      {state.status === "ready" && table && <table className={classes.table} data-testid="jul-editor-datatable">
        <thead className={classes.head}>
          <tr className={classes.row}>
            {table.columns.map((c) => (
              <th className={classes.headerCell} key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr className={classes.row} key={ri}>
              {row.map((cell, ci) => (
                <td className={classes.cell} key={ci}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>}
      {state.status === "ready" && more > 0 && <div className={classes.more} data-testid="jul-editor-datatable-more">{ko ? `나머지 ${more}개 행` : `${more} more rows`}</div>}
      {selected && !readOnly && updateProps && source.type === "inline" && !("format" in source && source.format === "json") && <div className={classes.controls} data-jul-editor-plugin="dataTable-editor">
        <textarea className={classes.source}
          aria-label={ko ? "표 CSV 데이터" : "Table CSV data"}
          data-testid="jul-editor-datatable-csv"
          value={source.csv}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateProps({ source: { type: "inline", csv: e.target.value } })}
        />
        <input className={classes.range}
          aria-label={ko ? "표 범위" : "Table range"}
          data-testid="jul-editor-datatable-range"
          type="text"
          value={typeof range === "string" ? range : ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateProps({ range: e.target.value || null })}
        />
      </div>}
    </div>
  );
}
