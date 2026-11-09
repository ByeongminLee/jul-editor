import { newId } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export { ChartView } from "./chart-view.js";
export type { ChartClassNames, ChartTheme, ChartViewProps } from "./chart-view.js";
export { ChartEditor } from "./chart-editor.js";
export type { ChartKind } from "./recharts-chart.js";
export { DEFAULT_PALETTE_HEX, PALETTE_PRESETS } from "./palette.js";
export type { ColorBy } from "./palette.js";
export { ResolveDataProvider, useResolveData } from "../resolve-data-context.js";
export { createFetchResolveData, readDataSource } from "../data/resolve-data.js";
export type { DataSource, ResolveData } from "../data/resolve-data.js";

export const chartSlashItem: SlashItem = {
  type: "chart",
  title: "Chart",
  labelKey: "slashChart",
  keywords: ["chart", "graph", "bar", "line", "pie", "radar", "radial", "차트", "그래프"],
  create: () => ({ id: newId(), type: "chart", props: { source: { type: "inline", csv: "Month,Visitors\nJan,120\nFeb,160\nMar,140\nApr,220" } } }),
};
