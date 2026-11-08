// Model Point {blockId, offset} <-> DOM (node, offset), both directions.
// Offsets are UTF-16 code units; a mention counts as exactly 1 unit,
// matching store/store.ts's inlineLength.

import type { Registry } from "../model/schema.js";
import { cellGridPosition, cellIdAt } from "../store/table.js";
import { nearestIsolatingAncestor, siblingsOf, spannedTopBlocks } from "../store/store.js";
import type { Point, Selection as StoreSelection, Store } from "../store/types.js";
import { CELL_SELECTED_ATTR, CONTENT_ATTR, MENTION_ATTR, SELECTED_ATTR, VOID_ATTR, WIDGET_ATTR, closestBlockId, closestContentEl, findContentEl } from "./dom.js";
import type { BlockEls } from "./render.js";

function measureNode(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return n.nodeValue?.length ?? 0;
  if (n.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = n as HTMLElement;
  if (el.tagName === "BR" || el.hasAttribute(WIDGET_ATTR)) return 0;
  if (el.hasAttribute(MENTION_ATTR)) return 1;
  let sum = 0;
  for (const c of Array.from(el.childNodes)) sum += measureNode(c);
  return sum;
}

/** Offset (in code units) of a DOM boundary point (node, offset) within its
 * enclosing content div. A boundary strictly inside a mention span clamps to
 * "before" (at the span's very first child) or "after" it. */
function measureBefore(contentEl: HTMLElement, targetNode: Node, targetOffset: number): number | null {
  let total = 0;
  let result: number | null = null;
  function walk(n: Node): boolean {
    if (n === targetNode) {
      if (n.nodeType === Node.TEXT_NODE) {
        result = total + targetOffset;
      } else {
        const kids = Array.from(n.childNodes);
        for (let i = 0; i < targetOffset && i < kids.length; i++) total += measureNode(kids[i]!);
        result = total;
      }
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      total += n.nodeValue?.length ?? 0;
      return false;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as HTMLElement;
    if (el.tagName === "BR" || el.hasAttribute(WIDGET_ATTR)) return false;
    if (el.hasAttribute(MENTION_ATTR)) {
      if (el.contains(targetNode)) {
        const atStart = targetOffset === 0 && targetNode === el.firstChild;
        result = total + (atStart ? 0 : 1);
        return true;
      }
      total += 1;
      return false;
    }
    for (const c of Array.from(el.childNodes)) {
      if (walk(c)) return true;
    }
    return false;
  }
  walk(contentEl);
  return result;
}

export function pointFromDOM(root: HTMLElement, node: Node, offset: number): Point | null {
  const contentEl = closestContentEl(node, root);
  const blockId = closestBlockId(node, root);
  if (!contentEl || !blockId) return null;
  const measured = measureBefore(contentEl, node, offset);
  if (measured === null) return null;
  return { blockId, offset: measured };
}

/** Reverse of pointFromDOM: a code-unit offset -> a DOM boundary point inside
 * `contentEl`. Falls back to (contentEl, contentEl.childNodes.length) when the
 * offset is at or past the end (also covers the empty-content placeholder case). */
export function domFromPoint(contentEl: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  function indexIn(parent: Node, child: Node): number {
    return Array.prototype.indexOf.call(parent.childNodes, child);
  }
  function walk(n: Node): { node: Node; offset: number } | null {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.nodeValue?.length ?? 0;
      if (remaining <= len) return { node: n, offset: remaining };
      remaining -= len;
      return null;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as HTMLElement;
    if (el.tagName === "BR" || el.hasAttribute(WIDGET_ATTR)) return null;
    if (el.hasAttribute(MENTION_ATTR)) {
      if (remaining <= 0) return { node: el.parentNode!, offset: indexIn(el.parentNode!, el) };
      remaining -= 1;
      if (remaining <= 0) return { node: el.parentNode!, offset: indexIn(el.parentNode!, el) + 1 };
      return null;
    }
    for (const c of Array.from(el.childNodes)) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  }
  const topLevel = Array.from(contentEl.childNodes);
  for (const child of topLevel) {
    const r = walk(child);
    if (r) return r;
  }
  // Fell through everything (offset at or past the end): land right before a
  // trailing placeholder/newline <br> if there is one, else after the last child.
  const brIndex = topLevel.findIndex((c) => c.nodeType === Node.ELEMENT_NODE && (c as HTMLElement).tagName === "BR");
  return { node: contentEl, offset: brIndex >= 0 ? brIndex : topLevel.length };
}

/** Reads the live DOM selection as a model `text` Selection, or null when
 * either end doesn't resolve to a content div (e.g. selection is outside the
 * editor, or inside a void block). Only 'text' selections are supported here
 * -- 'block'/'cells' selection reconstruction is not supported here. */
export function readDOMSelection(root: HTMLElement): StoreSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  let anchor = pointFromDOM(root, sel.anchorNode, sel.anchorOffset);
  let focus = pointFromDOM(root, sel.focusNode, sel.focusOffset);
  // A triple click (or a drag/shift-select) that ends at the very start of the NEXT block leaves
  // the DOM boundary on that block's wrapper. When that block is void (bookmark, image, divider,
  // ...) it has no content div, so the point does not resolve and the whole selection used to be
  // dropped (no BubbleMenu). Clamp the unresolved end to the nearest text position on the side the
  // selection came from; an entirely unresolved selection (caret inside a void) stays null.
  if (!anchor && focus) anchor = clampToText(root, sel.anchorNode, sel.anchorOffset, focus);
  else if (anchor && !focus) focus = clampToText(root, sel.focusNode, sel.focusOffset, anchor);
  if (!anchor || !focus) return null;
  return { type: "text", anchor, focus };
}

/** Nearest text-block position for a DOM boundary that sits outside every content div: the end of the
 * last content div before it when `other` lies before the boundary, else the start of the first one
 * after it. Null when the boundary is outside `root` or no such block exists. */
function clampToText(root: HTMLElement, node: Node, offset: number, other: Point): Point | null {
  if (!root.contains(node)) return null;
  const at = document.createRange();
  try {
    at.setStart(node, offset);
  } catch {
    return null;
  }
  at.collapse(true);
  const contents = Array.from(root.querySelectorAll<HTMLElement>(`[${CONTENT_ATTR}]`)).filter((el) => !el.closest(`[${VOID_ATTR}]`));
  const otherEl = findContentEl(root, other.blockId);
  const otherBefore = !otherEl || at.comparePoint(otherEl, 0) < 0; // the resolved end precedes the boundary
  let target: HTMLElement | undefined;
  if (otherBefore) {
    for (const el of contents) if (at.comparePoint(el, el.childNodes.length) <= 0) target = el;
  } else target = contents.find((el) => at.comparePoint(el, 0) >= 0);
  if (!target) return null;
  const blockId = closestBlockId(target, root);
  if (!blockId) return null;
  return { blockId, offset: otherBefore ? measureNode(target) : 0 };
}

function pointEq(a: Point, b: Point): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}

