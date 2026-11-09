"use client";

// Notion-like workspace editor (modeled on Tiptap's Notion-like template), built only from JulEditor parts:
//   core blocks + plugins: callout, toggle, toc, columns, links (bookmark / iframe), comments, collaboration.
// Everything external is an adapter passed in here, none of it touches the network:
//   - collaboration transport: BroadcastChannel (open this page in two tabs to co-edit),
//   - comment adapter: BroadcastChannel too, so threads follow the doc between tabs,
//   - link metadata: a fixed map of demo URLs (createStaticMetadata).
import { createCodeBlockRenderer, defaultRenderers, Editor, useBlockActions, useColorPicker, useEditor, useTurnInto } from "@jul-editor/react";
import { createLowlightHighlighter, pluginCodeLanguages } from "@jul-editor/plugins/code";
import { calloutPlugin } from "@jul-editor/plugins/callout";
import { togglePlugin, TOGGLE_CSS } from "@jul-editor/plugins/toggle";
import { tocPlugin, TocSidebar, TOC_CSS } from "@jul-editor/plugins/toc";
import { columnsPlugin, COLUMNS_CSS } from "@jul-editor/plugins/columns";
import { CALLOUT_CSS } from "@jul-editor/plugins/callout";
import {
  BookmarkView, createLinkBlocks, createStaticMetadata, IframeView, installUrlPaste, LinkContextProvider, linkSlashItems,
  type IframePolicy, type IframeViewProps, type PasteChoice, type PasteMenuRequest,
} from "@jul-editor/plugins/links";
import { AddCommentButton, commentMark, CommentsPanel, createBroadcastCommentAdapter, EditorCommentsProvider, useComments } from "@jul-editor/plugins/comments";
import { CollabAvatars, createBroadcastChannelTransport, useCollaboration } from "@jul-editor/plugins/collaboration";
import type { CollabUser } from "@jul-editor/plugins/collaboration";
import { Copy, GripVertical, MessageSquare, Moon, Plus, Redo2, Sun, Trash2, Undo2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NOTION_DOC_ID, notionSampleDoc } from "./notion-editor-sample.js";
import type { Doc } from "@jul-editor/core";
import { useBubblePlacement } from "../../components/workspace/bubble-placement.js";
import "./notion-editor.css";

export interface NotionEditorProps {
  locale?: "en" | "ko";
  /** Documents kept by the host page, so edits survive unmounting (e.g. switching showcase cases). */
  drafts?: Partial<Record<"en" | "ko", Doc>>;
  onDraftChange?: (locale: "en" | "ko", doc: Doc) => void;
}

type Locale = "en" | "ko";
type Theme = "dark" | "light";

// ---- demo adapters -------------------------------------------------------------------------------

/** Hosts a generic iframe may load besides the built-in provider transforms (figma and youtube are also provider-aware). */
const IFRAME_POLICY: IframePolicy = {
  allowedOrigins: ["https://www.figma.com", "https://figma.com", "https://www.youtube.com", "https://youtube.com", "https://codepen.io", "https://www.loom.com", "https://loom.com"],
};
const LINK_BLOCKS = createLinkBlocks(IFRAME_POLICY);

/** Demo link metadata: a fixed map, no request is ever made. Unknown URLs reject, and the card falls back to URL rules. */
const fetchMetadata = createStaticMetadata({
  "https://github.com/example/jul-editor": { title: "example/jul-editor", description: "A headless, block based editor with plugins for callouts, toggles, columns, comments and collaboration.", siteName: "GitHub" },
  "https://github.com/ueberdosis/tiptap": { title: "ueberdosis/tiptap", description: "The headless rich text editor framework for web artisans.", siteName: "GitHub" },
  "https://www.figma.com/design/1234567890123456789/Jul-demo": { title: "Jul demo", description: "A mock workspace layout.", siteName: "Figma" },
}, 150);

