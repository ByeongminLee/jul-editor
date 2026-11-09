// useColorPicker: textColor/highlight color-token swatches + a small
// "recent colors" list (localStorage, best-effort). Nothing here adds editing
// behavior beyond what @jul-editor/core already has -- toggleMark's own
// has-by-TYPE toggle (view/marks.ts) is wrong for "pick a specific color"
// (it would just remove the mark if ANY color is already set, never switch
// it), so setTextColor/setHighlight/clear instead build the same "REPLACE
// this mark on every overlapped run" ops core's own buildToggleMarkOps
// builds for a plain toggle, just with force-set-to-`color` semantics
// (color: null clears it entirely). Same rule as every other hook in this
// package: read+dispatch through @jul-editor/core's own public primitives only.
import type { ColorToken, Editor as CoreEditor } from "@jul-editor/core";
import { COLOR_PALETTE, orderPoints, contentLength, isText, nextBlockInPreOrder, sliceContent } from "@jul-editor/core";
import { useCallback, useEffect, useState } from "react";
import { useEditor, useEditorState } from "./hooks.js";

export interface UseColorPickerOptions {
  /** localStorage key for the recent-colors list. Defaults to a fixed
   * per-package key, so every mounted picker in an app shares one history
   * unless a caller wants several independent ones. */
  recentKey?: string;
  /** How many recent colors to remember (most-recent-first). */
  maxRecent?: number;
}

export interface UseColorPickerResult {
  palette: readonly ColorToken[];
  recent: ColorToken[];
  /** The current (collapsed-caret or uniformly-overlapped) textColor/
   * highlight color, or "default"/null when mixed or absent. */
  current: { textColor: ColorToken | null; highlight: ColorToken | null };
  setTextColor(color: ColorToken): void;
  setHighlight(color: ColorToken): void;
  /** Clears BOTH textColor and highlight from the current selection. */
  clear(): void;
}

const DEFAULT_RECENT_KEY = "jul-editor:color-picker:recent";
const DEFAULT_MAX_RECENT = 5;

function readRecent(key: string): ColorToken[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((c): c is ColorToken => COLOR_PALETTE.includes(c as ColorToken)) : [];
  } catch {
    return []; // A disabled/corrupted storage backend just means "no recent colors", not a crash
  }
}

function writeRecent(key: string, colors: ColorToken[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(colors));
  } catch {
    // Quota/disabled storage -- the in-memory list still works for this session
  }
}

/** The blocks (in pre-order) a 'text' selection spans -- same walk
 * view/marks.ts's textSelectionBlockIds does inside @jul-editor/core (duplicated
 * here rather than imported: it's 6 lines and core's copy isn't part of the
 * public surface). */
function selectionBlockIds(editor: CoreEditor): string[] {
  const sel = editor.getState().selection;
  if (!sel || sel.type !== "text") return [];
  const store = editor.getState().store;
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

/** The [start,end) bounds a 'text' selection actually overlaps, block by
 * block -- shared by setColorMarks/selectCurrentColor so "what's selected"
 * is computed exactly once (the old selectCurrentColor ignored these
 * bounds entirely and scanned each touched block's WHOLE content). */
function selectionRuns(editor: CoreEditor): { blockId: string; from: number; to: number }[] {
  const sel = editor.getState().selection;
  if (!sel || sel.type !== "text") return [];
  const store = editor.getState().store;
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);
  return selectionBlockIds(editor).map((blockId) => {
    const content = store.records.get(blockId)?.content ?? [];
    const len = contentLength(content);
    const from = blockId === start.blockId ? start.offset : 0;
    const to = blockId === end.blockId ? end.offset : len;
    return { blockId, from, to };
  });
}

/** Force-sets (or, `color: null`, clears) one or more mark types on every
 * text run the current selection overlaps -- unlike `toggleMark`, this
 * always ends up with exactly `color` (or no mark at all) for each,
 * regardless of what was already there. A collapsed caret has nothing to
 * overlap and is a no-op (matches `toggleMark`'s own collapsed-selection
 * behavior via the op-building path, not the "stored marks for next typed
 * text" convenience toolbar buttons use -- picking a color is about existing
 * selected text, same as the BubbleMenu it's meant to live in, which only
 * renders for a non-empty selection). textColor+highlight both go
 * through here in ONE call (one `editor.update`, one undo step) instead of
 * two separate calls each pushing their own history entry. */
