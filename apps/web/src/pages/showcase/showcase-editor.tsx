"use client";

import type { Doc } from "@jul-editor/core";
import { ChartView } from "@jul-editor/plugins/chart";
import { createLowlightHighlighter, pluginCodeLanguages } from "@jul-editor/plugins/code";
import { createCodeBlockRenderer, defaultRenderers, Editor, useBlockActions, useCanApplyMarks, useEditor } from "@jul-editor/react";
import { useEffect } from "react";
import { useBubblePlacement } from "../../components/workspace/bubble-placement.js";
import { PlacedMenu } from "../../components/workspace/menu-placement.js";

const codeBlock = createCodeBlockRenderer({ languages: pluginCodeLanguages });

function HighlightCode() {
  const editor = useEditor();
  useEffect(() => editor?.registerHighlighter(createLowlightHighlighter()), [editor]);
  return null;
}

export type ShowcaseMode = "block" | "rich" | "full";

export interface ShowcaseEditorProps {
  value: Doc;
  onChange: (doc: Doc) => void;
  theme: string;
  mode: ShowcaseMode;
  locale?: "en" | "ko";
}

function AddBelow({ blockId, top, left, locale }: { blockId: string; top: number; left: number; locale: "en" | "ko" }) {
  const actions = useBlockActions(blockId);
  return <button className="block-add" data-jul-editor-keep-selection="" type="button" aria-label={locale === "ko" ? "아래에 블록 추가" : "Add a block below"} style={{ top, left }} onClick={actions.insertBelow}>+</button>;
}

function BlockControls({ locale }: { locale: "en" | "ko" }) {
  return <Editor.DragHandle>{({ blockId, rect, dragging, dropIndicatorRect, announcement, getHandleProps }) => <>
    {blockId && rect && <>
      <AddBelow blockId={blockId} top={rect.top + 3} left={rect.left - 66} locale={locale} />
      <button {...getHandleProps()} className="drag-handle" type="button" aria-label={locale === "ko" ? "블록 이동" : "Move block"} data-dragging={dragging || undefined} style={{ top: rect.top + 3, left: rect.left - 34 }}>
        <svg aria-hidden="true" width="14" height="18" viewBox="0 0 14 18" fill="currentColor">
          <circle cx="4" cy="4" r="1.4" /><circle cx="10" cy="4" r="1.4" />
          <circle cx="4" cy="9" r="1.4" /><circle cx="10" cy="9" r="1.4" />
          <circle cx="4" cy="14" r="1.4" /><circle cx="10" cy="14" r="1.4" />
        </svg>
      </button>
    </>}
    {dropIndicatorRect && <div className="drop-indicator" style={{ top: dropIndicatorRect.top, left: dropIndicatorRect.left, width: dropIndicatorRect.width, height: Math.max(3, dropIndicatorRect.height) }} />}
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </>}</Editor.DragHandle>;
}

function SlashCommands({ locale }: { locale: "en" | "ko" }) {
  return <Editor.SlashMenu>{({ items, activeIndex, loading, rect, getListboxProps, getOptionProps }) =>
    <PlacedMenu data-jul-editor-keep-selection="" className="slash-menu" rect={rect}>
      <div className="slash-menu-label">{locale === "ko" ? "블록 삽입" : "INSERT A BLOCK"}</div>
      <div {...getListboxProps()} aria-label={locale === "ko" ? "블록 명령" : "Block commands"}>{items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>{item.title}</div>)}</div>
      <div role="status">{!items.length && <div className="slash-empty">{loading ? (locale === "ko" ? "불러오는 중…" : "Loading…") : (locale === "ko" ? "일치하는 블록이 없습니다" : "No matching blocks")}</div>}</div>
    </PlacedMenu>
  }</Editor.SlashMenu>;
}

