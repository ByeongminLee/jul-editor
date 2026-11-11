import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const GAP = 8;
const EDGE = 8;

/** Places a bubble menu above the selection rect with a gap, flips it below when there is no room
 * above (under the sticky site header or the viewport top), clamps it horizontally, and returns null
 * while the selection is scrolled out of view. */
export function bubblePlacement(rect: DOMRect, size: { width: number; height: number }): { left: number; top: number } | null {
  const headerBottom = Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
  if (rect.bottom < headerBottom || rect.top > window.innerHeight) return null;
  const above = rect.top - GAP - size.height;
  const top = above >= headerBottom + EDGE ? above : Math.min(rect.bottom + GAP, window.innerHeight - size.height - EDGE);
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - size.width - EDGE));
  return { left, top };
}

/** `ref` + fixed-position `style` for a bubble menu element: measured after layout (re-rendered
 * before paint), so the flip and clamp use the bubble's real size. */
export function useBubblePlacement<T extends HTMLElement = HTMLDivElement>(rect: DOMRect, guess = { width: 110, height: 40 }): { ref: RefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(guess);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.offsetWidth !== size.width || el.offsetHeight !== size.height) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  const place = bubblePlacement(rect, size);
  return { ref, style: place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" } };
}
