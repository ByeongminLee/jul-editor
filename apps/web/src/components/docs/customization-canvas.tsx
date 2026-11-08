import { defineBlock, newId, type Doc } from "@jul-editor/core";
import { Editor, useCommands, type VoidRendererProps } from "@jul-editor/react";
import { useEffect, useState } from "react";

import { Code } from "../code-block.js";
import { useSiteSettings } from "../../app/site-settings.js";

export const metricSpec = defineBlock({ type: "metric", content: "none", children: "none", props: { label: "Visitors", value: 120 } });
const metricBlock = (ko: boolean) => ({ id: newId(), type: "metric", props: { label: ko ? "방문자" : "Visitors", value: 120 } });
export function MetricView({ block, updateProps }: VoidRendererProps) {
  const { t } = useSiteSettings();
  const value = typeof block.props.value === "number" ? block.props.value : 120;
  return <div className="docs-metric" data-testid="docs-metric">
    <label><span>{t("Label", "이름")}</span><input aria-label={t("Metric label", "지표 이름")} value={String(block.props.label ?? t("Visitors", "방문자"))} onChange={(e) => updateProps({ label: e.target.value })} /></label>
    <strong>{value}</strong>
    <button type="button" onClick={() => updateProps({ value: value + 1 })}>+1</button>
  </div>;
}
function InsertMetric({ ko }: { ko: boolean }) {
  const commands = useCommands();
  return <button type="button" onClick={() => commands.insertBlock(metricBlock(ko))}>{ko ? "지표 블록 삽입" : "Insert metric block"}</button>;
}
export function DocsCustomizationCanvas({ locale, example }: { locale: "en" | "ko"; example: "typography" | "toolbar" | "custom-blocks" }) {
  const ko = locale === "ko";
  const [font, setFont] = useState("sans-serif");
  const [size, setSize] = useState(16);
  const [spacing, setSpacing] = useState(1.7);
  const [full, setFull] = useState(true);
  const [edited, setEdited] = useState(false);
  const initialDoc = (): Doc => ({ version: 1, blocks: [
    { id: "custom-heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: ko ? "내 제품의 에디터" : "An editor for your product" }] },
    { id: "custom-body", type: "paragraph", props: {}, content: [{ type: "text", text: ko ? "텍스트를 선택해 서식을 바꾸고 설정을 조절해 보세요." : "Select text to format it, then adjust the settings." }] },
    ...(example === "custom-blocks" ? [metricBlock(ko)] : []),
    { id: "custom-empty", type: "paragraph", props: {}, content: [] },
  ] });
  const [doc, setDoc] = useState<Doc>(initialDoc);
  useEffect(() => { if (!edited) setDoc(initialDoc()); }, [locale, example, edited]);
  return <div className="docs-live docs-customization" data-testid={`docs-${example}`}>
    <div className="docs-settings">
      {example === "typography" ? <>
        <label>{ko ? "글꼴" : "Font"}<select aria-label={ko ? "글꼴" : "Font family"} value={font} onChange={(e) => setFont(e.target.value)}><option value="sans-serif">{ko ? "산세리프" : "Sans serif"}</option><option value="serif">{ko ? "세리프" : "Serif"}</option><option value="monospace">{ko ? "고정폭" : "Monospace"}</option></select></label>
        <label>{ko ? "크기" : "Size"} · {size}px<input aria-label={ko ? "글자 크기" : "Font size"} type="range" min="12" max="24" value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
        <label>{ko ? "줄 간격" : "Line height"} · {spacing}<input aria-label={ko ? "줄 간격" : "Line height"} type="range" min="1.2" max="2.2" step="0.1" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} /></label>
      </> : example === "toolbar" ? <label><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />{ko ? "확장 툴바 표시" : "Show extended toolbar"}</label> : <span>{ko ? "블록 안의 UI를 조작하거나 새 지표를 삽입하세요. 실행 취소도 가능합니다." : "Use the component inside the block, insert another, and undo changes."}</span>}
    </div>
    <div style={{ fontFamily: font, fontSize: size, lineHeight: spacing }}>
      <Editor value={doc} onChange={(next) => { setEdited(true); setDoc(next); }} locale={locale} className="editor-instance" placeholder={ko ? "블록을 추가하려면 /를 입력하세요…" : "Type / to insert a block"}>
        <Editor.Plugin blocks={[metricSpec]} renderers={{ metric: MetricView }} />
        <Editor.Toolbar className="docs-demo-toolbar">
          <Editor.Bold /><Editor.Italic />
          {(full || example !== "toolbar") && <><Editor.Underline /><Editor.Strike /><Editor.Heading level={2}>H2</Editor.Heading><Editor.BulletList /></>}
          <Editor.Undo /><Editor.Redo />
          {example === "custom-blocks" && <InsertMetric ko={ko} />}
        </Editor.Toolbar>
        <Editor.Content className="docs-demo-content" />
        <Editor.SlashMenu>{({ items, rect, getListboxProps, getOptionProps }) => <div {...getListboxProps()} className="slash-menu" style={rect ? { left: rect.left, top: rect.bottom + 6 } : undefined}>{items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option">{item.title}</div>)}</div>}</Editor.SlashMenu>
      </Editor>
    </div>
    {example === "custom-blocks" && <details className="docs-model"><summary>{ko ? "저장되는 JSON 보기" : "View saved JSON"}</summary><Code title="json" locale={locale} testId="docs-custom-json">{JSON.stringify(doc, null, 2)}</Code></details>}
  </div>;
}