const COMMENT_CHANNEL = "jul-notion-comments";
const NAMES = ["Mina", "Jun", "Aria", "Theo", "Sora", "Noah", "Lena", "Hana", "Ravi", "Iris"];
const COLORS = ["#e5484d", "#f76b15", "#e5a000", "#30a46c", "#0091ff", "#6e56cf", "#d6409f", "#12a594"];

function randomUser(): CollabUser {
  const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  return { id, name: pick(NAMES), color: pick(COLORS) };
}

const codeBlockRenderer = createCodeBlockRenderer({ languages: pluginCodeLanguages });
/** Click-to-load wrapper: the embed stays a placeholder (no iframe, no request) until the user opts in. */
function LazyIframeView(props: IframeViewProps) {
  const [loaded, setLoaded] = useState(false);
  const url = typeof props.block.props.url === "string" ? props.block.props.url : "";
  // no url yet (a slash insert): IframeView shows its URL field, there is nothing to load
  if (loaded || !url) return <IframeView {...props} />;
  const ko = props.locale === "ko";
  let host = url;
  try { host = new URL(url).hostname; } catch { /* keep raw url */ }
  return <div data-jul-editor-plugin="iframe" data-state="idle" className="nt-embed-idle">
    <strong>{ko ? "임베드는 클릭하면 불러옵니다" : "Embed loads on click"}</strong>
    <span>{ko ? `${host}에 대한 요청은 버튼을 누르기 전까지 보내지 않습니다.` : `No request is made to ${host} until you press the button.`}</span>
    <button type="button" onClick={() => setLoaded(true)}>{ko ? "임베드 불러오기" : "Load embed"}</button>
  </div>;
}
const RENDERERS = { ...defaultRenderers, codeBlock: codeBlockRenderer, bookmark: BookmarkView, iframe: LazyIframeView };
const PLUGIN_CSS = [CALLOUT_CSS, TOGGLE_CSS, COLUMNS_CSS, TOC_CSS].join("\n");

const COPY = {
  en: {
    placeholder: "Type / for commands, or just start writing",
    invite: "Open this page in another tab to collaborate",
    live: "Live",
    offline: "Offline",
    undo: "Undo", redo: "Redo", theme: "Toggle light and dark theme", comments: "Comments", addComment: "Comment",
    slash: "INSERT A BLOCK", noMatch: "No matching blocks",
    bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", code: "Inline code", color: "Text color and highlight",
    textColor: "Text color", highlight: "Highlight", clear: "Clear",
    drag: "Drag to move, click for the block menu", addBelow: "Add a block below",
    turnInto: "Turn into", duplicate: "Duplicate", delete: "Delete", close: "Close",
    pasteTitle: "Paste as", link: "Link", bookmark: "Bookmark", embed: "Embed", mention: "Mention",
    outline: "Document outline", people: "People in this page", you: "you",
  },
  ko: {
    placeholder: "/ 를 눌러 명령을 쓰거나 바로 입력하세요",
    invite: "이 페이지를 다른 탭에서 열어 같이 편집해 보세요",
    live: "실시간",
    offline: "연결 끊김",
    undo: "실행 취소", redo: "다시 실행", theme: "라이트 다크 테마 전환", comments: "댓글", addComment: "댓글",
    slash: "블록 삽입", noMatch: "일치하는 블록이 없습니다",
    bold: "굵게", italic: "기울임", underline: "밑줄", strike: "취소선", code: "인라인 코드", color: "글자색과 강조색",
    textColor: "글자색", highlight: "강조", clear: "지우기",
    drag: "끌어서 이동, 클릭하면 블록 메뉴", addBelow: "아래에 블록 추가",
    turnInto: "블록 변환", duplicate: "복제", delete: "삭제", close: "닫기",
    pasteTitle: "붙여넣기 형식", link: "링크", bookmark: "북마크", embed: "임베드", mention: "멘션",
    outline: "문서 개요", people: "이 페이지의 참여자", you: "나",
  },
} as const;
type Strings = (typeof COPY)[Locale];

