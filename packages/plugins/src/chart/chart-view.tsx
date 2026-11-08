// The chart void block's renderer. Resolves `block.props.source` via
// the injected `resolveData`, applies `props.range` when the
// source is inline (range/filter is an inline-only concept), then lazy-loads
// Recharts (user choice: Recharts) so the main bundle never pays for it
// unless a chart block actually exists on the page.
import { Suspense, lazy, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Json } from "@jul-editor/core";
import { MissingResolverError, MissingUrlResolverError, applyRange, readDataSource, type RangeSpec, type Table } from "../data";
import { useResolveData } from "../resolve-data-context.js";
import type { PluginViewProps } from "../view-props.js";
import { ChartEditor, KINDS } from "./chart-editor.js";
import type { ChartKind } from "./recharts-chart.js";
import { PALETTE_SIZE, readColorBy, readPalette } from "./palette.js";

// `recharts` is an optional peer: if it is not installed the chart degrades
// to a status message instead of throwing out of the editor.
const LazyRechartsChart = lazy(() =>
  import("./recharts-chart.js").catch(() => ({
    default: function RechartsMissing(): ReactNode {
      return <div data-jul-editor-plugin="chart-error" role="status">Install `recharts` to render charts.</div>;
    },
  })),
);

function readKind(v: Json | undefined): ChartKind {
  return KINDS.find((kind) => kind === v) ?? "bar";
}

function readRange(v: Json | undefined): RangeSpec | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) return v as unknown as RangeSpec;
  return null;
}

type ChartStatus = "loading" | "ready" | "missing-resolver" | "error";
interface ChartState {
  status: ChartStatus;
  table?: Table;
  message?: string;
}

const EMPTY_TABLE: Table = { columns: [], columnTypes: [], rows: [] };

export interface ChartClassNames {
  container?: string;
  plot?: string;
  controls?: string;
  status?: string;
  tooltip?: string;
  legend?: string;
}

export interface ChartTheme {
  series?: readonly string[];
  surface?: string;
  grid?: string;
  muted?: string;
  hover?: string;
  cursor?: string;
  tooltipBackground?: string;
  tooltipForeground?: string;
  tooltipBorder?: string;
  tooltipMuted?: string;
}

export interface ChartViewProps extends PluginViewProps {
  className?: string | ChartClassNames;
  theme?: ChartTheme;
}

function chartThemeStyle(theme?: ChartTheme): CSSProperties | undefined {
  if (!theme) return undefined;
  const values: Record<string, string> = {};
  theme.series?.slice(0, PALETTE_SIZE).forEach((color, index) => { if (color) values[`--chart-${index + 1}`] = color; });
  const named = {
    surface: "--chart-surface", grid: "--chart-grid", muted: "--chart-muted", hover: "--chart-hover", cursor: "--chart-cursor",
    tooltipBackground: "--chart-tooltip-bg", tooltipForeground: "--chart-tooltip-fg",
    tooltipBorder: "--chart-tooltip-border", tooltipMuted: "--chart-tooltip-muted",
  } as const;
  for (const [key, variable] of Object.entries(named)) {
    const color = theme[key as keyof typeof named];
    if (color) values[variable] = color as string;
  }
  return values as CSSProperties;
}

/** Normalizes the stored `y` prop (string or string[]) to a list. */
export function readYColumns(v: Json | undefined): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.filter((c): c is string => typeof c === "string" && c !== "");
  return [];
}

/**
 * Picks x and y series, falling back to sensible columns when the saved ones no
 * longer exist. `y` is the first series (kept for single-series callers).
 */
export function chooseChartColumns(table: Table, savedX?: string, savedY?: string | readonly string[]): { x: string; y: string; ys: string[]; yColumns: string[] } {
  const x = savedX && table.columns.includes(savedX) ? savedX : (table.columns[0] ?? "");
  const yColumns = table.columns.filter((_, i) => table.columnTypes[i] === "number");
  const saved = (typeof savedY === "string" ? [savedY] : [...(savedY ?? [])]).filter((column, i, all) => yColumns.includes(column) && all.indexOf(column) === i);
  const fallback = yColumns.find((column) => column !== x) ?? yColumns[0];
  const ys = saved.length ? saved : fallback ? [fallback] : [];
  return { x, y: ys[0] ?? "", ys, yColumns };
}

export function ChartView({ block, selected, updateProps, readOnly, locale = "en", className, theme }: ChartViewProps): ReactNode {
  const t = (en: string, ko: string) => locale === "ko" ? ko : en;
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const props = block.props;
  const kind = readKind(props.kind);
  const source = readDataSource(props.source);
  const range = readRange(props.range);
  const resolveData = useResolveData();

  const [state, setState] = useState<ChartState>({ status: "loading" });

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

  const table = state.table ?? EMPTY_TABLE;
  const palette = readPalette(props.palette);
  const colorBy = readColorBy(props.colorBy);
  const { x, y, ys, yColumns } = chooseChartColumns(table, typeof props.x === "string" ? props.x : undefined, readYColumns(props.y));

  return (
    <div data-jul-editor-plugin="chart" data-jul-editor-chart-kind={kind} className={classes.container} style={chartThemeStyle(theme)}>
      {state.status === "loading" && <div data-jul-editor-plugin="chart-loading" className={classes.status} role="status">{t("Loading chart…", "차트 불러오는 중…")}</div>}
      {state.status === "missing-resolver" && <div data-jul-editor-plugin="missing-resolver" className={classes.status}>{t(state.message ?? "Add a data resolver.", "외부 데이터를 사용하려면 ResolveDataProvider를 연결하세요.")}</div>}
      {state.status === "error" && <div data-jul-editor-plugin="chart-error" className={classes.status}>{t(state.message ?? "Could not load chart data.", `차트 데이터를 불러오지 못했습니다: ${state.message ?? ""}`)}</div>}
      {state.status === "ready" && (!table.rows.length || !y ? (
        <div data-jul-editor-plugin="chart-empty" className={classes.status}>{t("Add data rows with a numeric column to preview the chart.", "차트를 보려면 숫자 열이 있는 데이터 행을 추가하세요.")}</div>
      ) : (
        <div className={classes.plot}><Suspense fallback={<div data-jul-editor-plugin="chart-loading" className={classes.status} role="status">{t("Loading chart…", "차트 불러오는 중…")}</div>}>
          <LazyRechartsChart kind={kind} table={table} x={x} y={ys} colorBy={colorBy} palette={palette} classNames={classes} />
        </Suspense></div>
      ))}
      {selected && !readOnly && updateProps && <div className={classes.controls}><ChartEditor locale={locale} kind={kind} source={source} range={range} x={x} y={y} ys={ys} palette={palette} colorBy={colorBy} columnTypes={table.columnTypes} columns={table.columns} yColumns={yColumns} updateProps={updateProps} /></div>}
    </div>
  );
}
