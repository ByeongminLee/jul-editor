import { lazy, Suspense, useState, type ReactElement, type ReactNode } from "react";
import { Code } from "../components/code-block.js";
import { DocsStyleAnatomy } from "../components/docs/style-anatomy.js";
import { DocsLive, DocsLiveDiff, type DocsChartKind } from "../components/docs/live.js";
import { useSiteSettings } from "../app/site-settings.js";

const Customization = lazy(() => import("../components/docs/customization-canvas.js").then((m) => ({ default: m.DocsCustomizationCanvas })));
const Feature = lazy(() => import("../components/docs/feature-canvas.js").then((m) => ({ default: m.DocsFeatureCanvas })));
const Plugin = lazy(() => import("../components/docs/plugin-canvas.js").then((m) => ({ default: m.DocsPluginCanvas })));
const ChartCustomization = lazy(() => import("../components/docs/chart-customization-canvas.js").then((m) => ({ default: m.DocsChartCustomizationCanvas })));
const CodeWorkspace = lazy(() => import("../components/docs/code-workspace-canvas.js").then((m) => ({ default: m.DocsCodeWorkspaceCanvas })));
const MenuCustomization = lazy(() => import("../components/docs/menu-customization-canvas.js").then((m) => ({ default: m.DocsMenuCustomizationCanvas })));
const View = lazy(() => import("../components/docs/view-canvas.js").then((m) => ({ default: m.DocsViewCanvas })));
const AboutCharts = lazy(() => import("../components/about/about-charts.js").then((m) => ({ default: m.DocsAboutCharts })));
const StyleSlots = lazy(() => import("../components/docs/style-slots-canvas.js").then((m) => ({ default: m.DocsStyleSlotsCanvas })));

export function Note({ children }: { children: ReactNode }) {
  return <aside className="mdx-doc-note">{children}</aside>;
}

export function MdxPre({ children }: { children?: ReactNode }) {
  const { locale } = useSiteSettings();
  const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const title = code?.props?.className?.replace("language-", "") ?? "code";
  const language = title.includes(".") ? title.slice(title.lastIndexOf(".") + 1) : title;
  return <Code title={title} language={language} locale={locale}>{String(code?.props?.children ?? "")}</Code>;
}

export function Demo({ example }: { example: "composition" | "formats" | "tags" | "typography" | "toolbar" | "style-slots" | "custom-blocks" | "menus" | "menus-custom" | "view" | "tables" | "media" | "state" | "extension-api" | "diagram" | "data-table" | "code-blocks" | "code-workspace" | "code-workspace-ide" | "chart-customization" | "diff" }) {
  const { locale } = useSiteSettings();
  if (example === "diff") return <DocsLiveDiff locale={locale} />;
  if (example === "composition" || example === "formats" || example === "tags") return <DocsLive example={example} locale={locale} chartKind="bar" />;
  return <Suspense fallback={<div className="docs-live-loading">{locale === "ko" ? "예제 불러오는 중…" : "Loading example…"}</div>}>
    {example === "typography" || example === "toolbar" || example === "custom-blocks"
      ? <Customization example={example} locale={locale} />
      : example === "style-slots" ? <StyleSlots locale={locale} />
        : example === "chart-customization" ? <ChartCustomization locale={locale} />
        : example === "code-workspace" || example === "code-workspace-ide" ? <CodeWorkspace locale={locale} variant={example === "code-workspace-ide" ? "ide" : "basic"} />
          : example === "menus-custom" ? <MenuCustomization locale={locale} />
            : example === "view" ? <View locale={locale} />
        : example === "diagram" || example === "data-table" || example === "code-blocks"
          ? <Plugin example={example} locale={locale} />
          : <Feature example={example} locale={locale} />}
  </Suspense>;
}

const chartKinds: { kind: DocsChartKind; en: string; ko: string }[] = [
  { kind: "bar", en: "Compare categories", ko: "범주별 값을 비교" },
  { kind: "line", en: "Track change", ko: "시간에 따른 변화" },
  { kind: "area", en: "Show volume", ko: "시간에 따른 규모" },
  { kind: "pie", en: "Parts of a whole", ko: "전체의 구성" },
  { kind: "radar", en: "Several dimensions", ko: "여러 지표" },
  { kind: "radial", en: "A circular measure", ko: "원형 지표" },
];

export function ChartKinds() {
  const { locale } = useSiteSettings();
  const [kind, setKind] = useState<DocsChartKind>("bar");
  return <>
    <div className="docs-chart-grid" role="group" aria-label={locale === "ko" ? "차트 종류 예시" : "Chart type examples"}>
      {chartKinds.map((item) => <button key={item.kind} type="button" aria-pressed={kind === item.kind} onClick={() => setKind(item.kind)}><strong>{item.kind}</strong><span>{item[locale]}</span></button>)}
    </div>
    <DocsLive key={kind} example="charts" locale={locale} chartKind={kind} />
  </>;
}

export const mdxComponents = { Note, Demo, ChartKinds, DocsStyleAnatomy, AboutCharts, pre: MdxPre };