// ---- block controls: drag handle, block menu -------------------------------------------------------

/** Menu opened from the drag handle. "Turn into" runs on the block selection, so plugin turnIntoItems
 * (callout, toggle ...) appear next to the built-in ones; duplicate, delete and plugin menu items come from useBlockActions. */
function BlockMenu({ blockId, left, top, copy, onClose }: { blockId: string; left: number; top: number; copy: Strings; onClose: () => void }) {
  const editor = useEditor();
  const actions = useBlockActions(blockId);
  const turn = useTurnInto();
  const ref = useRef<HTMLDivElement | null>(null);

  // select the whole block so useTurnInto (selection based) targets it
  useEffect(() => {
    editor?.update((tx) => tx.setSelection({ type: "block", ids: [blockId] }));
  }, [editor, blockId]);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key, true); };
  }, [onClose]);

  const keep = { "data-jul-editor-keep-selection": "" } as const;
  return <div ref={ref} className="nt-menu nt-block-menu" role="menu" aria-label={copy.turnInto} style={{ left: Math.max(8, Math.min(left, window.innerWidth - 220)), top: Math.max(8, Math.min(top, window.innerHeight - 380)) }} {...keep}>
    <div className="nt-menu-label">{copy.turnInto}</div>
    <div className="nt-menu-scroll">
      {turn.items.map((item) => <button key={item.id} type="button" role="menuitem" className="nt-menu-item" data-active={item.active || undefined} onClick={() => { turn.turnInto(item); onClose(); }}>{item.label}</button>)}
    </div>
    <div className="nt-menu-sep" />
    <button type="button" role="menuitem" className="nt-menu-item" onClick={() => { actions.duplicate(); onClose(); }}><Copy size={14} /> {copy.duplicate}</button>
    {actions.menuItems.map((entry) => <button key={entry.id} type="button" role="menuitem" className="nt-menu-item" onClick={() => { entry.run(); onClose(); }}>{entry.label}</button>)}
    <button type="button" role="menuitem" className="nt-menu-item nt-danger" onClick={() => { actions.delete(); onClose(); }}><Trash2 size={14} /> {copy.delete}</button>
  </div>;
}

function AddBelow({ blockId, top, left, label }: { blockId: string; top: number; left: number; label: string }) {
  const actions = useBlockActions(blockId);
  return <button className="nt-block-btn" data-jul-editor-keep-selection="" type="button" aria-label={label} title={label} style={{ top, left }} onClick={actions.insertBelow}><Plus size={16} /></button>;
}

function BlockControls({ copy }: { copy: Strings }) {
  const [menu, setMenu] = useState<{ blockId: string; left: number; top: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  return <>
    <Editor.DragHandle>{({ blockId, rect, dragging, dropIndicatorRect, announcement, getHandleProps }) => {
      const handle = getHandleProps();
      return <>
        {blockId && rect && <>
          <AddBelow blockId={blockId} top={rect.top + 2} left={rect.left - 56} label={copy.addBelow} />
          <button {...handle} className="nt-block-btn nt-drag" type="button" aria-label={copy.drag} title={copy.drag} aria-haspopup="menu" data-dragging={dragging || undefined} style={{ top: rect.top + 2, left: rect.left - 30 }}
            onClick={() => { setMenu({ blockId, left: rect.left - 30, top: rect.top + 28 }); }}><GripVertical size={16} /></button>
        </>}
        {dropIndicatorRect && <div className="nt-drop" style={{ top: dropIndicatorRect.top, left: dropIndicatorRect.left, width: dropIndicatorRect.width, height: Math.max(3, dropIndicatorRect.height) }} />}
        <span className="nt-sr" role="status" aria-live="polite">{announcement}</span>
      </>;
    }}</Editor.DragHandle>
    {menu && <BlockMenu blockId={menu.blockId} left={menu.left} top={menu.top} copy={copy} onClose={closeMenu} />}
  </>;
}

// ---- slash menu ----------------------------------------------------------------------------------------

function SlashCommands({ copy }: { copy: Strings }) {
  return <Editor.SlashMenu>{({ items, activeIndex, rect, getListboxProps, getOptionProps }) =>
    <div {...getListboxProps()} className="nt-menu nt-slash" style={rect ? { left: Math.max(8, Math.min(rect.left, window.innerWidth - 270)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 330)) } : undefined}>
      <div className="nt-menu-label">{copy.slash}</div>
      {items.length ? items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="nt-menu-item" data-active={index === activeIndex || undefined}>{item.title}</div>) : <div className="nt-menu-empty">{copy.noMatch}</div>}
    </div>
  }</Editor.SlashMenu>;
}

