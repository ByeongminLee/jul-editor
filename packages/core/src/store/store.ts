// Normalized immutable store: flat id->BlockRecord map + root order, path-copy
// commits, tree<->store conversion.

import { admit, normalizeProps } from "../model/canonical.js";
import type { ChildrenKind, Registry } from "../model/schema.js";
import type { Block, Doc, Inline, TextInline } from "../model/types.js";
import { CURRENT_VERSION } from "../model/migrate.js";
import { tableGrid } from "./table.js";
import type { BlockRecord, Selection, Store } from "./types.js";

// ---- content (Inline[]) offset helpers -----------------------------------
// Offsets are UTF-16 code units; a mention counts as exactly 1 unit.
// Only text runs can be split mid-unit.

export function inlineLength(inl: Inline): number {
  return inl.type === "text" ? (inl as TextInline).text.length : 1;
}

export function contentLength(content: Inline[] | undefined): number {
  return (content ?? []).reduce((n, inl) => n + inlineLength(inl), 0);
}

function sliceText(t: TextInline, start: number, end: number): TextInline {
  return t.marks ? { type: "text", text: t.text.slice(start, end), marks: t.marks } : { type: "text", text: t.text.slice(start, end) };
}

/** Splits `content` into [before, after] at a UTF-16 offset, splitting a text
 * run's own string when the offset lands inside one. */
export function splitContentAt(content: Inline[], offset: number): [Inline[], Inline[]] {
  if (offset <= 0) return [[], content];
  const before: Inline[] = [];
  let remaining = offset;
  for (let i = 0; i < content.length; i++) {
    const inl = content[i]!;
    const len = inlineLength(inl);
    if (remaining >= len) {
      before.push(inl);
      remaining -= len;
      continue;
    }
    if (remaining > 0 && inl.type === "text") {
      before.push(sliceText(inl as TextInline, 0, remaining));
      const after: Inline[] = [sliceText(inl as TextInline, remaining, len), ...content.slice(i + 1)];
      return [before, after];
    }
    return [before, content.slice(i)];
  }
  return [before, []];
}

export function sliceContent(content: Inline[], from: number, to: number): Inline[] {
  const [, afterFrom] = splitContentAt(content, from);
  const [mid] = splitContentAt(afterFrom, to - from);
  return mid;
}

export function spliceContent(content: Inline[], from: number, to: number, insert: Inline[]): Inline[] {
  const [before] = splitContentAt(content, from);
  const [, after] = splitContentAt(content, to);
  return [...before, ...insert, ...after];
}

// ---- tree <-> store --------------------------------------------------------

/** Flattens a Doc into a Store. Assumes the Doc is already schema-normalized
 * (fromJSON/normalizeDoc); this only re-derives BlockRecord.props' default-prop
 * omission so the store keeps the same invariant if a caller hands it raw JSON. */
export function fromDoc(doc: Doc, registry: Registry): Store {
  const records = new Map<string, BlockRecord>();
  function visit(block: Block, parentId: string | null) {
    const spec = registry.blocks.get(block.type);
    const rec: BlockRecord = {
      id: block.id,
      type: block.type,
      props: normalizeProps(block.props, spec?.props ?? {}),
      childIds: (block.children ?? []).map((c) => c.id),
      parentId,
    };
    if (block.content !== undefined) rec.content = block.content;
    records.set(block.id, rec);
    for (const c of block.children ?? []) visit(c, block.id);
  }
  for (const b of doc.blocks) visit(b, null);
  return { records, rootIds: doc.blocks.map((b) => b.id) };
}

// Module-level cache: BlockRecord identity == subtree identity,
// so a single WeakMap keyed by record object is safe to share across every
// toDoc call and every Store version -- an unchanged record is the literal
// same object across commits, a changed one (or any of its ancestors) is a
// fresh object and therefore a guaranteed cache miss.
const defaultBlockCache = new WeakMap<BlockRecord, Block>();

/** Builds a tree-shaped Doc from a Store. Unchanged subtrees (same BlockRecord
 * object as a previous call) reuse the exact same Block object. */
