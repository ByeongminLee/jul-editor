// Slash/mention-style suggestion menus. Query tracking updates
// from the SAME absorb path IME composition uses (`syncBlockFromDOM`), so a
// Korean composition like "/표" or "@홍길" updates the open menu's query
// while composing, not only after compositionend.

import { isText } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Inline } from "../model/types.js";
import type { EditorState, Point } from "../store/types.js";
import type { Dispatch } from "./types.js";

export interface SuggestionRange {
  blockId: string;
  from: number;
  to: number;
}

export interface SuggestionState {
  open: boolean;
  query: string;
  range: SuggestionRange | null;
  rect: DOMRect | null;
}

export interface SuggestionOpenContext {
  state: EditorState;
  blockId: string;
  /** Offset of the trigger character inside the block's plain text. */
  offset: number;
}

export interface SuggestionConfig {
  char: string;
  allowSpaces?: boolean;
  /** Only opens when the trigger is the first character of a line. Without
   * it the trigger must still follow whitespace, an opening bracket/quote or
   * the line start, so "me@x.com", "C#" or "issue#12" never open a menu. */
  startOfLine?: boolean;
  /** Last-say veto before opening (e.g. a slash menu refusing a context where
   * none of its items could be inserted). Code blocks never open a menu. */
  allow?(ctx: SuggestionOpenContext): boolean;
  onUpdate(state: SuggestionState): void;
  /** Given a chance to consume a keydown while this suggestion is open (menu
   * navigation: ArrowUp/Down/Enter/Escape) -- return true to mark it handled. */
  onKey?(e: KeyboardEvent): boolean;
}

export interface SuggestionHandle {
  closeSuggestion(): void;
  replaceRange(range: SuggestionRange, content: Inline[]): void;
  destroy(): void;
}

interface Registration {
  config: SuggestionConfig;
  active: boolean;
  blockId: string | null;
  startOffset: number | null;
  query: string;
  range: SuggestionRange | null;
}

