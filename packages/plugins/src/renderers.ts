import type { ReactNode } from "react";
import { ChartView } from "./chart/chart-view.js";
import { DataTableView } from "./data-table-view.js";
import { DiagramView } from "./diagram-view.js";
import { PageBreakView } from "./pages/paged-editor.js";
import { BookmarkView } from "./links/bookmark-view.js";
import { IframeView } from "./links/iframe-view.js";
import { CalloutView } from "./callout/callout-view.js";
import { ToggleView } from "./toggle/toggle-view.js";
import { TocView } from "./toc/toc-view.js";
import type { PluginViewProps } from "./view-props.js";

/** `<Editor renderers={pluginRenderers}>` -- wires chart/diagram/dataTable's
 * void blocks (defined in packages/core/src/model/builtins.ts) to their
 * headless React views. */
export const pluginRenderers: Record<string, (props: PluginViewProps) => ReactNode> = {
  chart: ChartView,
  diagram: DiagramView,
  dataTable: DataTableView,
  pageBreak: PageBreakView,
  bookmark: BookmarkView,
  iframe: IframeView,
  callout: CalloutView,
  toggle: ToggleView,
  toc: TocView,
};
