// Recharts stays behind ChartView's lazy import so documents without a chart
// never load the visualization dependency.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import type { ChartClassNames } from "./chart-view.js";
import type { CellValue, Table } from "../data";
import { DEFAULT_COLORS, resolvePalette, type ColorBy } from "./palette.js";

const COLORS = DEFAULT_COLORS;

export type ChartKind = "bar" | "line" | "area" | "pie" | "radar" | "radial";

function cellToPrimitive(v: CellValue | undefined): string | number {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v ?? "";
}

type TooltipEntry = { value?: string | number | ReadonlyArray<string | number>; color?: string; fill?: string; payload?: { x?: string | number; fill?: string }; name?: string | number };

/** Shared HTML tooltip for every chart family; CSS variables let the host theme it. */
export function ChartTooltipContent({ active, label, payload, valueLabel, className }: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<TooltipEntry>;
  valueLabel: string;
  className?: string;
}): ReactNode {
  if (!active || !payload?.length) return null;
  const category = payload[0]?.payload?.x ?? label;
  return <div data-chart-tooltip="" className={className} style={className ? undefined : {
    minWidth: 132, padding: "10px 12px", borderRadius: 9,
    background: "var(--chart-tooltip-bg, #191817)",
    border: "1px solid var(--chart-tooltip-border, #49443e)",
    color: "var(--chart-tooltip-fg, #f8f6f3)",
    boxShadow: "0 12px 32px #0005", fontSize: 12, lineHeight: 1.45,
  }}>
    {category !== undefined && category !== "" && <div style={{ fontWeight: 650, marginBottom: 6 }}>{String(category)}</div>}
    {payload.map((entry, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: i ? 4 : 0 }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 2, background: entry.payload?.fill ?? entry.color ?? entry.fill ?? COLORS[i % COLORS.length] }} />
      <span style={{ color: "var(--chart-tooltip-muted, #b7b2ac)", flex: 1 }}>{entry.name !== undefined && entry.name !== "" && payload.length > 1 ? String(entry.name) : valueLabel}</span>
      <strong style={{ fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{typeof entry.value === "number" ? new Intl.NumberFormat().format(entry.value) : String(entry.value ?? "")}</strong>
    </div>)}
  </div>;
}

