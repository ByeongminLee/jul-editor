// <Editor.BubbleMenu>: renders its children ONLY while a non-empty text
// selection exists and no composition is in progress (a thin component over
// `useSelectionRect()`). No markup/positioning of its
// own -- `rect` is handed to the render-prop children, who decide how/where
// to draw the popup (e.g. `position: fixed; left: rect.left; top: rect.top`).
import type { ReactNode } from "react";
import { useSelectionRect } from "./use-selection-rect.js";

export interface BubbleMenuRenderArgs {
  rect: DOMRect;
}

export interface BubbleMenuProps {
  children: (args: BubbleMenuRenderArgs) => ReactNode;
}

export function BubbleMenu({ children }: BubbleMenuProps): ReactNode {
  const rect = useSelectionRect();
  if (!rect) return null;
  return <>{children({ rect })}</>;
}
