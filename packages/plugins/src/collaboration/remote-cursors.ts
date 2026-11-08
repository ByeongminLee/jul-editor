// Remote carets and selections as a DOM overlay (framework-free).
//
// The editor root is contenteditable and owned by the view, so nothing is
// injected into it: a sibling overlay (position:absolute, pointer-events:none)
// is appended to the root's parent and positioned from Range client rects
// (core's domFromPoint maps a block offset to a DOM position). Style it with
// CSS variables on any ancestor, or override per element via the data attrs:
//
//   --jul-collab-caret-width   (2px)        data-jul-collab-caret
//   --jul-collab-label-fg      (#fff)       data-jul-collab-label
//   --jul-collab-label-size    (11px)       data-jul-collab-selection
//   --jul-collab-selection-opacity (0.22)

import { contentLength, domFromPoint, findContentEl } from "@jul-editor/core";
import type { Editor, Store } from "@jul-editor/core";
import type { CollabClient } from "./client.js";
import type { CollabPeer, CollabSelection } from "./types.js";

export interface RemoteCursorsOptions {
  /** Element the overlay is appended to and measured against (default: the editor root's parent). */
  container?: HTMLElement;
  /** Draw the selection tint (default true). */
  showSelection?: boolean;
  /** Draw the name flag above the caret (default true). */
  showLabels?: boolean;
  zIndex?: number;
}

export interface RemoteCursorsHandle {
  /** Re-measure and redraw now (it is also scheduled automatically). */
  render(): void;
  destroy(): void;
}

/** Document-order ids of blocks that hold inline content. */
function contentBlockOrder(store: Store): string[] {
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      const rec = store.records.get(id);
      if (!rec) continue;
      if (rec.content !== undefined) out.push(id);
      walk(rec.childIds);
    }
  };
  walk(store.rootIds);
  return out;
}

export function attachRemoteCursors(editor: Editor, client: CollabClient, options: RemoteCursorsOptions = {}): RemoteCursorsHandle {
  const root = editor.getRoot();
  const doc = root.ownerDocument;
  const host = options.container ?? root.parentElement ?? root;
  const showSelection = options.showSelection !== false;
  const showLabels = options.showLabels !== false;

  let restorePosition: string | null = null;
  if (doc.defaultView && doc.defaultView.getComputedStyle(host).position === "static") {
    restorePosition = host.style.position;
    host.style.position = "relative";
  }

  const overlay = doc.createElement("div");
  overlay.setAttribute("data-jul-collab-overlay", "");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:${options.zIndex ?? 5}`;
  host.appendChild(overlay);

  function rectsOf(range: Range): DOMRect[] {
    const list = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
    return list.filter((r) => r.width > 0 || r.height > 0);
  }

  function rangeFor(blockId: string, from: number, to: number): { range: Range; content: HTMLElement } | null {
    const content = findContentEl(root, blockId);
    if (!content) return null;
    const range = doc.createRange();
    const s = domFromPoint(content, from);
    const e = domFromPoint(content, to);
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return { range, content };
  }

  function place(el: HTMLElement, r: { left: number; top: number; width: number; height: number }, hostRect: DOMRect): void {
    el.style.left = `${r.left - hostRect.left + host.scrollLeft}px`;
    el.style.top = `${r.top - hostRect.top + host.scrollTop}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  function drawPeer(peer: CollabPeer, sel: CollabSelection, store: Store, hostRect: DOMRect, order: string[]): void {
    const color = peer.user.color;
    const group = doc.createElement("div");
    group.setAttribute("data-jul-collab-peer", peer.clientId);
    group.setAttribute("data-status", peer.status);
    group.style.opacity = peer.status === "idle" ? "0.55" : "1";
    overlay.appendChild(group);

    if (showSelection && (sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset)) {
      const ai = order.indexOf(sel.anchor.blockId);
      const fi = order.indexOf(sel.focus.blockId);
      const forward = ai < fi || (ai === fi && sel.anchor.offset <= sel.focus.offset);
      const [start, end] = forward ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
      const si = forward ? ai : fi;
      const ei = forward ? fi : ai;
      const spans: { blockId: string; from: number; to: number }[] = [];
      if (si >= 0 && ei >= 0) {
        for (let i = si; i <= ei; i++) {
          const id = order[i]!;
          const len = contentLength(store.records.get(id)?.content);
          spans.push({ blockId: id, from: i === si ? start.offset : 0, to: i === ei ? end.offset : len });
        }
      }
      for (const span of spans) {
        const found = rangeFor(span.blockId, span.from, span.to);
        if (!found) continue;
        for (const r of rectsOf(found.range)) {
          const tint = doc.createElement("div");
          tint.setAttribute("data-jul-collab-selection", "");
          tint.style.cssText = `position:absolute;background:${color};opacity:var(--jul-collab-selection-opacity,0.22);border-radius:2px`;
          place(tint, r, hostRect);
          group.appendChild(tint);
        }
      }
    }

    const found = rangeFor(sel.focus.blockId, sel.focus.offset, sel.focus.offset);
    if (!found) return;
    const rects = rectsOf(found.range);
    const base = rects[0] ?? found.content.getBoundingClientRect();
    const lineHeight = base.height || parseFloat(found.content.ownerDocument.defaultView?.getComputedStyle(found.content).lineHeight ?? "") || 18;
    const caret = doc.createElement("div");
    caret.setAttribute("data-jul-collab-caret", "");
    caret.style.cssText = `position:absolute;background:${color};border-radius:1px`;
    place(caret, { left: base.left, top: base.top, width: 0, height: lineHeight }, hostRect);
    caret.style.width = "var(--jul-collab-caret-width,2px)";
    group.appendChild(caret);
    if (showLabels) {
      const label = doc.createElement("div");
      label.setAttribute("data-jul-collab-label", "");
      label.textContent = peer.user.name;
      label.style.cssText = `position:absolute;left:0;bottom:100%;white-space:nowrap;padding:1px 6px;border-radius:4px 4px 4px 0;background:${color};color:var(--jul-collab-label-fg,#fff);font:600 var(--jul-collab-label-size,11px)/1.4 system-ui,sans-serif`;
      caret.appendChild(label);
    }
  }

  function render(): void {
    overlay.textContent = "";
    const store = editor.getState().store;
    const hostRect = host.getBoundingClientRect();
    const order = contentBlockOrder(store);
    for (const peer of client.getPeers()) {
      if (peer.selection) drawPeer(peer, peer.selection, store, hostRect, order);
    }
  }

  let frame: number | ReturnType<typeof setTimeout> = 0;
  const raf = (cb: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16));
  const caf = (h: number | ReturnType<typeof setTimeout>) => (typeof cancelAnimationFrame === "function" && typeof h === "number" ? cancelAnimationFrame(h) : clearTimeout(h as ReturnType<typeof setTimeout>));
  function schedule(): void {
    if (frame) return;
    frame = raf(() => {
      frame = 0;
      render();
    });
  }

  const offClient = client.subscribe(schedule);
  const offEditor = editor.on("change", schedule);
  const win = doc.defaultView;
  win?.addEventListener("resize", schedule);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  ro?.observe(root);
  render();

  return {
    render,
    destroy() {
      offClient();
      offEditor();
      win?.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (frame) caf(frame);
      overlay.remove();
      if (restorePosition !== null) host.style.position = restorePosition;
    },
  };
}