function ChartLegend({ payload, className }: { payload?: ReadonlyArray<{ value?: string; color?: string }>; className?: string }): ReactNode {
  if (!payload?.length) return null;
  return <div data-chart-legend="" className={className} style={className ? undefined : { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 16px", color: "var(--chart-muted, #aaa39b)", fontSize: 11 }}>
    {payload.map((entry, i) => <span key={`${entry.value ?? "series"}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: entry.color ?? COLORS[i % COLORS.length] }} />
      {entry.value}
    </span>)}
  </div>;
}

export default function RechartsChart({ kind, table, x, y, colorBy, palette, classNames }: {
  kind: ChartKind; table: Table; x: string; y: string | readonly string[];
  colorBy?: ColorBy; palette?: readonly string[] | null; classNames?: ChartClassNames;
}): ReactNode {
  const colors = resolvePalette(palette);
  const color = (i: number) => colors[i % colors.length]!;
  const series = (Array.isArray(y) ? y as readonly string[] : [y as string]).filter((name) => table.columns.includes(name));
  const xi = table.columns.indexOf(x);
  const yis = series.map((name) => table.columns.indexOf(name));
  const first = series[0] ?? "";
  // Single-series bars color each category by default; every other cartesian
  // chart colors per series. Pie and radial always color per slice.
  const byCategory = kind === "bar" && series.length === 1 && (colorBy ?? "category") === "category";
  const data = table.rows.map((row, r) => {
    const out: Record<string, string | number> = { x: cellToPrimitive(row[xi]), name: String(cellToPrimitive(row[xi])), y: cellToPrimitive(row[yis[0] ?? -1]) };
    yis.forEach((yi, i) => { out[`s${i}`] = cellToPrimitive(row[yi]); });
    if (byCategory) out.fill = color(r);
    return out;
  });
  const categoryData = data.map((row, i) => ({ ...row, fill: color(i) }));
  const cursor = kind === "bar" ? { fill: "var(--chart-hover, #ee9b5114)", stroke: "none" }
    : kind === "line" || kind === "area" ? { stroke: "var(--chart-cursor, #716c66)", strokeDasharray: "3 3" }
    : false;
  const tooltip = <Tooltip cursor={cursor} content={(props) => <ChartTooltipContent {...props} valueLabel={first} className={classNames?.tooltip} />} />;
  const categoryLegend = byCategory ? data.map((row, i) => ({ value: String(row.name), color: color(i) })) : null;
  const legend = <Legend itemSorter={null} content={({ payload }) => <ChartLegend payload={categoryLegend ?? payload} className={classNames?.legend} />} wrapperStyle={{ paddingTop: 12 }} />;

  if (kind === "pie") return <ResponsiveContainer width="100%" height={280}>
    <PieChart accessibilityLayer>
      <Pie data={categoryData} dataKey="y" nameKey="x" innerRadius="48%" outerRadius="74%" paddingAngle={3} stroke="var(--chart-surface, #181715)" strokeWidth={2} isAnimationActive={false}>
        {data.map((_, i) => <Cell key={i} fill={color(i)} />)}
      </Pie>
      {tooltip}
      {legend}
    </PieChart>
  </ResponsiveContainer>;

  if (kind === "radar") return <ResponsiveContainer width="100%" height={280}>
    <RadarChart accessibilityLayer data={data} margin={{ top: 15, right: 20, bottom: 8, left: 20 }}>
      <PolarGrid stroke="var(--chart-grid, #393630)" />
      <PolarAngleAxis dataKey="x" tick={{ fill: "var(--chart-muted, #aaa39b)", fontSize: 11 }} />
      {series.map((name, i) => <Radar key={name} dataKey={`s${i}`} name={name} fill={color(i)} stroke={color(i)} strokeWidth={2} fillOpacity={0.28} dot={{ r: 2, fill: color(i) }} isAnimationActive={false} />)}
      {tooltip}
      {legend}
    </RadarChart>
  </ResponsiveContainer>;

  if (kind === "radial") return <ResponsiveContainer width="100%" height={280}>
    <RadialBarChart accessibilityLayer data={categoryData} cx="50%" cy="48%" innerRadius="24%" outerRadius="78%" startAngle={90} endAngle={-270}>
      <RadialBar dataKey="y" name={first} background={{ fill: "var(--chart-grid, #393630)" }} cornerRadius={4} isAnimationActive={false} />
      {tooltip}
      {legend}
    </RadialBarChart>
  </ResponsiveContainer>;

  const Chart = kind === "line" ? LineChart : kind === "area" ? AreaChart : BarChart;
  return <ResponsiveContainer width="100%" height={280}>
    <Chart accessibilityLayer data={data} margin={{ top: 16, right: 18, bottom: 8, left: 0 }}>
      <CartesianGrid vertical={false} stroke="var(--chart-grid, #393630)" strokeDasharray="3 4" />
      <XAxis dataKey="x" axisLine={false} tickLine={false} tickMargin={11} tick={{ fill: "var(--chart-muted, #aaa39b)", fontSize: 11 }} />
      <YAxis axisLine={false} tickLine={false} tickMargin={8} width={36} tick={{ fill: "var(--chart-muted, #aaa39b)", fontSize: 11 }} />
      {tooltip}
      {legend}
      {kind === "line" && series.map((name, i) => <Line key={name} type="monotone" dataKey={`s${i}`} name={name} stroke={color(i)} strokeWidth={2.5} dot={{ r: 2.5, fill: color(i), strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface, #181715)" }} isAnimationActive={false} />)}
      {kind === "area" && series.map((name, i) => <Area key={name} type="monotone" dataKey={`s${i}`} name={name} fill={color(i)} fillOpacity={0.2} stroke={color(i)} strokeWidth={2.5} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface, #181715)" }} isAnimationActive={false} />)}
      {kind === "bar" && series.map((name, i) => <Bar key={name} dataKey={`s${i}`} name={name} fill={color(i)} maxBarSize={44} radius={[5, 5, 0, 0]} isAnimationActive={false}>
        {byCategory && data.map((_, r) => <Cell key={r} fill={color(r)} />)}
      </Bar>)}
    </Chart>
  </ResponsiveContainer>;
}