function BubbleBar({ rect, locale }: { rect: DOMRect; locale: "en" | "ko" }) {
  const { ref, style } = useBubblePlacement(rect);
  return <div ref={ref} className="bubble-tools" data-jul-editor-keep-selection="" style={style}>
    <Editor.Bold aria-label={locale === "ko" ? "굵게" : "Bold"} title={locale === "ko" ? "굵게" : "Bold"}>B</Editor.Bold>
    <Editor.Italic aria-label={locale === "ko" ? "기울임" : "Italic"} title={locale === "ko" ? "기울임" : "Italic"}>I</Editor.Italic>
    <Editor.Underline aria-label={locale === "ko" ? "밑줄" : "Underline"} title={locale === "ko" ? "밑줄" : "Underline"}>U</Editor.Underline>
  </div>;
}

function BubbleTools({ locale }: { locale: "en" | "ko" }) {
  // the bubble only holds mark buttons: inside a code block there is nothing for them to format
  if (!useCanApplyMarks()) return null;
  return <Editor.BubbleMenu>{({ rect }) => <BubbleBar rect={rect} locale={locale} />}</Editor.BubbleMenu>;
}

export function ShowcaseEditor({ value, onChange, theme, mode, locale = "en" }: ShowcaseEditorProps) {
  const t = (en: string, ko: string) => locale === "ko" ? ko : en;
  return <div className={`jul-editor-theme jul-editor-theme--${theme}${mode !== "rich" ? " jul-editor-theme--blocks" : ""}`}>
    <Editor value={value} onChange={onChange} locale={locale} renderers={{ ...defaultRenderers, codeBlock, chart: ChartView }} placeholder={(block) => block.type === "tableCell" ? "" : mode === "rich" ? t("Start writing…", "글을 써 보세요…") : t("Type / for a block…", "블록을 추가하려면 /를 입력하세요…")} className="editor-instance">
      <HighlightCode />
      {mode !== "block" && <Editor.Toolbar className="editor-toolbar" aria-label={t("Formatting", "서식 도구")}>
        <div className="toolbar-group">
          <Editor.Heading level={1} className="tool-button" title={t("Heading 1", "제목 1")}>H1</Editor.Heading>
          <Editor.Heading level={2} className="tool-button" title={t("Heading 2", "제목 2")}>H2</Editor.Heading>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <Editor.Bold className="tool-button" title={t("Bold", "굵게")}>B</Editor.Bold>
          <Editor.Italic className="tool-button" title={t("Italic", "기울임")}>I</Editor.Italic>
          <Editor.Underline className="tool-button" title={t("Underline", "밑줄")}>U</Editor.Underline>
          <Editor.Link className="tool-button" title={t("Link", "링크")}>↗</Editor.Link>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <Editor.BulletList className="tool-button" title={t("Bullet list", "글머리 기호")}>•</Editor.BulletList>
          <Editor.OrderedList className="tool-button" title={t("Numbered list", "번호 목록")}>1.</Editor.OrderedList>
          <Editor.Quote className="tool-button" title={t("Quote", "인용")}>❞</Editor.Quote>
          <Editor.CodeBlock className="tool-button" title={t("Code block", "코드 블록")}>{"</>"}</Editor.CodeBlock>
          <Editor.InsertTable className="tool-button" title={t("Table", "표")}>▦</Editor.InsertTable>
        </div>
        <span className="toolbar-spacer" />
        <div className="toolbar-group">
          <Editor.Undo className="tool-button" title={t("Undo", "실행 취소")}>↶</Editor.Undo>
          <Editor.Redo className="tool-button" title={t("Redo", "다시 실행")}>↷</Editor.Redo>
        </div>
      </Editor.Toolbar>}
      {mode !== "rich" && <BlockControls locale={locale} />}
      <Editor.Content className="editor-content" />
      {mode !== "rich" && <SlashCommands locale={locale} />}
      {mode !== "block" && <BubbleTools locale={locale} />}
    </Editor>
  </div>;
}
