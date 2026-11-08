// @jul-editor/plugins: chart/diagram/dataTable block views + data utilities,
// Servers that
// only need CSV parsing/range filtering (no React/recharts/mermaid) should
// import "@jul-editor/plugins/data" instead of this entry.
export * from "./data";
export * from "./code";
export * from "./code-workspace";
export * from "./view-props.js";
export * from "./resolve-data-context.js";
export * from "./renderers.js";
export * from "./slash.js";
export { ChartView } from "./chart/chart-view.js";
export { ChartEditor } from "./chart/chart-editor.js";
export type { ChartKind } from "./chart/recharts-chart.js";
export { DiagramView } from "./diagram-view.js";
export type { DiagramViewProps, DiagramViewClassNames } from "./diagram-view.js";
export { DataTableView } from "./data-table-view.js";
export type { DataTableViewProps, DataTableViewClassNames } from "./data-table-view.js";
// Notion-style block bundles (spread into <Editor.Plugin />). The rest of each
// plugin (comments, collaboration, links, pages, diff ...) is subpath-only.
export { calloutPlugin } from "./callout";
export { togglePlugin } from "./toggle";
export { tocPlugin } from "./toc";
export { columnsPlugin } from "./columns";
