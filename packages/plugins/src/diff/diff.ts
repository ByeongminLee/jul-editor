// Git-like document diff. DOM-free (must run in plain node).
//
// Algorithm:
// 1. Resolve default-prop/mark-order equivalence per side (so two docs that
//    differ only by "explicit default prop" vs "omitted" or mark ordering
//    diff as identical) -- see `effectiveSelfHash` below for why this is done
//    per-block via getProp/normalizeInline instead of calling the model's
//    `normalizeDoc` up front: normalizeDoc always allocates fresh Block
//    objects, which would defeat the WeakMap identity cache in step 2 even
//    when the store hands us the *same* Block references across two diffs.
// 2. Build id -> {block, parentId, index} maps for both trees. Subtree hash
//    (Merkle: selfHash + children subtree hashes) is memoized per Block
//    object via a module-level WeakMap -- Block objects from the store are
//    identity-stable, so repeated diffs of mostly-same docs (e.g. adjacent
//    history entries) are fast because most subtrees hit the cache.
// 3. Classify: id in both trees with different parentId => move (reparent).
//    Within a parent, among ids present in both under the same parent,
//    compute the LIS (O(n log n)) over old indices in new order -- ids in
//    the LIS are untouched, the rest => move (reorder). Only-in-new =>
//    insert. Only-in-old (and not present anywhere else in the new tree,
//    i.e. not a move) => delete. Same id + selfHash differs => modify. If
//    subtree hash is equal, the whole subtree is skipped (no descent).
// 4. Modify detail: inline content flattened to text (mentions/generic
//    inlines as U+FFFC) and diffed with fast-diff; props diffed as
//    {key, before, after}[] using getProp (effective, default-aware) values;
//    type changes reported via before/after.
// 5. Output is a DiffTree in NEW document order; deleted nodes are placed
//    among their still-existing old siblings (after the nearest earlier old
//    sibling that still exists under the same parent).
// 6. `diffStats`/`summarize` are convenience wrappers.

import fastDiff from "fast-diff";
import { canonicalStringify, getProp, normalizeInline } from "@jul-editor/core";
import { cyrb53 } from "@jul-editor/core";
import type { Registry } from "@jul-editor/core";
import type { Block, Doc, Inline, Json, TextInline } from "@jul-editor/core";

// Same narrowing issue canonical.ts works around: GenericInline.type is
// `string`, so a plain `inl.type === "text"` check doesn't exclude it (its
// type COULD be "text" as far as the checker knows) -- an explicit guard does.
function isTextInline(inl: Inline): inl is TextInline {
  return inl.type === "text";
}

export interface PropChange {
  key: string;
  before: Json | undefined;
  after: Json | undefined;
}

export type InlineOp = [-1 | 0 | 1, string];

export interface DiffNode {
  status: "same" | "insert" | "delete" | "modify" | "move";
  id: string;
  type: string;
  /** Set only when the block's type changed. */
  before?: string;
  after?: string;
  /** fast-diff ops over the flattened (mentions -> U+FFFC) inline text. */
  inline?: InlineOp[];
  /** Text identical but marks (or a mention/generic inline's attrs) differ. */
  formatChanged?: boolean;
  formatRanges?: [number, number][];
  props?: PropChange[];
  /** Old position, set only when status is 'move'. */
  from?: { parentId: string | null; index: number };
  children: DiffNode[];
  /** Subtree hash matched on both sides -- children were not descended into. */
  collapsed?: boolean;
}

export interface DiffStats {
  inserted: number;
  deleted: number;
  modified: number;
  moved: number;
  unchanged: number;
}

export interface DiffTree {
  root: DiffNode[];
  stats: DiffStats;
}

interface NodeInfo {
  block: Block;
  parentId: string | null;
  index: number;
}

function indexTree(blocks: Block[], parentId: string | null, map: Map<string, NodeInfo>): void {
  blocks.forEach((block, index) => {
    map.set(block.id, { block, parentId, index });
    if (block.children) indexTree(block.children, block.id, map);
  });
}

// Cyrb53 is a 53-bit hash (see model/hash.ts). At document scale
// (thousands of blocks) collisions are practically impossible, but a
// collision here means the diff *silently* treats a changed subtree as
// unchanged (the whole point of the hash-equality skip in step 3/6). If this
// ever needs to be adversary-proof, swap the hash in `effectiveSelfHash`/
// `subtreeHash` for a cryptographic one (e.g. SHA-256 truncated) -- do not
// try to widen cyrb53 itself.

