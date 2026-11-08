import { ChartView, chartSlashItem, createFetchResolveData, ResolveDataProvider } from "@jul-editor/plugins/chart";
import { Editor } from "@jul-editor/react";
import { EditorCanvas, type EditorCanvasProps } from "../workspace/editor-canvas.js";

/** This docs example opts into the chart subpath only. */
export function DocsChartCanvas(props: EditorCanvasProps) {
  return <ResolveDataProvider value={resolveData}><EditorCanvas {...props}>
    <Editor.Plugin renderers={{ chart: ChartView }} slashItems={[chartSlashItem]} />
  </EditorCanvas></ResolveDataProvider>;
}

const resolveData = createFetchResolveData();
