import { newId } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export { DataTableView } from "../data-table-view.js";
export type { DataTableViewProps, DataTableViewClassNames } from "../data-table-view.js";
export { ResolveDataProvider, useResolveData } from "../resolve-data-context.js";
export { createFetchResolveData, readDataSource } from "../data/resolve-data.js";
export type { DataSource, ResolveData } from "../data/resolve-data.js";

export const dataTableSlashItem: SlashItem = {
  type: "dataTable",
  title: "Data table",
  keywords: ["table", "data", "csv", "표", "데이터", "표 데이터"],
  create: () => ({ id: newId(), type: "dataTable", props: { source: { type: "inline", csv: "Name,Role\nAlex,Editor\nSam,Reviewer" } } }),
};
