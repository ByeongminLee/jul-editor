"use client";

import { COLOR_PALETTE } from "@jul-editor/core";
import type { ColorToken } from "@jul-editor/core";
import { Editor, useActiveMarks, useBlockType, useColorPicker, useCommands, useEditor, useEditorState, useLinkEditor } from "@jul-editor/react";
import { ZoomControl } from "@jul-editor/plugins/pages";
import { newId } from "@jul-editor/core";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowUpDown, Baseline, Bold, Code, Download, Ellipsis, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Moon, PanelRight, Printer, Strikethrough, Sun, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { setBlockProp, setMarkAttrs } from "./docx-editor-commands.js";

// The dark toolbar strip. Everything here sits inside <Editor.Toolbar>, which carries
// data-jul-editor-keep-selection, so clicking a control never drops the text selection.

export const FONT_FAMILIES = [
  { value: "", en: "Default (Calibri)", ko: "기본 (Calibri)" },
  { value: "Arial", en: "Arial", ko: "Arial" },
  { value: "Verdana", en: "Verdana", ko: "Verdana" },
  { value: "Trebuchet MS", en: "Trebuchet MS", ko: "Trebuchet MS" },
  { value: "Times New Roman", en: "Serif (Times)", ko: "세리프 (Times)" },
  { value: "Georgia", en: "Georgia", ko: "Georgia" },
  { value: "Courier New", en: "Mono (Courier)", ko: "고정폭 (Courier)" },
];
export const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36];
export const LINE_SPACINGS = [1, 1.15, 1.5, 2];
const ALIGNS = [
  { value: "left", Icon: AlignLeft, en: "Align left", ko: "왼쪽 맞춤" },
  { value: "center", Icon: AlignCenter, en: "Align center", ko: "가운데 맞춤" },
  { value: "right", Icon: AlignRight, en: "Align right", ko: "오른쪽 맞춤" },
  { value: "justify", Icon: AlignJustify, en: "Justify", ko: "양쪽 맞춤" },
] as const;

type Tr = (en: string, ko: string) => string;

/** A button that opens a floating panel. Fixed positioning so the toolbar's own horizontal scroll never clips it. */
function Menu(props: { label: string; icon: ReactNode; className?: string; pressed?: boolean; onOpen?: () => void; children: (close: () => void) => ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      // Only clicks inside this menu keep it open: opening another toolbar menu closes this one.
      if (e.type === "pointerdown" && e.target instanceof Node && (btn.current?.contains(e.target) || panel.current?.contains(e.target))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return <>
    <button ref={btn} type="button" className={`docx-tool ${props.className ?? ""}`} aria-label={props.label} title={props.label} aria-haspopup="menu" aria-expanded={open} aria-pressed={props.pressed} data-docx-menu-button="" data-testid={props.testId}
      onClick={() => {
        const r = btn.current!.getBoundingClientRect();
        setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 240)), top: r.bottom + 6 });
        if (!open) props.onOpen?.();
        setOpen(!open);
      }}>{props.icon}</button>
    {open && <div ref={panel} className="docx-menu" role="menu" data-docx-menu-panel="" data-jul-editor-keep-selection="" style={pos}>{props.children(() => setOpen(false))}</div>}
  </>;
}

function BlockStyleSelect({ t }: { t: Tr }) {
  const editor = useEditor();
  const type = useBlockType();
  const level = useEditorState(() => (editor?.getBlockType()?.props?.level as number | undefined) ?? 0);
  const value = type === "heading" ? `h${level}` : type === "paragraph" ? "p" : "";
  return <select className="docx-select docx-select--style" aria-label={t("Block style", "블록 스타일")} value={value} disabled={!type}
    onChange={(e) => {
      const v = e.target.value;
      if (v === "p") editor?.commands.setBlockType("paragraph");
      else if (v) editor?.commands.setBlockType("heading", { level: Number(v.slice(1)) });
    }}>
    {value === "" && <option value="" hidden>{t("Style", "스타일")}</option>}
    <option value="p">{t("Normal", "본문")}</option>
    <option value="h1">{t("Heading 1", "제목 1")}</option>
    <option value="h2">{t("Heading 2", "제목 2")}</option>
    <option value="h3">{t("Heading 3", "제목 3")}</option>
  </select>;
}

function FontFamilySelect({ t, locale }: { t: Tr; locale: "en" | "ko" }) {
  const editor = useEditor();
  const current = useEditorState(() => (editor?.getActiveMarks().find((m) => m.type === "fontFamily")?.attrs?.family as string | undefined) ?? "");
  return <select className="docx-select docx-select--family" aria-label={t("Font family", "글꼴")} value={FONT_FAMILIES.some((f) => f.value === current) ? current : ""}
    onChange={(e) => editor && setMarkAttrs(editor, "fontFamily", e.target.value ? { family: e.target.value } : null)}>
    {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f[locale]}</option>)}
  </select>;
}

