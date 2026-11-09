import type { Doc } from "@jul-editor/core";
import {
  Editor,
  useActiveMarks,
  useBlockActions,
  useCanApplyMarks,
  useEditor,
  useLinkEditor,
  type EditorProps,
  type SlashMenuRenderArgs,
  type VoidRendererProps,
} from "@jul-editor/react";
import { Bold, Code2, GripVertical, Heading1, Heading2, Italic, Link2, List, ListOrdered, Plus, Quote, Redo2, Table2, Underline, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useBubblePlacement } from "./bubble-placement.js";
import { useMenuPlacement } from "./menu-placement.js";
import { useSiteSettings } from "../../app/site-settings.js";

/** Hands focus back to the editor at its model selection without scrolling the page. */
function refocusEditor(editor: ReturnType<typeof useEditor>): void {
  if (!editor) return;
  const root = editor.getRoot();
  if (root.contains(document.activeElement)) return;
  root.focus({ preventScroll: true });
  const selection = editor.getState().selection;
  if (selection) editor.update((tx) => tx.setSelection(selection));
}

function LinkPopover({ link }: { link: ReturnType<typeof useLinkEditor> }) {
  const { t } = useSiteSettings();
  const editor = useEditor();
  const [href, setHref] = useState(link.href);
  const inputRef = useRef<HTMLInputElement>(null);
  // Fixed next to the selection rect the popover opened from (flips above when there is no room
  // below); without a rect (toolbar button with no selection) it falls back to the toolbar anchor.
  const { ref, style } = useMenuPlacement<HTMLFormElement>(link.rect, { width: 400, height: 46 });
  useEffect(() => setHref(link.href), [link.href]);
  // Not autoFocus: that scrolls the page to wherever the popover renders.
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  const done = (action: () => void) => {
    action();
    refocusEditor(editor);
  };
  const removable = link.href !== "";
  return <form ref={ref} className="link-popover" data-placed={style ? "" : undefined} data-jul-editor-keep-selection="" style={style}
    onSubmit={(event) => { event.preventDefault(); done(() => link.apply(href)); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); done(link.close); } }}>
    <label htmlFor="jul-editor-link-url">{t("Link URL", "링크 주소")}</label>
    <input ref={inputRef} id="jul-editor-link-url" placeholder="https://example.com" value={href} onChange={(event) => setHref(event.target.value)} />
    <button className="small-button" type="submit">{t("Apply", "적용")}</button>
    {removable && <button className="small-button" type="button" aria-label={t("Remove link", "링크 제거")} onClick={() => done(link.remove)}>{t("Remove", "제거")}</button>}
    <button className="icon-button" type="button" aria-label={t("Close link editor", "링크 에디터 닫기")} onClick={() => done(link.close)}><X size={16} /></button>
  </form>;
}

function LinkControl() {
  const { t } = useSiteSettings();
  const link = useLinkEditor();
  const active = useActiveMarks().has("link");
  return <>
    <button type="button" className="tool-button" aria-label={t("Link", "링크")} title={t("Link · ⌘K", "링크 · ⌘K")} aria-pressed={active} onClick={link.openEditor}><Link2 size={16} /></button>
    {link.open && <LinkPopover link={link} />}
  </>;
}

function SlashMenuList({ items, activeIndex, rect, getListboxProps, getOptionProps }: SlashMenuRenderArgs) {
  const { t } = useSiteSettings();
  const { ref, style } = useMenuPlacement(rect);
  return <div
    {...getListboxProps()}
    ref={ref}
    aria-label={t("Block commands", "블록 명령")}
    className="slash-menu"
    style={style}
  >
    <div className="slash-menu-label">{t("INSERT A BLOCK", "블록 삽입")}</div>
    {items.length ? items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>
      <span className="slash-option-symbol">{item.type === "chart" ? "▥" : item.type === "diagram" ? "◇" : item.type === "table" ? "▦" : item.type === "heading" ? "H" : "＋"}</span>
      <span>{item.title}</span>
    </div>) : <div className="slash-empty">{t("No matching blocks", "일치하는 블록이 없습니다")}</div>}
  </div>;
}

function SlashCommands() {
  return <Editor.SlashMenu>{(args) => <SlashMenuList {...args} />}</Editor.SlashMenu>;
}

function BubbleBar({ rect }: { rect: DOMRect }) {
  const { t } = useSiteSettings();
  const { ref, style } = useBubblePlacement(rect);
  return <div ref={ref} className="bubble-tools" data-jul-editor-keep-selection="" style={style}>
    <Editor.Bold aria-label={t("Bold", "굵게")} title={t("Bold", "굵게")}><Bold size={15} /></Editor.Bold>
    <Editor.Italic aria-label={t("Italic", "기울임")} title={t("Italic", "기울임")}><Italic size={15} /></Editor.Italic>
    <Editor.Underline aria-label={t("Underline", "밑줄")} title={t("Underline", "밑줄")}><Underline size={15} /></Editor.Underline>
  </div>;
}

function BubbleTools() {
  // the bubble only holds mark buttons: inside a code block there is nothing for them to format
  if (!useCanApplyMarks()) return null;
  return <Editor.BubbleMenu>{({ rect }) => <BubbleBar rect={rect} />}</Editor.BubbleMenu>;
}

