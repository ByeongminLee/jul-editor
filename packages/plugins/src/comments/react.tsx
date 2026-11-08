"use client";

// React layer over the comments controller. Everything visual is overridable:
//  - `classNames` slots on each component (host CSS / Tailwind), and
//  - CSS variables with defaults (--jul-editor-comment-*), set on any ancestor.
// Components read the controller from <CommentsProvider>; none touch the network.

import type { Editor as CoreEditor } from "@jul-editor/core";
import { useEditor } from "@jul-editor/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { CommentAdapter } from "./adapter.js";
import { createCommentsController, filterThreads } from "./controller.js";
import type { CommentFilter, CommentsCallbacks, CommentsController, CommentsState, ThreadView } from "./controller.js";
import type { Comment, CommentAuthor } from "./types.js";

// ---- labels -----------------------------------------------------------------------

export interface CommentLabels {
  addComment: string;
  title: string;
  empty: string;
  filterAll: string;
  filterOpen: string;
  filterResolved: string;
  detached: string;
  resolved: string;
  placeholderNew: string;
  placeholderReply: string;
  submit: string;
  reply: string;
  cancel: string;
  save: string;
  edit: string;
  delete: string;
  deleteThread: string;
  resolve: string;
  reopen: string;
  edited: string;
}

export const EN_COMMENT_LABELS: CommentLabels = {
  addComment: "Add comment",
  title: "Comments",
  empty: "No comments yet. Select text and add one.",
  filterAll: "All",
  filterOpen: "Open",
  filterResolved: "Resolved",
  detached: "Original text was removed",
  resolved: "Resolved",
  placeholderNew: "Write a comment",
  placeholderReply: "Reply",
  submit: "Comment",
  reply: "Reply",
  cancel: "Cancel",
  save: "Save",
  edit: "Edit",
  delete: "Delete",
  deleteThread: "Delete thread",
  resolve: "Resolve",
  reopen: "Reopen",
  edited: "edited",
};

export const KO_COMMENT_LABELS: CommentLabels = {
  addComment: "댓글 추가",
  title: "댓글",
  empty: "댓글이 없습니다. 텍스트를 선택해 추가하세요.",
  filterAll: "전체",
  filterOpen: "열림",
  filterResolved: "해결됨",
  detached: "원본 텍스트가 삭제되었습니다",
  resolved: "해결됨",
  placeholderNew: "댓글 작성",
  placeholderReply: "답글",
  submit: "댓글",
  reply: "답글",
  cancel: "취소",
  save: "저장",
  edit: "수정",
  delete: "삭제",
  deleteThread: "스레드 삭제",
  resolve: "해결",
  reopen: "다시 열기",
  edited: "수정됨",
};

// ---- context / provider ---------------------------------------------------------------

const CommentsContext = createContext<{ controller: CommentsController; labels: CommentLabels; formatTime: (ts: number) => string } | null>(null);

export interface CommentsProviderProps extends CommentsCallbacks {
  editor: CoreEditor | null;
  adapter: CommentAdapter;
  /** The current user (a function lets the host return a fresh value without re-creating the controller). */
  author: CommentAuthor | (() => CommentAuthor);
  locale?: "en" | "ko";
  labels?: Partial<CommentLabels>;
  formatTime?: (ts: number) => string;
  /** Inject the highlight stylesheet (default true). Disable to style `[data-mark="comment"]` yourself. */
  injectStyles?: boolean;
  children?: ReactNode;
}

/** Provides the comments controller to the components below. Pass the core editor
 * (e.g. from react's `useEditor()`); use <EditorCommentsProvider> to fetch it from context. */
