// Operational transformation for the one part of the op model that is
// position-based: text offsets inside a block (replaceContent). Everything
// else is addressed by block id (or sibling anchors), so concurrent edits to
// different blocks, inserts, moves and deletes commute without transforming.
//
// Text edits are decomposed by the diff (wire.ts) into ATOMS: delete(from,to)
// and insert(at, inlines). The classic insert/delete transformation functions
// below satisfy TP1 (apply(a then it(b,a)) == apply(b then it(a,b))), which is
// all a single-authority protocol needs; a fuzz test in transform.test.ts
// checks it on random plain text.
//
// `it(x, y, xWins)` rewrites `x` so it applies AFTER `y` (both were made
// concurrently from the same state). `xWins` is the tie-break/priority flag:
// the op the authority sequenced first wins (its insert lands first, its
// last-write-wins property survives).

import { contentLength } from "@jul-editor/core";
import type { Point, Selection } from "@jul-editor/core";
import type { WireOp } from "./types.js";

type ContentOp = Extract<WireOp, { type: "replaceContent" }>;

const isContent = (op: WireOp): op is ContentOp => op.type === "replaceContent";
const isInsert = (op: ContentOp): boolean => op.from === op.to;

const lenOf = (op: ContentOp): number => contentLength(op.inlines);

/** Rewrites text atom `a` over concurrent text atom `b` (same block id). */
function itText(a: ContentOp, b: ContentOp, aWins: boolean): WireOp[] {
  const lb = lenOf(b);
  if (isInsert(a)) {
    const p = a.from;
    let np: number;
    if (isInsert(b)) np = p < b.from ? p : p > b.from ? p + lb : aWins ? p : p + lb;
    else if (p <= b.from) np = p;
    else if (p >= b.to) np = p - (b.to - b.from);
    else np = b.from; // inside a range someone else deleted: keep the text where the hole closed
    return a.inlines.length === 0 ? [] : [{ ...a, from: np, to: np }];
  }
  // a is a pure delete [s,e)
  const s = a.from;
  const e = a.to;
  if (isInsert(b)) {
    const q = b.from;
    if (q <= s) return [{ ...a, from: s + lb, to: e + lb }];
    if (q >= e) return [a];
    // a collaborator typed INSIDE the range being deleted: delete around it so
    // their text survives (an insert always wins over a delete)
    return [
      { ...a, from: s, to: q },
      { ...a, from: s + lb, to: s + lb + (e - q) },
    ];
  }
  // delete vs delete: drop the already-deleted overlap
  const overlap = Math.max(0, Math.min(e, b.to) - Math.max(s, b.from));
  const remaining = e - s - overlap;
  if (remaining <= 0) return [];
  const start = s >= b.to ? s - (b.to - b.from) : s >= b.from ? b.from : s;
  return [{ ...a, from: start, to: start + remaining }];
}

/** Rewrites `x` over concurrent `y`; returns 0..n ops. Non-text ops commute
 * (id addressing) except for the last-write-wins and "target replaced" rules. */
export function it(x: WireOp, y: WireOp, xWins: boolean): WireOp[] {
  if (isContent(x)) {
    if (isContent(y) && x.id === y.id) return itText(x, y, xWins);
    // the block's whole content was swapped under the edit: the edit's offsets
    // mean nothing any more, whichever order they were sequenced in
    if (y.type === "replaceBlock" && y.id === x.id) return [];
    return [x];
  }
  if ("id" in x && "id" in y && x.id === y.id) {
    // last write wins: the winner (earlier in the sequence) is overridden by
    // the loser that applies after it, so the winner's conflicting part is cut
    // when it is replayed over the loser.
    if (xWins) {
      if (x.type === "setProps" && y.type === "setProps") {
        const keys = new Set([...Object.keys(y.patch), ...(y.unset ?? [])]);
        const patch = Object.fromEntries(Object.entries(x.patch).filter(([k]) => !keys.has(k)));
        const unset = (x.unset ?? []).filter((k) => !keys.has(k));
        return Object.keys(patch).length || unset.length ? [{ ...x, patch, unset }] : [];
      }
      if (
        (x.type === "setType" && y.type === "setType") ||
        (x.type === "moveBlock" && y.type === "moveBlock") ||
        (x.type === "replaceBlock" && y.type === "replaceBlock")
      ) {
        return [];
      }
    }
  }
  return [x];
}

/** Grid transform of two op lists: returns `as` rewritten to apply after `bs`
 * and `bs` rewritten to apply after `as`. `aWins`: `as` is the earlier-
 * sequenced side. */
export function transformLists(as: WireOp[], bs: WireOp[], aWins: boolean): [WireOp[], WireOp[]] {
  if (as.length === 0 || bs.length === 0) return [as, bs];
  if (as.length === 1 && bs.length === 1) return [it(as[0]!, bs[0]!, aWins), it(bs[0]!, as[0]!, !aWins)];
  if (as.length > 1) {
    const [a1, bs1] = transformLists([as[0]!], bs, aWins);
    const [aRest, bs2] = transformLists(as.slice(1), bs1, aWins);
    return [[...a1, ...aRest], bs2];
  }
  const [a1, b1] = transformLists(as, [bs[0]!], aWins);
  const [a2, bRest] = transformLists(a1, bs.slice(1), aWins);
  return [a2, [...b1, ...bRest]];
}

// ---- point / selection mapping (carets, remote presence) -----------------------

/** Maps a text offset in `blockId` over one op. A caret AT a collaborator's
 * insertion point stays before the inserted text (you keep typing in place). */
export function mapOffset(offset: number, blockId: string, op: WireOp): number {
  if (!isContent(op) || op.id !== blockId) return offset;
  if (isInsert(op)) return offset > op.from ? offset + lenOf(op) : offset;
  if (offset <= op.from) return offset;
  if (offset >= op.to) return offset - (op.to - op.from);
  return op.from;
}

/** Maps a point over ops; null when its block was removed/replaced. */
export function mapPoint(point: Point, ops: readonly WireOp[], alive: (id: string) => boolean): Point | null {
  let offset = point.offset;
  for (const op of ops) offset = mapOffset(offset, point.blockId, op);
  return alive(point.blockId) ? { blockId: point.blockId, offset } : null;
}

export function mapSelectionOver(selection: Selection | null, ops: readonly WireOp[], alive: (id: string) => boolean): Selection | null {
  if (!selection || selection.type !== "text") return selection;
  const anchor = mapPoint(selection.anchor, ops, alive);
  const focus = mapPoint(selection.focus, ops, alive);
  return anchor && focus ? { type: "text", anchor, focus } : null;
}
