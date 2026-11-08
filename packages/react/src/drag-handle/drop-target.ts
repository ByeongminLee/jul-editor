// Pure drop-target math for the drag handle (sibling reorder + indent-level
// drop). No DOM,
// no React, no store access -- just "given a pointer position and a
// candidate block's rect, where does it land". Kept separate from
// useDragHandle.ts so this is trivially vitest-able without mounting an
// editor (a pure function, unit-tested with vitest).

// core's `Editor.moveBlockTo(id, target)` (packages/core/src/view/editor.ts)
// isn't re-exported as a named type from @jul-editor/react's own scope here
// -- this is a plain structural duplicate of its `MoveBlockTarget` shape
// (same fields, same string-literal union), which TypeScript accepts
// wherever the real type is expected without an extra cross-package import.
export type MoveBlockPlacement = "before" | "after" | "child";

export interface DropTarget {
  targetId: string;
  placement: MoveBlockPlacement;
}

/** The minimal rect shape this module needs -- a real DOMRect satisfies it,
 * and so does a plain object in a test. */
export interface RectLike {
  top: number;
  bottom: number;
  left: number;
}

/** Nesting under a block ("child" placement) requires the pointer to sit at
 * least this far to the right of the target's own left edge (its content's
 * start -- core is headless/zero-indent, so a block's own rect.left IS its
 * content start) -- a horizontal offset > 40px to the right of the
 * target's content start means 'child'. */
export const CHILD_OFFSET_PX = 40;

/** Where `id` would land if dropped on `targetRect` at (pointerX, pointerY):
 * the top/bottom half of the rect picks before/after; being far enough to
 * the right (regardless of which half) nests it as the target's last child
 * instead. */
export function computeDropTarget(targetId: string, targetRect: RectLike, pointerX: number, pointerY: number): DropTarget {
  if (pointerX - targetRect.left > CHILD_OFFSET_PX) return { targetId, placement: "child" };
  const mid = (targetRect.top + targetRect.bottom) / 2;
  return { targetId, placement: pointerY < mid ? "before" : "after" };
}

/** Where to draw the drop-indicator line/box for a computed DropTarget --
 * a zero-height line at the target's top/bottom edge for before/after, or
 * the target's own rect (the consumer highlights the whole block) for
 * "child". Consumer-rendered; this only computes the geometry. */
export function dropIndicatorRect(targetRect: RectLike & { width: number }, placement: MoveBlockPlacement): { top: number; left: number; width: number; height: number } {
  if (placement === "child") return { top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.bottom - targetRect.top };
  const y = placement === "before" ? targetRect.top : targetRect.bottom;
  return { top: y, left: targetRect.left, width: targetRect.width, height: 0 };
}
