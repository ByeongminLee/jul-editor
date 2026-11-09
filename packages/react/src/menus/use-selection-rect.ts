// useSelectionRect: the hook behind <Editor.BubbleMenu>.
// Returns the current non-collapsed text selection's DOMRect, or null when
// there's no real range selected, the selection/focus has left the editor, or
// an IME composition is in progress (a bubble menu popping up mid-composition
// would be confusing and core doesn't touch DOM selection while composing anyway).
// The rect follows the live selection: every range change (a backward drag,
// Shift+Arrow, a triple click), every commit, and every scroll or resize
// re-measures it, so a popup positioned from it never goes stale.
import { KEEP_SELECTION_ATTRIBUTE } from "@jul-editor/core";
import { useEffect, useLayoutEffect, useState } from "react";
import { useEditor, useEditorState } from "../hooks.js";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useIsComposing(): boolean {
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onStart = () => setComposing(true);
    const onEnd = () => setComposing(false);
    document.addEventListener("compositionstart", onStart);
    document.addEventListener("compositionend", onEnd);
    return () => {
      document.removeEventListener("compositionstart", onStart);
      document.removeEventListener("compositionend", onEnd);
    };
  }, []);
  return composing;
}

function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** Where the live selection is relative to the editor: "inside" (both DOM ends in the root),
 * "kept" (focus moved to editor-owned UI marked keep-selection, e.g. an input inside the popup;
 * the model selection still applies) or "outside" (a click elsewhere on the page). */
function selectionPlace(root: HTMLElement): "inside" | "kept" | "outside" {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (sel && sel.rangeCount > 0 && sel.anchorNode && sel.focusNode && root.contains(sel.anchorNode) && root.contains(sel.focusNode)) return "inside";
  const active = doc.activeElement;
  if (active && active !== doc.body && active.closest(`[${KEEP_SELECTION_ATTRIBUTE}]`)) return "kept";
  return "outside";
}

export function useSelectionRect(): DOMRect | null {
  const editor = useEditor();
  const composing = useIsComposing();
  const hasRange = useEditorState((state) => {
    const sel = state.selection;
    if (!sel || sel.type !== "text") return false;
    return sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset;
  });
  // Any commit (a new range while one is already selected, a mark change re-laying the text) re-measures.
  const state = useEditorState((s) => s);
  const active = !!editor && hasRange && !composing;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!editor || !active) {
      setRect(null);
      return;
    }
    const root = editor.getRoot();
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const place = selectionPlace(root);
      if (place === "kept") return; // keep the last rect while the popup's own control has focus
      const next = place === "inside" ? editor.getSelectionRect() : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const schedule = (): void => {
      if (frame || !win) return;
      frame = typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame(measure) : (win.setTimeout(measure, 16) as unknown as number);
    };
    measure();
    doc.addEventListener("selectionchange", schedule);
    doc.addEventListener("focusin", schedule);
    doc.addEventListener("focusout", schedule);
    win?.addEventListener("scroll", schedule, true);
    win?.addEventListener("resize", schedule);
    return () => {
      if (frame && typeof win?.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
      else if (frame) win?.clearTimeout(frame);
      doc.removeEventListener("selectionchange", schedule);
      doc.removeEventListener("focusin", schedule);
      doc.removeEventListener("focusout", schedule);
      win?.removeEventListener("scroll", schedule, true);
      win?.removeEventListener("resize", schedule);
    };
  }, [editor, active, state]);

  return active ? rect : null;
}
