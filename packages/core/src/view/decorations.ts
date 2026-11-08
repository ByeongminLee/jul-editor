// "decorated" renderer slot -- a non-editable sibling container for a
// non-void block with editable content or children (e.g. a callout's icon or
// a table's custom controls). The void path owns its full subtree. Reuses
// the same `RenderVoidFn`
// callback/container convention as void blocks (one persistent container per
// id, created once, torn down via the returned cleanup) so the host side
// (e.g. @jul-editor/react's voidRegistry + portal) needs no new concept -- it's
// the same "mount whatever `renderers[type]` is into this container" wiring,
// just anchored beside the content div instead of replacing it. Kept in its
// own file/hook (not inlined into render.ts) so this small, testable policy
// doesn't bloat the file every executor is touching concurrently.

import type { Block } from "../model/types.js";
import { DECORATION_ATTR } from "./dom.js";
import type { BlockEls, RenderVoidFn } from "./render.js";

/** Creates (once) the decoration container and mounts `renderVoid` into it,
 * if the block hasn't already gotten one this render pass. No-op if
 * `renderVoid` is unset (a bare/headless createView -- nothing to mount). */
export function ensureDecoration(els: BlockEls, block: Block, renderVoid: RenderVoidFn | undefined): void {
  if (els.decorationEl || !renderVoid) return;
  const el = document.createElement("div");
  el.setAttribute(DECORATION_ATTR, "");
  el.setAttribute("contenteditable", "false");
  els.wrapper.appendChild(el);
  els.decorationEl = el;
  els.decorationDestroy = renderVoid(block, el) ?? undefined;
}

/** Tears down a previously-created decoration container (e.g. the block's
 * spec stopped being `decorated`, or it was removed from the doc). */
export function teardownDecoration(els: BlockEls): void {
  if (!els.decorationEl) return;
  els.decorationDestroy?.();
  els.decorationEl.remove();
  els.decorationEl = undefined;
  els.decorationDestroy = undefined;
}
