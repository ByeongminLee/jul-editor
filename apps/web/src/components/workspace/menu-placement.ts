import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const GAP = 8;
const EDGE = 8;

/** Places a suggestion menu (slash/mention/tag) below the caret rect, flips it above when there is
 * not enough room below, clamps it horizontally, and returns null while the caret is scrolled out of
 * view (under the sticky site header or past the viewport). */
export function menuPlacement(rect: DOMRect, size: { width: number; height: number }): { left: number; top: number } | null {
  const headerBottom = Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
  if (rect.bottom < headerBottom || rect.top > window.innerHeight) return null;
  const below = rect.bottom + GAP;
  const above = rect.top - GAP - size.height;
  const roomBelow = window.innerHeight - EDGE - below;
  const roomAbove = rect.top - GAP - (headerBottom + EDGE);
  let top: number;
  if (size.height <= roomBelow) top = below;
  else if (size.height <= roomAbove) top = above;
  else top = roomAbove > roomBelow ? Math.max(headerBottom + EDGE, above) : below;
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - size.width - EDGE));
  return { left, top };
}

/** `ref` + fixed-position `style` for a suggestion menu element, measured after layout (re-rendered
 * before paint) so the flip uses the menu's real height (a 3-item mention list is far shorter than
 * the full slash list). */
export function useMenuPlacement<T extends HTMLElement = HTMLDivElement>(rect: DOMRect | null, guess = { width: 250, height: 290 }): { ref: RefObject<T | null>; style: CSSProperties | undefined } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(guess);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.offsetWidth !== size.width || el.offsetHeight !== size.height) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  if (!rect) return { ref, style: undefined };
  const place = menuPlacement(rect, size);
  return { ref, style: place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" } };
}
