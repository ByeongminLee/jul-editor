// Store <-> wire ops. Local edits reach the sync layer as plain before/after
// stores (typing, commands, undo/redo, setDoc all end as a store change), so
// ONE function turns any store change into wire ops. That is deliberately the
// only outbound path: undo/redo and programmatic edits are replicated exactly
// like typing, and no core change is needed to observe ops.

import { applyOp, contentLength, sliceContent } from "@jul-editor/core";
import type { Block, BlockRecord, Inline, Json, Op, Registry, Store, TextInline } from "@jul-editor/core";
import type { WireOp } from "./types.js";

/** `to` of a "delete everything after `from`" atom; JSON-safe (no Infinity). */
export const TO_END = Number.MAX_SAFE_INTEGER;

// ---- equality -------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function sameRecord(a: BlockRecord, b: BlockRecord): boolean {
  return (
    a === b ||
    (a.type === b.type &&
      a.parentId === b.parentId &&
      deepEqual(a.childIds, b.childIds) &&
      deepEqual(a.props, b.props) &&
      deepEqual(a.content ?? [], b.content ?? []))
  );
}

/** Structural store equality (content undefined == []). */
export function sameStore(a: Store, b: Store): boolean {
  if (a === b) return true;
  if (a.records.size !== b.records.size || !deepEqual(a.rootIds, b.rootIds)) return false;
  for (const [id, rec] of a.records) {
    const other = b.records.get(id);
    if (!other || !sameRecord(rec, other)) return false;
  }
  return true;
}

// ---- text diff ----------------------------------------------------------------------

interface Unit {
  c: string | null; // the UTF-16 unit, or null for a non-text inline
  k: string; // marks / inline identity
}

function toUnits(content: readonly Inline[] | undefined): Unit[] {
  const out: Unit[] = [];
  for (const inl of content ?? []) {
    if (inl.type === "text") {
      const t = inl as TextInline;
      const k = t.marks && t.marks.length ? JSON.stringify(t.marks) : "";
      for (let i = 0; i < t.text.length; i++) out.push({ c: t.text[i]!, k });
    } else out.push({ c: null, k: JSON.stringify(inl) });
  }
  return out;
}

/** Minimal common-prefix/suffix diff of two inline sequences as atoms. */
function diffContent(id: string, before: readonly Inline[] | undefined, after: readonly Inline[] | undefined): WireOp[] {
  if (before === after || deepEqual(before ?? [], after ?? [])) return [];
  const a = toUnits(before);
  const b = toUnits(after);
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p]!.c === b[p]!.c && a[p]!.k === b[p]!.k) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s]!.c === b[b.length - 1 - s]!.c && a[a.length - 1 - s]!.k === b[b.length - 1 - s]!.k) s++;
  const ops: WireOp[] = [];
  if (a.length - s > p) ops.push({ type: "replaceContent", id, from: p, to: a.length - s, inlines: [] });
  if (b.length - s > p) ops.push({ type: "replaceContent", id, from: p, to: p, inlines: sliceContent([...(after ?? [])], p, b.length - s) });
  return ops;
}

// ---- LIS (which survivors can stay put) -----------------------------------------------

/** Indices (into `seq`) of one longest strictly increasing subsequence. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = []; // index into seq of the smallest tail per length
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

// ---- store diff -------------------------------------------------------------------------

/**
 * Wire ops that turn `prev` into `next`. O(records) identity/field compares;
 * fine for documents in the thousands of blocks (measured against the core's
 * own O(n) commit copy). Order: inserts and moves in document pre-order of
 * `next` (anchors only ever name already-placed siblings), then content/props/
 * type updates, then removals last (so a survivor can be moved out of a doomed
 * parent first).
 */