function FontSizeSelect({ t }: { t: Tr }) {
  const editor = useEditor();
  const current = useEditorState(() => (editor?.getActiveMarks().find((m) => m.type === "fontSize")?.attrs?.size as string | undefined) ?? "");
  const known = FONT_SIZES.some((s) => `${s}pt` === current);
  return <select className="docx-select docx-select--size" aria-label={t("Font size", "글자 크기")} value={known ? current : ""}
    onChange={(e) => editor && setMarkAttrs(editor, "fontSize", e.target.value ? { size: e.target.value } : null)}>
    <option value="">{t("11 (default)", "11 (기본)")}</option>
    {FONT_SIZES.filter((s) => s !== 11).map((s) => <option key={s} value={`${s}pt`}>{s}</option>)}
  </select>;
}

function ColorMenu({ t }: { t: Tr }) {
  const picker = useColorPicker();
  return <Menu label={t("Text color", "글자 색")} icon={<Baseline size={16} />} testId="docx-color">
    {(close) => <div className="docx-swatches">{COLOR_PALETTE.map((c: ColorToken) => <button key={c} type="button" role="menuitem" className="docx-swatch" data-color={c} aria-label={c} title={c} aria-pressed={picker.current.textColor === c}
      onClick={() => { picker.setTextColor(c); close(); }} />)}</div>}
  </Menu>;
}

function LinkMenu({ t }: { t: Tr }) {
  const link = useLinkEditor();
  const marks = useActiveMarks();
  const [value, setValue] = useState("");
  useEffect(() => setValue(link.href), [link.href, link.open]);
  return <>
    <button type="button" className="docx-tool" aria-label={t("Link", "링크")} title={t("Link (Ctrl+K)", "링크 (Ctrl+K)")} aria-pressed={marks.has("link")} onClick={() => link.openEditor()}><LinkIcon size={16} /></button>
    {link.open && <form className="docx-menu docx-linkform" data-jul-editor-keep-selection="" style={{ left: Math.max(8, Math.min(link.rect?.left ?? 80, window.innerWidth - 300)), top: (link.rect?.bottom ?? 80) + 8 }}
      onSubmit={(e) => { e.preventDefault(); link.apply(value); }}>
      <input autoFocus aria-label={t("Link URL", "링크 주소")} placeholder="https://" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && link.close()} />
      <button type="submit">{t("Apply", "적용")}</button>
      {link.href && <button type="button" onClick={() => link.remove()}>{t("Remove", "제거")}</button>}
    </form>}
  </>;
}

export interface DocxToolbarProps {
  locale: "en" | "ko";
  zoom: number;
  onZoom: (zoom: number) => void;
  lineSpacing: number;
  onLineSpacing: (v: number) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  dark: boolean;
  onToggleTheme: () => void;
  onImport: () => void;
  onExport: () => void;
  onPrint: () => void;
  busy: boolean;
}

