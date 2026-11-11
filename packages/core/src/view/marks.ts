// Stored marks (ProseMirror-style): when a mark is toggled with a COLLAPSED
// selection there is no text run to flip yet, so the intent is recorded here
// and applied to the next actually-typed text instead ("Mark
// toggling with collapsed selection sets 'stored marks' for the next typed
// text"). `null` means "no explicit override -- derive from context" (the
// normal typing-continues-the-surrounding-formatting behavior); an (possibly
// empty) array means "use exactly these marks", overriding context.

import { isText } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Json, Mark, TextInline } from "../model/types.js";
import { markRanges } from "../store/edits.js";
import { orderPoints, contentLength, nextBlockInPreOrder, sliceContent } from "../store/store.js";
import type { EditorState, Point, Selection, Store } from "../store/types.js";
import type { Dispatch } from "./types.js";

export interface MarksRef {
  stored: Mark[] | null;
}

/** `onChange` (optional) fires whenever `stored` is assigned a different
 * value -- stored marks live outside EditorState (no commit, no `change`
 * emit), so this is the seam createEditor uses to tell UI (a toolbar's
 * pressed Bold) that the pending marks changed, and to remember where the
 * caret was when they were set (they are discarded once it moves). */
export function createMarksRef(onChange?: () => void): MarksRef {
  if (!onChange) return { stored: null };
  let stored: Mark[] | null = null;
  return {
    get stored() {
      return stored;
    },
    set stored(next: Mark[] | null) {
      if (next === stored) return;
      stored = next;
      onChange();
    },
  };
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
}

/** Marks active at a collapsed caret: the preceding text run's marks, or (at
 * a block's very start) the following run's -- matches most editors' "what
 * would typing here inherit" convention. */
export function marksAtPoint(state: EditorState, point: Point): Mark[] {
  const rec = state.store.records.get(point.blockId);
  const content = rec?.content ?? [];
  let seen = 0;
  for (const inl of content) {
    const len = isText(inl) ? inl.text.length : 1;
    if (point.offset > seen && point.offset <= seen + len && isText(inl)) return inl.marks ?? [];
    seen += len;
  }
  if (point.offset === 0) {
    for (const inl of content) {
      if (isText(inl)) return inl.marks ?? [];
      return [];
    }
  }
  return [];
}

/** The (possibly cross-block) pre-order chain of block ids a 'text' selection
 * touches -- same divergence-free walk store/edits.ts's buildToggleMarkOps
 * uses to decide which blocks a range spans. */
export function textSelectionBlockIds(store: Store, sel: Extract<Selection, { type: "text" }>): string[] {
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);
  const ids: string[] = [start.blockId];
  let cur: string | null = start.blockId;
  while (cur !== end.blockId) {
    cur = nextBlockInPreOrder(store, cur);
    if (cur === null) break;
    ids.push(cur);
  }
  return ids;
}

/** The effective marks for the CURRENT selection: `stored` if an explicit
 * override is pending, else derived from the collapsed caret's context, else
 * (a non-collapsed, possibly cross-block selection) the marks common to
 * every text run the selection actually OVERLAPS -- not every run in the
 * block(s), and not just the anchor's own block (bug found in review: a
 * partially-selected run outside the range, or a second/third spanned block,
 * must not affect the result). */
export function activeMarks(state: EditorState, marksRef: MarksRef, registry?: Registry): Mark[] {
  if (marksRef.stored !== null) return marksRef.stored;
  const sel = state.selection;
  if (sel?.type === "cells" && registry) return commonMarks(state.store, markRanges(state.store, sel, registry));
  if (!sel || sel.type !== "text") return [];
  if (sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset) {
    return marksAtPoint(state, sel.anchor);
  }
  const store = state.store;
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);
  const blockIds = textSelectionBlockIds(store, sel);

  const overlapped: TextInline[] = [];
  for (const blockId of blockIds) {
    const content = store.records.get(blockId)?.content ?? [];
    const len = contentLength(content);
    const from = blockId === start.blockId ? start.offset : 0;
    const to = blockId === end.blockId ? end.offset : len;
    if (from >= to) continue;
    for (const inl of sliceContent(content, from, to)) {
      if (isText(inl) && inl.text.length > 0) overlapped.push(inl);
    }
  }
  if (overlapped.length === 0) return [];
  return (overlapped[0]!.marks ?? []).filter((m) => overlapped.every((r) => (r.marks ?? []).some((m2) => sameMark(m, m2))));
}

