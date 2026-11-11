import type { Editor } from "@jul-editor/core";

/** Hands focus back to the editor at its model selection without scrolling the page. */
export function refocusEditor(editor: Editor | null): void {
  if (!editor) return;
  const root = editor.getRoot();
  if (root.contains(document.activeElement)) return;
  root.focus({ preventScroll: true });
  const selection = editor.getState().selection;
  if (selection) editor.update((tx) => tx.setSelection(selection));
}
