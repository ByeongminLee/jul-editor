import type { Doc } from "@jul-editor/core";
import { ChartView, type ChartKind } from "@jul-editor/plugins/chart";
import { Editor, type VoidRendererProps } from "@jul-editor/react";
import { createContext, useContext, useEffect, useState } from "react";
import { EditorCanvas } from "../workspace/editor-canvas.js";
import { useSiteSettings } from "../../app/site-settings.js";
import "../../styles/docs-chart-customization.css";

const KINDS: ChartKind[] = ["bar", "line", "area", "pie", "radar", "radial"];
const chartPalettes = {
  brand: ["#ef9850", "#70a4bd", "#b294d0", "#78bba0", "#d2bd78", "#dd858e"],
  ocean: ["#3c94b7", "#57b9aa", "#7e9cdb", "#a7c86e", "#dfae72", "#d981a4"],
  violet: ["#9b77c9", "#d47eaf", "#7f9bdf", "#c7a169", "#86bb9f", "#d58983"],
} as const;
const ChartPaletteContext = createContext<keyof typeof chartPalettes>("brand");
const sourceFor = (locale: "en" | "ko") => ({ type: "inline" as const, csv: locale === "ko" ? "주,가입\n1주,40\n2주,65\n3주,52\n4주,84\n5주,72\n6주,96" : "Week,Signups\nW1,40\nW2,65\nW3,52\nW4,84\nW5,72\nW6,96" });
const initialDoc = (locale: "en" | "ko"): Doc => ({ version: 1, blocks: [
  { id: "docs-custom-chart", type: "chart", props: { kind: "line", source: sourceFor(locale), x: locale === "ko" ? "주" : "Week", y: locale === "ko" ? "가입" : "Signups" } },
  { id: "docs-custom-chart-end", type: "paragraph", props: {}, content: [] },
] });

function BrandedChart(props: VoidRendererProps) {
  const { t } = useSiteSettings();
  const palette = useContext(ChartPaletteContext);
  const kind = KINDS.find((item) => item === props.block.props.kind) ?? "bar";
  return <section className="docs-branded-chart">
    <ChartView {...props} selected={false} theme={{ series: chartPalettes[palette] }} />
    {props.selected && <label className="docs-chart-type-control">
      {t("Chart type", "차트 종류")}
      <select value={kind} onChange={(event) => props.updateProps({ kind: event.target.value })}>
        {KINDS.map((item) => <option key={item} value={item}>{t(item, ({ bar: "막대", line: "꺾은선", area: "영역", pie: "원형", radar: "레이더", radial: "방사형" } as Record<ChartKind, string>)[item])}</option>)}
      </select>
    </label>}
  </section>;
}

export function DocsChartCustomizationCanvas({ locale }: { locale: "en" | "ko" }) {
  const [palette, setPalette] = useState<"brand" | "ocean" | "violet">("brand");
  const [doc, setDoc] = useState<Doc>(() => initialDoc(locale));
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited) setDoc(initialDoc(locale)); }, [locale, edited]);
  const ko = locale === "ko";
  return <div className="docs-live docs-chart-customization" data-palette={palette}>
    <div className="docs-live-head"><strong>{ko ? "차트를 선택해 종류를 바꾸세요" : "Select the chart to change its type"}</strong></div>
    <div className="docs-chart-palette" role="group" aria-label={ko ? "차트 색상" : "Chart palette"}>
      {(["brand", "ocean", "violet"] as const).map((name) => <button key={name} type="button" data-swatch={name} aria-label={`${name === "brand" ? (ko ? "브랜드" : "Brand") : name === "ocean" ? (ko ? "바다" : "Ocean") : (ko ? "보라" : "Violet")} ${ko ? "색상" : "palette"}`} aria-pressed={palette === name} onClick={() => setPalette(name)}>
        <span aria-hidden="true" />{name === "brand" ? (ko ? "브랜드" : "Brand") : name === "ocean" ? (ko ? "바다" : "Ocean") : (ko ? "보라" : "Violet")}
      </button>)}
    </div>
    <div className="docs-live-editor">
      <ChartPaletteContext.Provider value={palette}><EditorCanvas value={doc} onChange={(next) => { setEdited(true); setDoc(next); }} mode="block" compact showDrag={false}>
        <Editor.Plugin renderers={{ chart: BrandedChart }} />
      </EditorCanvas></ChartPaletteContext.Provider>
    </div>
  </div>;
}