export function diffStores(prev: Store, next: Store): WireOp[] {
  if (prev === next) return [];
  const old = prev.records;
  const cur = next.records;
  const added = new Set<string>();
  const deleted = new Set<string>();
  for (const id of cur.keys()) if (!old.has(id)) added.add(id);
  for (const id of old.keys()) if (!cur.has(id)) deleted.add(id);

  const ops: WireOp[] = [];

  function payload(id: string): Block {
    const rec = cur.get(id)!;
    const block: Block = { id: rec.id, type: rec.type, props: rec.props };
    if (rec.content !== undefined) block.content = rec.content;
    const kids = rec.childIds.filter((c) => added.has(c));
    if (kids.length) block.children = kids.map(payload);
    return block;
  }

  // sibling position of every survivor in the OLD tree, built once per parent
  const oldIndexCache = new Map<string | null, Map<string, number>>();
  function oldIndexIn(parentId: string | null, id: string): number {
    let m = oldIndexCache.get(parentId);
    if (!m) {
      m = new Map();
      (parentId === null ? prev.rootIds : (old.get(parentId)?.childIds ?? [])).forEach((c, i) => m!.set(c, i));
      oldIndexCache.set(parentId, m);
    }
    return m.get(id) ?? -1;
  }

  function visit(parentId: string | null, parentAdded: boolean): void {
    const children = parentId === null ? next.rootIds : cur.get(parentId)!.childIds;
    // survivors that already sit in this parent and keep their relative order
    // need no op; the rest are moved right after their new predecessor
    const candidates: { child: string; idx: number }[] = [];
    if (!parentAdded) {
      for (const c of children) {
        if (!old.has(c) || old.get(c)!.parentId !== parentId) continue;
        candidates.push({ child: c, idx: oldIndexIn(parentId, c) });
      }
    }
    const stableIdx = lis(candidates.map((c) => c.idx));
    const stable = new Set<string>();
    candidates.forEach((c, i) => stableIdx.has(i) && stable.add(c.child));

    children.forEach((c, i) => {
      const after = i > 0 ? children[i - 1]! : null;
      const before = i + 1 < children.length ? children[i + 1]! : null;
      if (added.has(c)) {
        if (!parentAdded) ops.push({ type: "insertBlock", parentId, after, before, block: payload(c) });
      } else if (!stable.has(c)) {
        ops.push({ type: "moveBlock", id: c, newParentId: parentId, after, before });
      }
      visit(c, added.has(c));
    });
  }
  visit(null, false);

  // updates to survivors
  for (const [id, rec] of cur) {
    const was = old.get(id);
    if (!was || rec === was) continue;
    if (rec.type !== was.type) {
      ops.push({ type: "setType", id, blockType: rec.type, props: rec.props });
      if (rec.content !== undefined || was.content !== undefined) {
        ops.push({ type: "replaceContent", id, from: 0, to: TO_END, inlines: [] });
        if (contentLength(rec.content) > 0) ops.push({ type: "replaceContent", id, from: 0, to: 0, inlines: rec.content! });
      }
      continue;
    }
    if (!deepEqual(rec.props, was.props)) {
      const patch: Record<string, Json> = {};
      const unset: string[] = [];
      for (const k of Object.keys(rec.props)) if (!deepEqual(rec.props[k], was.props[k])) patch[k] = rec.props[k]!;
      for (const k of Object.keys(was.props)) if (!(k in rec.props)) unset.push(k);
      ops.push({ type: "setProps", id, patch, ...(unset.length ? { unset } : {}) });
    }
    ops.push(...diffContent(id, was.content, rec.content));
  }

  for (const id of deleted) {
    const pid = old.get(id)!.parentId;
    if (pid === null || !deleted.has(pid)) ops.push({ type: "removeBlock", id });
  }
  return ops;
}

// ---- applying wire ops ---------------------------------------------------------------------

function siblingsOf(store: Store, parentId: string | null): readonly string[] {
  return parentId === null ? store.rootIds : (store.records.get(parentId)?.childIds ?? []);
}

/** Anchor -> numeric index in the receiver's CURRENT sibling list. */
function resolveIndex(store: Store, parentId: string | null, after: string | null, before: string | null, excludeId?: string): number {
  const list = siblingsOf(store, parentId).filter((s) => s !== excludeId);
  if (after === null) return 0;
  const i = list.indexOf(after);
  if (i >= 0) return i + 1;
  const j = before ? list.indexOf(before) : -1;
  return j >= 0 ? j : list.length;
}

function subtreeIds(block: Block, out: string[] = []): string[] {
  out.push(block.id);
  for (const c of block.children ?? []) subtreeIds(c, out);
  return out;
}

/** Wire op -> core Op against `store`, or null when it must be skipped
 * (an insert whose ids already exist: a duplicate delivery or a lost race). */
export function resolveWireOp(store: Store, op: WireOp): Op | null {
  switch (op.type) {
    case "insertBlock": {
      if (subtreeIds(op.block).some((id) => store.records.has(id))) return null;
      return { type: "insertBlock", parentId: op.parentId, index: resolveIndex(store, op.parentId, op.after, op.before), block: op.block };
    }
    case "moveBlock":
      return { type: "moveBlock", id: op.id, newParentId: op.newParentId, index: resolveIndex(store, op.newParentId, op.after, op.before, op.id) };
    case "setProps": {
      const patch: Record<string, Json | undefined> = { ...op.patch };
      for (const k of op.unset ?? []) patch[k] = undefined;
      return { type: "setProps", id: op.id, patch };
    }
    default:
      return op;
  }
}

/** Applies wire ops in order, skipping the unresolvable ones. */
export function applyWireOps(store: Store, ops: readonly WireOp[], registry: Registry): { store: Store; changedIds: Set<string>; resolved: Op[] } {
  let cur = store;
  const changedIds = new Set<string>();
  const resolved: Op[] = [];
  for (const wire of ops) {
    const op = resolveWireOp(cur, wire);
    if (!op) continue;
    const r = applyOp(cur, op, registry);
    cur = r.store;
    for (const id of r.changedIds) changedIds.add(id);
    resolved.push(op);
  }
  return { store: cur, changedIds, resolved };
}