/** Chained-hash walk of a canonical (sorted-key, undefined-omitting) JSON
 * value: same equivalence as `canonicalStringify` + `cyrb53`, but folds each
 * primitive straight into a running hash (via cyrb53's own seed param)
 * instead of first rebuilding a fully sorted copy and serializing it to one
 * big string -- on 5000-block docs this is the difference between the diff
 * fitting its perf budget and not (see decisions.md). Order-sensitive (array
 * order and sorted-key order both matter), which is exactly what hashing a
 * canonical form needs. */
function hashValue(v: unknown, seed: number): number {
  // Every primitive is hashed with a type tag prefix (so e.g. the number
  // 100, the string "100", and a string that happens to read "n:100" never
  // fold to the same running hash), and arrays/objects get an explicit end
  // marker (so e.g. [1,[2]] and [1,2] -- which would otherwise chain the same
  // sequence of cyrb53 calls up to a point -- diverge instead of colliding).
  if (v === undefined) return cyrb53("u:", seed);
  if (v === null) return cyrb53("z:", seed);
  if (typeof v === "string") return cyrb53("s:" + v, seed);
  if (typeof v === "number") return cyrb53("n:" + String(v), seed);
  if (typeof v === "boolean") return cyrb53("b:" + String(v), seed);
  if (Array.isArray(v)) {
    let h = cyrb53("[", seed);
    for (const item of v) h = hashValue(item, h);
    return cyrb53("]", h);
  }
  const obj = v as Record<string, unknown>;
  let h = cyrb53("{", seed);
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val === undefined) continue;
    h = cyrb53(key, h);
    h = hashValue(val, h);
  }
  return cyrb53("}", h);
}

function hashInlineContent(inlines: Inline[], seed: number): number {
  let h = cyrb53("[", seed);
  for (const inl of inlines) {
    if (!isTextInline(inl)) {
      h = hashValue(inl, h);
      continue;
    }
    // normalizeInline emits text keys in this fixed shape; avoid sorting
    // thousands of tiny objects while preserving hashValue's key order.
    h = cyrb53("{", h);
    if (inl.marks !== undefined) {
      h = cyrb53("marks", h);
      h = hashValue(inl.marks, h);
    }
    h = cyrb53("text", h);
    h = hashValue(inl.text, h);
    h = cyrb53("type", h);
    h = hashValue("text", h);
    h = cyrb53("}", h);
  }
  return cyrb53("]", h);
}

/** Effective (default-prop-resolved) props hash, over every prop name either
 * side's schema declares or the block itself sets -- so "explicit default"
 * and "omitted" hash identically. Skips materializing the resolved-props
 * object (unlike `getProp` callers elsewhere) since only the hash is needed
 * here. */
function hashEffectiveProps(block: Block, registry: Registry, seed: number): number {
  const spec = registry.blocks.get(block.type);
  const defaultKeys = spec ? Object.keys(spec.props) : [];
  const ownKeys = Object.keys(block.props ?? {});
  if (!defaultKeys.length && !ownKeys.length) return cyrb53("{", seed);
  const keys = new Set<string>([...defaultKeys, ...ownKeys]);
  let h = cyrb53("{", seed);
  for (const key of [...keys].sort()) {
    const v = getProp(block, key, registry);
    if (v === undefined) continue;
    h = cyrb53(key, h);
    h = hashValue(v, h);
  }
  return h;
}

/** Self-hash (id/children excluded, like `blockSelfHash`) but default-prop-
 * and mark-order-aware, so "explicit default" vs "omitted" and reordered
 * marks never register as a modify. Computed straight off the raw block
 * (no tree copy) so the WeakMap cache below can key on store-identity-stable
 * Block objects -- see the module doc comment, step 1. */
function effectiveSelfHash(block: Block, registry: Registry): number {
  let h = cyrb53(block.type, 0);
  h = hashEffectiveProps(block, registry, h);
  h = block.content ? hashInlineContent(normalizeInline(block.content, registry), h) : hashValue(undefined, h);
  return h;
}