export function toDoc(store: Store, version: number = CURRENT_VERSION, cache: WeakMap<BlockRecord, Block> = defaultBlockCache): Doc {
  function build(id: string): Block {
    const rec = store.records.get(id)!;
    const cached = cache.get(rec);
    if (cached) return cached;
    const block: Block = { id: rec.id, type: rec.type, props: rec.props };
    if (rec.content !== undefined) block.content = rec.content;
    if (rec.childIds.length) block.children = rec.childIds.map(build);
    cache.set(rec, block);
    return block;
  }
  return { version, blocks: store.rootIds.map(build) };
}

/** Same as a single toDoc node, but uncached -- used to snapshot a subtree
 * (e.g. for an Op's inverse, or before a structural rewrite) without disturbing
 * the shared toDoc cache. */
export function recordToBlock(store: Store, id: string): Block {
  const rec = store.records.get(id);
  if (!rec) throw new Error(`store: unknown block id "${id}"`);
  const block: Block = { id: rec.id, type: rec.type, props: rec.props };
  if (rec.content !== undefined) block.content = rec.content;
  if (rec.childIds.length) block.children = rec.childIds.map((c) => recordToBlock(store, c));
  return block;
}

/** Flattens a Block subtree (e.g. one being inserted) into BlockRecords rooted
 * at `parentId`. Trusts the caller's props/content are already normalized. */
export function flattenBlockRecords(block: Block, parentId: string | null): Map<string, BlockRecord> {
  const out = new Map<string, BlockRecord>();
  function visit(b: Block, p: string | null) {
    const rec: BlockRecord = { id: b.id, type: b.type, props: b.props, childIds: (b.children ?? []).map((c) => c.id), parentId: p };
    if (b.content !== undefined) rec.content = b.content;
    out.set(b.id, rec);
    for (const c of b.children ?? []) visit(c, b.id);
  }
  visit(block, parentId);
  return out;
}

export function collectSubtreeIds(store: Store, id: string): string[] {
  const out: string[] = [];
  function visit(cur: string) {
    out.push(cur);
    for (const c of store.records.get(cur)?.childIds ?? []) visit(c);
  }
  visit(id);
  return out;
}

// ---- commit (path-copy) ----------------------------------------------------

/** Applies a batch of record changes (new value, or `null` to delete) and
 * path-copies every ancestor up to the root, returning the new
 * Store plus the set of ids whose record identity changed (the touched
 * block(s) + their ancestor chain -- NOT unrelated siblings). */
export function commitPatch(
  store: Store,
  updated: Map<string, BlockRecord | null>,
  rootIds: string[] = store.rootIds,
): { store: Store; changedIds: Set<string> } {
  // `new Map(store.records)` is a full O(n) copy per commit (measured
  // ~0.2ms at 5000 records, ~2.2ms at 50000). Upgrade path if that
  // ever shows up in profiling: a 2-tier overlay map (only when > ~20k blocks).
  const next = new Map(store.records);
  const changedIds = new Set<string>();
  for (const [id, rec] of updated) {
    changedIds.add(id);
    if (rec === null) next.delete(id);
    else next.set(id, rec);
  }
  for (const id of [...updated.keys()]) {
    const rec = updated.get(id);
    let parentId: string | null = rec === null ? (store.records.get(id)?.parentId ?? null) : rec!.parentId;
    while (parentId !== null && !changedIds.has(parentId)) {
      const anc = next.get(parentId);
      if (!anc) break;
      next.set(parentId, { ...anc });
      changedIds.add(parentId);
      parentId = anc.parentId;
    }
  }
  return { store: { records: next, rootIds }, changedIds };
}

// ---- structure queries ------------------------------------------------------

export function siblingsOf(store: Store, id: string): { parentId: string | null; siblings: string[]; index: number } {
  const rec = store.records.get(id);
  const parentId = rec ? rec.parentId : null;
  const siblings = parentId === null ? store.rootIds : (store.records.get(parentId)?.childIds ?? []);
  return { parentId, siblings, index: siblings.indexOf(id) };
}

/** Ids from a root down to (and including) `id`. */
export function ancestorChain(store: Store, id: string): string[] {
  const chain: string[] = [];
  let cur: string | null = id;
  while (cur !== null) {
    chain.unshift(cur);
    cur = store.records.get(cur)?.parentId ?? null;
  }
  return chain;
}

/** -1 if `a` comes before `b` in document pre-order, 1 if after, 0 if equal
 * (including the "one is an ancestor of the other" case as before/after). */
