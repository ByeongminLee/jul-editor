// Slash/mention-style suggestion menus. Query tracking updates
// from the SAME absorb path IME composition uses (`syncBlockFromDOM`), so a
// Korean composition like "/표" or "@홍길" updates the open menu's query
// while composing, not only after compositionend.

import { isText } from "../model/canonical.js";
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

export interface SuggestionConfig {
  char: string;
  allowSpaces?: boolean;
  startOfLine?: boolean;
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
}

function plainTextOf(state: EditorState, blockId: string): string {
  const content = state.store.records.get(blockId)?.content ?? [];
  return content.map((inl) => (isText(inl) ? inl.text : "￼")).join("");
}

export interface SuggestionControllerDeps {
  getState: () => EditorState;
  dispatch: Dispatch;
  getCaretRect: () => DOMRect | null;
}

export function createSuggestionController(deps: SuggestionControllerDeps) {
  const registrations: Registration[] = [];

  function emit(reg: Registration, open: boolean, query: string, range: SuggestionRange | null): void {
    reg.config.onUpdate({ open, query, range, rect: open ? deps.getCaretRect() : null });
  }

  function closeOne(reg: Registration): void {
    if (!reg.active) return;
    reg.active = false;
    reg.blockId = null;
    reg.startOffset = null;
    emit(reg, false, "", null);
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
    for (const reg of registrations) {
      if (reg.active && reg.blockId === point.blockId && reg.startOffset !== null) {
        const start = reg.startOffset;
        if (point.offset <= start || text[start] !== reg.config.char) {
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
        const atLineStart = point.offset - 1 === 0 || text[point.offset - 2] === "\n";
        if (reg.config.startOfLine && !atLineStart) continue;
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
    const reg: Registration = { config, active: false, blockId: null, startOffset: null };
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

  return { register, notifyTextChange, handleKey, anyOpen };
}

export type SuggestionController = ReturnType<typeof createSuggestionController>;