/** Writes a model selection to the DOM. No-op (returns false) for non-'text'
 * selections (nothing to map to a caret yet), when either block's content
 * div is missing, or when the live DOM selection already maps to this exact
 * model selection -- callers must skip this entirely while composing
 *. `beforeWrite`, if given, runs synchronously right before the actual
 * native call, ONLY when a write is really about to happen -- the caller's
 * seam for `suppressOwnWrite()` (index.ts), which must not fire for a
 * no-op (the same class of bug was fixed for block/cells selections; an
 * always-a-no-op 'text' write needs the identical guard). Returns whether it
 * actually wrote. */
export function writeDOMSelection(root: HTMLElement, selection: StoreSelection | null, beforeWrite?: () => void): boolean {
  if (!selection || selection.type !== "text") return false;
  const domSel = window.getSelection();
  if (!domSel) return false;

  // after our own text patch (render.ts's sameShape in-place
  // nodeValue update, or a plain native keystroke the browser already
  // positioned correctly), the live DOM selection often already maps to
  // this exact model selection -- mapping the CURRENT DOM selection back to
  // a Point (the same machinery readDOMSelection uses) and comparing is
  // O(this block's own content length), NOT O(document size), unlike
  // Selection.collapse/setBaseAndExtent's own native cost, which
  // profiling found scales with total document size (~1.7ms/call at 500
  // blocks, ~6.7ms/call at 5000 -- confirmed NOT caused by our attribute
  // writes and not fixable by CSS containment).
  // Skipping the call entirely when it
  // would be a no-op anyway is the only lever available here short of a
  // selection-architecture change.
  if (domSel.rangeCount > 0 && domSel.anchorNode && domSel.focusNode) {
    const curAnchor = pointFromDOM(root, domSel.anchorNode, domSel.anchorOffset);
    const curFocus = pointFromDOM(root, domSel.focusNode, domSel.focusOffset);
    if (curAnchor && curFocus && pointEq(curAnchor, selection.anchor) && pointEq(curFocus, selection.focus)) return false;
  }

  const anchorContent = findContentEl(root, selection.anchor.blockId);
  const focusContent = findContentEl(root, selection.focus.blockId);
  if (!anchorContent || !focusContent) return false;
  const a = domFromPoint(anchorContent, selection.anchor.offset);
  beforeWrite?.();
  // A collapsed selection is by far the common case (every plain keystroke)
  // -- Selection.collapse(node, offset) is the more direct native API for
  // it, vs. setBaseAndExtent's more general
  // two-endpoint form, needed only for an actual range.
  if (pointEq(selection.anchor, selection.focus)) {
    domSel.collapse(a.node, a.offset);
    return true;
  }
  const f = domFromPoint(focusContent, selection.focus.offset);
  domSel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  return true;
}

/** Every tableCell id covered by a `cells` Selection's rectangle, or an empty
 * set for anything else. `store`/`registry` are optional (default to no cells
 * marked) so existing callers that don't have them on hand keep working
 * unchanged. resolved through `tableGrid` (grid coordinates), not raw
 * childIds indices -- a merged cell's covered positions must mark exactly the
 * cells the rectangle actually covers, not whatever sits at that childIds slot. */