export function comparePreOrder(store: Store, a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  const chainA = ancestorChain(store, a);
  const chainB = ancestorChain(store, b);
  let i = 0;
  while (i < chainA.length && i < chainB.length && chainA[i] === chainB[i]) i++;
  if (i === chainA.length) return -1; // a is an ancestor of b
  if (i === chainB.length) return 1; // b is an ancestor of a
  const parentId = i === 0 ? null : chainA[i - 1]!;
  const siblings = parentId === null ? store.rootIds : store.records.get(parentId)!.childIds;
  return siblings.indexOf(chainA[i]!) < siblings.indexOf(chainB[i]!) ? -1 : 1;
}

/** The nearest block (starting at `id` itself) whose spec has `isolating:
 * true`, or null. Merges/splits/indents may not cross this boundary. */
export function nearestIsolatingAncestor(store: Store, id: string, registry: Registry): string | null {
  let cur: string | null = id;
  while (cur !== null) {
    const rec = store.records.get(cur);
    if (!rec) return null;
    if (registry.blocks.get(rec.type)?.isolating) return cur;
    cur = rec.parentId;
  }
  return null;
}

/** The previous block in document pre-order (a sibling's deepest last
 * descendant, or the parent, or null if `id` is the very first block). */
export function prevBlockInPreOrder(store: Store, id: string): string | null {
  const { parentId, siblings, index } = siblingsOf(store, id);
  if (index <= 0) return parentId;
  let cur = siblings[index - 1]!;
  for (;;) {
    const rec = store.records.get(cur)!;
    if (rec.childIds.length === 0) return cur;
    cur = rec.childIds[rec.childIds.length - 1]!;
  }
}

/** The next block in document pre-order (first child, else next sibling,
 * else the nearest ancestor's next sibling), or null if `id` is the last. */
export function nextBlockInPreOrder(store: Store, id: string): string | null {
  const rec = store.records.get(id);
  if (rec && rec.childIds.length) return rec.childIds[0]!;
  let cur: string | null = id;
  while (cur !== null) {
    const { parentId, siblings, index } = siblingsOf(store, cur);
    if (index + 1 < siblings.length) return siblings[index + 1]!;
    cur = parentId;
  }
  return null;
}

/** The contiguous run of top-level (shared-parent) sibling ids spanning from
 * `aId`'s branch down to `bId`'s branch -- i.e. "which blocks does a range from
 * aId to bId touch, at the level where their ancestor chains diverge" (same
 * divergence-point logic as edits.ts's buildDeleteRangeOps). Order-independent
 * (aId/bId may be given in either document order). Used to promote a text
 * selection to a `block` selection (Esc) and to extend one (Shift+Arrow). */
export function spannedTopBlocks(store: Store, aId: string, bId: string): string[] {
  if (aId === bId) return [aId];
  const chainA = ancestorChain(store, aId);
  const chainB = ancestorChain(store, bId);
  let k = 0;
  while (k < chainA.length && k < chainB.length && chainA[k] === chainB[k]) k++;
  if (k >= chainA.length) return [aId]; // aId is an ancestor of bId
  if (k >= chainB.length) return [bId]; // bId is an ancestor of aId
  const aChild = chainA[k]!;
  const bChild = chainB[k]!;
  const { siblings } = siblingsOf(store, aChild);
  const i = siblings.indexOf(aChild);
  const j = siblings.indexOf(bChild);
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return siblings.slice(lo, hi + 1);
}

export function containerInfo(store: Store, parentId: string | null, registry: Registry): { type: string | null; children: ChildrenKind } {
  if (parentId === null) return { type: null, children: "any" };
  const rec = store.records.get(parentId)!;
  return { type: rec.type, children: registry.blocks.get(rec.type)?.children ?? "none" };
}

export function canAdmit(registry: Registry, childType: string, containerType: string | null, containerChildren: ChildrenKind): boolean {
  return admit(childType, registry.blocks.get(childType), containerType, containerChildren);
}

// ---- copy/cut fragment extraction --------------------
// The read-side mirror of edits.ts's buildDeleteRangeOps: instead of emitting
// Ops that DELETE the selected range, this builds the Doc fragment that IS
// the selected range, for encodeClipboard to serialize. Every kept subtree
// reuses its original block id (safe: decodeClipboard's jul-editor-json path
// unconditionally reissues every id anyway, and the markdown/HTML paths
// never carry ids at all -- see clipboard/index.ts's decodeJulEditorJson comment).

