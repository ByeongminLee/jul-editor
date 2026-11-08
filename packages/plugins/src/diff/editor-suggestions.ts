// In-editor suggestion mode: shows a proposed change set directly inside the LIVE editor using
// core's view-only range / widget decorations (`editor.setDecorations`), and resolves each change
// with a transaction (one undo step). The model never contains the markup, so nothing leaks into
// saving, collaboration or export. Framework-agnostic; the React hook lives in
// use-editor-suggestions.ts and SuggestionView (read-only review panel) is unchanged.
//
// Perspective (which document the editor holds):
//   "base" (default)  the editor holds the user's current text and `proposed` is the suggestion.
//                     Insertions are ghost widgets (highlighted text that is not in the document),
//                     deletions are highlighted ranges over real text with strike-through.
//                     accept = apply the change to the editor; reject = drop it from `proposed`.
//   "proposed"        the editor already holds the suggested text (an AI wrote into it) and the doc
//                     passed in is the ORIGINAL to compare against. Insertions are highlighted
//                     ranges over real text, deletions are strike-through widgets.
//                     accept = the original absorbs the change; reject = revert it in the editor.
// Either way every decision is `applyDecisions` + `reconcileDoc`, so id-matched blocks keep their
// identity, selection and undo history.
//
// Controls: ONE small floating toolbar (check / x icon buttons, role=toolbar) per change, shown while
// the pointer is over a change or the caret is inside it, like Tiptap's suggestion bubble. It lives
// outside the contenteditable (position: fixed in <body>), so it never touches the model or the
// selection. Keyboard: Alt+Shift+A accepts and Alt+Shift+R rejects the change under the caret;
// Escape hides the control. Deleted text is struck through, inserted text underlined (green).
//
// Limits (documented, not hidden): an inserted block while perspective is "base" (or a deleted
// block in "proposed") is not in the editor, so it is previewed as a ghost line widget anchored at
// the end of the nearest preceding block; void blocks have no text to decorate and only get their
// controls. Mark-only changes (`format`) get a range class, their old marks are not drawn.

import type { Decoration, Doc, Editor, Registry } from "@jul-editor/core";
import { coreRegistry } from "@jul-editor/core";
import { applyDecisions } from "./apply-decisions.js";
import type { ChangeDecision } from "./apply-decisions.js";
import { computeInlineDiff } from "./inline-diff.js";
import type { ChangeAttribution, InlineChange, InlineDiff, InlineDiffBlock } from "./inline-diff.js";
import { reconcileDoc } from "./reconcile-doc.js";

export interface EditorSuggestionLabels {
  accept: string;
  reject: string;
  /** aria-label of the floating toolbar. */
  toolbar: string;
}

export const DEFAULT_EDITOR_SUGGESTION_LABELS: EditorSuggestionLabels = { accept: "Accept", reject: "Reject", toolbar: "Suggested change" };

export interface EditorSuggestionsOptions {
  registry?: Registry;
  perspective?: "base" | "proposed";
  attribute?: (change: InlineChange) => ChangeAttribution | undefined;
  labels?: Partial<EditorSuggestionLabels>;
  /** Decoration key; change it to run two controllers on one editor. Default "jul-suggestions". */
  decorationKey?: string;
  /** false: decorate only, no floating Accept/Reject control (the host draws its own list from `changes`). */
  controls?: boolean;
  /** Text hunk granularity, see ComputeInlineDiffOptions. Default "word". */
  granularity?: "char" | "word";
}