const selfHashCache = new WeakMap<Registry, WeakMap<Block, number>>();
const subtreeHashCache = new WeakMap<Registry, WeakMap<Block, number>>();
const subtreeSizeCache = new WeakMap<Block, number>();

// selfHash is cached separately from subtreeHash (both keyed by the same
// Block, but requested independently -- buildMatchedNode needs the bare
// selfHash to decide modify-vs-same, subtreeHash needs it too to fold
// children in) so it's computed at most once per block per registry.
function cacheFor(cache: WeakMap<Registry, WeakMap<Block, number>>, registry: Registry): WeakMap<Block, number> {
  let blocks = cache.get(registry);
  if (!blocks) cache.set(registry, (blocks = new WeakMap<Block, number>()));
  return blocks;
}

function getSelfHash(block: Block, registry: Registry): number {
  const cache = cacheFor(selfHashCache, registry);
  const cached = cache.get(block);
  if (cached !== undefined) return cached;
  const h = effectiveSelfHash(block, registry);
  cache.set(block, h);
  return h;
}

function subtreeHash(block: Block, registry: Registry): number {
  const cache = cacheFor(subtreeHashCache, registry);
  const cached = cache.get(block);
  if (cached !== undefined) return cached;
  let h = getSelfHash(block, registry);
  for (const c of block.children ?? []) h = cyrb53(String(subtreeHash(c, registry)), h);
  cache.set(block, h);
  return h;
}

function subtreeSize(block: Block): number {
  const cached = subtreeSizeCache.get(block);
  if (cached !== undefined) return cached;
  let size = 1;
  for (const c of block.children ?? []) size += subtreeSize(c);
  subtreeSizeCache.set(block, size);
  return size;
}

/** Longest increasing subsequence of `seq` (values assumed distinct, which
 * holds here since they're sibling indices). Returns the *indices into seq*
 * that belong to one such subsequence -- O(n log n) (a DP LCS
 * over ids would be O(n*m), ~25M cells for 5000 root siblings). */
function computeLIS(seq: number[]): number[] {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const out: number[] = [];
  let idx = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (idx !== -1) {
    out.push(idx);
    idx = prev[idx]!;
  }
  return out;
}

function diffProps(oldBlock: Block, newBlock: Block, registry: Registry): PropChange[] {
  const oldSpec = registry.blocks.get(oldBlock.type);
  const newSpec = registry.blocks.get(newBlock.type);
  const keys = new Set<string>();
  if (oldSpec) for (const k of Object.keys(oldSpec.props)) keys.add(k);
  if (newSpec) for (const k of Object.keys(newSpec.props)) keys.add(k);
  for (const k of Object.keys(oldBlock.props ?? {})) keys.add(k);
  for (const k of Object.keys(newBlock.props ?? {})) keys.add(k);

  const out: PropChange[] = [];
  for (const key of keys) {
    const before = getProp(oldBlock, key, registry);
    const after = getProp(newBlock, key, registry);
    if (canonicalStringify(before) !== canonicalStringify(after)) out.push({ key, before, after });
  }
  return out;
}

/** Flattens inline content to a plain string (mentions/generic inlines as a
 * single U+FFFC each) plus a parallel per-char "signature" array used to spot
 * format-only changes (mark changes, or a same-position mention/generic
 * inline whose attrs changed even though the placeholder char didn't). */
function flattenInline(content: Inline[] | undefined, registry: Registry): { text: string; sig: string[] } {
  const list = normalizeInline(content ?? [], registry);
  let text = "";
  const sig: string[] = [];
  for (const inl of list) {
    if (isTextInline(inl)) {
      const key = canonicalStringify(inl.marks ?? []);
      text += inl.text;
      for (let i = 0; i < inl.text.length; i++) sig.push(key);
    } else {
      text += "￼";
      sig.push(canonicalStringify(inl));
    }
  }
  return { text, sig };
}

interface InlineDiffResult {
  ops: InlineOp[];
  formatChanged?: boolean;
  formatRanges?: [number, number][];
}

