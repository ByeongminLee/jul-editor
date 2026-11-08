import type { Doc } from "@jul-editor/core";
import { toHTML, toMarkdown } from "@jul-editor/core/serde";
import { DiffView, useDiff } from "@jul-editor/plugins/diff";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Code } from "../code-block.js";
import { EditorCanvas } from "../workspace/editor-canvas.js";

const DocsChartCanvas = lazy(() => import("./chart-canvas.js").then((module) => ({ default: module.DocsChartCanvas })));
const DocsTagCanvas = lazy(() => import("./tag-canvas.js").then((module) => ({ default: module.DocsTagCanvas })));

export type DocsExample = "composition" | "formats" | "charts" | "tags";
export type DocsChartKind = "bar" | "line" | "area" | "pie" | "radar" | "radial";
type Locale = "en" | "ko";

export function WhenNearViewport({ children, locale }: { children: ReactNode; locale: Locale }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (host.current?.closest("article")?.id === location.hash.slice(1)) { setReady(true); return; }
    if (!host.current || typeof IntersectionObserver === "undefined") { setReady(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setReady(true); observer.disconnect(); }
    }, { rootMargin: "400px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host}>{ready ? children : <div className="docs-live-loading">{locale === "ko" ? "스크롤하면 예제가 열립니다" : "The example loads as you scroll"}</div>}</div>;
}

function exampleDoc(example: DocsExample, locale: Locale, chartKind: DocsChartKind): Doc {
  const ko = locale === "ko";
  const koreanChartNames: Record<DocsChartKind, string> = { bar: "막대", line: "꺾은선", area: "영역", pie: "원형", radar: "레이더", radial: "방사형" };
  if (example === "charts") return { version: 1, blocks: [
    { id: "docs-chart-title", type: "heading", props: { level: 2 }, content: [{ type: "text", text: ko ? `${koreanChartNames[chartKind]} 차트` : `${chartKind.charAt(0).toUpperCase() + chartKind.slice(1)} chart` }] },
    { id: "docs-chart", type: "chart", props: { kind: chartKind, source: { type: "inline", csv: ko ? "월,방문자\n1월,120\n2월,160\n3월,140\n4월,220\n5월,190\n6월,260" : "Month,Visitors\nJan,120\nFeb,160\nMar,140\nApr,220\nMay,190\nJun,260" }, x: ko ? "월" : "Month", y: ko ? "방문자" : "Visitors" } },
  ] };
  if (example === "tags") return { version: 1, blocks: [
    { id: "docs-tags-title", type: "heading", props: { level: 2 }, content: [{ type: "text", text: ko ? "태그로 생각 정리하기" : "Organize an idea with tags" }] },
    { id: "docs-tags-line", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "이 문장 끝에 #을 입력해 태그를 추가해 보세요. " : "Type # at the end of this sentence to add a tag. " }] },
  ] };
  return { version: 1, blocks: [
    { id: "docs-live-title", type: "heading", props: { level: 2 }, content: [{ type: "text", text: ko ? "편집 가능한 초안" : "An editable draft" }] },
    { id: "docs-live-body", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "이 문장을 고쳐 보세요. 블록을 옮기거나 아래에서 새 블록을 추가할 수 있습니다." : "Edit this sentence. Move its block, or add another below." }] },
    { id: "docs-live-list", type: "bulletListItem", props: {}, content: [{ type: "text", text: example === "formats" ? (ko ? "내용을 바꾸면 아래 Markdown과 HTML 출력도 바뀝니다." : "The Markdown and HTML output below updates with every edit.") : (ko ? "블록을 추가하거나 서식을 바꿔 보세요." : "Add a block or change the formatting.") }] },
    { id: "docs-live-empty", type: "paragraph", props: {}, content: [] },
  ] };
}

