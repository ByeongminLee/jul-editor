import type { Block, Doc } from "@jul-editor/core";
import { newId } from "@jul-editor/core";
import { Editor, defaultRenderers, restoreDraft, useAutosave, useBlockActions, useCommands, useTableState } from "@jul-editor/react";
import { useEffect, useState } from "react";

import { Code } from "../code-block.js";
import { metricSpec, MetricView } from "./customization-canvas.js";
import "../../styles/docs-feature.css";

type Locale = "en" | "ko";
export type DocsFeatureExample = "menus" | "tables" | "media" | "state" | "extension-api";

const draftKey = "docs:feature-state";
function paragraph(id: string, text: string): Block {
  return { id, type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] };
}

function initialDoc(example: DocsFeatureExample, locale: Locale): Doc {
  const ko = locale === "ko";
  if (example === "tables") return { version: 1, blocks: [
    { id: "feature-table", type: "table", props: { headerRow: true }, children: [
      { id: "feature-row-head", type: "tableRow", props: {}, children: [
        { id: "feature-cell-head-1", type: "tableCell", props: {}, content: [{ type: "text", text: ko ? "작업" : "Task" }] },
        { id: "feature-cell-head-2", type: "tableCell", props: {}, content: [{ type: "text", text: ko ? "상태" : "Status" }] },
      ] },
      { id: "feature-row-body", type: "tableRow", props: {}, children: [
        { id: "feature-cell-body-1", type: "tableCell", props: {}, content: [{ type: "text", text: ko ? "문서 작성" : "Write docs" }] },
        { id: "feature-cell-body-2", type: "tableCell", props: {}, content: [{ type: "text", text: ko ? "진행 중" : "In progress" }] },
      ] },
    ] },
    paragraph("feature-table-end", ""),
  ] };
  if (example === "media") return { version: 1, blocks: [
    { id: "feature-image", type: "image", props: { src: "/editor-canvas.svg", alt: ko ? "JulEditor 문서 삽화" : "JulEditor document illustration", width: 320, caption: ko ? "이미지를 눌러 설명과 정렬을 수정하세요." : "Select the image to edit its caption and alignment." } },
    { id: "feature-embed", type: "embed", props: { provider: "link", url: "", id: "", title: "" } },
    paragraph("feature-media-end", ""),
  ] };
  if (example === "extension-api") return { version: 1, blocks: [
    { id: "feature-metric", type: "metric", props: { label: ko ? "방문자" : "Visitors", value: 120 } },
    paragraph("feature-extension-end", ""),
  ] };
  if (example === "state") return { version: 1, blocks: [
    paragraph("feature-state-line", ko ? "여기에 입력하면 브라우저에 초안이 저장됩니다." : "Edit this line to save a draft in this browser."),
  ] };
  return { version: 1, blocks: [
    paragraph("feature-menu-line", ko ? "문장 끝에 # 또는 @를 입력하세요. 텍스트를 선택하면 툴바가 열립니다." : "Type # or @ at the end. Select text to open the toolbar."),
    paragraph("feature-menu-empty", ""),
  ] };
}

function menuPosition(rect: DOMRect | null) {
  return rect ? { left: Math.max(8, Math.min(rect.left, window.innerWidth - 258)), top: Math.max(8, Math.min(rect.bottom + 7, window.innerHeight - 280)) } : undefined;
}