function diffInline(
  oldContent: Inline[] | undefined,
  newContent: Inline[] | undefined,
  registry: Registry,
): InlineDiffResult {
  const a = flattenInline(oldContent, registry);
  const b = flattenInline(newContent, registry);
  const ops = fastDiff(a.text, b.text) as InlineOp[];
  const result: InlineDiffResult = { ops };

  if (a.text === b.text && a.sig.length === b.sig.length) {
    const ranges: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= a.text.length; i++) {
      const differs = i < a.text.length && a.sig[i] !== b.sig[i];
      if (differs && start === -1) start = i;
      if (!differs && start !== -1) {
        ranges.push([start, i]);
        start = -1;
      }
    }
    if (ranges.length) {
      result.formatChanged = true;
      result.formatRanges = ranges;
    }
  }
  return result;
}

/** Places new-order children ids into a final list, splicing true-delete ids
 * back in among their still-existing old siblings: a
 * deleted id goes right after the nearest *earlier* old sibling that is
 * still a child of this same parent in the new tree, or at the front if
 * none is. Ids that simply moved to a different parent are neither in
 * `newIds` nor `deleteIds` here -- they're rendered once, under their new
 * parent, elsewhere in the tree. */
function placeChildren(
  oldIds: string[],
  newIds: string[],
  deleteIds: Set<string>,
  nodesById: Map<string, DiffNode>,
  buildDelete: (id: string) => DiffNode | null,
): DiffNode[] {
  const stillHere = new Set(newIds);
  const deletesByAnchor = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const id of oldIds) {
    if (stillHere.has(id)) {
      anchor = id;
    } else if (deleteIds.has(id)) {
      const bucket = deletesByAnchor.get(anchor);
      if (bucket) bucket.push(id);
      else deletesByAnchor.set(anchor, [id]);
    }
  }

  const out: DiffNode[] = [];
  for (const id of deletesByAnchor.get(null) ?? []) {
    const n = buildDelete(id);
    if (n) out.push(n);
  }
  for (const id of newIds) {
    out.push(nodesById.get(id)!);
    for (const dId of deletesByAnchor.get(id) ?? []) {
      const n = buildDelete(dId);
      if (n) out.push(n);
    }
  }
  return out;
}