/** A same-block or cross-block `text` selection's fragment (single- or
 * multi-block-topped, mirrors buildDeleteRangeOps' own divergence-point walk),
 * a `block` selection's own blocks verbatim, or a `cells` selection's
 * rectangular range wrapped back in a synthetic table/row shell. */
export function extractFragment(store: Store, selection: Selection, registry: Registry): Doc {
  if (selection.type === "block") {
    return { version: CURRENT_VERSION, blocks: selection.ids.filter((id) => store.records.has(id)).map((id) => recordToBlock(store, id)) };
  }
  if (selection.type === "cells") {
    return { version: CURRENT_VERSION, blocks: extractCellsFragment(store, registry, selection) };
  }

  const order = comparePreOrder(store, selection.anchor.blockId, selection.focus.blockId);
  const [start, end] = order <= 0 ? [selection.anchor, selection.focus] : [selection.focus, selection.anchor];

  if (start.blockId === end.blockId) {
    const rec = store.records.get(start.blockId);
    if (!rec) return { version: CURRENT_VERSION, blocks: [] };
    const from = Math.min(start.offset, end.offset);
    const to = Math.max(start.offset, end.offset);
    if (from === to) return { version: CURRENT_VERSION, blocks: [] };
    const content = sliceContent(rec.content ?? [], from, to);
    return { version: CURRENT_VERSION, blocks: content.length ? [{ id: rec.id, type: rec.type, props: rec.props, content }] : [] };
  }

  const startChain = ancestorChain(store, start.blockId);
  const endChain = ancestorChain(store, end.blockId);
  let k = 0;
  while (k < startChain.length && k < endChain.length && startChain[k] === endChain[k]) k++;

  if (k === startChain.length) {
    // start.blockId is itself an ancestor of end.blockId (mirrors
    // buildDeleteRangeOps' matching branch): its own content from
    // start.offset onward is kept, full siblings before the branch toward
    // end.blockId are kept, and the branch itself is recursively trimmed down
    // to end.offset.
    const startRec = store.records.get(start.blockId)!;
    const content = sliceContent(startRec.content ?? [], start.offset, contentLength(startRec.content));
    const restPath = endChain.slice(k);
    const branchIdx = startRec.childIds.indexOf(restPath[0]!);
    const before = startRec.childIds.slice(0, branchIdx).map((id) => recordToBlock(store, id));
    const branch = sliceSubtreeToEnd(store, restPath[0]!, restPath.slice(1), end.offset);
    const block: Block = { id: startRec.id, type: startRec.type, props: startRec.props };
    if (content.length) block.content = content;
    const children = [...before, branch];
    if (children.length) block.children = children;
    return { version: CURRENT_VERSION, blocks: [block] };
  }

  // General case: start/end diverge at distinct top-level (for this fragment)
  // siblings under a common parent (possibly root).
  const aChild = startChain[k]!;
  const bChild = endChain[k]!;
  const { siblings } = siblingsOf(store, aChild);
  const aIdx = siblings.indexOf(aChild);
  const bIdx = siblings.indexOf(bChild);

  const startBlock = sliceSubtreeFromStart(store, aChild, startChain.slice(k + 1), start.offset);
  const middle = siblings.slice(aIdx + 1, bIdx).map((id) => recordToBlock(store, id));
  const endBlock = sliceSubtreeToEnd(store, bChild, endChain.slice(k + 1), end.offset);
  return { version: CURRENT_VERSION, blocks: [startBlock, ...middle, endBlock] };
}

/** Keeps `id`'s subtree from (path, offset) THROUGH to its own end -- the
 * complement of edits.ts's emitDeleteFromStart (which deletes that same
 * span). `id`'s own content precedes every descendant in pre-order, so when
 * `path` is non-empty (the kept point is inside a deeper descendant) it's
 * entirely excluded here; likewise every child before `path[0]` is excluded
 * (they precede the kept point too), and every child after it is kept whole. */
