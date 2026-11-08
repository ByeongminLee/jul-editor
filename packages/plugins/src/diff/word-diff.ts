// Word-level coarsening of fast-diff ops (a light "cleanupSemantic" in the diff-match-patch sense).
// fast-diff is character-level, so "teh" -> "The" comes out as three tiny hunks ("te" deleted, "T"
// inserted, ...), each of which would get its own Accept / Reject control. This pass turns the op
// list into hunks, grows every hunk to the nearest word boundaries and merges hunks that touch or
// are separated only by a few separator characters, so one edited word (or phrase) is ONE
// replacement. DOM-free; operates on the same [op, text] tuples fast-diff produces.

export type DiffOp = [-1 | 0 | 1, string];

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (ch: string | undefined): boolean => ch !== undefined && ch !== "" && WORD.test(ch);

/** Longest run of non-word characters between two hunks that is still absorbed into one change. */
const MERGE_GAP = 3;

interface Hunk {
  of: number;
  ot: number;
  nf: number;
  nt: number;
}

/** Coarsens `ops` to word granularity. Returns ops over the same old/new strings. */
export function wordifyOps(ops: readonly DiffOp[]): DiffOp[] {
  let oldS = "";
  let newS = "";
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const [type, s] of ops) {
    if (type === 0) {
      cur = null;
      oldS += s;
      newS += s;
      continue;
    }
    cur ??= (hunks[hunks.push({ of: oldS.length, ot: oldS.length, nf: newS.length, nt: newS.length }) - 1] as Hunk);
    if (type === -1) {
      oldS += s;
      cur.ot = oldS.length;
    } else {
      newS += s;
      cur.nt = newS.length;
    }
  }
  if (hunks.length === 0) return ops.map((o) => [o[0], o[1]] as DiffOp);

  // 1. grow each hunk outwards while its edge sits inside a word (neighbours in the equal region
  //    are identical on both sides, so the old/new offsets move in lockstep)
  for (const h of hunks) {
    while (h.of > 0 && h.nf > 0 && isWord(oldS[h.of - 1]) && (isWord(oldS[h.of]) || isWord(newS[h.nf]))) {
      h.of--;
      h.nf--;
    }
    while (h.ot < oldS.length && h.nt < newS.length && isWord(oldS[h.ot]) && (isWord(oldS[h.ot - 1]) || isWord(newS[h.nt - 1]))) {
      h.ot++;
      h.nt++;
    }
  }

  // 2. merge hunks that overlap/touch, or whose gap is a few non-word characters only
  const merged: Hunk[] = [];
  for (const h of hunks) {
    const last = merged[merged.length - 1];
    if (last) {
      const gap = oldS.slice(last.ot, h.of);
      if (h.of <= last.ot || (gap.length <= MERGE_GAP && ![...gap].some(isWord))) {
        last.ot = Math.max(last.ot, h.ot);
        last.nt = Math.max(last.nt, h.nt);
        continue;
      }
    }
    merged.push({ ...h });
  }

  // 3. rebuild ops
  const out: DiffOp[] = [];
  let po = 0;
  for (const h of merged) {
    if (h.of > po) out.push([0, oldS.slice(po, h.of)]);
    if (h.ot > h.of) out.push([-1, oldS.slice(h.of, h.ot)]);
    if (h.nt > h.nf) out.push([1, newS.slice(h.nf, h.nt)]);
    po = h.ot;
  }
  if (po < oldS.length) out.push([0, oldS.slice(po)]);
  return out;
}