// ---- bubble menu: formatting, color, comment --------------------------------------------------------------

function ColorMenu({ copy }: { copy: Strings }) {
  const picker = useColorPicker();
  const [open, setOpen] = useState(false);
  const keep = { "data-jul-editor-keep-selection": "" } as const;
  return <span className="nt-color" {...keep}>
    <button type="button" className="nt-tool" aria-label={copy.color} title={copy.color} aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}>
      <span className="nt-color-a" style={{ borderBottomColor: picker.current.textColor && picker.current.textColor !== "default" ? `var(--nt-c-${picker.current.textColor})` : undefined }}>A</span>
    </button>
    {open && <div className="nt-menu nt-color-pop" role="group" aria-label={copy.color} onMouseDown={(event) => event.preventDefault()}>
      <div className="nt-menu-label">{copy.textColor}</div>
      <div className="nt-swatches">{picker.palette.map((color) => <button key={color} type="button" className="nt-swatch" data-color={color} aria-label={`${copy.textColor}: ${color}`} data-active={picker.current.textColor === color || undefined} onClick={() => picker.setTextColor(color)}><span style={{ color: `var(--nt-c-${color})` }}>A</span></button>)}</div>
      <div className="nt-menu-label">{copy.highlight}</div>
      <div className="nt-swatches">{picker.palette.map((color) => <button key={color} type="button" className="nt-swatch" data-color={color} aria-label={`${copy.highlight}: ${color}`} data-active={picker.current.highlight === color || undefined} onClick={() => picker.setHighlight(color)}><span className="nt-swatch-bg" style={{ background: `var(--nt-h-${color})` }} /></button>)}</div>
      <button type="button" className="nt-menu-item" onClick={() => { picker.clear(); setOpen(false); }}>{copy.clear}</button>
    </div>}
  </span>;
}

function BubbleBar({ rect, copy, onComment }: { rect: DOMRect; copy: Strings; onComment: () => void }) {
  const { ref, style } = useBubblePlacement(rect, { width: 330, height: 40 });
  return <div ref={ref} className="nt-bubble" data-jul-editor-keep-selection="" style={style}>
    <Editor.Bold className="nt-tool" aria-label={copy.bold} title={copy.bold}><b>B</b></Editor.Bold>
    <Editor.Italic className="nt-tool" aria-label={copy.italic} title={copy.italic}><i>I</i></Editor.Italic>
    <Editor.Underline className="nt-tool" aria-label={copy.underline} title={copy.underline}><u>U</u></Editor.Underline>
    <Editor.Strike className="nt-tool" aria-label={copy.strike} title={copy.strike}><s>S</s></Editor.Strike>
    <Editor.Code className="nt-tool" aria-label={copy.code} title={copy.code}>{"</>"}</Editor.Code>
    <ColorMenu copy={copy} />
    <span className="nt-bubble-sep" />
    <AddCommentButton className="nt-tool nt-tool-wide" onOpen={onComment}><MessageSquare size={14} /> {copy.addComment}</AddCommentButton>
  </div>;
}

