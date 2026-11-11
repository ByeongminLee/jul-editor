import { orderPoints, contentLength, isText, nextBlockInPreOrder, sliceContent } from "@jul-editor/core";
import type { Editor as CoreEditor, Json } from "@jul-editor/core";

// Editor commands the DOCX toolbar needs on top of core's toggleMark/setBlockType: set a mark with a
// specific attr (font family, font size), clear it, and set a block prop (text alignment). They are
// built from the same public primitives core's own useColorPicker uses.

/** Block ids a text selection spans, in document order. */
export function selectedBlockIds(editor: CoreEditor): string[] {
  const state = editor.getState();
  const sel = state.selection;
  if (!sel || sel.type !== "text") return [];
  const store = state.store;
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);
  const ids = [start.blockId];
  let cur: string | null = start.blockId;
  while (cur !== end.blockId) {
    cur = nextBlockInPreOrder(store, cur);
    if (cur === null) break;
    ids.push(cur);
  }
  return ids;
}

/** The [from,to) range of each selected block that the selection actually covers. */
function selectedRuns(editor: CoreEditor): { blockId: string; from: number; to: number }[] {
  const state = editor.getState();
  const sel = state.selection;
  if (!sel || sel.type !== "text") return [];
  const [start, end] = orderPoints(state.store, sel.anchor, sel.focus);
  return selectedBlockIds(editor).map((blockId) => {
    const len = contentLength(state.store.records.get(blockId)?.content ?? []);
    return { blockId, from: blockId === start.blockId ? start.offset : 0, to: blockId === end.blockId ? end.offset : len };
  });
}

/** Force-sets `type` with `attrs` on every selected run (replacing an existing one), or clears it
 * with `attrs: null`. One editor.update, so one undo step. A collapsed caret stores the mark for
 * the next typed text instead (core's stored-marks path) when setting, and does nothing when clearing. */
export function setMarkAttrs(editor: CoreEditor, type: string, attrs: Record<string, Json> | null): void {
  const runs = selectedRuns(editor).filter((r) => r.from < r.to);
  if (runs.length === 0) {
    const active = editor.getActiveMarks().some((m) => m.type === type);
    if (attrs && !active) editor.commands.toggleMark(type, attrs);
    return;
  }
  const store = editor.getState().store;
  editor.update((tx) => {
    let t = tx;
    for (const { blockId, from, to } of runs) {
      const content = store.records.get(blockId)?.content ?? [];
      const next = sliceContent(content, from, to).map((inl) => {
        if (!isText(inl)) return inl;
        const marks = (inl.marks ?? []).filter((m) => m.type !== type);
        if (attrs) marks.push({ type, attrs });
        return marks.length ? { ...inl, marks } : { type: "text" as const, text: inl.text };
      });
      t = t.replaceContent(blockId, from, to, next);
    }
    return t;
  });
}

/** Sets (or, `null`, removes) a block prop such as `textAlign` on every selected block. */
export function setBlockProp(editor: CoreEditor, key: string, value: Json | undefined): void {
  const ids = selectedBlockIds(editor);
  if (ids.length === 0) return;
  editor.update((tx) => ids.reduce((t, id) => t.setProps(id, { [key]: value }), tx));
}