export interface EditorSuggestions {
  /** Pending changes of the current diff. */
  readonly changes: readonly InlineChange[];
  readonly diff: InlineDiff;
  /** The suggestion that is still undecided, as a whole Doc: what the editor would become after
   * "accept all". Perspective "base": the proposal minus rejected changes. "proposed": the editor
   * doc itself. null while suggestion mode is off. Compare the editor/original doc against this in
   * a Review or Diff view so partial decisions are respected. */
  readonly remainingProposal: Doc | null;
  accept(changeId: string): void;
  reject(changeId: string): void;
  acceptAll(): void;
  rejectAll(): void;
  /** Replaces the suggestion (or the original, for perspective "proposed"). */
  setProposed(doc: Doc | null): void;
  /** Called after every recompute; the returned function unsubscribes. */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

/** Class names put on range decorations / ghost widgets; style them in the host (see SUGGESTION_CSS). */
export const SUGGESTION_CLASSES = { ins: "jul-editor-suggest-ins", del: "jul-editor-suggest-del", fmt: "jul-editor-suggest-fmt" } as const;

/** Optional stylesheet for the decorations and the Accept/Reject widgets (CSS variables, no inline styles). */
export const SUGGESTION_CSS = `
.jul-editor-suggest-ins{background:var(--jul-editor-diff-ins-bg,rgba(46,160,67,.16));text-decoration:underline;text-decoration-color:var(--jul-editor-diff-ins-line,#2ea043);text-decoration-thickness:2px;text-underline-offset:2px}
.jul-editor-suggest-del{background:var(--jul-editor-diff-del-bg,rgba(248,81,73,.14));text-decoration:line-through;text-decoration-color:var(--jul-editor-diff-del-line,#f85149)}
.jul-editor-suggest-fmt{background:var(--jul-editor-diff-fmt-bg,rgba(56,139,253,.18))}
[data-jul-editor-suggest-ghost]{user-select:none}
[data-jul-editor-suggest-anchor]{display:inline-block;width:0;height:0;overflow:hidden}
[data-change][data-active]{outline:1px solid var(--jul-editor-diff-author,rgba(100,100,100,.5));outline-offset:1px;border-radius:2px}
[data-jul-editor-suggest-control]{position:fixed;z-index:1000;display:flex;gap:2px;padding:2px;border-radius:6px;background:var(--jul-editor-suggest-control-bg,#fff);color:var(--jul-editor-suggest-control-ink,#1f2328);border:1px solid var(--jul-editor-diff-author,rgba(0,0,0,.18));box-shadow:0 2px 8px rgba(0,0,0,.15)}
[data-jul-editor-suggest-control][hidden]{display:none}
[data-jul-editor-suggest-control] button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
[data-jul-editor-suggest-control] button:hover,[data-jul-editor-suggest-control] button:focus-visible{background:rgba(127,127,127,.2)}
[data-jul-editor-suggest-control] button[data-action=accept]{color:var(--jul-editor-diff-ins-line,#2ea043)}
[data-jul-editor-suggest-control] button[data-action=reject]{color:var(--jul-editor-diff-del-line,#f85149)}
[data-jul-editor-suggest-control] svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

const EMPTY_DIFF: InlineDiff = computeInlineDiff({ version: 1, blocks: [] }, { version: 1, blocks: [] });

interface Anchor {
  blockId: string;
  offset: number;
}

interface FlatInfo {
  parentId: string | null;
  index: number;
  siblings: string[];
  contentLen: number;
  hasContent: boolean;
}

function flatten(blocks: Doc["blocks"], out: Map<string, FlatInfo> = new Map(), parentId: string | null = null): Map<string, FlatInfo> {
  const ids = blocks.map((b) => b.id);
  blocks.forEach((b, index) => {
    const len = (b.content ?? []).reduce((n, i) => n + (i.type === "text" ? (i as { text: string }).text.length : 1), 0);
    out.set(b.id, { parentId, index, siblings: ids, contentLen: len, hasContent: b.content !== undefined });
    if (b.children) flatten(b.children, out, b.id);
  });
  return out;
}

export function createEditorSuggestions(editor: Editor, initialProposed: Doc | null, opts: EditorSuggestionsOptions = {}): EditorSuggestions {
  const registry = opts.registry ?? editor.getRegistry() ?? coreRegistry;
  const perspective = opts.perspective ?? "base";
  const key = opts.decorationKey ?? "jul-suggestions";
  const labels = { ...DEFAULT_EDITOR_SUGGESTION_LABELS, ...opts.labels };
  const showControls = opts.controls !== false;
  let other: Doc | null = initialProposed; // the suggestion ("base") or the original ("proposed")
  let diff: InlineDiff = EMPTY_DIFF;
  const listeners = new Set<() => void>();
  let destroyed = false;

  // the diff always runs before -> after: base: editor -> suggestion; proposed: original -> editor
  const sides = (): { before: Doc; after: Doc } | null => {
    if (!other) return null;
    const mine = editor.getDoc();
    return perspective === "base" ? { before: mine, after: other } : { before: other, after: mine };
  };

  // ---- floating ctlEl -------------------------------------------------------------------
  const root = editor.getRoot();
  const doc0 = root.ownerDocument;
  let ctlEl: HTMLElement | null = null;
  let activeId: string | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** blockId -> change id for changes that have no inline element to hover (props, moves, void blocks) */
  let blockChange = new Map<string, string>();
  const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const elementsOf = (id: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[data-change="${CSS.escape(id)}"]`)];

  const hideControl = (): void => {
    clearTimeout(hideTimer);
    if (ctlEl) ctlEl.hidden = true;
    for (const el of root.querySelectorAll("[data-active]")) el.removeAttribute("data-active");
    activeId = null;
  };

  const placeControl = (): void => {
    if (!ctlEl || !activeId) return;
    const els = elementsOf(activeId);
    if (els.length === 0) return hideControl();
    let top = Infinity;
    let right = -Infinity;
    let left = Infinity;
    let bottom = -Infinity;
    for (const el of els) {
      const rects = el.getClientRects();
      for (const r of rects.length ? [...rects] : [el.getBoundingClientRect()]) {
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
    }
    const w = ctlEl.offsetWidth || 56;
    const h = ctlEl.offsetHeight || 28;
    const view = doc0.defaultView ?? window;
    let y = top - h - 4;
    if (y < 4) y = bottom + 4; // no room above: below the change
    const x = Math.max(4, Math.min(right - w, view.innerWidth - w - 4, Math.max(left, right - w)));
    ctlEl.style.top = `${Math.round(y)}px`;
    ctlEl.style.left = `${Math.round(x)}px`;
  };

  const showControl = (id: string): void => {
    if (!showControls || !ctlEl) return;
    const change = diff.changeById.get(id);
    if (!change) return hideControl();
    clearTimeout(hideTimer);
    if (activeId !== id) {
      for (const el of root.querySelectorAll("[data-active]")) el.removeAttribute("data-active");
      for (const el of elementsOf(id)) if (!el.hasAttribute("data-jul-editor-suggest-anchor")) el.setAttribute("data-active", "");
      activeId = id;
      ctlEl.setAttribute("data-for", id);
      ctlEl.setAttribute("data-kind", change.kind);
      ctlEl.setAttribute("aria-label", `${labels.toolbar}: ${change.summary}`);
      for (const action of ["accept", "reject"] as const) {
        const b = ctlEl.querySelector<HTMLElement>(`[data-action=${action}]`)!;
        b.setAttribute("aria-label", `${labels[action]}: ${change.summary}`);
        b.title = labels[action];
      }
      if (change.attribution?.color) ctlEl.style.setProperty("--jul-editor-diff-author", change.attribution.color);
      else ctlEl.style.removeProperty("--jul-editor-diff-author");
    }
    ctlEl.hidden = false;
    placeControl();
  };

  const changeAt = (node: Node | null): string | null => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    if (!el || !root.contains(el)) return null;
    const hit = el.closest<HTMLElement>("[data-change]");
    if (hit && root.contains(hit)) return hit.getAttribute("data-change");
    const block = el.closest<HTMLElement>("[data-id]");
    return block ? (blockChange.get(block.getAttribute("data-id")!) ?? null) : null;
  };
  const caretChange = (): string | null => {
    const sel = doc0.getSelection();
    return sel && sel.rangeCount ? changeAt(sel.focusNode) : null;
  };

  const scheduleHide = (): void => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const caret = caretChange();
      if (caret && root.contains(doc0.activeElement)) showControl(caret);
      else hideControl();
    }, 160);
  };
  const onOver = (e: Event): void => {
    const id = changeAt(e.target as Node);
    if (id) showControl(id);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && activeId) return hideControl();
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const id = caretChange();
    if (!id) return;
    if (e.code === "KeyA") (e.preventDefault(), decide("accept", [id]));
    else if (e.code === "KeyR") (e.preventDefault(), decide("reject", [id]));
  };
  const onSelection = (): void => {
    const id = caretChange();
    if (id) showControl(id);
    else if (activeId && !ctlEl?.matches(":hover")) scheduleHide();
  };
  const onScroll = (): void => placeControl();

  if (showControls) {
    ctlEl = doc0.createElement("div");
    ctlEl.setAttribute("data-jul-editor-suggest-control", "");
    ctlEl.setAttribute("role", "toolbar");
    ctlEl.hidden = true;
    for (const action of ["accept", "reject"] as const) {
      const b = doc0.createElement("button");
      b.type = "button";
      b.setAttribute("data-action", action);
      b.innerHTML = action === "accept" ? ICON_CHECK : ICON_X;
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret where it is
      b.addEventListener("click", (e) => {
        e.preventDefault();
        const id = activeId;
        if (!id) return;
        hideControl();
        decide(action, [id]);
      });
      ctlEl.appendChild(b);
    }
    ctlEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    ctlEl.addEventListener("mouseleave", scheduleHide);
    ctlEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideControl();
        root.focus();
      }
    });
    doc0.body.appendChild(ctlEl);
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", scheduleHide);
    root.addEventListener("keydown", onKey);
    doc0.addEventListener("scroll", onScroll, true);
    (doc0.defaultView ?? window).addEventListener("resize", onScroll);
  }

  const ghost = (tag: "ins" | "del", text: string, changeId: string): (() => HTMLElement) => () => {
    const el = document.createElement(tag);
    el.className = tag === "ins" ? SUGGESTION_CLASSES.ins : SUGGESTION_CLASSES.del;
    el.setAttribute("data-change", changeId);
    el.setAttribute("data-jul-editor-suggest-ghost", tag);
    el.textContent = text.replace(/￼/g, "");
    return el;
  };

  function compute(): void {
    if (destroyed) return;
    const s = sides();
    diff = s ? computeInlineDiff(s.before, s.after, { registry, attribute: opts.attribute, granularity: opts.granularity }) : EMPTY_DIFF;
    const mine = editor.getDoc();
    const mineIdx = flatten(mine.blocks);
    const otherIdx = other ? flatten(other.blocks) : new Map<string, FlatInfo>();
    const decos: Decoration[] = [];
    const controlled = new Set<string>();
    const nextBlockChange = new Map<string, string>();
    // zero-size anchor so every change has an element the floating control can sit on, even a
    // props/move change or a void block with no text of its own
    const control = (change: InlineChange | undefined, at: Anchor): void => {
      if (!showControls || !change || controlled.has(change.id)) return;
      controlled.add(change.id);
      if (!nextBlockChange.has(at.blockId) || change.kind !== "text") nextBlockChange.set(at.blockId, change.id);
      decos.push({
        blockId: at.blockId,
        offset: at.offset,
        render: () => {
          const a = document.createElement("span");
          a.setAttribute("data-jul-editor-suggest-anchor", "");
          a.setAttribute("data-change", change.id);
          a.setAttribute("aria-hidden", "true");
          return a;
        },
      });
    };
    const range = (blockId: string, from: number, to: number, kind: "ins" | "del" | "fmt", changeId: string): void => {
      if (to > from) decos.push({ blockId, from, to, class: SUGGESTION_CLASSES[kind], attrs: { "data-change": changeId } });
    };
    // nearest block of the editor that precedes `id` in the other document (anchor for ghost blocks)
    const anchorFor = (id: string): Anchor | null => {
      let cursor: string | null = id;
      while (cursor !== null) {
        const info = otherIdx.get(cursor);
        if (!info) break;
        for (let i = info.index - 1; i >= 0; i--) {
          const m = mineIdx.get(info.siblings[i]!);
          if (m?.hasContent) return { blockId: info.siblings[i]!, offset: m.contentLen };
        }
        cursor = info.parentId;
        const m = cursor !== null ? mineIdx.get(cursor) : undefined;
        if (cursor !== null && m?.hasContent) return { blockId: cursor, offset: m.contentLen };
      }
      const first = mine.blocks.find((b) => b.content !== undefined);
      return first ? { blockId: first.id, offset: 0 } : null;
    };

    const ghostKind = perspective === "base" ? "insert" : "delete"; // status of a block only the other document has
    const coverKindHere = perspective === "base" ? "delete" : "insert"; // status of a block only the editor has
    const walk = (blocks: InlineDiffBlock[]): void => {
      for (const b of blocks) {
        const info = mineIdx.get(b.id);
        const own = b.changeIds.map((id) => diff.changeById.get(id)).filter((c): c is InlineChange => !!c);
        if (info) {
          const start: Anchor = { blockId: b.id, offset: 0 };
          const end: Anchor = { blockId: b.id, offset: info.contentLen };
          // a whole block (and its descendants) that only the editor has
          if (b.status === coverKindHere && b.coverId) {
            range(b.id, 0, info.contentLen, perspective === "base" ? "del" : "ins", b.coverId);
            control(diff.changeById.get(b.coverId), info.hasContent ? end : start);
          }
          if (b.segments) {
            let off = 0;
            let hunk: { change: InlineChange; at: Anchor } | null = null;
            let prev: string | undefined;
            for (const seg of b.segments) {
              if (seg.changeId !== prev && hunk) {
                control(hunk.change, hunk.at);
                hunk = null;
              }
              prev = seg.changeId;
              const len = seg.text.length;
              const change = seg.changeId ? diff.changeById.get(seg.changeId) : undefined;
              if (seg.kind === "same") {
                off += len;
                continue;
              }
              if (seg.kind === "fmt") {
                range(b.id, off, off + len, "fmt", seg.changeId!);
                off += len;
              } else if (seg.kind === "ins") {
                if (perspective === "proposed") {
                  range(b.id, off, off + len, "ins", seg.changeId!);
                  off += len;
                } else decos.push({ blockId: b.id, offset: off, render: ghost("ins", seg.text, seg.changeId!) });
              } else if (perspective === "base") {
                range(b.id, off, off + len, "del", seg.changeId!);
                off += len;
              } else decos.push({ blockId: b.id, offset: off, render: ghost("del", seg.text, seg.changeId!) });
              if (change) hunk = { change, at: { blockId: b.id, offset: off } };
            }
            if (hunk) control(hunk.change, hunk.at);
          }
          for (const c of own) if (c.kind === "props" || c.kind === "move") control(c, start);
        } else if (b.status === ghostKind && b.coverId && b.changeIds[0] === b.coverId) {
          // a whole block that exists only in the other document: preview it as a ghost line
          const change = diff.changeById.get(b.coverId);
          const at = anchorFor(b.id);
          if (change && at) {
            const text = (b.block.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "")).join("");
            decos.push({ blockId: at.blockId, offset: at.offset, render: ghost(perspective === "base" ? "ins" : "del", ` ${text || b.type}`, change.id) });
            control(change, at);
          }
        }
        walk(b.children);
      }
    };
    walk(diff.blocks);
    blockChange = nextBlockChange;
    editor.setDecorations(key, decos);
    // keep the control in sync with the new geometry; drop it when its change is gone
    if (activeId && !diff.changeById.has(activeId)) hideControl();
    else if (activeId) {
      const id = activeId;
      activeId = null;
      showControl(id);
    }
    for (const l of [...listeners]) l();
  }

  // accept/reject of one or several changes. `resolve` is the "before" document with exactly the
  // listed changes decided and every other change left as it is:
  //   accept: others stay REJECTED (before + these changes);  reject: others stay ACCEPTED (after - these changes)
  // Which document that result replaces depends on the perspective (see the header comment).
  function decide(kind: ChangeDecision, ids: readonly string[]): void {
    const s = sides();
    if (!s || !other || ids.length === 0) return;
    const map: Record<string, ChangeDecision> = {};
    for (const id of ids) map[id] = kind;
    const resolved = applyDecisions(s.before, s.after, map, { registry, diff, granularity: opts.granularity, defaultDecision: kind === "accept" ? "reject" : "accept" });
    const intoEditor = perspective === "base" ? kind === "accept" : kind === "reject";
    if (intoEditor) editor.update((tx) => reconcileDoc(tx, editor.getDoc(), resolved, registry));
    else other = resolved;
    compute();
  }

  const offChange = editor.on("change", () => compute());
  const offSelection = editor.on("selection", () => onSelection());
  const api: EditorSuggestions = {
    get changes() {
      return diff.changes;
    },
    get diff() {
      return diff;
    },
    get remainingProposal() {
      return other ? (perspective === "base" ? other : editor.getDoc()) : null;
    },
    accept: (id) => decide("accept", [id]),
    reject: (id) => decide("reject", [id]),
    acceptAll: () => decide("accept", diff.changes.map((c) => c.id)),
    rejectAll: () => decide("reject", diff.changes.map((c) => c.id)),
    setProposed(doc) {
      other = doc;
      compute();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offChange();
      offSelection();
      clearTimeout(hideTimer);
      if (ctlEl) {
        root.removeEventListener("mouseover", onOver);
        root.removeEventListener("mouseleave", scheduleHide);
        root.removeEventListener("keydown", onKey);
        doc0.removeEventListener("scroll", onScroll, true);
        (doc0.defaultView ?? window).removeEventListener("resize", onScroll);
        ctlEl.remove();
        ctlEl = null;
      }
      editor.setDecorations(key, []);
      listeners.clear();
    },
  };
  compute();
  return api;
}