function BubbleTools({ copy, onComment }: { copy: Strings; onComment: () => void }) {
  return <Editor.BubbleMenu>{({ rect }) => <BubbleBar rect={rect} copy={copy} onComment={onComment} />}</Editor.BubbleMenu>;
}

// ---- paste menu (Link / Bookmark / Embed / Mention) ---------------------------------------------------------

function PasteMenu({ request, copy, onClose }: { request: PasteMenuRequest; copy: Strings; onClose: () => void }) {
  const editor = useEditor();
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const label: Record<PasteChoice, string> = { link: copy.link, bookmark: copy.bookmark, embed: copy.embed, mention: copy.mention };
  const choose = useCallback((choice: PasteChoice) => { void request.choose(choice); onClose(); }, [request, onClose]);
  const dismiss = useCallback(() => { request.dismiss(); onClose(); }, [request, onClose]);

  // anchor under the pasted url (caret rect, else the block)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
      const block = editor?.getRoot().querySelector(`[data-id="${request.blockId}"]`)?.getBoundingClientRect();
      const base = range && (range.width || range.height) ? range : block;
      setPos(base ? { left: Math.max(8, Math.min(base.left, window.innerWidth - 220)), top: Math.min(base.bottom + 6, window.innerHeight - 200) } : { left: 24, top: 120 });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, request.blockId]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : request.options.length - 1)) % request.options.length);
      } else if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        choose(request.options[active]!);
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        dismiss();
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key !== "Shift") dismiss();
    };
    const away = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.(".nt-paste")) dismiss(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", away, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", away, true); };
  }, [active, choose, dismiss, request.options]);

  if (!pos) return null;
  return <div className="nt-menu nt-paste" role="menu" aria-label={copy.pasteTitle} style={pos} data-jul-editor-keep-selection="">
    <div className="nt-menu-label">{copy.pasteTitle}</div>
    {request.options.map((choice, index) => <button key={choice} type="button" role="menuitem" className="nt-menu-item" data-active={index === active || undefined} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)}>{label[choice]}</button>)}
  </div>;
}

/** Registers the paste interceptor for as long as the editor lives (it is module level in core, so it must be removed on unmount). */
function UrlPaste({ copy }: { copy: Strings }) {
  const [request, setRequest] = useState<PasteMenuRequest | null>(null);
  useEffect(() => installUrlPaste({ defaultChoice: "menu", onMenu: setRequest, fetchMetadata }), []);
  return request ? <PasteMenu key={request.blockId + request.url} request={request} copy={copy} onClose={() => setRequest(null)} /> : null;
}

// ---- top bar + workspace -----------------------------------------------------------------------------------------