export function CommentsProvider(props: CommentsProviderProps): ReactNode {
  const { editor, adapter, author, locale, labels, formatTime, injectStyles = true, children } = props;
  // callbacks/author are read through refs so a new inline function never rebuilds the controller
  const cbRef = useRef(props);
  cbRef.current = props;
  const authorRef = useRef(author);
  authorRef.current = author;

  const [controller, setController] = useState<CommentsController | null>(null);
  useEffect(() => {
    if (!editor) return;
    const c = createCommentsController({
      editor,
      adapter,
      author: () => (typeof authorRef.current === "function" ? authorRef.current() : authorRef.current),
      onThreadCreated: (t) => cbRef.current.onThreadCreated?.(t),
      onThreadUpdated: (t) => cbRef.current.onThreadUpdated?.(t),
      onThreadResolved: (t) => cbRef.current.onThreadResolved?.(t),
      onThreadReopened: (t) => cbRef.current.onThreadReopened?.(t),
      onThreadDeleted: (id) => cbRef.current.onThreadDeleted?.(id),
    });
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [editor, adapter]);

  // hover tracking by delegation on the editor root (spans are re-created on render, so no per-span listeners)
  useEffect(() => {
    if (!editor || !controller) return;
    const root = editor.getRoot();
    const idAt = (t: EventTarget | null): string | null => (t instanceof Element ? (t.closest("[data-mark-thread-id]")?.getAttribute("data-mark-thread-id") ?? null) : null);
    const over = (e: MouseEvent) => controller.hover(idAt(e.target));
    const leave = () => controller.hover(null);
    const click = (e: MouseEvent) => {
      const id = idAt(e.target);
      if (id && controller.getState().threads.some((v) => v.thread.id === id)) controller.select(id);
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseleave", leave);
    root.addEventListener("click", click);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseleave", leave);
      root.removeEventListener("click", click);
    };
  }, [editor, controller]);

  const value = useMemo(
    () =>
      controller
        ? {
            controller,
            labels: { ...(locale === "ko" ? KO_COMMENT_LABELS : EN_COMMENT_LABELS), ...labels },
            formatTime: formatTime ?? ((ts: number) => new Date(ts).toLocaleString()),
          }
        : null,
    [controller, locale, labels, formatTime],
  );

  return (
    <CommentsContext.Provider value={value}>
      {injectStyles && controller ? <CommentStyles controller={controller} /> : null}
      {children}
    </CommentsContext.Provider>
  );
}

/** Same as CommentsProvider but reads the editor from @jul-editor/react's context. */
export function EditorCommentsProvider(props: Omit<CommentsProviderProps, "editor">): ReactNode {
  const editor = useEditor();
  return <CommentsProvider {...props} editor={editor} />;
}

/** `{controller, state}` or null before the editor is ready. */
export function useComments(): { controller: CommentsController; state: CommentsState } | null {
  const ctx = useContext(CommentsContext); // null until the editor mounted: components render nothing/disabled
  const subscribe = useCallback((l: () => void) => (ctx ? ctx.controller.subscribe(l) : () => {}), [ctx]);
  const get = useCallback(() => (ctx ? ctx.controller.getState() : null), [ctx]);
  const state = useSyncExternalStore(subscribe, get, get);
  return ctx && state ? { controller: ctx.controller, state } : null;
}

// ---- highlight styles --------------------------------------------------------------------

const safeId = (id: string): string => id.replace(/["\\\]]/g, "");

/** Stylesheet for anchored text: base highlight, hovered/selected thread, resolved threads
 * (faded), block-anchored threads. Per-thread selectors are generated from controller state
 * (no DOM mutation, so it survives every re-render). Colors: --jul-editor-comment-bg,
 * -bg-active, -border, -resolved-bg. */
export function CommentStyles({ controller }: { controller: CommentsController }): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const mark = (id: string) => `[data-mark="comment"][data-mark-thread-id="${safeId(id)}"]`;
  const block = (id: string) => `[data-jul-editor-block][data-id="${safeId(id)}"]`;
  let css = `
[data-mark="comment"]{background:var(--jul-editor-comment-bg,rgba(255,200,0,.28));border-bottom:2px solid var(--jul-editor-comment-border,rgba(230,160,0,.7));cursor:pointer;transition:background .12s}
`;
  for (const v of state.threads) {
    const id = v.thread.id;
    const anchor = v.thread.anchor;
    const target = anchor.type === "block" ? block(anchor.blockId) : mark(id);
    if (anchor.type === "block") css += `${target}{box-shadow:inset 3px 0 0 var(--jul-editor-comment-border,rgba(230,160,0,.7))}\n`;
    if (v.thread.status === "resolved") css += `${target}{background:var(--jul-editor-comment-resolved-bg,transparent);border-bottom-color:transparent}\n`;
    if (state.hoveredThreadId === id || state.selectedThreadId === id) {
      css += `${target}{background:var(--jul-editor-comment-bg-active,rgba(255,200,0,.5));border-bottom-color:var(--jul-editor-comment-border,rgba(230,160,0,1))}\n`;
    }
  }
  return <style data-jul-editor-comment-styles="">{css}</style>;
}

// ---- add comment button / command ---------------------------------------------------------

export interface AddCommentButtonProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Called after the draft box was opened (e.g. to focus the panel). */
  onOpen?: () => void;
}

/** Starts a comment draft from the current selection. Drop it in `<Editor.BubbleMenu>` or a toolbar.
 * Disabled while no range is selected. Uses onMouseDown + preventDefault so the click does not
 * collapse the editor selection before the draft captures it. */
export function AddCommentButton({ className, style, children, onOpen }: AddCommentButtonProps): ReactNode {
  const ctx = useContext(CommentsContext);
  const c = useComments();
  const label = ctx?.labels.addComment ?? EN_COMMENT_LABELS.addComment;
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={!c?.state.canAdd}
      aria-label={label}
      title={label}
      data-jul-editor-comment-add=""
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (c?.controller.beginDraft()) onOpen?.();
      }}
    >
      {children ?? label}
    </button>
  );
}

