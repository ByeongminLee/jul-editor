// Shared helpers for the "/perf" route (both the react=0 vanilla variant
// and the react=1 @jul-editor/react variant). These support the
// measurement protocol in e2e/perf.spec.ts.

import { contentLength, type Block, type Doc } from "@jul-editor/core";

/** A generic, deliberately lightweight void-block renderer -- the perf doc
 * fixtures include image/chart/diagram blocks (the "mixed" doc
 * requirement), but this page measures TYPING latency, not chart/mermaid
 * rendering cost, so it skips @jul-editor/plugins' real renderers on purpose. */
export function renderVoidGeneric(block: Block, container: HTMLElement): void {
  const div = document.createElement("div");
  div.setAttribute("data-testid", "void-block");
  div.textContent = String(block.props.alt ?? block.props.code ?? block.type);
  container.appendChild(div);
}

/** The document-order-flattened middle block that actually has typeable
 * `content` (a table/void/list-parent-without-content block in the middle
 * index is skipped in favor of the nearest text block) -- "커서는 문서 중간
 * 무작위 블록".
 *
 * Offset is the MIDDLE of the block's content, not its end -- the
 * bench fixtures' generated inline runs sometimes end in a marked (bold/
 * italic/link) run with nothing plain after it, and appending exactly at
 * that boundary needs a brand-new trailing (unmarked) inline run, which
 * view/render.ts's patchContent doesn't have an in-place path for (falls
 * back to rebuilding the whole block's DOM, i.e. even its untouched marked
 * runs get torn down and recreated) -- a real render-layer gap, but not part
 * of the typing-latency measurement. Typing
 * mid-run instead keeps every perf.spec.ts test on the common-case "just
 * patch this text node in place" path. Left as a known
 * render-layer gap rather than silently avoided. */
export function findMiddleTextPoint(doc: Doc): { blockId: string; offset: number } {
  const flat: Block[] = [];
  (function walk(blocks: Block[]) {
    for (const b of blocks) {
      flat.push(b);
      if (b.children) walk(b.children);
    }
  })(doc.blocks);

  const mid = Math.floor(flat.length / 2);
  for (let d = 0; d < flat.length; d++) {
    for (const idx of [mid + d, mid - d]) {
      const b = flat[idx];
      if (b && Array.isArray(b.content)) return { blockId: b.id, offset: Math.floor(contentLength(b.content) / 2) };
    }
  }
  throw new Error("perf: no text-content block found in doc");
}