function Workspace({ locale, user, theme, onTheme }: { locale: Locale; user: CollabUser; theme: Theme; onTheme: () => void }) {
  const copy = COPY[locale];
  const editor = useEditor();
  const transport = useMemo(() => createBroadcastChannelTransport({ prefix: "jul-notion:" }), []);
  // the hook connects on mount and disconnects (carets, presence, channel) on unmount
  const { status, peers } = useCollaboration(editor, { transport, user, docId: NOTION_DOC_ID });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const comments = useComments();
  const threadCount = comments?.state.threads.length ?? 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useEffect(() => { editor?.registerHighlighter(createLowlightHighlighter()); }, [editor]);

  return <>
    <header className="nt-topbar">
      <div className="nt-crumbs"><span className="nt-doc-icon" aria-hidden="true">📄</span><strong>{locale === "ko" ? "노션형 템플릿" : "Notion-like template"}</strong></div>
      <span className="nt-invite" data-status={status}><Users size={14} /> <span>{copy.invite}</span></span>
      <div className="nt-actions">
        <span className="nt-status" data-status={status} title={status}>{status === "connected" ? copy.live : status === "disconnected" ? copy.offline : "…"}</span>
        <CollabAvatars className="nt-avatars" peers={peers} self={user} label={copy.people} />
        <Editor.Undo className="nt-icon-btn" aria-label={copy.undo} title={copy.undo}><Undo2 size={16} /></Editor.Undo>
        <Editor.Redo className="nt-icon-btn" aria-label={copy.redo} title={copy.redo}><Redo2 size={16} /></Editor.Redo>
        <button type="button" className="nt-icon-btn" aria-label={copy.theme} title={copy.theme} onClick={onTheme}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
        <button type="button" className="nt-icon-btn nt-comments-toggle" aria-label={copy.comments} title={copy.comments} aria-pressed={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}><MessageSquare size={16} />{threadCount > 0 && <span className="nt-count">{threadCount}</span>}</button>
      </div>
    </header>
    <div className="nt-body" data-comments={commentsOpen || undefined}>
      <div className="nt-scroll" ref={(el) => { scrollRef.current = el; if (el !== scroller) setScroller(el); }}>
        <Editor.Content className="nt-content editor-content" />
        {/* inside the root's parent: the drag handle hook treats pointer/focus outside that element as "left the editor" */}
        <BlockControls copy={copy} />
      </div>
      <TocSidebar editor={editor} scrollContainer={scroller} locale={locale} className="nt-toc" activeOffset={140} />
      <aside className="nt-comments" aria-label={copy.comments} data-open={commentsOpen || undefined}>
        <button type="button" className="nt-icon-btn nt-comments-close" aria-label={copy.close} onClick={() => setCommentsOpen(false)}><X size={16} /></button>
        <CommentsPanel />
      </aside>
    </div>
    <SlashCommands copy={copy} />
    <BubbleTools copy={copy} onComment={() => setCommentsOpen(true)} />
    <UrlPaste copy={copy} />
  </>;
}

function readSiteTheme(): Theme {
  try { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; } catch { return "dark"; }
}

export function NotionEditor({ locale = "en", drafts, onDraftChange }: NotionEditorProps) {
  const [theme, setTheme] = useState<Theme>(readSiteTheme);
  const [user] = useState<CollabUser>(randomUser);
  const copy = COPY[locale];
  const [adapter, setAdapter] = useState(() => createBroadcastCommentAdapter(COMMENT_CHANNEL));
  const closed = useRef(false);

  // comment threads travel over their own BroadcastChannel; closed on unmount so no channel leaks
  // (re-created if an effect cycle already closed it, e.g. React StrictMode in development)
  useEffect(() => {
    let current = adapter;
    if (closed.current) { current = createBroadcastCommentAdapter(COMMENT_CHANNEL); closed.current = false; setAdapter(current); }
    return () => { current.close(); closed.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const author = useMemo(() => ({ id: user.id, name: user.name, color: user.color }), [user]);
  const linkContext = useMemo(() => ({ fetchMetadata, iframePolicy: IFRAME_POLICY }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => drafts?.[locale] ?? notionSampleDoc(locale), [locale]);

  return <div className="showcase-notion" data-nt-theme={theme}>
    <style>{PLUGIN_CSS}</style>
    <LinkContextProvider value={linkContext}>
      <Editor key={locale} defaultValue={initial} onChange={(doc) => onDraftChange?.(locale, doc)} locale={locale} renderers={RENDERERS} placeholder={copy.placeholder} className="editor-instance nt-shell">
        <Editor.Plugin {...calloutPlugin} />
        <Editor.Plugin {...togglePlugin} />
        <Editor.Plugin {...tocPlugin} />
        <Editor.Plugin {...columnsPlugin} />
        <Editor.Plugin blocks={LINK_BLOCKS} renderers={{ bookmark: BookmarkView, iframe: LazyIframeView }} slashItems={linkSlashItems} />
        <Editor.Plugin marks={[commentMark]} />
        <EditorCommentsProvider adapter={adapter} author={author} locale={locale}>
          <Workspace locale={locale} user={user} theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </EditorCommentsProvider>
      </Editor>
    </LinkContextProvider>
  </div>;
}
