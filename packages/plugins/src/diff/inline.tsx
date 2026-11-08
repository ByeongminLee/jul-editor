// Inline renderer for DiffView. Aligns the diff's fast-diff ops (computed over FLATTENED
// before/after text, mentions as U+FFFC -- see ./diff.ts's flattenInline) back onto each side's
// actual marked Inline runs, so a modified block's <ins>/<del> renders marks the way the editor
// would. Mark/run rendering itself comes from @jul-editor/react's public inline helpers.

import type { Inline, Registry } from "@jul-editor/core";
import { renderInlineChars, toInlineChars, type InlineChar } from "@jul-editor/react";
import { Fragment, type ReactNode } from "react";
import type { InlineOp } from "./diff.js";

export interface InlineSeg {
  kind: "same" | "ins" | "del";
  chars: InlineChar[];
}

/** Walks `ops` (old/new text index order) while walking parallel cursors into
 * `oldContent`'s and `newContent`'s per-char lists, so each op's slice can be
 * rendered with that side's real marks instead of just its flattened text.
 * `formatRanges` (only ever set when text is identical on both sides) flags
 * same-text chars whose formatting changed. */
export function computeInlineSegments(
  oldContent: Inline[] | undefined,
  newContent: Inline[] | undefined,
  ops: InlineOp[],
  formatRanges: [number, number][] | undefined,
  registry: Registry,
): InlineSeg[] {
  const oldChars = toInlineChars(oldContent, registry);
  const newChars = toInlineChars(newContent, registry);
  let oi = 0;
  let ni = 0;
  const segs: InlineSeg[] = [];
  for (const [type, text] of ops) {
    const len = text.length;
    if (type === -1) {
      segs.push({ kind: "del", chars: oldChars.slice(oi, oi + len) });
      oi += len;
    } else if (type === 1) {
      segs.push({ kind: "ins", chars: newChars.slice(ni, ni + len) });
      ni += len;
    } else {
      const slice = newChars.slice(ni, ni + len).map((c, idx) => {
        const abs = ni + idx;
        const inRange = (formatRanges ?? []).some(([s, e]) => abs >= s && abs < e);
        return inRange ? { ...c, format: true } : c;
      });
      segs.push({ kind: "same", chars: slice });
      oi += len;
      ni += len;
    }
  }
  return segs;
}

export function renderInlineSeg(seg: InlineSeg, key: string): ReactNode {
  const content = renderInlineChars(seg.chars, key);
  if (seg.kind === "ins") {
    return (
      <ins key={key} data-diff-inline="insert">
        {content}
      </ins>
    );
  }
  if (seg.kind === "del") {
    return (
      <del key={key} data-diff-inline="delete">
        {content}
      </del>
    );
  }
  return <Fragment key={key}>{content}</Fragment>;
}

export function renderInlineSegments(segs: InlineSeg[]): ReactNode {
  return <>{segs.map((s, i) => renderInlineSeg(s, `seg-${i}`))}</>;
}