function sliceSubtreeFromStart(store: Store, id: string, path: string[], offset: number): Block {
  const rec = store.records.get(id)!;
  if (path.length === 0) {
    const content = sliceContent(rec.content ?? [], offset, contentLength(rec.content));
    const block: Block = { id: rec.id, type: rec.type, props: rec.props };
    if (content.length) block.content = content;
    if (rec.childIds.length) block.children = rec.childIds.map((cid) => recordToBlock(store, cid));
    return block;
  }
  const idx = rec.childIds.indexOf(path[0]!);
  const childFrag = sliceSubtreeFromStart(store, path[0]!, path.slice(1), offset);
  const rest = rec.childIds.slice(idx + 1).map((cid) => recordToBlock(store, cid));
  return { id: rec.id, type: rec.type, props: rec.props, children: [childFrag, ...rest] };
}

/** Keeps `id`'s subtree from its own start THROUGH to (path, offset) -- the
 * complement of edits.ts's emitDeleteToEnd. `id`'s own content precedes every
 * descendant, so it's always kept whole here; children before `path[0]` are
 * kept whole (they precede the kept endpoint), the branch is recursed into,
 * and children after it are excluded entirely (they follow the endpoint). */
function sliceSubtreeToEnd(store: Store, id: string, path: string[], offset: number): Block {
  const rec = store.records.get(id)!;
  if (path.length === 0) {
    const content = sliceContent(rec.content ?? [], 0, offset);
    const block: Block = { id: rec.id, type: rec.type, props: rec.props };
    if (content.length) block.content = content;
    return block;
  }
  const idx = rec.childIds.indexOf(path[0]!);
  const before = rec.childIds.slice(0, idx).map((cid) => recordToBlock(store, cid));
  const childFrag = sliceSubtreeToEnd(store, path[0]!, path.slice(1), offset);
  const block: Block = { id: rec.id, type: rec.type, props: rec.props };
  if ((rec.content ?? []).length) block.content = rec.content;
  block.children = [...before, childFrag];
  return block;
}

// grid-aware (tableGrid), not raw childIds indices -- same rectangle
// coordinates buildCellsClearOps/cellsSelectionIds resolve, so copying a
// selection that starts or ends inside a merged cell's covered area extracts
// exactly the cells it visually covers. A spanning cell is only ever emitted
// at its own ANCHOR position (`g.isAnchor`), never at every row/col its span
// covers too -- emitting it more than once would duplicate its id across
// rows of the very fragment being built (recordToBlock returns the same id
// each time), which is exactly the kind of doc `opReplaceBlock`'s duplicate-id fix
// guards against on the WRITE side; here on the read side it's simplest to
// just never produce it in the first place.
function extractCellsFragment(store: Store, registry: Registry, selection: Extract<Selection, { type: "cells" }>): Block[] {
  const table = store.records.get(selection.tableId);
  if (!table) return [];
  const grid = tableGrid(store, registry, selection.tableId);
  const minR = Math.min(selection.anchor[0], selection.focus[0]);
  const maxR = Math.min(Math.max(selection.anchor[0], selection.focus[0]), grid.length - 1);
  const minC = Math.min(selection.anchor[1], selection.focus[1]);
  const maxC = Math.max(selection.anchor[1], selection.focus[1]);
  const rows: Block[] = [];
  for (let r = minR; r <= maxR; r++) {
    const rowId = table.childIds[r];
    const row = rowId ? store.records.get(rowId) : undefined;
    const gridRow = grid[r] ?? [];
    if (!row) continue;
    const cells: Block[] = [];
    for (let c = minC; c <= maxC && c < gridRow.length; c++) {
      const g = gridRow[c];
      if (!g || !g.isAnchor) continue;
      cells.push(recordToBlock(store, g.cellId));
    }
    // A row can legitimately have NO anchors of its own within the selected
    // columns (entirely covered by an earlier row's rowspan, e.g. copying a
    // merged cell's own full 2-row footprint) -- it still must be emitted
    // (even childless) so the fragment's own ROW COUNT matches what the
    // anchor's rowspan expects; dropping it would leave the anchor's rowspan
    // reaching past the fragment's own last row, which normalizeDoc's
    // span-aware padding (model/canonical.ts) then clamps back down as if it
    // were hostile input.
    rows.push({ id: row.id, type: "tableRow", props: row.props, children: cells });
  }
  return rows.length ? [{ id: table.id, type: "table", props: table.props, children: rows }] : [];
}
