// useSelectionRect: the hook behind <Editor.BubbleMenu>.
// Returns the current non-collapsed text selection's DOMRect, or null when
// there's no real range selected, nothing is focused, or an IME composition
// is in progress (a bubble menu popping up mid-composition would be
// confusing and core doesn't touch DOM selection while composing anyway).
import { useEffect, useState } from "react";
import { useEditor, useEditorState } from "../hooks.js";

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

export function useSelectionRect(): DOMRect | null {
  const editor = useEditor();
  const composing = useIsComposing();
  const hasRange = useEditorState((state) => {
    const sel = state.selection;
    if (!sel || sel.type !== "text") return false;
    return sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset;
  });

  if (!editor || !hasRange || composing) return null;
  return editor.getSelectionRect();
}