export function DocsLive({ example, locale, chartKind }: { example: DocsExample; locale: Locale; chartKind: DocsChartKind }) {
  const [doc, setDoc] = useState<Doc>(() => exampleDoc(example, locale, chartKind));
  const [edited, setEdited] = useState(false);
  const [mode, setMode] = useState<"block" | "rich">("block");
  const [format, setFormat] = useState<"markdown" | "html">("markdown");
  const output = useMemo(() => format === "html" ? toHTML(doc) : toMarkdown(doc).markdown, [doc, format]);
  useEffect(() => { if (!edited) setDoc(exampleDoc(example, locale, chartKind)); }, [example, locale, chartKind, edited]);
  const onChange = (next: Doc) => { setEdited(true); setDoc(next); };
  const label = example === "charts" ? (locale === "ko" ? "차트 블록 예제" : "Chart block example")
    : example === "tags" ? (locale === "ko" ? "태그 에디터 예제" : "Tag editor example")
    : example === "formats" ? (locale === "ko" ? "실시간 형식 미리보기" : "Live format preview")
    : (locale === "ko" ? "블록 에디터 예제" : "Block editor example");

  return <div className={`docs-live docs-live-${example}`} aria-label={label}>
    <div className="docs-live-head"><div><span className="docs-live-signal" /> <strong>{label}</strong><small>{locale === "ko" ? "아래 문서에서 직접 편집해 보세요" : "Edit the document below"}</small></div>
      {example === "composition" && <div className="docs-live-switch" role="group" aria-label={locale === "ko" ? "에디터 구성" : "Editor composition"}>
        <button type="button" aria-pressed={mode === "block"} onClick={() => setMode("block")}>{locale === "ko" ? "블록" : "Blocks"}</button>
        <button type="button" aria-pressed={mode === "rich"} onClick={() => setMode("rich")}>{locale === "ko" ? "리치 텍스트" : "Rich text"}</button>
      </div>}
    </div>
    <WhenNearViewport locale={locale}><div className="docs-live-editor">
      {example === "charts" ? <Suspense fallback={<div className="docs-live-loading">{locale === "ko" ? "예제 불러오는 중…" : "Loading example…"}</div>}><DocsChartCanvas value={doc} onChange={onChange} mode="block" compact /></Suspense>
        : example === "tags" ? <Suspense fallback={<div className="docs-live-loading">{locale === "ko" ? "예제 불러오는 중…" : "Loading example…"}</div>}><DocsTagCanvas value={doc} onChange={onChange} mode="block" compact /></Suspense>
          : <EditorCanvas value={doc} onChange={onChange} mode={mode} compact />}
    </div></WhenNearViewport>
    {(example === "formats" || example === "tags") && <div className="docs-live-output">
      <div className="docs-live-output-head"><span>{locale === "ko" ? "문서 출력" : "DOCUMENT OUTPUT"}</span><div role="group" aria-label={locale === "ko" ? "출력 형식" : "Output format"}>
        <button type="button" aria-pressed={format === "markdown"} onClick={() => setFormat("markdown")}>Markdown</button>
        <button type="button" aria-pressed={format === "html"} onClick={() => setFormat("html")}>HTML</button>
      </div></div>
      <Code title={format} locale={locale} testId="docs-live-output">{output}</Code>
    </div>}
    {example === "charts" && <div className="docs-live-foot">{locale === "ko" ? "차트를 선택하면 종류, 열, 데이터 에디터가 열립니다." : "Select the chart to edit its type, columns, and data."}</div>}
    {example === "tags" && <div className="docs-live-foot">{locale === "ko" ? "#을 입력하면 태그 추천 목록이 열립니다." : "Type # to open tag suggestions."}</div>}
  </div>;
}

function diffExample(locale: Locale): [Doc, Doc] {
  const ko = locale === "ko";
  const title = { id: "docs-diff-title", type: "heading", props: { level: 2 }, content: [{ type: "text" as const, text: ko ? "설치 안내" : "Setup guide" }] };
  return [
    { version: 1, blocks: [title, { id: "docs-diff-line", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "워크스페이스를 설치합니다." : "Install the workspace." }] }] },
    { version: 1, blocks: [title, { id: "docs-diff-line", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "Node.js 24로 워크스페이스를 설치합니다." : "Install the workspace with Node.js 24." }] }, { id: "docs-diff-extra", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "pnpm 실행 명령을 추가합니다." : "Add the pnpm run command." }] }] },
  ];
}

export function DocsLiveDiff({ locale }: { locale: Locale }) {
  const [before, after] = useMemo(() => diffExample(locale), [locale]);
  const { stats } = useDiff(before, after);
  return <div className="docs-live docs-live-diff">
    <div className="docs-live-head"><div><span className="docs-live-signal" /> <strong>{locale === "ko" ? "문서 비교 예제" : "Document diff example"}</strong><small>{locale === "ko" ? "같은 블록 ID를 가진 두 문서" : "Two documents with stable block IDs"}</small></div></div>
    <div className="docs-live-diff-stats"><span>+{stats.inserted} {locale === "ko" ? "추가" : "inserted"}</span><span>~{stats.modified} {locale === "ko" ? "수정" : "modified"}</span></div>
    <DiffView before={before} after={after} mode="full" className="docs-live-diff-view" />
  </div>;
}
