// The `comment` mark: how a thread is anchored to text.
//
// Why a mark (and not decorations over absolute positions):
//  - the core already keeps marks on text runs, so the anchor moves with the text
//    through typing, deletion, split/merge, indent, move, paste, undo/redo and
//    every op a collaboration plugin replays, with zero extra bookkeeping;
//  - marks stack: a run's `marks` array holds several `comment` marks with
//    different `threadId`s, so overlapping/nested threads just work (normalizeMarks
//    dedupes by canonical JSON, i.e. same threadId only);
//  - it serializes with the doc (JSON/HTML), so copy, export and snapshots keep anchors.
// Cost: the doc is "polluted" by thread ids, and an adapter that lost a thread leaves a
// dangling mark (rendered as plain text, see controller.ts's `orphanMarks`).
//
// Detaching: when ALL text carrying a thread's mark is deleted, the thread has no
// range left. The thread record is kept (status "detached" in ThreadView) and
// reattaches automatically if undo brings the text back.

import { defineMark } from "@jul-editor/core";
import type { Editor, EditorState, Inline, Mark, Registry, Selection, Store, TextInline } from "@jul-editor/core";
import { orderPoints, contentLength, sliceContent, textSelectionBlockIds } from "@jul-editor/core";

export const COMMENT_MARK = "comment";

/** Register via `<Editor marks={[commentMark]}>` or `<EditorPlugin marks={[commentMark]}>`.
 *
 * Serde:
 *  - markdown: `omitFromMarkdown`, so the commented text is emitted plain (comments are
 *    not part of the markdown content; not reported as lossy to avoid noise on every export).
 *  - HTML: `<span data-thread-id="...">text</span>` out, and the same span read back on
 *    paste/fromHTML (parse() only accepts spans carrying data-thread-id).
 *  - live DOM: `<span data-mark="comment" data-mark-thread-id="...">` (core inline-dom). */
export const commentMark = defineMark({
  type: COMMENT_MARK,
  attrs: { threadId: "" },
  // typing right before/after a commented range must NOT grow the comment
  inclusive: false,
  omitFromMarkdown: true,
  html: {
    tag: "span",
    attrs: (m) => ({ "data-thread-id": String(m.attrs?.threadId ?? "") }),
    parse: (el) => {
      const id = el.getAttribute("data-thread-id");
      return id ? { type: COMMENT_MARK, attrs: { threadId: id } } : null;
    },
  },
});

export function threadIdOf(mark: Mark): string | null {
  return mark.type === COMMENT_MARK && typeof mark.attrs?.threadId === "string" && mark.attrs.threadId ? mark.attrs.threadId : null;
}

export interface ThreadRange {
  blockId: string;
  from: number;
  to: number;
}

const isTextInl = (inl: Inline): inl is TextInline => inl.type === "text";

/** Every comment-marked range in the doc, per thread id, in document order. Adjacent
 * runs of one block are merged into a single range. */
export function findCommentRanges(store: Store): Map<string, ThreadRange[]> {
  const out = new Map<string, ThreadRange[]>();
  const visit = (id: string): void => {
    const rec = store.records.get(id);
    if (!rec) return;
    let offset = 0;
    for (const inl of rec.content ?? []) {
      const len = isTextInl(inl) ? inl.text.length : 1;
      if (isTextInl(inl)) {
        for (const m of inl.marks ?? []) {
          const tid = threadIdOf(m);
          if (!tid) continue;
          const list = out.get(tid) ?? [];
          const last = list[list.length - 1];
          if (last && last.blockId === id && last.to === offset) last.to = offset + len;
          else list.push({ blockId: id, from: offset, to: offset + len });
          out.set(tid, list);
        }
      }
      offset += len;
    }
    for (const c of rec.childIds) visit(c);
  };
  for (const id of store.rootIds) visit(id);
  return out;
}

/** The thread ids whose mark covers the caret (innermost/most recently added last).
 * Uses the character before the caret, falling back to the one after, so a caret
 * sitting at either edge of a range still counts as "in" it. */
