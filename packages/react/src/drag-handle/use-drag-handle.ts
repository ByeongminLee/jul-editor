// useDragHandle: the headless engine behind <Editor.DragHandle> (sibling
// reorder + indent-level drop). Two independent ways to move a block, both
// ending at the same `editor.moveBlockTo` (or a chain of it, for a multi-
// block selection):
//  - pointer: pointer capture on the handle itself (not HTML5 DnD, so it
//    keeps working inside/around a contenteditable), hit-testing the block
//    under the pointer via core's `getBlockAtPoint` every rAF tick;
//  - keyboard: the SAME handle element, focusable -- Space picks a block (or
//    the current block-selection) up, ArrowUp/Down commits one sibling-swap
//    step at a time (mirrors core's own Mod+Shift+ArrowUp/Down keymap, just
//    entered through the handle instead of the text caret), Space/Enter
//    drops (keeps the moves), Escape cancels (undoes every step taken).
//
// Hover tracking uses pointermove; the selected block id is subscribed to so
// keyboard users can reach the handle before any pointer activity. The
// selector stays equal while typing in the same block, avoiding rerenders.
import type { Editor as CoreEditor, Store } from "@jul-editor/core";
import { cellPosition, comparePreOrder, resolveMoveTarget, siblingsOf } from "@jul-editor/core";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, useEditorState } from "../hooks.js";
import { useEditorContext } from "../context.js";
import { computeDropTarget, dropIndicatorRect as computeIndicatorRect } from "./drop-target.js";
import type { DropTarget } from "./drop-target.js";

export type { DropTarget, MoveBlockPlacement } from "./drop-target.js";

interface DragState {
  mode: "pointer" | "keyboard";
  /** Doc-order ids being moved together (a multi-block selection drags as a
   * set, "in order"). */
  ids: string[];
  /** Only ever set in pointer mode (a live preview before the drop commits);
   * keyboard mode commits each arrow step immediately instead, same as core's
   * own Mod+Shift+Arrow. */
  dropTarget: DropTarget | null;
  /** Keyboard mode only: how many arrow-step moves have committed so far in
   * this pick-up -- Escape undoes exactly this many. */
  steps: number;
}

export interface DragHandleProps {
  tabIndex: 0;
  role: "button";
  "aria-roledescription": "drag handle";
  "aria-pressed": boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  /** Spread it onto the handle element. A handle rendered conditionally (on `blockId`/`rect`) can be unmounted and re-created
   * by the re-render a keyboard move causes; the replacement takes focus back so Space/Arrow keep driving the move. */
  ref: (el: HTMLElement | null) => void;
  /** Focusing the handle must not clear a block selection (core clears it when focus leaves the editor). */
  "data-jul-editor-keep-selection": "";
  /** Marks the handle as editor UI, so the hook treats a pointerdown / hover on it as "still in the
   * editor" even when the handle is rendered outside the `<Editor.Content>` parent container. */
  "data-jul-editor-drag-handle": "";
}

export interface DragIndicatorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface UseDragHandleResult {
  /** The block the handle is currently attached to: hovered, or (while
   * dragging) the first of the moving set. Null when nothing is hovered. */
  blockId: string | null;
  rect: DOMRect | null;
  dragging: boolean;
  dropTarget: DropTarget | null;
  dropIndicatorRect: DragIndicatorRect | null;
  /** ARIA live-region text -- render it into a `role="status"`/
   * `aria-live="polite"` element (this hook has no markup of its own). */
  announcement: string;
  getHandleProps(): DragHandleProps;
}

function blockHandleIsVisible(rect: DOMRect, root: HTMLElement | null): boolean {
  if (typeof window === "undefined") return false;
  const rootRect = root?.getBoundingClientRect();
  // The handle is fixed-position and 24px high. A selected block can remain
  // in editor state after its canvas has scrolled out of view.
  const handleTop = rect.top + 3;
  if (rootRect?.height && (handleTop < rootRect.top || handleTop + 24 > rootRect.bottom)) return false;
  // Keep the initial handle in the tab order even when the editor starts
  // below the fold. Once the page scrolls, hide blocks outside the viewport.
  return window.scrollY === 0 || (handleTop >= 0 && handleTop + 24 <= window.innerHeight);
}

function orderIdsByDoc(store: Store, ids: string[]): string[] {
  return [...ids].sort((a, b) => comparePreOrder(store, a, b));
}

/** The sibling immediately before/after `id` at its own level, as a
 * DropTarget -- null at a level boundary (already first/last). */
function stepSibling(store: Store, id: string, dir: 1 | -1): DropTarget | null {
  const { siblings, index } = siblingsOf(store, id);
  const at = index + dir;
  if (at < 0 || at >= siblings.length) return null;
  return { targetId: siblings[at]!, placement: dir === -1 ? "before" : "after" };
}

/** Moves every id in `ids` (already in doc order) to land consecutively at
 * `target`, in order, as ONE undo step -- see core's `Editor.moveBlocksTo`
 * (a multi-block drag used to chain one `moveBlockTo` commit
 * per id, so undoing a 3-block move took 3 undos; batched into a single
 * transaction in core now). */
