import { ChartView, chartSlashItem, createFetchResolveData, ResolveDataProvider } from "@jul-editor/plugins/chart";
import { createLowlightHighlighter, pluginCodeLanguages } from "@jul-editor/plugins/code";
import { codeWorkspaceBlock, CodeWorkspaceIDEView, codeWorkspaceSlashItem } from "@jul-editor/plugins/code-workspace";
import { DiagramView, diagramSlashItem } from "@jul-editor/plugins/diagram";
import { DataTableView, dataTableSlashItem } from "@jul-editor/plugins/table";
import { AttachmentView, attachmentBlock, createAttachmentBlock, createCodeBlockRenderer, defaultRenderers, Editor, useEditor, type MentionItem } from "@jul-editor/react";
import { Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";
import { EditorCanvas, type EditorCanvasProps } from "./editor-canvas.js";
import { useSiteSettings } from "../../app/site-settings.js";
import "../../styles/code-workspace.css";

const codeBlock = createCodeBlockRenderer({ languages: pluginCodeLanguages });
const resolveData = createFetchResolveData();
const pluginRenderers = { chart: ChartView, diagram: DiagramView, dataTable: DataTableView, codeWorkspace: CodeWorkspaceIDEView };
const pluginSlashItems = [chartSlashItem, diagramSlashItem, dataTableSlashItem, codeWorkspaceSlashItem];
const mentionItems: Record<"en" | "ko", MentionItem[]> = {
  en: [
    { id: "mina", label: "Mina", kind: "user" },
    { id: "alex", label: "Alex", kind: "user" },
    { id: "design-notes", label: "Design notes", kind: "post" },
    { id: "release-checklist", label: "Release checklist", kind: "post" },
  ],
  ko: [
    { id: "mina", label: "Mina", kind: "user" },
    { id: "alex", label: "Alex", kind: "user" },
    { id: "design-notes", label: "디자인 노트", kind: "post" },
    { id: "release-checklist", label: "배포 체크리스트", kind: "post" },
  ],
};
const tagItems = {
  en: [{ id: "idea", label: "idea" }, { id: "research", label: "research" }, { id: "release", label: "release" }, { id: "design", label: "design" }],
  ko: [{ id: "idea", label: "아이디어" }, { id: "research", label: "조사" }, { id: "release", label: "배포" }, { id: "design", label: "디자인" }],
};

function MentionCommands() {
  const { locale, t } = useSiteSettings();
  return <Editor.MentionMenu onSearch={async (query, kind) => mentionItems[locale].filter((item) => item.kind === kind && item.label.toLowerCase().includes(query.toLowerCase()))}>
    {({ items, activeIndex, kindLabel, rect, getListboxProps, getOptionProps }) => <div
      {...getListboxProps()}
      aria-label={kindLabel}
      className="slash-menu"
      style={rect ? { left: Math.min(rect.left, window.innerWidth - 270), top: Math.min(rect.bottom + 8, window.innerHeight - 300) } : undefined}
    >
      <div className="slash-menu-label">{kindLabel.toUpperCase()} · {t("TAB TO SWITCH TYPE", "TAB으로 유형 전환")}</div>
      {items.length ? items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>@{item.label}</div>) : <div className="slash-empty">{t("No matching mentions", "일치하는 멘션이 없습니다")}</div>}
    </div>}
  </Editor.MentionMenu>;
}

function TagCommands() {
  const { locale, t } = useSiteSettings();
  return <Editor.TagMenu onSearch={(query) => tagItems[locale].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))}>
    {({ items, activeIndex, rect, getListboxProps, getOptionProps }) => <div
      {...getListboxProps()}
      aria-label={t("Tags", "태그")}
      className="slash-menu"
      style={rect ? { left: Math.min(rect.left, window.innerWidth - 270), top: Math.min(rect.bottom + 8, window.innerHeight - 300) } : undefined}
    >
      <div className="slash-menu-label">{t("TAGS", "태그")}</div>
      {items.length ? items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>#{item.label}</div>) : <div className="slash-empty">{t("No matching tags", "일치하는 태그가 없습니다")}</div>}
    </div>}
  </Editor.TagMenu>;
}

function HighlightCode() {
  const editor = useEditor();
  useEffect(() => editor?.registerHighlighter(createLowlightHighlighter()), [editor]);
  return null;
}

function FileInsert() {
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const { t } = useSiteSettings();
  return <>
    <button className="tool-button" type="button" title={t("Add image or file", "이미지 또는 파일 추가")} aria-label={t("Add image or file", "이미지 또는 파일 추가")} onClick={() => input.current?.click()}><Paperclip size={17} /></button>
    <input ref={input} type="file" multiple className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => {
      if (event.currentTarget.files?.length) editor?.insertFiles(Array.from(event.currentTarget.files));
      event.currentTarget.value = "";
    }} />
  </>;
}

/** Consumer opt-in: importing this module adds chart, diagram, data and highlighting UI. */
export function FullEditorCanvas(props: EditorCanvasProps) {
  return <ResolveDataProvider value={resolveData}><EditorCanvas {...props} uploadMode={props.uploadMode ?? "deferred"} createFileBlock={props.createFileBlock ?? createAttachmentBlock} toolbarActions={<FileInsert />} renderers={{ ...defaultRenderers, codeBlock, attachment: AttachmentView, ...props.renderers }}>
    <Editor.Plugin blocks={[codeWorkspaceBlock, attachmentBlock]} renderers={pluginRenderers} slashItems={pluginSlashItems} />
    <HighlightCode />
    <MentionCommands />
    <TagCommands />
    {props.children}
  </EditorCanvas></ResolveDataProvider>;
}