function setColorMarks(editor: CoreEditor, patch: Partial<Record<"textColor" | "highlight", ColorToken | null>>): void {
  const runs = selectionRuns(editor);
  if (runs.length === 0) return;
  const store = editor.getState().store;
  const entries = Object.entries(patch) as [("textColor" | "highlight"), ColorToken | null][];
  editor.update((tx) => {
    let t = tx;
    for (const { blockId, from, to } of runs) {
      if (from >= to) continue;
      const content = store.records.get(blockId)?.content ?? [];
      const next = sliceContent(content, from, to).map((inl) => {
        if (!isText(inl)) return inl;
        let marks = inl.marks ?? [];
        for (const [markType, color] of entries) {
          marks = marks.filter((m) => m.type !== markType);
          if (color) marks.push({ type: markType, attrs: { color } });
        }
        return marks.length ? { ...inl, marks } : { type: "text" as const, text: inl.text };
      });
      t = t.replaceContent(blockId, from, to, next);
    }
    return t;
  });
}

/** The mark's color when uniformly present across every overlapped run,
 * else null (mixed, or absent) -- same "uniform or null" convention
 * @jul-editor/core's own `getBlockType()` uses for mixed block types. Reads
 * only the SELECTED [from,to) slice of each touched block, not its whole
 * content (a run outside the selection must never affect this). */
function selectCurrentColor(editor: CoreEditor | null, markType: "textColor" | "highlight"): ColorToken | null {
  if (!editor) return null;
  const runs = selectionRuns(editor);
  if (runs.length === 0) return null;
  const store = editor.getState().store;
  let found: ColorToken | null | undefined;
  for (const { blockId, from, to } of runs) {
    if (from >= to) continue;
    const content = store.records.get(blockId)?.content ?? [];
    for (const inl of sliceContent(content, from, to)) {
      if (!isText(inl)) continue;
      const mark = (inl.marks ?? []).find((m) => m.type === markType);
      const color = (mark?.attrs?.color as ColorToken | undefined) ?? null;
      if (found === undefined) found = color;
      else if (found !== color) return null; // mixed
    }
  }
  return found ?? null;
}

export function useColorPicker(opts: UseColorPickerOptions = {}): UseColorPickerResult {
  const editor = useEditor();
  const recentKey = opts.recentKey ?? DEFAULT_RECENT_KEY;
  const maxRecent = opts.maxRecent ?? DEFAULT_MAX_RECENT;
  const [recent, setRecent] = useState<ColorToken[]>([]);

  useEffect(() => setRecent(readRecent(recentKey)), [recentKey]);

  const remember = useCallback(
    (color: ColorToken) => {
      if (color === "default") return;
      setRecent((prev) => {
        const next = [color, ...prev.filter((c) => c !== color)].slice(0, maxRecent);
        writeRecent(recentKey, next);
        return next;
      });
    },
    [recentKey, maxRecent],
  );

  const textColor = useEditorState(() => selectCurrentColor(editor, "textColor"));
  const highlight = useEditorState(() => selectCurrentColor(editor, "highlight"));

  const setTextColor = useCallback(
    (color: ColorToken) => {
      if (!editor) return;
      setColorMarks(editor, { textColor: color });
      remember(color);
    },
    [editor, remember],
  );

  const setHighlight = useCallback(
    (color: ColorToken) => {
      if (!editor) return;
      setColorMarks(editor, { highlight: color });
      remember(color);
    },
    [editor, remember],
  );

  const clear = useCallback(() => {
    if (!editor) return;
    setColorMarks(editor, { textColor: null, highlight: null });
  }, [editor]);

  return { palette: COLOR_PALETTE, recent, current: { textColor, highlight }, setTextColor, setHighlight, clear };
}