function commonMarks(store: Store, ranges: { blockId: string; from: number; to: number }[]): Mark[] {
  const runs: TextInline[] = [];
  for (const { blockId, from, to } of ranges) {
    if (from >= to) continue;
    for (const inl of sliceContent(store.records.get(blockId)?.content ?? [], from, to)) if (isText(inl) && inl.text.length > 0) runs.push(inl);
  }
  if (runs.length === 0) return [];
  return (runs[0]!.marks ?? []).filter((m) => runs.every((r) => (r.marks ?? []).some((m2) => sameMark(m, m2))));
}

/** Whether a mark command has text it can format: false when the selection sits only in blocks that
 * hold no marks (a codeBlock's `content: "code"`), or is a block selection / no selection. A `cells`
 * rectangle formats every selected cell. Toolbars use this to disable their mark buttons. */
export function canApplyMarks(state: EditorState, registry: Registry): boolean {
  const sel = state.selection;
  if (!sel) return false;
  if (sel.type === "cells") return markRanges(state.store, sel, registry).length > 0;
  if (sel.type !== "text") return false;
  if (sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset) {
    const type = state.store.records.get(sel.anchor.blockId)?.type;
    return type !== undefined && registry.blocks.get(type)?.content === "inline";
  }
  return markRanges(state.store, sel, registry).length > 0;
}

/** Toggles `markType` for the current selection: a real range dispatches
 * `tx.toggleMark` as usual; a collapsed caret instead flips `marksRef.stored`
 * (no store mutation, no history entry -- nothing to toggle yet). Returns
 * true either way (the key is considered handled). */
export function toggleMarkOrStore(state: EditorState, marksRef: MarksRef, dispatch: Dispatch, markType: string, attrs?: Record<string, Json>, registry?: Registry): boolean {
  const sel = state.selection;
  if (sel?.type === "cells") {
    // every selected cell's whole content (the transaction's registry resolves the rectangle)
    dispatch((tx) => tx.toggleMark(sel, markType, attrs));
    marksRef.stored = null;
    return true;
  }
  if (!sel || sel.type !== "text") return false;
  // a caret or range only inside blocks that hold no marks (a codeBlock): nothing to format
  if (registry && !canApplyMarks(state, registry)) return true;
  const collapsed = sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
  if (!collapsed) {
    dispatch((tx) => tx.toggleMark(sel, markType, attrs));
    marksRef.stored = null;
    return true;
  }
  const current = activeMarks(state, marksRef);
  const has = current.some((m) => m.type === markType);
  marksRef.stored = has ? current.filter((m) => m.type !== markType) : [...current, attrs ? { type: markType, attrs } : { type: markType }];
  return true;
}

/** Marks to apply to text about to be typed at `point`: `marksRef.stored` if
 * set (consumed -- cleared back to null so it only affects the very next
 * insert), else derived from context (undefined = "no marks", matching
 * `tx.insertText`'s existing no-marks-param behavior). */
export function consumeInsertMarks(state: EditorState, marksRef: MarksRef, point: Point, registry?: Registry): Mark[] | undefined {
  if (marksRef.stored !== null) {
    const marks = marksRef.stored;
    marksRef.stored = null;
    return marks.length ? marks : undefined;
  }
  let marks = marksAtPoint(state, point);
  // `MarkSpec.inclusive === false` marks (e.g. a comment anchor) are only
  // inherited when the caret is strictly inside their range: the character
  // on BOTH sides of the caret must carry the same mark.
  if (registry && marks.some((m) => registry.marks.get(m.type)?.inclusive === false)) {
    const before = marksOfCharAt(state, point, point.offset - 1);
    const after = marksOfCharAt(state, point, point.offset);
    marks = marks.filter((m) => registry.marks.get(m.type)?.inclusive !== false || (before.some((b) => sameMark(b, m)) && after.some((a) => sameMark(a, m))));
  }
  return marks.length ? marks : undefined;
}

/** Marks of the text character at `index` in the point's block ([] when out of range or non-text). */
function marksOfCharAt(state: EditorState, point: Point, index: number): Mark[] {
  if (index < 0) return [];
  let seen = 0;
  for (const inl of state.store.records.get(point.blockId)?.content ?? []) {
    const len = isText(inl) ? inl.text.length : 1;
    if (index < seen + len) return isText(inl) ? (inl.marks ?? []) : [];
    seen += len;
  }
  return [];
}

export function clampToLength(point: Point, state: EditorState): number {
  return contentLength(state.store.records.get(point.blockId)?.content);
}
