"use client";

// Formatting toolbar for the Agent editor showcase: undo/redo, zoom, heading and list dropdowns,
// marks, font family/size (fontFamily / fontSize marks), block alignment (textAlign prop), table
// and chart insertion. Every control is a thin call into core commands or one `editor.update`.

import type { Block, Doc, Editor as CoreEditor, Inline, Mark } from "@jul-editor/core";
import { newId } from "@jul-editor/core";
import { Editor, useActiveMarks, useBlockType, useCommands, useEditor, useEditorState } from "@jul-editor/react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, BarChart3, Bold, Highlighter, Italic, Minus, Plus, Redo2, Strikethrough, Table2, Underline, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { blockIds } from "./agent-editor-mock.js";

type TextAlign = "left" | "center" | "right" | "justify";
const ICON = 16;

/** Ids of the blocks the selection touches (a caret counts as its own block). */
function selectedBlockIds(editor: CoreEditor): string[] {
  const sel = editor.getState().selection;
  if (!sel || sel.type === "cells") return [];
  if (sel.type === "block") return sel.ids;
  const order = blockIds(editor.getDoc());
  const a = order.indexOf(sel.anchor.blockId);
  const f = order.indexOf(sel.focus.blockId);
  if (a < 0 || f < 0) return [];
  return order.slice(Math.min(a, f), Math.max(a, f) + 1);
}

