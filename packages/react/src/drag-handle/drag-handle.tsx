// <Editor.DragHandle>: render-prop wrapper around useDragHandle.
// No markup/positioning of its own -- the consumer places its handle icon at
// `rect`'s left edge, draws `dropIndicatorRect` while `dragging`, and renders
// the ARIA live region carrying `announcement` (a `role="status"
// aria-live="polite"` element is a reasonable default, but this stays purely
// text -- exactly BubbleMenu/SlashMenu's own "no styles, no positioning"
// rule).
import type { ReactNode } from "react";
import type { UseDragHandleResult } from "./use-drag-handle.js";
import { useDragHandle } from "./use-drag-handle.js";

export type DragHandleRenderArgs = UseDragHandleResult;

export interface EditorDragHandleProps {
  children: (args: DragHandleRenderArgs) => ReactNode;
}

export function DragHandle({ children }: EditorDragHandleProps): ReactNode {
  const state = useDragHandle();
  return <>{children(state)}</>;
}