// ---- panel ------------------------------------------------------------------------------------

export interface CommentsClassNames {
  root?: string;
  header?: string;
  filters?: string;
  filter?: string;
  list?: string;
  card?: string;
  cardSelected?: string;
  quote?: string;
  comment?: string;
  author?: string;
  body?: string;
  meta?: string;
  actions?: string;
  button?: string;
  input?: string;
  empty?: string;
  badge?: string;
}

export interface CommentsPanelProps {
  /** "aligned": each card sits next to its anchor (needs the panel to share the editor's
   * scroll container/top); "list": plain stacked list. Default "list". */
  layout?: "list" | "aligned";
  className?: string;
  classNames?: CommentsClassNames;
  style?: CSSProperties;
  /** Only the open/resolved filter bar is hidden when false (default true). */
  showFilters?: boolean;
}

const css = {
  root: { display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--jul-editor-comment-fg,inherit)" } as CSSProperties,
  card: { border: "1px solid var(--jul-editor-comment-card-border,rgba(128,128,128,.3))", borderRadius: 8, padding: 10, background: "var(--jul-editor-comment-card-bg,transparent)", display: "flex", flexDirection: "column", gap: 8 } as CSSProperties,
  cardSelected: { borderColor: "var(--jul-editor-comment-border,rgba(230,160,0,1))", boxShadow: "0 0 0 1px var(--jul-editor-comment-border,rgba(230,160,0,1))" } as CSSProperties,
  muted: { opacity: 0.65, fontSize: 12 } as CSSProperties,
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } as CSSProperties,
  input: { width: "100%", boxSizing: "border-box", font: "inherit", padding: 6, borderRadius: 6, border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit", resize: "vertical" } as CSSProperties,
  btn: { font: "inherit", fontSize: 12, padding: "2px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit", cursor: "pointer" } as CSSProperties,
};