function findBlock(doc: Doc, id: string): Block | undefined {
  const walk = (blocks: Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.id === id) return b;
      const hit = b.children && walk(b.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(doc.blocks);
}

function setAlign(editor: CoreEditor, align: TextAlign): void {
  const ids = selectedBlockIds(editor);
  if (!ids.length) return;
  editor.update((tx) => {
    for (const id of ids) tx.setProps(id, { textAlign: align === "left" ? undefined : align });
    return tx;
  });
}

/** Sets (or clears, with "") a valued mark such as fontFamily / fontSize on the selected text range.
 * toggleMark flips by mark TYPE, so switching between two values needs this explicit replace. */
function setValuedMark(editor: CoreEditor, type: string, attr: string, value: string): void {
  const sel = editor.getState().selection;
  if (!sel || sel.type !== "text") return;
  const order = blockIds(editor.getDoc());
  const a = order.indexOf(sel.anchor.blockId);
  const f = order.indexOf(sel.focus.blockId);
  if (a < 0 || f < 0) return;
  const [start, end] = a < f || (a === f && sel.anchor.offset <= sel.focus.offset) ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  const doc = editor.getDoc();
  editor.update((tx) => {
    for (const id of order.slice(order.indexOf(start.blockId), order.indexOf(end.blockId) + 1)) {
      const block = findBlock(doc, id);
      if (!block?.content) continue;
      const len = block.content.reduce((n, i) => n + (i.type === "text" ? (i as { text: string }).text.length : 1), 0);
      const from = id === start.blockId ? start.offset : 0;
      const to = id === end.blockId ? end.offset : len;
      if (from >= to) continue;
      const out: Inline[] = [];
      let pos = 0;
      for (const inl of block.content) {
        const l = inl.type === "text" ? (inl as { text: string }).text.length : 1;
        const lo = pos;
        pos += l;
        if (pos <= from || lo >= to) continue; // outside the range: replaceContent only takes the slice
        if (inl.type !== "text") {
          out.push(inl);
          continue;
        }
        const t = inl as { text: string; marks?: Mark[] };
        const s = Math.max(from, lo) - lo;
        const e = Math.min(to, pos) - lo;
        const marks = (t.marks ?? []).filter((m) => m.type !== type);
        if (value) marks.push({ type, attrs: { [attr]: value } });
        out.push(marks.length ? { type: "text", text: t.text.slice(s, e), marks } : { type: "text", text: t.text.slice(s, e) });
      }
      tx.replaceContent(id, from, to, out);
    }
    return tx;
  });
}

/** The value of a valued mark on the first text inline of the selection's first block. */
function readValuedMark(editor: CoreEditor | null, type: string, attr: string): string {
  if (!editor) return "";
  const sel = editor.getState().selection;
  if (!sel || sel.type !== "text") return "";
  const block = findBlock(editor.getDoc(), sel.focus.blockId);
  let pos = 0;
  for (const inl of block?.content ?? []) {
    const l = inl.type === "text" ? (inl as { text: string }).text.length : 1;
    if (sel.focus.offset <= pos + l && inl.type === "text") {
      const m = ((inl as { marks?: Mark[] }).marks ?? []).find((x) => x.type === type);
      return typeof m?.attrs?.[attr] === "string" ? (m.attrs[attr] as string) : "";
    }
    pos += l;
  }
  return "";
}

/** Inserts a block after the top-level block holding the caret (a chart cannot live inside a table
 * cell or a list item's children, so `commands.insertBlock` at a nested caret would be rejected). */
function insertTopLevel(editor: CoreEditor, block: Block): void {
  const doc = editor.getDoc();
  const sel = editor.getState().selection;
  const id = sel?.type === "text" ? sel.focus.blockId : sel?.type === "block" ? sel.ids[sel.ids.length - 1] : sel?.type === "cells" ? sel.tableId : undefined;
  const holds = (b: Block): boolean => b.id === id || !!b.children?.some(holds);
  const at = id ? doc.blocks.findIndex(holds) : -1;
  editor.update((tx) => tx.insertBlock(null, at < 0 ? doc.blocks.length : at + 1, block));
}

const FAMILIES: [string, string, string][] = [["", "Font", "글꼴"], ["Georgia", "Georgia", "Georgia"], ["serif", "Serif", "세리프"], ["sans-serif", "Sans", "산세리프"], ["monospace", "Mono", "고정폭"]];
const SIZES = ["12px", "14px", "16px", "18px", "24px", "32px"];

export interface AgentToolbarProps {
  locale: "en" | "ko";
  zoom: number;
  onZoom: (zoom: number) => void;
}

export function AgentToolbar({ locale, zoom, onZoom }: AgentToolbarProps): ReactNode {
  const t = (en: string, ko: string): string => (locale === "ko" ? ko : en);
  const editor = useEditor();
  const commands = useCommands();
  const marks = useActiveMarks();
  const blockType = useBlockType();
  const level = useEditorState(() => {
    const info = editor?.getBlockType();
    return info?.type === "heading" ? Number(info.props.level ?? 1) : 0;
  });
  const align = useEditorState((): TextAlign => {
    if (!editor) return "left";
    const id = selectedBlockIds(editor)[0];
    const v = id ? findBlock(editor.getDoc(), id)?.props.textAlign : undefined;
    return v === "center" || v === "right" || v === "justify" ? v : "left";
  });
  const family = useEditorState(() => readValuedMark(editor, "fontFamily", "family"));
  const size = useEditorState(() => readValuedMark(editor, "fontSize", "size"));
  const keep = { "data-jul-editor-keep-selection": "" } as const;
  const headingValue = blockType === "heading" ? `h${level}` : blockType === "paragraph" ? "p" : "";
  const listValue = blockType === "bulletListItem" || blockType === "orderedListItem" || blockType === "todoListItem" ? blockType : "";

  const alignButton = (value: TextAlign, icon: ReactNode, label: string): ReactNode => (
    <button type="button" className="agent-tool" {...keep} aria-label={label} title={label} aria-pressed={align === value} onClick={() => editor && setAlign(editor, value)}>{icon}</button>
  );

  return (
    <Editor.Toolbar className="agent-toolbar" aria-label={t("Formatting", "서식 도구")}>
      <div className="agent-tool-group">
        <Editor.Undo className="agent-tool" title={t("Undo", "실행 취소")} aria-label={t("Undo", "실행 취소")}><Undo2 size={ICON} /></Editor.Undo>
        <Editor.Redo className="agent-tool" title={t("Redo", "다시 실행")} aria-label={t("Redo", "다시 실행")}><Redo2 size={ICON} /></Editor.Redo>
      </div>
      <span className="agent-tool-sep" />
      <div className="agent-tool-group agent-zoom" role="group" aria-label={t("Zoom", "확대/축소")}>
        <button type="button" className="agent-tool" aria-label={t("Zoom out", "축소")} title={t("Zoom out", "축소")} disabled={zoom <= 50} onClick={() => onZoom(Math.max(50, zoom - 10))}><Minus size={ICON} /></button>
        <span className="agent-zoom-value" data-testid="agent-zoom">{zoom}%</span>
        <button type="button" className="agent-tool" aria-label={t("Zoom in", "확대")} title={t("Zoom in", "확대")} disabled={zoom >= 200} onClick={() => onZoom(Math.min(200, zoom + 10))}><Plus size={ICON} /></button>
      </div>
      <span className="agent-tool-sep" />
      <div className="agent-tool-group">
        <select className="agent-select" aria-label={t("Text style", "텍스트 스타일")} value={headingValue} onChange={(e) => {
          const v = e.target.value;
          if (v === "p") commands.setBlockType("paragraph");
          else if (v) commands.setBlockType("heading", { level: Number(v.slice(1)) });
        }}>
          <option value="" disabled>{t("Style", "스타일")}</option>
          <option value="p">{t("Paragraph", "본문")}</option>
          <option value="h1">{t("Heading 1", "제목 1")}</option>
          <option value="h2">{t("Heading 2", "제목 2")}</option>
          <option value="h3">{t("Heading 3", "제목 3")}</option>
        </select>
        <select className="agent-select" aria-label={t("List", "목록")} value={listValue} onChange={(e) => commands.setBlockType(e.target.value)}>
          <option value="" disabled>{t("List", "목록")}</option>
          <option value="bulletListItem">{t("Bullet list", "글머리 기호")}</option>
          <option value="orderedListItem">{t("Numbered list", "번호 목록")}</option>
          <option value="todoListItem">{t("Task list", "체크리스트")}</option>
          <option value="paragraph">{t("No list", "목록 해제")}</option>
        </select>
        <select className="agent-select" aria-label={t("Font family", "글꼴")} value={family} onChange={(e) => editor && setValuedMark(editor, "fontFamily", "family", e.target.value)}>
          {FAMILIES.map(([v, en, ko]) => <option key={v} value={v}>{t(en, ko)}</option>)}
        </select>
        <select className="agent-select agent-select--size" aria-label={t("Font size", "글자 크기")} value={size} onChange={(e) => editor && setValuedMark(editor, "fontSize", "size", e.target.value)}>
          <option value="">{t("Size", "크기")}</option>
          {SIZES.map((s) => <option key={s} value={s}>{s.replace("px", "")}</option>)}
        </select>
      </div>
      <span className="agent-tool-sep" />
      <div className="agent-tool-group">
        <Editor.Bold className="agent-tool" title={t("Bold", "굵게")} aria-label={t("Bold", "굵게")}><Bold size={ICON} /></Editor.Bold>
        <Editor.Italic className="agent-tool" title={t("Italic", "기울임")} aria-label={t("Italic", "기울임")}><Italic size={ICON} /></Editor.Italic>
        <Editor.Strike className="agent-tool" title={t("Strikethrough", "취소선")} aria-label={t("Strikethrough", "취소선")}><Strikethrough size={ICON} /></Editor.Strike>
        <Editor.Underline className="agent-tool" title={t("Underline", "밑줄")} aria-label={t("Underline", "밑줄")}><Underline size={ICON} /></Editor.Underline>
        <button type="button" className="agent-tool" {...keep} title={t("Highlight", "형광펜")} aria-label={t("Highlight", "형광펜")} aria-pressed={marks.has("highlight")} onClick={() => commands.toggleMark("highlight", { color: "yellow" })}><Highlighter size={ICON} /></button>
      </div>
      <span className="agent-tool-sep" />
      <div className="agent-tool-group" role="group" aria-label={t("Alignment", "정렬")}>
        {alignButton("left", <AlignLeft size={ICON} />, t("Align left", "왼쪽 정렬"))}
        {alignButton("center", <AlignCenter size={ICON} />, t("Align center", "가운데 정렬"))}
        {alignButton("right", <AlignRight size={ICON} />, t("Align right", "오른쪽 정렬"))}
        {alignButton("justify", <AlignJustify size={ICON} />, t("Justify", "양쪽 정렬"))}
      </div>
      <span className="agent-tool-sep" />
      <div className="agent-tool-group">
        <Editor.InsertTable className="agent-tool" title={t("Insert table", "표 삽입")} aria-label={t("Insert table", "표 삽입")}><Table2 size={ICON} /></Editor.InsertTable>
        <button type="button" className="agent-tool" {...keep} title={t("Insert chart", "차트 삽입")} aria-label={t("Insert chart", "차트 삽입")} onClick={() => {
          const csv = locale === "ko" ? "항목,값\nA,30\nB,50\nC,20" : "Label,Value\nA,30\nB,50\nC,20";
          if (editor) insertTopLevel(editor, { id: newId(), type: "chart", props: { kind: "bar", source: { type: "inline", csv } } });
        }}><BarChart3 size={ICON} /></button>
      </div>
    </Editor.Toolbar>
  );
}
