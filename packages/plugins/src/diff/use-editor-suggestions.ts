"use client";

// React binding for createEditorSuggestions (editor-suggestions.ts): in-editor suggestion mode.
// `const s = useEditorSuggestions(editor, proposedDoc)`; render your own list from `s.changes` or
// rely on the Accept / Reject widgets drawn inside the editor.
import type { Doc, Editor } from "@jul-editor/core";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createEditorSuggestions } from "./editor-suggestions.js";
import type { EditorSuggestions, EditorSuggestionsOptions } from "./editor-suggestions.js";
import type { InlineChange, InlineDiff } from "./inline-diff.js";

export interface UseEditorSuggestionsResult {
  changes: readonly InlineChange[];
  diff: InlineDiff | null;
  /** The still-undecided suggestion as a whole Doc (see EditorSuggestions.remainingProposal). */
  remainingProposal: Doc | null;
  accept(changeId: string): void;
  reject(changeId: string): void;
  acceptAll(): void;
  rejectAll(): void;
}

const NONE: readonly InlineChange[] = [];
const noop = (): void => {};

/** Pass `null`/`undefined` for `editor` or `proposed` to switch suggestion mode off. */
export function useEditorSuggestions(editor: Editor | null | undefined, proposed: Doc | null | undefined, opts: EditorSuggestionsOptions = {}): UseEditorSuggestionsResult {
  const ctl = useRef<EditorSuggestions | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const perspective = opts.perspective ?? "base";
  const decorationKey = opts.decorationKey;

  // (re)created when the editor, perspective or key changes; a new `proposed` only replaces the doc
  const subscribers = useRef(new Set<() => void>());
  useEffect(() => {
    if (!editor) return;
    const c = createEditorSuggestions(editor, proposedRef.current ?? null, optsRef.current);
    ctl.current = c;
    const off = c.subscribe(() => subscribers.current.forEach((l) => l()));
    subscribers.current.forEach((l) => l());
    return () => {
      off();
      c.destroy();
      ctl.current = null;
      subscribers.current.forEach((l) => l());
    };
  }, [editor, perspective, decorationKey, opts.granularity]);

  const proposedRef = useRef<Doc | null | undefined>(proposed);
  proposedRef.current = proposed;
  useEffect(() => {
    ctl.current?.setProposed(proposed ?? null);
  }, [proposed]);

  const subscribe = useMemo(() => (l: () => void) => {
    subscribers.current.add(l);
    return () => void subscribers.current.delete(l);
  }, []);
  const changes = useSyncExternalStore(subscribe, () => ctl.current?.diff.changes ?? NONE, () => NONE);
  return {
    changes,
    diff: ctl.current?.diff ?? null,
    remainingProposal: ctl.current?.remainingProposal ?? null,
    accept: (id) => ctl.current?.accept(id) ?? noop(),
    reject: (id) => ctl.current?.reject(id) ?? noop(),
    acceptAll: () => ctl.current?.acceptAll() ?? noop(),
    rejectAll: () => ctl.current?.rejectAll() ?? noop(),
  };
}