function cellsSelectionIds(selection: StoreSelection | null, store: Store | undefined, registry: Registry | undefined): Set<string> {
  if (!store || !registry || selection?.type !== "cells") return new Set();
  const minR = Math.min(selection.anchor[0], selection.focus[0]);
  const maxR = Math.max(selection.anchor[0], selection.focus[0]);
  const minC = Math.min(selection.anchor[1], selection.focus[1]);
  const maxC = Math.max(selection.anchor[1], selection.focus[1]);
  const ids = new Set<string>();
  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      const id = cellIdAt(store, registry, selection.tableId, row, col);
      if (id) ids.add(id);
    }
  }
  return ids;
}

// which ids were marked selected/cell-selected as of the last call, per
// view (keyed by that view's own `blockEls` map identity, so independent
// createView instances never share state and nothing needs explicit
// teardown -- a WeakMap entry dies with its blockEls map). Lets
// writeBlockSelectionAttrs touch only the ids that actually joined or left
// the selection instead of walking every rendered block every commit.
const prevSelectionAttrs = new WeakMap<Map<string, BlockEls>, { selected: Set<string>; cell: Set<string> }>();

/** Marks every block in a `block` Selection with `data-jul-editor-selected`, and
 * every tableCell covered by a `cells` Selection's rectangle with
 * `data-jul-editor-cell-selected` (both presence-only, no styles),
 * clearing whichever doesn't apply. `store`/`registry` are only
 * needed to resolve a `cells` selection's own cell ids; omit
 * them (existing callers) to skip cell marking entirely. */
export function writeBlockSelectionAttrs(blockEls: Map<string, BlockEls>, selection: StoreSelection | null, store?: Store, registry?: Registry): void {
  const selectedIds = selection?.type === "block" ? new Set(selection.ids) : new Set<string>();
  const cellIds = cellsSelectionIds(selection, store, registry);
  const prev = prevSelectionAttrs.get(blockEls) ?? { selected: new Set<string>(), cell: new Set<string>() };

  for (const id of prev.selected) if (!selectedIds.has(id)) blockEls.get(id)?.wrapper.removeAttribute(SELECTED_ATTR);
  for (const id of selectedIds) if (!prev.selected.has(id)) blockEls.get(id)?.wrapper.setAttribute(SELECTED_ATTR, "");
  for (const id of prev.cell) if (!cellIds.has(id)) blockEls.get(id)?.wrapper.removeAttribute(CELL_SELECTED_ATTR);
  for (const id of cellIds) if (!prev.cell.has(id)) blockEls.get(id)?.wrapper.setAttribute(CELL_SELECTED_ATTR, "");

  prevSelectionAttrs.set(blockEls, { selected: selectedIds, cell: cellIds });
}

// grid-aware (cellGridPosition), not raw childIds indices -- promoted
// via this into a `cells` Selection, whose (row, col) must be GRID
// coordinates everywhere else it's consumed (the table keymap, mergeCells,
// cellsSelectionIds above).
function cellPosition(store: Store, registry: Registry, blockId: string): { tableId: string; row: number; col: number } | null {
  if (nearestIsolatingAncestor(store, blockId, registry) !== blockId) return null; // not itself a tableCell
  const pos = cellGridPosition(store, registry, blockId);
  if (!pos) return null;
  return { tableId: pos.tableId, row: pos.row, col: pos.col };
}

/** Promotes a DOM-derived `text` selection that crosses an `isolating`
 * boundary: both endpoints inside the
 * same table's cells -> `cells`; anything else that crosses a boundary (e.g.
 * spans into/out of a table, or a future non-table isolating block) ->
 * `block` (the spanned top-level blocks). A same-block or no-boundary-crossed
 * selection passes through untouched. */
/** The live caret's DOMRect (collapsed to its start point) -- for positioning
 * a slash/mention menu. Null when there is no live selection. */
export function getCaretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0]! : range.getBoundingClientRect();
}

/** The live selection's full bounding DOMRect (for a BubbleMenu-style
 * consumer positioning against a possibly non-collapsed range). */
export function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0).getBoundingClientRect();
}

export function promoteSelection(store: Store, registry: Registry, sel: StoreSelection): StoreSelection {
  if (sel.type !== "text" || sel.anchor.blockId === sel.focus.blockId) return sel;
  const a = cellPosition(store, registry, sel.anchor.blockId);
  const b = cellPosition(store, registry, sel.focus.blockId);
  if (a && b && a.tableId === b.tableId) {
    return { type: "cells", tableId: a.tableId, anchor: [a.row, a.col], focus: [b.row, b.col] };
  }
  const isoA = nearestIsolatingAncestor(store, sel.anchor.blockId, registry);
  const isoB = nearestIsolatingAncestor(store, sel.focus.blockId, registry);
  if (isoA === isoB) return sel; // both null (ordinary cross-block text selection), or same non-cell isolating block
  return { type: "block", ids: spannedTopBlocks(store, sel.anchor.blockId, sel.focus.blockId) };
}