function movePreservingOrder(editor: CoreEditor, ids: string[], target: DropTarget): void {
  editor.moveBlocksTo(ids, target);
}

export function useDragHandle(): UseDragHandleResult {
  const editor = useEditor();
  const { registry, rootRef } = useEditorContext("useDragHandle");
  const selectedBlock = useEditorState((state) => {
    const selection = state.selection;
    const id = selection ? (selection.type === "text" ? selection.anchor.blockId : selection.type === "block" ? selection.ids[0] : selection.tableId) : state.store.rootIds[0];
    return { id: id && state.store.records.get(id)?.type === "tableCell" ? (cellPosition(state.store, id)?.tableId ?? id) : (id ?? null), active: !!selection };
  }, (a, b) => a.id === b.id && a.active === b.active);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  useEffect(() => setHover(null), [selectedBlock]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hasEnteredEditorRef = useRef(false);
  const [, setViewportVersion] = useState(0);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  const candidateBlockId = dragState ? dragState.ids[0]! : controlsVisible ? (hover?.id ?? selectedBlock.id) : null;
  const candidateRect = candidateBlockId ? (editor?.getBlockRect(candidateBlockId) ?? null) : null;
  const rect = candidateRect && (dragState || blockHandleIsVisible(candidateRect, rootRef.current)) ? candidateRect : null;
  const blockId = rect ? candidateBlockId : null;
  const blockIdRef = useRef(blockId);
  blockIdRef.current = blockId;

  const [announcement, setAnnouncement] = useState("");

  // Hover tracking: pointermove on the editable root, rAF-throttled. Only
  // active while NOT dragging -- once `setPointerCapture` (in onPointerDown
  // below) is engaged, subsequent pointer events land on the handle element
  // itself, not the root, so this listener naturally goes quiet mid-drag.
  // Keep the handle reachable through its gutter, but dismiss it when the
  // pointer/focus leaves the editor or the page scrolls away. A text selection
  // persists on blur, and a block selection is only cleared when focus lands
  // outside the editor and outside editor-owned UI (the handle opts out via
  // data-jul-editor-keep-selection), so selection alone cannot decide visibility.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const frame = root.parentElement ?? root;
    let raf = 0;
    function cancelPendingHover(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    function onMove(e: PointerEvent): void {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const ed = editorRef.current;
        if (!ed) return;
        const hit = ed.getBlockAtPoint(e.clientX, e.clientY);
        if (hit) {
          hasEnteredEditorRef.current = true;
          setHover(hit);
          setControlsVisible(true);
        }
      });
    }
    const isHandle = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest("[data-jul-editor-drag-handle]");
    function onDocumentMove(e: PointerEvent): void {
      if (dragRef.current || !hasEnteredEditorRef.current || frame.contains(e.target as Node) || isHandle(e.target)) return;
      const bounds = root!.getBoundingClientRect();
      // A short gutter connects block text to its fixed handle; pointerleave
      // on the editable root itself would dismiss the handle mid-transit.
      if (bounds.width && e.clientX >= bounds.left - 64 && e.clientX <= bounds.right && e.clientY >= bounds.top && e.clientY <= bounds.bottom) return;
      cancelPendingHover();
      setHover(null);
      setControlsVisible(false);
    }
    function onFocusOrDown(e: Event): void {
      if (dragRef.current) return;
      const inside = frame.contains(e.target as Node) || isHandle(e.target);
      if (inside) hasEnteredEditorRef.current = true;
      if (!hasEnteredEditorRef.current) return;
      if (!inside) {
        cancelPendingHover();
        setHover(null);
      }
      setControlsVisible(inside);
    }
    function onViewportChange(): void {
      setViewportVersion((version) => version + 1);
      if (!dragRef.current) setHover(null);
    }
    root.addEventListener("pointermove", onMove);
    document.addEventListener("pointermove", onDocumentMove);
    document.addEventListener("pointerdown", onFocusOrDown, true);
    document.addEventListener("focusin", onFocusOrDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      root.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointermove", onDocumentMove);
      document.removeEventListener("pointerdown", onFocusOrDown, true);
      document.removeEventListener("focusin", onFocusOrDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      cancelPendingHover();
    };
  }, [editor, rootRef]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const ed = editorRef.current;
    const id = blockIdRef.current;
    if (!ed || !id) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    el.setPointerCapture(pointerId);
    el.focus();

    const sel = ed.getState().selection;
    const ids = sel?.type === "block" && sel.ids.includes(id) ? orderIdsByDoc(ed.getState().store, sel.ids) : [id];
    const next: DragState = { mode: "pointer", ids, dropTarget: null, steps: 0 };
    dragRef.current = next;
    setDragState(next);
    setAnnouncement(ids.length > 1 ? `Picked up ${ids.length} blocks.` : "Picked up block.");

    function onMove(ev: PointerEvent): void {
      const current = editorRef.current;
      if (!current) return;
      const hit = current.getBlockAtPoint(ev.clientX, ev.clientY);
      const candidate = hit && !ids.includes(hit.id) ? computeDropTarget(hit.id, hit.rect, ev.clientX, ev.clientY) : null;
      const store = current.getState().store;
      const valid = (target: DropTarget) => ids.every((id) => resolveMoveTarget(store, registry, id, target));
      let target = candidate && valid(candidate) ? candidate : null;
      if (!target && candidate?.placement === "child" && hit) {
        const sibling = computeDropTarget(hit.id, hit.rect, hit.rect.left, ev.clientY);
        if (valid(sibling)) target = sibling;
      }
      const state = dragRef.current;
      if (!state || state.mode !== "pointer") return;
      if (state.dropTarget?.targetId === target?.targetId && state.dropTarget?.placement === target?.placement) return;
      const next = { ...state, dropTarget: target };
      dragRef.current = next; // pointerup can follow before React commits this render
      setDragState(next);
    }
    function finish(commit: boolean): void {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      const finalTarget = dragRef.current?.dropTarget ?? null;
      dragRef.current = null;
      setDragState(null);
      if (commit && finalTarget && editorRef.current) {
        movePreservingOrder(editorRef.current, ids, finalTarget);
        setAnnouncement(ids.length > 1 ? `Moved ${ids.length} blocks.` : "Moved block.");
      } else {
        setAnnouncement("Move cancelled.");
      }
    }
    function onUp(): void {
      finish(true);
    }
    function onCancel(): void {
      finish(false);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
  }, [registry]);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const ed = editorRef.current;
    const current = dragRef.current;

    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (current?.mode === "keyboard") {
        dragRef.current = null;
        setDragState(null);
        setAnnouncement("Dropped.");
        return;
      }
      const id = blockIdRef.current;
      if (!ed || !id) return;
      const sel = ed.getState().selection;
      const ids = sel?.type === "block" && sel.ids.includes(id) ? orderIdsByDoc(ed.getState().store, sel.ids) : [id];
      const next: DragState = { mode: "keyboard", ids, dropTarget: null, steps: 0 };
      dragRef.current = next;
      setDragState(next);
      setAnnouncement(ids.length > 1 ? `Picked up ${ids.length} blocks. Use arrow keys to move, space or enter to drop, escape to cancel.` : "Picked up block. Use arrow keys to move, space or enter to drop, escape to cancel.");
      return;
    }

    if (!current || current.mode !== "keyboard") return;

    if (e.key === "Enter") {
      e.preventDefault();
      dragRef.current = null;
      setDragState(null);
      setAnnouncement("Dropped.");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      for (let i = 0; i < current.steps; i++) ed?.commands.undo();
      dragRef.current = null;
      setDragState(null);
      setAnnouncement("Move cancelled.");
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && ed) {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      const pivot = dir === -1 ? current.ids[0]! : current.ids[current.ids.length - 1]!;
      const step = stepSibling(ed.getState().store, pivot, dir);
      if (step) {
        movePreservingOrder(ed, current.ids, step);
        const next: DragState = { ...current, steps: current.steps + 1 };
        dragRef.current = next;
        setDragState(next);
        setAnnouncement("Moved.");
      }
    }
  }, []);

  // A keyboard move re-renders the block, and a host that renders the handle conditionally (on rect) replaces it. The
  // replacement is a new element, so focus (and the Space/Arrow flow) would be lost; remember that the focused handle
  // went away mid keyboard move and focus the next handle that mounts.
  const refocusRef = useRef(false);
  const handleElRef = useRef<HTMLElement | null>(null);
  const handleRef = useCallback((el: HTMLElement | null) => {
    const prev = handleElRef.current;
    if (!el) {
      if (prev && prev.ownerDocument.activeElement === prev && dragRef.current?.mode === "keyboard") refocusRef.current = true;
      handleElRef.current = null;
      return;
    }
    handleElRef.current = el;
    if (refocusRef.current) {
      refocusRef.current = false;
      if (dragRef.current?.mode === "keyboard") el.focus();
    }
  }, []);
  // The move ended (drop/cancel) before a replacement mounted: nothing to restore.
  useEffect(() => { if (!dragState) refocusRef.current = false; }, [dragState]);

  const getHandleProps = useCallback(
    (): DragHandleProps => ({
      tabIndex: 0,
      role: "button",
      "aria-roledescription": "drag handle",
      "aria-pressed": dragState !== null,
      onPointerDown,
      onKeyDown,
      ref: handleRef,
      "data-jul-editor-keep-selection": "",
      "data-jul-editor-drag-handle": "",
    }),
    [dragState, onPointerDown, onKeyDown, handleRef],
  );

  const dropTarget = dragState?.dropTarget ?? null;

  const targetRect = dropTarget ? editor?.getBlockRect(dropTarget.targetId) : null;
  const indicatorRect: DragIndicatorRect | null = targetRect && dropTarget ? computeIndicatorRect(targetRect, dropTarget.placement) : null;

  return {
    blockId,
    rect,
    dragging: dragState !== null,
    dropTarget,
    dropIndicatorRect: indicatorRect,
    announcement,
    getHandleProps,
  };
}