function Menus({ locale }: { locale: Locale }) {
  const ko = locale === "ko";
  const tags = [
    { id: "research", label: ko ? "연구" : "research" },
    { id: "design", label: ko ? "디자인" : "design" },
    { id: "idea", label: ko ? "아이디어" : "idea" },
  ];
  const searchTags = (query: string) => tags.filter((tag) => tag.label.includes(query.toLowerCase()));
  const searchMention = async (query: string, kind: "user" | "post") => (kind === "user"
    ? [{ id: "lee", kind: "user" as const, label: ko ? "이민" : "Lee" }]
    : [{ id: "guide", kind: "post" as const, label: ko ? "안내 글" : "Guide" }]).filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Editor.SlashMenu>{({ items, activeIndex, rect, getListboxProps, getOptionProps }) => <div {...getListboxProps()} aria-label={ko ? "블록 명령" : "Block commands"} className="slash-menu" style={menuPosition(rect)}>
      <div className="slash-menu-label">{ko ? "블록 삽입" : "INSERT A BLOCK"}</div>
      {items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>{item.title}</div>)}
      {!items.length && <div className="slash-empty">{ko ? "일치하는 블록 없음" : "No matching blocks"}</div>}
    </div>}</Editor.SlashMenu>
    <Editor.TagMenu onSearch={searchTags}>{({ items, activeIndex, rect, getListboxProps, getOptionProps }) => <div {...getListboxProps()} aria-label={ko ? "태그" : "Tags"} className="slash-menu" style={menuPosition(rect)}>
      <div className="slash-menu-label">{ko ? "태그" : "TAGS"}</div>
      {items.map((tag, index) => <div key={tag.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>#{tag.label}</div>)}
      {!items.length && <div className="slash-empty">{ko ? "일치하는 태그가 없습니다" : "No matching tags"}</div>}
    </div>}</Editor.TagMenu>
    <Editor.MentionMenu onSearch={searchMention}>{({ items, activeIndex, kindLabel, rect, getListboxProps, getOptionProps }) => <div {...getListboxProps()} aria-label={kindLabel} className="slash-menu" style={menuPosition(rect)}>
      <div className="slash-menu-label">{kindLabel} · {ko ? "Tab으로 전환" : "Tab to switch"}</div>
      {items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>@{item.label}</div>)}
    </div>}</Editor.MentionMenu>
    <Editor.BubbleMenu>{({ rect }) => <div className="bubble-tools" data-jul-editor-keep-selection="" style={{ left: Math.max(8, rect.left), top: Math.max(8, rect.top - 42) }}>
      <Editor.Bold aria-label={ko ? "굵게" : "Bold"}>B</Editor.Bold>
      <Editor.Italic aria-label={ko ? "기울임" : "Italic"}>I</Editor.Italic>
      <Editor.Underline aria-label={ko ? "밑줄" : "Underline"}>U</Editor.Underline>
    </div>}</Editor.BubbleMenu>
  </>;
}

function TablePosition({ locale }: { locale: Locale }) {
  const table = useTableState();
  return <output className="docs-feature-context" aria-live="polite">{table.inTable
    ? locale === "ko" ? `${table.row + 1}행 ${table.col + 1}열 · ${table.rows}×${table.cols}` : `Row ${table.row + 1}, column ${table.col + 1} · ${table.rows}×${table.cols}`
    : locale === "ko" ? "셀을 눌러 표를 편집하세요" : "Select a cell to edit the table"}</output>;
}

function SaveStatus({ locale }: { locale: Locale }) {
  const { status, flush } = useAutosave({ key: draftKey, localDebounceMs: 300, warnOnUnload: false });
  const label = status === "saved-local" || status === "saved" ? locale === "ko" ? "브라우저에 저장됨" : "Saved in browser"
    : status === "dirty" || status === "saving" ? locale === "ko" ? "저장 중…" : "Saving…"
      : status === "local-error" ? locale === "ko" ? "저장 실패" : "Save failed"
        : locale === "ko" ? "저장할 변경 사항 없음" : "No changes to save";
  return <div className="docs-feature-save"><output data-testid="docs-feature-save-status" aria-live="polite">{label}</output><button type="button" onClick={flush}>{locale === "ko" ? "지금 저장" : "Save now"}</button></div>;
}

function SchemaActions({ locale }: { locale: Locale }) {
  const actions = useBlockActions("feature-metric");
  const commands = useCommands();
  return <div className="docs-feature-actions">
    <button type="button" onClick={actions.duplicate}>{locale === "ko" ? "블록 복제" : "Duplicate block"}</button>
    <button type="button" onClick={() => commands.insertBlock({ id: newId(), type: "metric", props: { label: locale === "ko" ? "방문자" : "Visitors", value: 120 } })}>{locale === "ko" ? "새 지표 삽입" : "Insert metric"}</button>
    <Editor.Undo>{locale === "ko" ? "실행 취소" : "Undo"}</Editor.Undo>
  </div>;
}

/** Interactive, dependency-light previews for the component guides. */
export function DocsFeatureCanvas({ example, locale }: { example: DocsFeatureExample; locale: Locale }) {
  const ko = locale === "ko";
  const [doc, setDoc] = useState<Doc>(() => example === "state" ? restoreDraft(draftKey)?.doc ?? initialDoc(example, locale) : initialDoc(example, locale));
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited && example !== "state") setDoc(initialDoc(example, locale)); }, [edited, example, locale]);
  const intro: Record<DocsFeatureExample, [string, string]> = {
    menus: ["Type / in the empty line, # for tags, or select text for formatting.", "빈 줄에 /, 문장 끝에 #을 입력하거나 텍스트를 선택하세요."],
    tables: ["Edit a cell, then use the table commands above it.", "셀을 편집하고 위의 표 명령을 사용하세요."],
    media: ["Select the image, then paste a link into the empty embed.", "이미지를 선택하고 빈 임베드에 링크를 붙여넣으세요."],
    state: ["Edits save locally and survive a page reload. Switch site language to change editor labels.", "변경 내용은 브라우저에 저장됩니다. 사이트 언어를 바꿔 에디터 레이블을 확인하세요."],
    "extension-api": ["Change the metric, duplicate it, or insert another. Every action changes the Doc.", "지표를 바꾸거나 복제·삽입해 보세요. 모든 동작이 문서에 기록됩니다."],
  };
  return <div className="docs-live docs-feature" data-testid={`docs-feature-${example}`}>
    <div className="docs-live-head"><div><span className="docs-live-signal" /><strong>{ko ? "실제 에디터" : "Live editor"}</strong><small>{intro[example][ko ? 1 : 0]}</small></div></div>
    <Editor value={doc} onChange={(next) => { setEdited(true); setDoc(next); }} locale={locale} labels={example === "state" ? { toolbarBold: ko ? "강조" : "Emphasize" } : undefined} renderers={example === "media" ? defaultRenderers : undefined} className="editor-instance" placeholder={ko ? "블록을 추가하려면 /를 입력하세요…" : "Type / for a block"}>
      {example === "extension-api" && <Editor.Plugin blocks={[metricSpec]} renderers={{ metric: MetricView }} />}
      {example === "tables" && <Editor.Toolbar className="docs-demo-toolbar docs-feature-toolbar" aria-label={ko ? "표 명령" : "Table commands"}>
        <Editor.InsertTable rows={2} cols={2} /><Editor.AddRowAfter /><Editor.AddColumnAfter /><Editor.ToggleHeaderRow /><Editor.DeleteRow /><Editor.DeleteColumn /><Editor.Undo />
        <TablePosition locale={locale} />
      </Editor.Toolbar>}
      {example === "state" && <Editor.Toolbar className="docs-demo-toolbar docs-feature-toolbar" aria-label={ko ? "서식" : "Formatting"}><Editor.Bold /><Editor.Undo /><Editor.Redo /></Editor.Toolbar>}
      {example === "extension-api" && <SchemaActions locale={locale} />}
      <Editor.Content className="editor-content docs-demo-content docs-feature-content" />
      {example === "menus" && <Menus locale={locale} />}
      {example === "state" && <SaveStatus locale={locale} />}
    </Editor>
    {example === "extension-api" && <details className="docs-model"><summary>{ko ? "문서 JSON 보기" : "View document JSON"}</summary><Code title="json" locale={locale} testId="docs-feature-json">{JSON.stringify(doc, null, 2)}</Code></details>}
  </div>;
}