export function threadIdsAtPoint(state: EditorState): string[] {
  const sel = state.selection;
  if (!sel || sel.type !== "text") return [];
  const p = sel.focus;
  const content = state.store.records.get(p.blockId)?.content ?? [];
  const at = (index: number): string[] => {
    let seen = 0;
    for (const inl of content) {
      const len = isTextInl(inl) ? inl.text.length : 1;
      if (index >= seen && index < seen + len) return isTextInl(inl) ? (inl.marks ?? []).map(threadIdOf).filter((x): x is string => !!x) : [];
      seen += len;
    }
    return [];
  };
  const collapsed = sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
  // a non-collapsed selection counts only the chars it covers
  if (!collapsed) return at(Math.min(sel.anchor.offset, sel.focus.offset));
  const before = at(p.offset - 1);
  return before.length ? before : at(p.offset);
}

/** Per-block [from,to) pieces of a text selection, in document order. */
function selectionRanges(store: Store, registry: Registry | undefined, sel: Extract<Selection, { type: "text" }>): ThreadRange[] {
  const ids = textSelectionBlockIds(store, sel);
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);
  const out: ThreadRange[] = [];
  for (const blockId of ids) {
    const rec = store.records.get(blockId);
    if (!rec) continue;
    const spec = registry?.blocks.get(rec.type);
    if (spec ? spec.content !== "inline" : rec.type === "codeBlock" || !rec.content) continue; // code/void blocks carry no marks
    const len = contentLength(rec.content);
    const from = blockId === start.blockId ? start.offset : 0;
    const to = blockId === end.blockId ? end.offset : len;
    if (from < to) out.push({ blockId, from, to });
  }
  return out;
}

/** The plain text a text selection covers (blocks joined by a space). "" for no real range. */
export function quoteOfSelection(store: Store, registry: Registry | undefined, sel: Extract<Selection, { type: "text" }>): string {
  return selectionRanges(store, registry, sel)
    .map((r) =>
      sliceContent(store.records.get(r.blockId)?.content ?? [], r.from, r.to)
        .map((i) => (isTextInl(i) ? i.text : ""))
        .join(""),
    )
    .join(" ");
}

/** Adds `{comment, threadId}` to every text run inside `sel`. Returns false when the
 * selection holds no markable text. One undo step. */
export function addCommentMark(editor: Editor, registry: Registry | undefined, sel: Extract<Selection, { type: "text" }>, threadId: string): boolean {
  const ranges = selectionRanges(editor.getState().store, registry, sel);
  if (ranges.length === 0) return false;
  editor.update((tx) => {
    const store = editor.getState().store;
    for (const { blockId, from, to } of ranges) {
      const slice = sliceContent(store.records.get(blockId)?.content ?? [], from, to);
      const next = slice.map((inl): Inline => {
        if (!isTextInl(inl)) return inl;
        const marks = inl.marks ?? [];
        if (marks.some((m) => threadIdOf(m) === threadId)) return inl;
        return { type: "text", text: inl.text, marks: [...marks, { type: COMMENT_MARK, attrs: { threadId } }] };
      });
      tx.replaceContent(blockId, from, to, next);
    }
    return tx;
  });
  return true;
}

/** Strips `threadId`'s mark everywhere (thread deleted). No-op (no history entry) when none exist. */
export function removeCommentMark(editor: Editor, threadId: string): boolean {
  const ranges = findCommentRanges(editor.getState().store).get(threadId);
  if (!ranges || ranges.length === 0) return false;
  editor.update((tx) => {
    const store = editor.getState().store;
    for (const { blockId, from, to } of ranges) {
      const slice = sliceContent(store.records.get(blockId)?.content ?? [], from, to);
      const next = slice.map((inl): Inline => {
        if (!isTextInl(inl)) return inl;
        const marks = (inl.marks ?? []).filter((m) => threadIdOf(m) !== threadId);
        return marks.length ? { type: "text", text: inl.text, marks } : { type: "text", text: inl.text };
      });
      tx.replaceContent(blockId, from, to, next);
    }
    return tx;
  });
  return true;
}

/** Convenience: a block (by id) still present in the doc? */
export function hasBlock(store: Store, id: string): boolean {
  return store.records.has(id);
}

/** Block id -> pre-order index, for sorting threads by document position. */
export function docOrder(store: Store): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (id: string): void => {
    out.set(id, out.size);
    for (const c of store.records.get(id)?.childIds ?? []) visit(c);
  };
  for (const id of store.rootIds) visit(id);
  return out;
}
