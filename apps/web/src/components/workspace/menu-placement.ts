import { createElement, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from "react";

const GAP = 8;
const EDGE = 8;

/** Places a suggestion menu (slash/mention/tag) below the caret rect, flips it above when there is
 * not enough room below, clamps it horizontally, and returns null while the caret is scrolled out of
 * view (under the sticky site header or past the viewport). */
export function menuPlacement(rect: DOMRect, size: { width: number; height: number }): { left: number; top: number; maxHeight: number } | null {
  const headerBottom = Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
  if (rect.bottom < headerBottom || rect.top > window.innerHeight) return null;
  const below = rect.bottom + GAP;
  const above = rect.top - GAP - size.height;
  const roomBelow = window.innerHeight - EDGE - below;
  const roomAbove = rect.top - GAP - (headerBottom + EDGE);
  const useAbove = size.height > roomBelow && (size.height <= roomAbove || roomAbove > roomBelow);
  const available = Math.max(0, useAbove ? roomAbove : roomBelow);
  const maxHeight = Math.min(size.height, available);
  const top = useAbove ? rect.top - GAP - maxHeight : below;
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - size.width - EDGE));
  return { left, top, maxHeight };
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
    const height = Math.max(el.offsetHeight, Math.min(el.scrollHeight, guess.height));
    if (el.offsetWidth !== size.width || height !== size.height) setSize({ width: el.offsetWidth, height });
  });
  if (!rect) return { ref, style: undefined };
  const place = menuPlacement(rect, size);
  return { ref, style: place ? { left: place.left, top: place.top, maxHeight: place.maxHeight, overflowY: "auto" } : { left: 0, top: 0, visibility: "hidden" } };
}

/** A `div` placed by `useMenuPlacement`, for menus rendered inline in a render prop. */
export function PlacedMenu({ rect, guess, ...props }: ComponentProps<"div"> & { rect: DOMRect | null; guess?: { width: number; height: number } }) {
  const { ref, style } = useMenuPlacement(rect, guess);
  return createElement("div", { ...props, ref, style });
}
