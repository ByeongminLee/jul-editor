// useEditor/useEditorState/useActiveMarks/useBlockType/useCommands.
// `useEditorState`'s selector+isEqual caching is what makes "typing 100 plain
// chars -> 0 Toolbar re-renders" possible: useSyncExternalStore only re-renders
// a consumer when its OWN getSnapshot() result changes (Object.is) from the
// previous call, and the cache below returns the *same* previous reference
// whenever `isEqual` says the newly-selected value is unchanged, even though
// the underlying EditorState object itself changes on every commit.

import type { Editor as CoreEditor, EditorState } from "@jul-editor/core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useEditorContext } from "./context.js";

export function useEditor(): CoreEditor | null {
  const ctx = useEditorContext("useEditor");
  const getSnapshot = useCallback(() => ctx.store.getEditor(), [ctx]);
  return useSyncExternalStore(ctx.store.subscribe, getSnapshot, getSnapshot);
}

export function useEditorState<T>(selector: (state: EditorState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const ctx = useEditorContext("useEditorState");
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;
  const cacheRef = useRef<{ input: EditorState; version: number; output: T } | null>(null);

  // Keyed on the shim's version too: a stored-mark change (Bold toggled at a
  // collapsed caret) notifies without a new EditorState, and selectors that
  // read `editor.getActiveMarks()` must still see it.
  const getSnapshot = useCallback(() => {
    const state = ctx.store.getSnapshot();
    const version = ctx.store.getVersion();
    const cache = cacheRef.current;
    if (cache && cache.input === state && cache.version === version) return cache.output;
    const output = selectorRef.current(state);
    if (cache && isEqualRef.current(cache.output, output)) {
      cacheRef.current = { input: state, version, output: cache.output };
      return cache.output;
    }
    cacheRef.current = { input: state, version, output };
    return output;
  }, [ctx]);

  return useSyncExternalStore(ctx.store.subscribe, getSnapshot, getSnapshot);
}

const NOOP_COMMANDS: CoreEditor["commands"] = {
  undo() {},
  redo() {},
  toggleMark() {},
  setBlockType() {},
  insertBlock() {},
  indent() {},
  outdent() {},
  insertTable() {},
  addRowBefore() {},
  addRowAfter() {},
  addColumnBefore() {},
  addColumnAfter() {},
  deleteRow() {},
  deleteColumn() {},
  deleteTable() {},
  toggleHeaderRow() {},
  // table merge/split/move
  mergeCells() {},
  splitCell() {},
  moveRowUp() {},
  moveRowDown() {},
  moveColumnLeft() {},
  moveColumnRight() {},
};

export function useCommands(): CoreEditor["commands"] {
  const editor = useEditor();
  return editor?.commands ?? NOOP_COMMANDS;
}

const EMPTY_MARKS: ReadonlySet<string> = new Set();

function marksEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const m of a) if (!b.has(m)) return false;
  return true;
}

// Core's `editor.getActiveMarks()`/`getBlockType()` (view/editor.ts)
// are now correct for non-collapsed selections too (the
// whole-block-run bug this file used to work around locally is fixed) -- both hooks
// just delegate, no local duplicate computation left to maintain. Both
// core methods read the editor's OWN current state internally (not a
// selection argument), same as `state` here, so ignoring the selector's
// `state` param and calling straight into `editor` is safe and is exactly
// what `useEditorState`'s cache-by-EditorState-identity already assumes.
function selectActiveMarks(editor: CoreEditor | null): ReadonlySet<string> {
  if (!editor) return EMPTY_MARKS;
  const marks = editor.getActiveMarks();
  return marks.length === 0 ? EMPTY_MARKS : new Set(marks.map((m) => m.type));
}

/** Whether mark buttons (Bold, Italic, Link ...) have text to format right now: false inside a codeBlock
 * or with a block selection, true for text and for a table cells rectangle. Before the editor has any
 * selection (never focused) it is true, so a toolbar does not look dead on first render. */
export function useCanApplyMarks(): boolean {
  const ctx = useEditorContext("useCanApplyMarks");
  return useEditorState((state) => {
    const editor = ctx.store.getEditor();
    if (!editor || !state.selection || typeof editor.canApplyMarks !== "function") return true;
    return editor.canApplyMarks();
  });
}

export function useActiveMarks(): ReadonlySet<string> {
  const ctx = useEditorContext("useActiveMarks");
  return useEditorState(() => selectActiveMarks(ctx.store.getEditor()), marksEqual);
}

function selectBlockType(editor: CoreEditor | null): string | null {
  return editor?.getBlockType()?.type ?? null;
}

export function useBlockType(): string | null {
  const ctx = useEditorContext("useBlockType");
  return useEditorState(() => selectBlockType(ctx.store.getEditor()));
}
