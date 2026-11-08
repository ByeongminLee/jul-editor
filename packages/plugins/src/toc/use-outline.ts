"use client";

// Live outline hook: re-reads the heading list on every editor commit but hands React the SAME array
// while nothing heading-related changed, so typing in a paragraph never re-renders the TOC.
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { Doc, Editor } from "@jul-editor/core";
import { extractOutline, extractOutlineFromDoc, outlineEqual } from "./outline.js";
import type { OutlineEntry, OutlineOptions } from "./outline.js";

/** Read-only pages (EditorView renderers get no doc) provide the document here. */
export const TocDocContext = /* @__PURE__ */ createContext<Doc | null>(null);
export const TocDocProvider = TocDocContext.Provider;

const EMPTY: OutlineEntry[] = [];
const NOOP_SUBSCRIBE = () => () => {};

export function useOutline(editor: Editor | null | undefined, opts: OutlineOptions = {}, doc?: Doc | null): OutlineEntry[] {
  const ctxDoc = useContext(TocDocContext);
  const cache = useRef<OutlineEntry[]>(EMPTY);
  const min = opts.minLevel;
  const max = opts.maxLevel;
  const getSnapshot = (): OutlineEntry[] => {
    const source = doc ?? ctxDoc;
    const next = editor ? extractOutline(editor.getState().store, { minLevel: min, maxLevel: max }) : source ? extractOutlineFromDoc(source, { minLevel: min, maxLevel: max }) : EMPTY;
    if (!outlineEqual(cache.current, next)) cache.current = next;
    return cache.current;
  };
  const subscribe = editor ? (listener: () => void) => editor.on("change", listener) : NOOP_SUBSCRIBE;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
