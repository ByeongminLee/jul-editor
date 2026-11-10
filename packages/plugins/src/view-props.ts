// Accepts both editing void-renderer props and read-only viewer props without
// depending on @jul-editor/react.
import type { Editor as CoreEditor, Json } from "@jul-editor/core";
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

export interface PluginViewProps {
  block: { id: string; type: string; props: Record<string, Json> };
  editor?: CoreEditor;
  selected?: boolean;
  updateProps?: (patch: Record<string, Json | undefined>) => void;
  readOnly?: boolean;
  locale?: "en" | "ko";
}

/** Edit controls show while the block is selected. Escape inside them closes them and hands focus back to the
 * editor with the block still selected, so keyboard editing continues from the block; a click on the block or
 * selecting it again reopens them. */
export function usePluginControls(editor: CoreEditor | undefined, selected: boolean | undefined): { open: boolean; onKeyDown(event: KeyboardEvent<HTMLElement>): void; onPointerDown(): void } {
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (!selected) setClosed(false); }, [selected]);
  return {
    open: !!selected && !closed,
    onPointerDown: () => setClosed(false),
    onKeyDown(event) {
      if (event.key !== "Escape" || event.nativeEvent.isComposing || !editor || !selected || closed) return;
      const root = editor.getRoot();
      if (!root.contains(event.currentTarget)) return;
      event.preventDefault();
      event.stopPropagation();
      setClosed(true);
      const selection = editor.getState().selection;
      root.focus({ preventScroll: true });
      // focus() alone may drop the caret at the root's start; re-applying the model selection writes it back.
      if (selection) editor.update((tx) => tx.setSelection(selection));
    },
  };
}