export function DocxToolbar(p: DocxToolbarProps) {
  const t: Tr = (en, ko) => (p.locale === "ko" ? ko : en);
  const editor = useEditor();
  const commands = useCommands();
  const align = useEditorState(() => (editor?.getBlockType()?.props?.textAlign as string | undefined) ?? "left");
  const imageInput = useRef<HTMLInputElement>(null);
  const CurrentAlign = ALIGNS.find((a) => a.value === align)?.Icon ?? AlignLeft;

  // The editor's own file path: the image block previews the file at once and keeps it as a pending
  // upload (core never stores data: or blob: URLs in the document). Export reads the pending bytes.
  function insertImage(file: File) {
    editor?.insertFiles([file]);
  }

  return <Editor.Toolbar className="docx-toolbar" aria-label={t("Document formatting", "문서 서식")}>
    <div className="docx-group"><ZoomControl zoom={p.zoom} onZoomChange={p.onZoom} className="docx-zoom" /></div>
    <span className="docx-sep" />
    <div className="docx-group">
      <BlockStyleSelect t={t} />
      <FontFamilySelect t={t} locale={p.locale} />
      <FontSizeSelect t={t} />
    </div>
    <span className="docx-sep" />
    <div className="docx-group">
      <Editor.Bold className="docx-tool" aria-label={t("Bold", "굵게")} title={t("Bold", "굵게")}><Bold size={16} /></Editor.Bold>
      <Editor.Italic className="docx-tool" aria-label={t("Italic", "기울임")} title={t("Italic", "기울임")}><Italic size={16} /></Editor.Italic>
      <Editor.Strike className="docx-tool" aria-label={t("Strikethrough", "취소선")} title={t("Strikethrough", "취소선")}><Strikethrough size={16} /></Editor.Strike>
      <Editor.Code className="docx-tool" aria-label={t("Code", "코드")} title={t("Code", "코드")}><Code size={16} /></Editor.Code>
      <ColorMenu t={t} />
      <LinkMenu t={t} />
      <button type="button" className="docx-tool" aria-label={t("Insert image", "이미지 삽입")} title={t("Insert image", "이미지 삽입")} onClick={() => imageInput.current?.click()}><ImageIcon size={16} /></button>
      <input ref={imageInput} type="file" accept="image/*" hidden data-testid="docx-image-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ""; }} />
    </div>
    <span className="docx-sep" />
    <div className="docx-group">
      <Editor.BulletList className="docx-tool" aria-label={t("Bulleted list", "글머리 기호")} title={t("Bulleted list", "글머리 기호")}><List size={16} /></Editor.BulletList>
      <Editor.OrderedList className="docx-tool" aria-label={t("Numbered list", "번호 목록")} title={t("Numbered list", "번호 목록")}><ListOrdered size={16} /></Editor.OrderedList>
      <Menu label={t("Line spacing", "줄 간격")} icon={<ArrowUpDown size={16} />} testId="docx-linespacing">
        {(close) => LINE_SPACINGS.map((v) => <button key={v} type="button" role="menuitemradio" aria-checked={p.lineSpacing === v} onClick={() => { p.onLineSpacing(v); close(); }}>{v.toFixed(v === 1.5 || v === 2 || v === 1 ? 1 : 2)}</button>)}
      </Menu>
      <Menu label={t("Alignment", "정렬")} icon={<CurrentAlign size={16} />} testId="docx-align">
        {(close) => ALIGNS.map(({ value, Icon, en, ko }) => <button key={value} type="button" role="menuitemradio" aria-checked={align === value} onClick={() => { if (editor) setBlockProp(editor, "textAlign", value === "left" ? undefined : value); close(); }}><Icon size={14} /> {t(en, ko)}</button>)}
      </Menu>
      <Menu label={t("More", "더 보기")} icon={<Ellipsis size={16} />} testId="docx-more">
        {(close) => <>
          <button type="button" role="menuitem" onClick={() => { commands.toggleMark("underline"); close(); }}>{t("Underline", "밑줄")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.toggleMark("subscript"); close(); }}>{t("Subscript", "아래 첨자")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.toggleMark("superscript"); close(); }}>{t("Superscript", "위 첨자")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.setBlockType("quote"); close(); }}>{t("Quote", "인용")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.insertBlock({ id: newId(), type: "pageBreak", props: {} }); close(); }}>{t("Insert page break", "페이지 나누기 삽입")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.undo(); close(); }}>{t("Undo", "실행 취소")}</button>
          <button type="button" role="menuitem" onClick={() => { commands.redo(); close(); }}>{t("Redo", "다시 실행")}</button>
        </>}
      </Menu>
    </div>
    <span className="docx-spacer" />
    <div className="docx-group docx-group--actions">
      <button type="button" className="docx-tool docx-tool--text" onClick={p.onImport} disabled={p.busy} title={t("Import .docx", ".docx 가져오기")}><Upload size={15} /><span>{t("Import", "가져오기")}</span></button>
      <button type="button" className="docx-tool docx-tool--text" onClick={p.onExport} disabled={p.busy} title={t("Export .docx", ".docx 내보내기")}><Download size={15} /><span>{t("Export", "내보내기")}</span></button>
      <button type="button" className="docx-tool" onClick={p.onPrint} aria-label={t("Print or save as PDF", "인쇄 또는 PDF 저장")} title={t("Print / PDF", "인쇄 / PDF")}><Printer size={16} /></button>
      <button type="button" className="docx-tool" onClick={p.onToggleSettings} aria-pressed={p.settingsOpen} aria-label={t("Page settings", "페이지 설정")} title={t("Page settings", "페이지 설정")}><PanelRight size={16} /></button>
      <button type="button" className="docx-tool" onClick={p.onToggleTheme} aria-label={p.dark ? t("Switch to light theme", "라이트 테마로 전환") : t("Switch to dark theme", "다크 테마로 전환")} title={t("Theme", "테마")}>{p.dark ? <Sun size={16} /> : <Moon size={16} />}</button>
    </div>
  </Editor.Toolbar>;
}