/** Characters a non-startOfLine trigger may directly follow. */
const TRIGGER_BOUNDARY = /[\s([{"'\u201c\u2018\u3008\u300a\u300c\u300e\u3010]/;

function plainTextOf(state: EditorState, blockId: string): string {
  const content = state.store.records.get(blockId)?.content ?? [];
  return content.map((inl) => (isText(inl) ? inl.text : "￼")).join("");
}

export interface SuggestionControllerDeps {
  getState: () => EditorState;
  dispatch: Dispatch;
  getCaretRect: () => DOMRect | null;
  /** Lets the controller refuse code blocks (content: "code"). */
  registry?: Registry;
  /** The editable root: an open menu closes when focus leaves it and
   * re-reads the caret rect when anything scrolls or the window resizes. */
  root?: HTMLElement;
}

const KEEP_SELECTION_SELECTOR = "[data-jul-editor-keep-selection]";

export function createSuggestionController(deps: SuggestionControllerDeps) {
  const registrations: Registration[] = [];

  function emit(reg: Registration, open: boolean, query: string, range: SuggestionRange | null): void {
    reg.query = query;
    reg.range = range;
    reg.config.onUpdate({ open, query, range, rect: open ? deps.getCaretRect() : null });
  }

  function closeOne(reg: Registration): void {
    if (!reg.active) return;
    reg.active = false;
    reg.blockId = null;
    reg.startOffset = null;
    emit(reg, false, "", null);
  }

  function closeAll(): void {
    for (const reg of registrations) closeOne(reg);
  }

  function isCodeBlock(state: EditorState, blockId: string): boolean {
    const type = state.store.records.get(blockId)?.type;
    return !!type && deps.registry?.blocks.get(type)?.content === "code";
  }

  /** Updates an open query after edits/selection changes. A closed suggestion
   * may open only for a newly typed trigger, never for an old character the
   * caret happens to revisit (including programmatic selection changes). */
  function notifyTextChange(typedChar?: string): void {
    const state = deps.getState();
    const sel = state.selection;
    if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset) {
      for (const reg of registrations) closeOne(reg);
      return;
    }
    const point: Point = sel.anchor;
    const text = plainTextOf(state, point.blockId);
    const inCode = isCodeBlock(state, point.blockId);
    for (const reg of registrations) {
      if (reg.active && reg.blockId === point.blockId && reg.startOffset !== null) {
        const start = reg.startOffset;
        if (inCode || point.offset <= start || text[start] !== reg.config.char) {
          closeOne(reg);
          continue;
        }
        const query = text.slice(start + 1, point.offset);
        if (!reg.config.allowSpaces && /\s/.test(query)) {
          closeOne(reg);
          continue;
        }
        emit(reg, true, query, { blockId: point.blockId, from: start, to: point.offset });
        continue;
      }
      if (reg.active) {
        closeOne(reg); // caret moved to a different block entirely
        continue;
      }
      if (typedChar === reg.config.char && point.offset > 0 && text[point.offset - 1] === reg.config.char) {
        if (inCode) continue;
        // One menu at a time: an already-open trigger keeps the floor ("/@").
        if (registrations.some((other) => other.active)) continue;
        const atLineStart = point.offset - 1 === 0 || text[point.offset - 2] === "\n";
        if (reg.config.startOfLine && !atLineStart) continue;
        if (!atLineStart && !TRIGGER_BOUNDARY.test(text[point.offset - 2]!)) continue;
        if (reg.config.allow && !reg.config.allow({ state, blockId: point.blockId, offset: point.offset - 1 })) continue;
        reg.active = true;
        reg.blockId = point.blockId;
        reg.startOffset = point.offset - 1;
        emit(reg, true, "", { blockId: point.blockId, from: reg.startOffset, to: point.offset });
      }
    }
  }

  /** Gives the topmost (most-recently-registered) OPEN suggestion first crack
   * at a keydown -- `plugin`s and callers register menus in the order they
   * want navigation-key priority. */
  function handleKey(e: KeyboardEvent): boolean {
    for (let i = registrations.length - 1; i >= 0; i--) {
      const reg = registrations[i]!;
      if (reg.active && reg.config.onKey?.(e)) return true;
    }
    return false;
  }

  function anyOpen(): boolean {
    return registrations.some((r) => r.active);
  }

  function register(config: SuggestionConfig): SuggestionHandle {
    const reg: Registration = { config, active: false, blockId: null, startOffset: null, query: "", range: null };
    registrations.push(reg);
    return {
      closeSuggestion() {
        closeOne(reg);
      },
      replaceRange(range, content) {
        const caretOffset = range.from + content.reduce((n, inl) => n + (isText(inl) ? inl.text.length : 1), 0);
        const caret = { blockId: range.blockId, offset: caretOffset };
        deps.dispatch((tx) => tx.replaceContent(range.blockId, range.from, range.to, content).setSelection({ type: "text", anchor: caret, focus: caret }));
        closeOne(reg);
      },
      destroy() {
        closeOne(reg);
        const i = registrations.indexOf(reg);
        if (i >= 0) registrations.splice(i, 1);
      },
    };
  }

  // Fixed-position menus follow the caret on scroll/resize, and close when
  // focus really leaves the editor (a click elsewhere, another tab button).
  const root = deps.root;
  const doc = root?.ownerDocument;
  const win = doc?.defaultView ?? null;
  function reposition(e?: Event): void {
    if (!anyOpen()) return;
    // The menu scrolling its own list (or arrow keys scrolling it) is not the
    // caret moving.
    const target = e?.target;
    if (target instanceof Element && target.closest(KEEP_SELECTION_SELECTOR)) return;
    for (const reg of registrations) if (reg.active) emit(reg, true, reg.query, reg.range);
  }
  // A press elsewhere moves focus on pointerdown; closing right then could
  // shift an inline-rendered menu's layout under the pointer and swallow the
  // click it started, so wait for the press to finish.
  let pointerDown = false;
  const onPointerDown = (): void => { pointerDown = true; };
  const onPointerUp = (): void => {
    pointerDown = false;
    if (closeOnRelease) {
      closeOnRelease = false;
      setTimeout(closeAll, 0);
    }
  };
  let closeOnRelease = false;
  function closeAfterPointer(): void {
    if (pointerDown) closeOnRelease = true;
    else closeAll();
  }
  function onFocusOut(e: FocusEvent): void {
    if (!anyOpen() || !root) return;
    const next = e.relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    if (next instanceof Element && next.closest(KEEP_SELECTION_SELECTOR)) return;
    if (next) {
      closeAfterPointer();
      return;
    }
    // No relatedTarget: a re-render can drop focus for a moment; only close
    // when focus has not come back to the editor by the next task. A window
    // blur (switching apps) keeps the menu, like the selection.
    setTimeout(() => {
      if (!doc || !doc.hasFocus()) return;
      const active = doc.activeElement;
      if (active && (root.contains(active) || active.closest(KEEP_SELECTION_SELECTOR))) return;
      closeAll();
    }, 0);
  }
  if (root && doc) {
    root.addEventListener("focusout", onFocusOut);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("pointercancel", onPointerUp, true);
    doc.addEventListener("scroll", reposition, { capture: true, passive: true });
    win?.addEventListener("resize", reposition);
  }
  function destroy(): void {
    if (root && doc) {
      root.removeEventListener("focusout", onFocusOut);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("pointercancel", onPointerUp, true);
      doc.removeEventListener("scroll", reposition, { capture: true });
      win?.removeEventListener("resize", reposition);
    }
  }

  return { register, notifyTextChange, handleKey, anyOpen, closeAll, destroy };
}

export type SuggestionController = ReturnType<typeof createSuggestionController>;
