// IME absorb path: the model is kept live during
// composition instead of waiting for compositionend, so slash/mention queries
// and any command that runs mid-composition see up-to-date text.

import { canonicalStringify, normalizeInline } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Inline, Mark } from "../model/types.js";
import { contentLength, splitContentAt } from "../store/store.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import { plainTextOf, readContentFromDOM } from "./inline-dom.js";
import type { BlockEls } from "./render.js";
import { readDOMSelection } from "./selection.js";

export interface ComposeRef {
  id: string | null;
  /** true only strictly between compositionstart and compositionend. Render
   * must skip DOM writes for `id` while this is true; once false, `id` may
   * still be set ("pending") until the next command's flush. */
  active: boolean;
  /** A stored-mark override (Mod+b with a collapsed caret, marks.ts's
   * toggleMarkOrStore) that was pending at `compositionstart`, consumed right
   * there (same one-shot contract as consumeInsertMarks) -- `null` means no
   * override was pending, so the composed text is left exactly as
   * readContentFromDOM reports it (the common case: composing inside/next to
   * already-marked DOM naturally inherits those marks for free, since the
   * browser's own composition writes land inside whatever DOM node the caret
   * was already in). A non-null (possibly empty) array means this override
   * must be applied to the newly-composed substring specifically, since a
   * JUST-toggled mark has no marked DOM to physically sit inside of yet. */
  overrideMarks: Mark[] | null;
  /** The composing block's content, and the collapsed offset composition
   * began at, captured once at compositionstart (before any composition
   * edits) -- only set when `overrideMarks` is non-null, used to find the
   * newly-composed substring within each sync's freshly-read content. */
  startContent: Inline[] | null;
  startOffset: number | null;
}

/** Reapplies a pending stored-mark override (see ComposeRef.overrideMarks) to
 * the substring of `next` that composition actually inserted, leaving the
 * untouched prefix/suffix (from `startContent`, sliced at `startOffset`) with
 * their own original marks. Falls back to `next` unchanged if the read-back
 * text doesn't cleanly start/end with that prefix/suffix (composition should
 * never touch text outside its own insertion point, but if something
 * unexpected happened, guessing would be worse than doing nothing). */
function applyOverrideMarks(next: Inline[], startContent: Inline[], startOffset: number, overrideMarks: Mark[], registry: Registry): Inline[] {
  const [before, after] = splitContentAt(startContent, startOffset);
  const prefix = plainTextOf(before);
  const suffix = plainTextOf(after);
  const nextPlain = plainTextOf(next);
  if (nextPlain.length < prefix.length + suffix.length || !nextPlain.startsWith(prefix) || !nextPlain.endsWith(suffix)) return next;
  const inserted = nextPlain.slice(prefix.length, nextPlain.length - suffix.length);
  const middle: Inline[] = inserted.length > 0 ? [overrideMarks.length > 0 ? { type: "text", text: inserted, marks: overrideMarks } : { type: "text", text: inserted }] : [];
  return normalizeInline([...before, ...middle, ...after], registry);
}

export interface SyncDeps {
  root: HTMLElement;
  registry: Registry;
  blockEls: Map<string, BlockEls>;
  getState: () => EditorState;
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult;
  /** Present when called from the view's own composition handling -- carries
   * a pending stored-mark override (see ComposeRef), if any, so it can be
   * reapplied to the newly-composed substring. Omitted by any other caller
   * (there are none today, but the field stays optional rather than required
   * so a future non-IME caller of syncBlockFromDOM isn't forced to invent one). */
  compose?: ComposeRef;
}

/** Reads `blockId`'s content DOM, and if it differs from the model, commits a
 * full-range replaceContent (plus the model selection re-derived from the
 * SAME, not-yet-touched DOM -- otherwise the selection left over from before
 * composition started would go stale and get written back at the wrong
 * offset once composition ends and DOM writes resume). Idempotent: calling it
 * again with an unchanged DOM is a no-op (no dispatch, no render). Safe to
 * call speculatively from every input event, compositionend, and the
 * pending-composition flush. */
export function syncBlockFromDOM(blockId: string | null, deps: SyncDeps): void {
  if (!blockId) return;
  const els = deps.blockEls.get(blockId);
  if (!els?.content) return;
  const rec = deps.getState().store.records.get(blockId);
  if (!rec) return;
  const spec = deps.registry.blocks.get(rec.type);
  if (!spec || (spec.content !== "inline" && spec.content !== "code")) return;
  const prior = rec.content ?? [];
  let next = readContentFromDOM(els.content, deps.registry, prior);
  const c = deps.compose;
  if (c && c.id === blockId && c.overrideMarks !== null && c.startContent !== null && c.startOffset !== null) {
    next = applyOverrideMarks(next, c.startContent, c.startOffset, c.overrideMarks, deps.registry);
  }
  if (canonicalStringify(next) === canonicalStringify(prior)) return;
  const domSel = readDOMSelection(deps.root);
  deps.runDispatch((tx) => {
    tx.replaceContent(blockId, 0, contentLength(prior), next);
    return domSel ? tx.setSelection(domSel) : tx;
  });
}
