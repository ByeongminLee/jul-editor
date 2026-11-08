// Seeded random mutator for diff fixture tests + bench (bench/suites/diff.mjs).
// Not part of the public diff API -- deliberately kept out of index.ts.

import { isText } from "@jul-editor/core";
import { newId } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";

// mulberry32 (public domain), same PRNG as bench/gen.mjs -- small
// enough to duplicate rather than refactor gen.mjs (a script, not a module)
// just to share 8 lines.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Loc {
  parentArr: Block[];
  block: Block;
}

function flattenLocs(blocks: Block[], out: Loc[] = []): Loc[] {
  for (const block of blocks) {
    out.push({ parentArr: blocks, block });
    if (block.children) flattenLocs(block.children, out);
  }
  return out;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function collectSubtreeIds(block: Block, set: Set<string>): void {
  set.add(block.id);
  for (const c of block.children ?? []) collectSubtreeIds(c, set);
}

const CONTAINER_TYPES = new Set(["bulletListItem", "orderedListItem", "todoListItem", "quote"]);

export interface MutateExpected {
  inserted: number;
  deleted: number;
  modified: number;
  moved: number;
}

export interface MutateResult {
  doc: Doc;
  expected: MutateExpected;
}

/** Deep-clones `doc` and applies a seeded, disjoint mutation: `moveCount`
 * blocks reparented (always to a *different* container id, so the
 * "move is unconditional on parentId change" path is exercised -- no LIS
 * edge case can reabsorb it back into 'same'), `deleteCount` leaf blocks
 * removed, `insertCount` brand-new paragraph blocks added, and enough text
 * edits to bring the total mutated-existing-block fraction to `fraction`
 * (default 1%). Returns the exact expected stats so the caller never has to
 * hardcode counts that depend on fixture size. */
export function mutateFixture(
  doc: Doc,
  seed: number,
  opts: { moveCount?: number; deleteCount?: number; insertCount?: number; fraction?: number } = {},
): MutateResult {
  const moveCount = opts.moveCount ?? 5;
  const deleteCount = opts.deleteCount ?? 5;
  const insertCount = opts.insertCount ?? 5;
  const fraction = opts.fraction ?? 0.01;

  const rng = mulberry32(seed);
  const mutated: Doc = structuredClone(doc);
  const locs = shuffle(flattenLocs(mutated.blocks), rng);
  const total = locs.length;

  const used = new Set<Block>();

  // 1. Deletes: leaf blocks (no children), removed outright.
  const deleteIds: string[] = [];
  for (const loc of locs) {
    if (deleteIds.length >= deleteCount) break;
    if (used.has(loc.block)) continue;
    if (loc.block.children && loc.block.children.length > 0) continue;
    used.add(loc.block);
    const idx = loc.parentArr.indexOf(loc.block);
    loc.parentArr.splice(idx, 1);
    deleteIds.push(loc.block.id);
  }

  // 2. Moves: reparent to a different existing "listy" container (or root).
  const containers: { id: string | null; arr: Block[] }[] = [{ id: null, arr: mutated.blocks }];
  for (const loc of flattenLocs(mutated.blocks)) {
    if (CONTAINER_TYPES.has(loc.block.type)) {
      if (!loc.block.children) loc.block.children = [];
      containers.push({ id: loc.block.id, arr: loc.block.children });
    }
  }

  let moved = 0;
  for (const loc of locs) {
    if (moved >= moveCount) break;
    if (used.has(loc.block)) continue;
    const subtree = new Set<string>();
    collectSubtreeIds(loc.block, subtree);
    const currentParentArr = loc.parentArr;
    const candidates = containers.filter((c) => c.arr !== currentParentArr && !subtree.has(c.id ?? ""));
    if (candidates.length === 0) continue;
    const target = candidates[Math.floor(rng() * candidates.length)]!;
    used.add(loc.block);
    const idx = loc.parentArr.indexOf(loc.block);
    loc.parentArr.splice(idx, 1);
    target.arr.push(loc.block);
    moved++;
  }

  // 3. Text-edit modifies: remaining budget = round(total * fraction) - structural changes.
  const modifyBudget = Math.max(0, Math.round(total * fraction) - deleteCount - moveCount);
  let modified = 0;
  for (const loc of locs) {
    if (modified >= modifyBudget) break;
    if (used.has(loc.block)) continue;
    const textInline = loc.block.content?.find(isText);
    if (!textInline) continue;
    used.add(loc.block);
    textInline.text = `${textInline.text} EDITED`;
    modified++;
  }

  // 4. Inserts: brand-new paragraph blocks into random (post-mutation) containers.
  const insertTargets = [mutated.blocks, ...containers.slice(1).map((c) => c.arr)];
  for (let i = 0; i < insertCount; i++) {
    const arr = insertTargets[Math.floor(rng() * insertTargets.length)]!;
    const at = Math.floor(rng() * (arr.length + 1));
    arr.splice(at, 0, { id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text: "inserted" }] });
  }

  return {
    doc: mutated,
    expected: { inserted: insertCount, deleted: deleteIds.length, modified, moved },
  };
}
