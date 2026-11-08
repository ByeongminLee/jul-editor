import { defineBlock, type Doc } from "@jul-editor/core";
import { ChartView } from "@jul-editor/plugins/chart";
import { defaultRenderers, Editor, type ViewRendererProps, type VoidRendererProps } from "@jul-editor/react";
import { useState } from "react";
import { EditorCanvas } from "../workspace/editor-canvas.js";
import "../../styles/docs-view.css";

export const customCardBlock = defineBlock({ type: "customCard", content: "none", children: "none", props: { title: "", detail: "" } });

function CardEditor({ block, selected, updateProps }: VoidRendererProps) {
  const title = String(block.props.title ?? "");
  return <aside data-docs-custom-card><strong>{title}</strong><p>{String(block.props.detail ?? "")}</p>
    {selected && <input aria-label="Card title" value={title} onChange={(event) => updateProps({ title: event.target.value })} />}
  </aside>;
}

function CardView({ block }: ViewRendererProps) {
  return <aside data-docs-custom-card><strong>{String(block.props.title ?? "")}</strong><p>{String(block.props.detail ?? "")}</p></aside>;
}

function initialDoc(locale: "en" | "ko"): Doc {
  const ko = locale === "ko";
  return { version: 1, blocks: [
    { id: "view-title", type: "heading", props: { level: 2 }, content: [{ type: "text", text: ko ? "분기 기획서" : "Quarterly brief" }] },
    { id: "view-copy", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "저장된 문서를 편집 도구 없이 같은 레이아웃으로 보여 줄 수 있습니다." : "A saved document can use the same layout without editing controls." }] },
    { id: "view-card", type: "customCard", props: { title: ko ? "디자인 검토" : "Design review", detail: ko ? "편집과 보기에서 같은 블록 키의 렌더러를 사용합니다." : "The custom renderer uses the same block key in edit and view modes." } },
    { id: "view-chart", type: "chart", props: { kind: "bar", source: { type: "inline", csv: ko ? "월,방문자\n1월,120\n2월,160\n3월,140" : "month,visitors\nJan,120\nFeb,160\nMar,140" }, x: ko ? "월" : "month", y: ko ? "방문자" : "visitors" } },
  ] };
}

export function DocsViewCanvas({ locale }: { locale: "en" | "ko" }) {
  const [docs, setDocs] = useState(() => ({ en: initialDoc("en"), ko: initialDoc("ko") }));
  const doc = docs[locale];
  const setDoc = (next: Doc) => setDocs((previous) => ({ ...previous, [locale]: next }));
  const [mode, setMode] = useState<"edit" | "view">("edit");
  return <div className="docs-live docs-view-demo" data-testid="docs-read-only-view">
    <div className="docs-live-head"><div><span className="docs-live-signal" /><strong>{locale === "ko" ? "편집과 읽기 화면" : "Edit and view"}</strong><small>{locale === "ko" ? "같은 문서 데이터와 테마를 사용합니다" : "The same document and theme, two modes"}</small></div>
      <div className="docs-live-switch" role="group" aria-label={locale === "ko" ? "문서 모드" : "Document mode"}>
        <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>{locale === "ko" ? "편집" : "Edit"}</button>
        <button type="button" aria-pressed={mode === "view"} onClick={() => setMode("view")}>{locale === "ko" ? "보기" : "View"}</button>
      </div>
    </div>
    {mode === "edit" ? <EditorCanvas value={doc} onChange={setDoc} mode="block" compact renderers={{ ...defaultRenderers, chart: ChartView, customCard: CardEditor }}>
      <Editor.Plugin blocks={[customCardBlock]} />
    </EditorCanvas> : <Editor.View doc={doc} blocks={[customCardBlock]} renderers={{ chart: ChartView, customCard: CardView }} locale={locale} className="editor-content docs-view-static" />}
  </div>;
}

export default DocsViewCanvas;
