import type { Doc } from "@jul-editor/core";
import { ChartView } from "@jul-editor/plugins/chart";
import { Editor, type ViewRendererProps } from "@jul-editor/react";
import { engineColorByName } from "../../lib/about-engines.js";
import { AboutEngineLegend } from "./about-engine-legend.js";
import { useSiteSettings } from "../../app/site-settings.js";

const bundle = [
  ["JulEditor", 70.50], ["Lexical", 67.54], ["Quill", 58.57], ["ProseMirror", 55.41],
] as const;
const roundtrip = [
  ["JulEditor", 0.261], ["Lexical", 0.401], ["Quill", 0.051], ["ProseMirror", 0.187],
] as const;

// Row order of both charts, so the palette (one fixed color per engine) lines up with the bars.
const ORDER = bundle.map(([name]) => name);
const PALETTE = ORDER.map((name) => engineColorByName(name));

function BenchChart(props: ViewRendererProps) {
  return <ChartView {...props} className={{ container: "about-bench-plot" }} theme={{
    series: PALETTE,
    grid: "var(--line)", muted: "var(--muted)", tooltipBackground: "var(--surface)", tooltipForeground: "var(--text)",
  }} />;
}

function chartDoc(id: string, rows: readonly (readonly [string, number])[], locale: "en" | "ko", unit: string): Doc {
  const category = locale === "ko" ? "엔진" : "Engine";
  return { version: 1, blocks: [{ id, type: "chart", props: {
    kind: "bar", source: { type: "inline", csv: `${category},${unit}\n${rows.map(([name, value]) => `${name},${value}`).join("\n")}` },
    x: category, y: unit,
    // One color per engine (see lib/about-engines.ts). Needs the chart block's colorBy/palette props.
    colorBy: "category", palette: [...PALETTE],
  } }] };
}

export function DocsAboutCharts() {
  const { locale, t } = useSiteSettings();
  return <div data-testid="about-charts"><AboutEngineLegend /><div className="about-bench-charts">
    <section><h3>{t("Edit entry bundle, gzip KiB", "편집 엔트리 번들, gzip KiB")}</h3><p className="about-chart-note">{t("Lower is smaller.", "낮을수록 작습니다.")}</p><Editor.View doc={chartDoc("about-bundle-chart", bundle, locale, "KiB")} renderers={{ chart: BenchChart }} locale={locale} className="editor-content about-chart-editor" /></section>
    <section><h3>{t("500 paragraphs, JSON parse + stringify, ms", "500문단, JSON 파싱+직렬화, ms")}</h3><p className="about-chart-note">{t("Lower is faster.", "낮을수록 빠릅니다.")}</p><Editor.View doc={chartDoc("about-json-chart", roundtrip, locale, "ms")} renderers={{ chart: BenchChart }} locale={locale} className="editor-content about-chart-editor" /></section>
  </div></div>;
}

export default DocsAboutCharts;