function runDiff(before: Doc, after: Doc, registry: Registry, detail: boolean): DiffTree {
  const oldMap = new Map<string, NodeInfo>();
  const newMap = new Map<string, NodeInfo>();
  indexTree(before.blocks, null, oldMap);
  indexTree(after.blocks, null, newMap);

  const stats: DiffStats = { inserted: 0, deleted: 0, modified: 0, moved: 0, unchanged: 0 };

  // A newly-inserted parent's own children are walked here directly
  // (never through diffChildrenOf, since diffChildrenOf only recurses into a
  // MATCHED node) -- so without this check, a block that already existed
  // elsewhere in the old tree and simply moved under this new parent would
  // get reported as a second, fresh `insert` instead of the single `move` it
  // actually is.
  function buildInsertNode(id: string): DiffNode {
    const info = newMap.get(id)!;
    if (oldMap.has(id)) {
      const oi = oldMap.get(id)!;
      return buildMatchedNode(id, { parentId: oi.parentId, index: oi.index });
    }
    const block = info.block;
    stats.inserted++;
    return {
      status: "insert",
      id,
      type: block.type,
      children: (block.children ?? []).map((c) => buildInsertNode(c.id)),
    };
  }

  // Symmetric fix for a deleted parent's children -- a child
  // that still exists elsewhere in the new tree is reported once, as a move,
  // by whichever new parent's diffChildrenOf actually owns it; skip it here
  // (return null) instead of ALSO emitting a delete for the same id.
  function buildDeleteNode(id: string): DiffNode | null {
    const block = oldMap.get(id)!.block;
    if (newMap.has(id)) return null;
    stats.deleted++;
    return {
      status: "delete",
      id,
      type: block.type,
      children: (block.children ?? []).map((c) => buildDeleteNode(c.id)).filter((n): n is DiffNode => n !== null),
    };
  }

  function buildMatchedNode(id: string, moveFrom?: { parentId: string | null; index: number }): DiffNode {
    const oldBlock = oldMap.get(id)!.block;
    const newBlock = newMap.get(id)!.block;
    // Cold clones usually have identical leaves; native JSON skips
    // normalization and hashing, while unequal serializations take the canonical path.
    const leaf = !oldBlock.children?.length && !newBlock.children?.length;
    const sameLeaf = leaf && (oldBlock === newBlock || JSON.stringify(oldBlock) === JSON.stringify(newBlock));
    const contentChanged = !sameLeaf && getSelfHash(oldBlock, registry) !== getSelfHash(newBlock, registry);
    const status: DiffNode["status"] = moveFrom ? "move" : contentChanged ? "modify" : "same";
    stats[status === "move" ? "moved" : status === "modify" ? "modified" : "unchanged"]++;

    const node: DiffNode = { status, id, type: newBlock.type, children: [] };
    if (moveFrom) node.from = moveFrom;
    if (oldBlock.type !== newBlock.type) {
      node.before = oldBlock.type;
      node.after = newBlock.type;
    }

    if (detail && contentChanged) {
      const props = diffProps(oldBlock, newBlock, registry);
      if (props.length) node.props = props;
      if (oldBlock.content !== undefined || newBlock.content !== undefined) {
        const inlineDiff = diffInline(oldBlock.content, newBlock.content, registry);
        node.inline = inlineDiff.ops;
        if (inlineDiff.formatChanged) {
          node.formatChanged = true;
          if (inlineDiff.formatRanges) node.formatRanges = inlineDiff.formatRanges;
        }
      }
    }

    // A leaf's subtree hash is its self hash; skip two hash-cache walks.
    if (leaf) {
      if (!contentChanged) node.collapsed = true;
    } else if (subtreeHash(oldBlock, registry) === subtreeHash(newBlock, registry)) {
      node.collapsed = true;
      const size = subtreeSize(newBlock);
      if (size > 1) stats.unchanged += size - 1;
    } else {
      node.children = diffChildrenOf(id);
    }
    return node;
  }

  function diffChildrenOf(containerId: string | null): DiffNode[] {
    const oldKids = containerId === null ? before.blocks : (oldMap.get(containerId)?.block.children ?? []);
    const newKids = containerId === null ? after.blocks : (newMap.get(containerId)?.block.children ?? []);
    const oldIds = oldKids.map((b) => b.id);
    const newIds = newKids.map((b) => b.id);

    // LIS candidates: ids that stayed under this exact parent on both sides.
    const candidatePositions: number[] = [];
    const candidateOldIndex: number[] = [];
    newIds.forEach((id, i) => {
      const oi = oldMap.get(id);
      if (oi && oi.parentId === containerId) {
        candidatePositions.push(i);
        candidateOldIndex.push(oi.index);
      }
    });
    const kept = new Set<number>();
    for (const pos of computeLIS(candidateOldIndex)) kept.add(candidatePositions[pos]!);

    const nodesById = new Map<string, DiffNode>();
    newIds.forEach((id, i) => {
      if (!oldMap.has(id)) {
        nodesById.set(id, buildInsertNode(id));
        return;
      }
      const oi = oldMap.get(id)!;
      const reparented = oi.parentId !== containerId;
      const reordered = !reparented && !kept.has(i);
      const moveFrom = reparented || reordered ? { parentId: oi.parentId, index: oi.index } : undefined;
      nodesById.set(id, buildMatchedNode(id, moveFrom));
    });

    const deleteIds = new Set(oldIds.filter((id) => !newMap.has(id)));
    return placeChildren(oldIds, newIds, deleteIds, nodesById, buildDeleteNode);
  }

  const root = diffChildrenOf(null);
  return { root, stats };
}

/** Diffs two documents into a DiffTree in NEW document order. Both docs
 * should already be store-normalized; see the module doc comment for why
 * this doesn't call `normalizeDoc` itself (it would break the WeakMap
 * identity cache that makes repeated diffs of mostly-shared docs fast).
 * Treat docs and a registry as immutable after use; create a new registry
 * object when changing schema defaults. */
export function diffDocs(before: Doc, after: Doc, registry: Registry): DiffTree {
  return runDiff(before, after, registry, true);
}

/** Same classification as `diffDocs` but skips building per-node prop/inline
 * detail -- useful when only the summary counts are needed (e.g. an edition
 * list row). */
export function diffStats(before: Doc, after: Doc, registry: Registry): DiffStats {
  return runDiff(before, after, registry, false).stats;
}

export function summarize(tree: DiffTree): string {
  const { inserted, deleted, modified, moved, unchanged } = tree.stats;
  return `${inserted} inserted, ${deleted} deleted, ${modified} modified, ${moved} moved, ${unchanged} unchanged`;
}