function BlockTools({ blockId, top, left }: { blockId: string; top: number; left: number }) {
  const actions = useBlockActions(blockId);
  const { t } = useSiteSettings();
  return <button type="button" className="block-add" data-jul-editor-keep-selection="" style={{ top, left }} title={t("Add a block below", "아래에 블록 추가")} aria-label={t("Add a block below", "아래에 블록 추가")} onClick={actions.insertBelow}><Plus size={16} /></button>;
}

function DragControls() {
  const { t } = useSiteSettings();
  return <Editor.DragHandle>{({ blockId, rect, dragging, dropIndicatorRect, announcement, getHandleProps }) => <>
    {blockId && rect && <>
      <BlockTools blockId={blockId} top={rect.top + 3} left={rect.left - 53} />
      <button type="button" {...getHandleProps()} className="drag-handle" data-dragging={dragging || undefined} style={{ top: rect.top + 3, left: rect.left - 27 }} title={t("Drag to move · Space for keyboard move", "드래그하여 이동 · 키보드는 Space 키")} aria-label={t("Move block", "블록 이동")}><GripVertical size={17} /></button>
    </>}
    {dropIndicatorRect && <div className="drop-indicator" style={{ top: dropIndicatorRect.top, left: dropIndicatorRect.left, width: dropIndicatorRect.width, height: Math.max(3, dropIndicatorRect.height) }} />}
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </>}</Editor.DragHandle>;
}

export interface EditorCanvasProps {
  value?: Doc;
  defaultValue?: Doc;
  onChange?: (doc: Doc) => void;
  compact?: boolean;
  showDrag?: boolean;
  mode?: "full" | "block" | "rich";
  className?: string;
  renderers?: Record<string, ComponentType<VoidRendererProps>>;
  uploadMode?: EditorProps["uploadMode"];
  onUpload?: EditorProps["onUpload"];
  createFileBlock?: EditorProps["createFileBlock"];
  toolbarActions?: ReactNode;
  slashMenu?: ReactNode | false;
  children?: ReactNode;
}

export function EditorCanvas({ value, defaultValue, onChange, compact = false, showDrag, mode = "full", className, renderers, uploadMode, onUpload, createFileBlock, toolbarActions, slashMenu, children }: EditorCanvasProps) {
  const { locale, t } = useSiteSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef({ locale, mode });
  displayRef.current = { locale, mode };
  const placeholder = () => displayRef.current.locale === "ko"
    ? (displayRef.current.mode === "rich" ? "글을 입력하세요…" : "블록을 추가하려면 /를 입력하세요…")
    : (displayRef.current.mode === "rich" ? "Start writing…" : "Type / for a block…");
  useEffect(() => {
    hostRef.current?.querySelectorAll("[data-jul-editor-content][data-placeholder]").forEach((element) => element.setAttribute("data-placeholder", placeholder()));
  }, [locale, mode]);
  return <div ref={hostRef}><Editor value={value} defaultValue={defaultValue} onChange={onChange} renderers={renderers} uploadMode={uploadMode} onUpload={onUpload} createFileBlock={createFileBlock} placeholder={placeholder} locale={locale} className={`editor-instance${className ? ` ${className}` : ""}`}>
    {children}
    {mode !== "block" && <Editor.Toolbar className="editor-toolbar" aria-label={t("Formatting", "서식")}>
      <div className="toolbar-group">
        <Editor.Heading level={1} className="tool-button" title={t("Heading 1", "제목 1")}><Heading1 size={17} /></Editor.Heading>
        <Editor.Heading level={2} className="tool-button" title={t("Heading 2", "제목 2")}><Heading2 size={17} /></Editor.Heading>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <Editor.Bold className="tool-button" title={t("Bold", "굵게")}><Bold size={16} /></Editor.Bold>
        <Editor.Italic className="tool-button" title={t("Italic", "기울임")}><Italic size={16} /></Editor.Italic>
        <Editor.Underline className="tool-button" title={t("Underline", "밑줄")}><Underline size={16} /></Editor.Underline>
        <LinkControl />
      </div>
      <div className="toolbar-divider toolbar-divider-before-break" />
      <span className="toolbar-break" aria-hidden="true" />
      <div className="toolbar-group">
        <Editor.BulletList className="tool-button" title={t("Bullet list", "글머리 기호 목록")}><List size={17} /></Editor.BulletList>
        <Editor.OrderedList className="tool-button" title={t("Numbered list", "번호 목록")}><ListOrdered size={17} /></Editor.OrderedList>
        <Editor.Quote className="tool-button" title={t("Quote", "인용")}><Quote size={16} /></Editor.Quote>
        <Editor.CodeBlock className="tool-button" title={t("Code block", "코드 블록")}><Code2 size={17} /></Editor.CodeBlock>
        <Editor.InsertTable className="tool-button" title={t("Insert table", "표 삽입")}><Table2 size={17} /></Editor.InsertTable>
        {toolbarActions}
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <Editor.Undo className="tool-button" title={t("Undo", "실행 취소")}><Undo2 size={16} /></Editor.Undo>
        <Editor.Redo className="tool-button" title={t("Redo", "다시 실행")}><Redo2 size={16} /></Editor.Redo>
      </div>
    </Editor.Toolbar>}
    {(showDrag ?? mode !== "rich") && <DragControls />}
    <Editor.Content className={`editor-content${compact ? " editor-content-compact" : ""}`} />
    {mode !== "rich" && (slashMenu === undefined ? <SlashCommands /> : slashMenu)}
    {mode !== "block" && <BubbleTools />}
  </Editor></div>;
}