function Avatar({ author }: { author: CommentAuthor }): ReactNode {
  const base: CSSProperties = { width: 22, height: 22, borderRadius: "50%", flex: "none", background: author.color ?? "#888", color: "#fff", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
  return author.avatar ? <img src={author.avatar} alt="" style={base} /> : <span style={base} aria-hidden="true">{(author.name || "?").slice(0, 1).toUpperCase()}</span>;
}

function Composer(props: { placeholder: string; submitLabel: string; cancelLabel?: string; initial?: string; autoFocus?: boolean; onSubmit(body: string): void; onCancel?(): void; classNames?: CommentsClassNames }): ReactNode {
  const [text, setText] = useState(props.initial ?? "");
  const cn = props.classNames ?? {};
  const submit = () => {
    if (!text.trim()) return;
    props.onSubmit(text);
    setText("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        className={cn.input}
        style={cn.input ? undefined : css.input}
        rows={2}
        value={text}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") props.onCancel?.();
        }}
      />
      <div style={css.row}>
        <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} disabled={!text.trim()} onClick={submit}>
          {props.submitLabel}
        </button>
        {props.onCancel ? (
          <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentItem({ threadId, comment, controller, classNames, labels, formatTime }: { threadId: string; comment: Comment; controller: CommentsController; classNames?: CommentsClassNames; labels: CommentLabels; formatTime(ts: number): string }): ReactNode {
  const [editing, setEditing] = useState(false);
  const cn = classNames ?? {};
  return (
    <div className={cn.comment} data-comment-id={comment.id} style={{ display: "flex", gap: 8 }}>
      <Avatar author={comment.author} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={css.row}>
          <strong className={cn.author}>{comment.author.name}</strong>
          <span className={cn.meta} style={css.muted}>
            {formatTime(comment.createdAt)}
            {comment.editedAt ? ` (${labels.edited})` : ""}
          </span>
        </div>
        {editing ? (
          <Composer
            placeholder={labels.edit}
            submitLabel={labels.save}
            cancelLabel={labels.cancel}
            initial={comment.body}
            autoFocus
            classNames={cn}
            onSubmit={(b) => {
              void controller.editComment(threadId, comment.id, b);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className={cn.body} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {comment.body}
          </div>
        )}
        {!editing ? (
          <div className={cn.actions} style={css.row}>
            <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => setEditing(true)}>
              {labels.edit}
            </button>
            <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => void controller.deleteComment(threadId, comment.id)}>
              {labels.delete}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThreadCard({ view, selected, controller, classNames, labels, formatTime, cardRef, style }: { view: ThreadView; selected: boolean; controller: CommentsController; classNames?: CommentsClassNames; labels: CommentLabels; formatTime(ts: number): string; cardRef?: (el: HTMLDivElement | null) => void; style?: CSSProperties }): ReactNode {
  const { thread } = view;
  const [replying, setReplying] = useState(false);
  const cn = classNames ?? {};
  const quote = thread.anchor.type === "text" ? thread.anchor.quote : null;
  return (
    <div
      ref={cardRef}
      role="group"
      aria-label={`${labels.title}: ${thread.comments[0]?.author.name ?? ""}`}
      className={[cn.card, selected ? cn.cardSelected : ""].filter(Boolean).join(" ") || undefined}
      style={{ ...(cn.card ? {} : css.card), ...(selected && !cn.cardSelected ? css.cardSelected : {}), ...style }}
      data-thread-id={thread.id}
      data-status={thread.status}
      data-detached={view.detached ? "" : undefined}
      data-selected={selected ? "" : undefined}
      onClick={() => controller.select(thread.id, { scroll: true })}
    >
      {quote ? (
        <div className={cn.quote} style={{ ...css.muted, borderLeft: "3px solid var(--jul-editor-comment-border,rgba(230,160,0,.7))", paddingLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {quote}
        </div>
      ) : null}
      {view.detached || thread.status === "resolved" ? (
        <div style={css.row}>
          {view.detached ? <span className={cn.badge} style={css.muted} data-badge="detached">{labels.detached}</span> : null}
          {thread.status === "resolved" ? <span className={cn.badge} style={css.muted} data-badge="resolved">{labels.resolved}</span> : null}
        </div>
      ) : null}
      {thread.comments.map((c) => (
        <CommentItem key={c.id} threadId={thread.id} comment={c} controller={controller} classNames={cn} labels={labels} formatTime={formatTime} />
      ))}
      {replying ? (
        <Composer
          placeholder={labels.placeholderReply}
          submitLabel={labels.reply}
          cancelLabel={labels.cancel}
          autoFocus
          classNames={cn}
          onSubmit={(b) => {
            void controller.reply(thread.id, b);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : null}
      <div className={cn.actions} style={css.row} onClick={(e) => e.stopPropagation()}>
        {!replying ? (
          <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => setReplying(true)}>
            {labels.reply}
          </button>
        ) : null}
        {thread.status === "open" ? (
          <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => void controller.resolve(thread.id)}>
            {labels.resolve}
          </button>
        ) : (
          <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => void controller.reopen(thread.id)}>
            {labels.reopen}
          </button>
        )}
        <button type="button" className={cn.button} style={cn.button ? undefined : css.btn} onClick={() => void controller.deleteThread(thread.id)}>
          {labels.deleteThread}
        </button>
      </div>
    </div>
  );
}

/** Y of each card's anchor relative to the panel, resolved against the doc's DOM. */
function anchorTop(editor: CoreEditor, v: ThreadView | "draft", state: CommentsState, panel: HTMLElement): number | null {
  const root = editor.getRoot();
  let el: Element | null | undefined;
  if (v === "draft") {
    const d = state.draft;
    if (!d) return null;
    const bid = d.type === "block" ? d.blockId : d.selection.anchor.blockId;
    el = Array.from(root.querySelectorAll("[data-jul-editor-block]")).find((e) => e.getAttribute("data-id") === bid);
  } else if (v.thread.anchor.type === "block") {
    const bid = v.thread.anchor.blockId;
    el = Array.from(root.querySelectorAll("[data-jul-editor-block]")).find((e) => e.getAttribute("data-id") === bid);
  } else if (!v.detached) {
    el = Array.from(root.querySelectorAll("[data-mark-thread-id]")).find((e) => e.getAttribute("data-mark-thread-id") === v.thread.id);
  }
  if (!el) return null;
  return el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
}

/** The threads side panel: filter bar, new-comment draft, thread cards (replies, edit, delete,
 * resolve/reopen). Clicking a card selects its thread (highlight + scroll to anchor); clicking
 * highlighted text selects the card (see CommentsProvider). */
export function CommentsPanel({ layout = "list", className, classNames, style, showFilters = true }: CommentsPanelProps): ReactNode {
  const ctx = useContext(CommentsContext);
  const c = useComments();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const cn = classNames ?? {};

  const state = c?.state;
  const visible = useMemo(() => (state ? filterThreads(state.threads, state.filter) : []), [state]);

  // aligned layout: desired top = anchor top, then push down so cards never overlap
  const layoutCards = useCallback(() => {
    const panel = panelRef.current;
    const controller = ctx?.controller;
    if (layout !== "aligned" || !panel || !controller || !state) return;
    const ed = controller.editor;
    const items: Array<{ key: string; view: ThreadView | "draft" }> = [...(state.draft ? [{ key: "__draft", view: "draft" as const }] : []), ...visible.map((v) => ({ key: v.thread.id, view: v }))];
    const next: Record<string, number> = {};
    let cursor = 0;
    for (const { key, view } of items) {
      const want = anchorTop(ed, view, state, panel);
      const h = cardEls.current.get(key)?.offsetHeight ?? 0;
      const top = Math.max(want ?? cursor, cursor);
      next[key] = top;
      cursor = top + h + 8;
    }
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setHeight(cursor);
  }, [layout, ctx, state, visible]);
  useLayoutEffect(layoutCards, [layoutCards]);
  useEffect(() => {
    if (layout !== "aligned" || typeof window === "undefined") return;
    window.addEventListener("resize", layoutCards);
    return () => window.removeEventListener("resize", layoutCards);
  }, [layout, layoutCards]);

  if (!ctx || !c || !state) return null;
  const { controller, labels, formatTime } = ctx;
  const aligned = layout === "aligned";
  const place = (key: string): CSSProperties | undefined => (aligned ? { position: "absolute", left: 0, right: 0, top: tops[key] ?? 0 } : undefined);
  const filters: Array<[CommentFilter, string]> = [
    ["all", labels.filterAll],
    ["open", labels.filterOpen],
    ["resolved", labels.filterResolved],
  ];

  return (
    <div ref={panelRef} className={[cn.root, className].filter(Boolean).join(" ") || undefined} style={{ ...(cn.root ? {} : css.root), ...style }} data-jul-editor-comments-panel="" data-layout={layout}>
      <div className={cn.header} style={css.row}>
        <strong>{labels.title}</strong>
        {showFilters ? (
          <div className={cn.filters} style={css.row} role="tablist">
            {filters.map(([f, text]) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={state.filter === f}
                className={cn.filter}
                style={cn.filter ? undefined : { ...css.btn, fontWeight: state.filter === f ? 700 : 400 }}
                onClick={() => controller.setFilter(f)}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={cn.list} style={aligned ? { position: "relative", minHeight: height } : { display: "flex", flexDirection: "column", gap: 8 }}>
        {state.draft ? (
          <div ref={(el) => void (el ? cardEls.current.set("__draft", el as HTMLDivElement) : cardEls.current.delete("__draft"))} className={cn.card} style={{ ...(cn.card ? {} : css.card), ...place("__draft") }} data-jul-editor-comment-draft="">
            {state.draft.type === "text" ? (
              <div className={cn.quote} style={{ ...css.muted, borderLeft: "3px solid var(--jul-editor-comment-border,rgba(230,160,0,.7))", paddingLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {state.draft.quote}
              </div>
            ) : null}
            <Composer placeholder={labels.placeholderNew} submitLabel={labels.submit} cancelLabel={labels.cancel} autoFocus classNames={cn} onSubmit={(b) => void controller.submitDraft(b)} onCancel={() => controller.cancelDraft()} />
          </div>
        ) : null}
        {visible.map((v) => (
          <ThreadCard
            key={v.thread.id}
            view={v}
            selected={state.selectedThreadId === v.thread.id}
            controller={controller}
            classNames={cn}
            labels={labels}
            formatTime={formatTime}
            style={place(v.thread.id)}
            cardRef={(el) => void (el ? cardEls.current.set(v.thread.id, el) : cardEls.current.delete(v.thread.id))}
          />
        ))}
        {visible.length === 0 && !state.draft ? (
          <div className={cn.empty} style={css.muted}>
            {labels.empty}
          </div>
        ) : null}
      </div>
    </div>
  );
}
