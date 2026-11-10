// Higher-level edit helpers, each expressed as a sequence of the 6 primitive
// Ops (ops.ts) computed against the CURRENT store snapshot. A transaction
// applies the returned ops one at a time (transaction.ts), so op N+1 only
// ever needs to reference blocks by id -- never by a position that an earlier
// op in the same sequence might have shifted.

import { isText, normalizeInline } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline, Json, Mark, MentionInline } from "../model/types.js";
import {
  ancestorChain,
  canAdmit,
  orderPoints,
  containerInfo,
  contentLength,
  nearestIsolatingAncestor,
  nextBlockInPreOrder,
  prevBlockInPreOrder,
  siblingsOf,
  sliceContent,
} from "./store.js";
import { tableGrid } from "./table.js";
import type { Op, Point, Selection, Store } from "./types.js";

function replaceContentOp(id: string, from: number, to: number, inlines: Inline[]): Op {
  return { type: "replaceContent", id, from, to, inlines };
}
function removeBlockOp(id: string): Op {
  return { type: "removeBlock", id };
}
function moveBlockOp(id: string, newParentId: string | null, index: number): Op {
  return { type: "moveBlock", id, newParentId, index };
}

// ---- insertText -------------------------------------------------------------

export function buildInsertTextOps(point: Point, text: string, marks?: Mark[]): Op[] {
  if (text.length === 0) return [];
  const inline: Inline = marks && marks.length ? { type: "text", text, marks } : { type: "text", text };
  return [replaceContentOp(point.blockId, point.offset, point.offset, [inline])];
}

// ---- deleteRange -----

// Deletes from the very START of `id`'s subtree THROUGH to (path, offset)
// inside it. `path` is the chain from a child of `id` down to the leaf target
// (empty when `id` itself IS the leaf). Siblings before the branch at every
// level are removed; `id`'s own content (which precedes all of its children)
// is removed too, since the target is one of its descendants.
function emitDeleteFromStart(store: Store, id: string, path: string[], offset: number, ops: Op[]): void {
  const rec = store.records.get(id);
  if (!rec) return;
  if (path.length === 0) {
    if (offset > 0) ops.push(replaceContentOp(id, 0, offset, []));
    return;
  }
  const idx = rec.childIds.indexOf(path[0]!);
  for (let i = 0; i < idx; i++) ops.push(removeBlockOp(rec.childIds[i]!));
  if ((rec.content ?? []).length > 0) ops.push(replaceContentOp(id, 0, contentLength(rec.content), []));
  emitDeleteFromStart(store, path[0]!, path.slice(1), offset, ops);
}

// Symmetric: deletes FROM (path, offset) inside `id`'s subtree THROUGH to the
// end of it. Siblings after the branch at every level are removed; `id`'s own
// content is left untouched (it precedes the target, so it's kept as-is).
function emitDeleteToEnd(store: Store, id: string, path: string[], offset: number, ops: Op[]): void {
  const rec = store.records.get(id);
  if (!rec) return;
  if (path.length === 0) {
    const len = contentLength(rec.content);
    if (offset < len) ops.push(replaceContentOp(id, offset, len, []));
    for (const childId of rec.childIds) ops.push(removeBlockOp(childId));
    return;
  }
  const idx = rec.childIds.indexOf(path[0]!);
  emitDeleteToEnd(store, path[0]!, path.slice(1), offset, ops);
  for (let i = idx + 1; i < rec.childIds.length; i++) ops.push(removeBlockOp(rec.childIds[i]!));
}

// grid-aware (tableGrid), not raw childIds indices -- the selection's
// (row, col) rectangle is in GRID coordinates, so clearing must resolve
// through the same grid a merged cell's covered positions are marked with
// (cellsSelectionIds/the table keymap), or it clears the wrong neighbor.
function buildCellsClearOps(store: Store, registry: Registry, selection: Extract<Selection, { type: "cells" }>): Op[] {
  const ops: Op[] = [];
  for (const id of cellSelectionIds(store, registry, selection)) {
    const cell = store.records.get(id);
    if (cell && (cell.content ?? []).length > 0) ops.push(replaceContentOp(cell.id, 0, contentLength(cell.content), []));
  }
  return ops;
}

/** Deletes a selection. `text` selections spanning more than one block merge
 * the anchor block's head with the focus block's tail (its own children are
 * discarded as "intermediate", the focus block's children are appended) --
 * unless the range crosses an `isolating` boundary (e.g. two different table
 * cells), in which case only each endpoint's own content is cleared and
 * nothing is merged or removed. */
export function buildDeleteRangeOps(store: Store, selection: Selection, registry: Registry): Op[] {
  if (selection.type === "block") return selection.ids.map(removeBlockOp);
  if (selection.type === "cells") return buildCellsClearOps(store, registry, selection);

  const [start, end] = orderPoints(store, selection.anchor, selection.focus);

  if (start.blockId === end.blockId) {
    const from = Math.min(start.offset, end.offset);
    const to = Math.max(start.offset, end.offset);
    return from === to ? [] : [replaceContentOp(start.blockId, from, to, [])];
  }

  const isoStart = nearestIsolatingAncestor(store, start.blockId, registry);
  const isoEnd = nearestIsolatingAncestor(store, end.blockId, registry);
  if (isoStart !== isoEnd) {
    const ops: Op[] = [];
    const startLen = contentLength(store.records.get(start.blockId)?.content);
    if (start.offset < startLen) ops.push(replaceContentOp(start.blockId, start.offset, startLen, []));
    if (end.offset > 0) ops.push(replaceContentOp(end.blockId, 0, end.offset, []));
    return ops;
  }

  const startChain = ancestorChain(store, start.blockId);
  const endChain = ancestorChain(store, end.blockId);
  let k = 0;
  while (k < startChain.length && k < endChain.length && startChain[k] === endChain[k]) k++;

  const ops: Op[] = [];

  if (k === startChain.length) {
    // start.blockId is itself an ancestor of end.blockId: its own content
    // precedes ALL of its descendants in pre-order, so it survives head-
    // truncated; children before the branch leading to end.blockId are
    // "intermediate" and dropped; children after are untouched.
    const startRec = store.records.get(start.blockId)!;
    const startLen = contentLength(startRec.content);
    if (start.offset < startLen) ops.push(replaceContentOp(start.blockId, start.offset, startLen, []));
    const restPath = endChain.slice(k);
    const branchIdx = startRec.childIds.indexOf(restPath[0]!);
    for (let i = 0; i < branchIdx; i++) ops.push(removeBlockOp(startRec.childIds[i]!));
    emitDeleteFromStart(store, restPath[0]!, restPath.slice(1), end.offset, ops);
    return ops;
  }

  // General case: start and end diverge at distinct siblings (aChild/bChild)
  // under a common parent (possibly root).
  const aChild = startChain[k]!;
  const bChild = endChain[k]!;
  const { siblings } = siblingsOf(store, aChild);
  const aIdx = siblings.indexOf(aChild);
  const bIdx = siblings.indexOf(bChild);

  emitDeleteToEnd(store, aChild, startChain.slice(k + 1), start.offset, ops); // trims start.blockId's own subtree down to its head, always ending with start.blockId content-truncated + childless
  for (const midId of siblings.slice(aIdx + 1, bIdx)) ops.push(removeBlockOp(midId)); // fully-intermediate top-level siblings

  const endRestPath = endChain.slice(k + 1);
  const bRec = store.records.get(bChild)!;
  let tailContent: Inline[];
  let tailChildIds: string[];
  if (endRestPath.length === 0) {
    tailContent = sliceContent(bRec.content ?? [], end.offset, contentLength(bRec.content));
    tailChildIds = bRec.childIds;
  } else {
    tailContent = [];
    const branchIdx = bRec.childIds.indexOf(endRestPath[0]!);
    tailChildIds = bRec.childIds.slice(branchIdx);
    emitDeleteFromStart(store, endRestPath[0]!, endRestPath.slice(1), end.offset, ops);
  }

  // Merge point is always start.blockId itself: emitDeleteToEnd guarantees it
  // ends up content-truncated to [0, start.offset) with zero children,
  // regardless of how deep aChild's kept branch runs to reach it.
  if (tailContent.length > 0) ops.push(replaceContentOp(start.blockId, start.offset, start.offset, tailContent));
  // the merge target (start.blockId) may not admit `tailChildIds` as its
  // own children at all -- merging a list item WITH children into a
  // preceding codeBlock/divider/any other children:'none' (or type-
  // restricted) block must not silently nest them there (invisible in the
  // DOM, dropped from every export). Re-home each refused child as a
  // FOLLOWING SIBLING of the merge target instead (same "lift" rule
  // normalizeDoc's own root-orphan repair uses).
  const targetRec = store.records.get(start.blockId)!;
  const targetSpec = registry.blocks.get(targetRec.type);
  const { parentId: targetParentId, index: targetIndex } = siblingsOf(store, start.blockId);
  let childIdx = 0; // emitDeleteToEnd already cleared start.blockId's own children
  let sibIdx = targetIndex + 1;
  for (const childId of tailChildIds) {
    const childType = store.records.get(childId)?.type ?? "";
    if (canAdmit(registry, childType, targetRec.type, targetSpec?.children ?? "none")) ops.push(moveBlockOp(childId, start.blockId, childIdx++));
    else ops.push(moveBlockOp(childId, targetParentId, sibIdx++));
  }
  ops.push(removeBlockOp(bChild));
  return ops;
}

// ---- splitBlock -------------------------

/** Props the freshly created half of a split starts with: the source
 * block's own props minus per-item STATE that must never be duplicated onto
 * a new item -- a checked to-do splits into a checked one and a fresh,
 * UNchecked one (Notion/Docs/GitHub task lists alike). */
function splitProps(props: Block["props"]): Block["props"] {
  if (!props || !("checked" in props)) return props;
  const { checked: _checked, ...rest } = props;
  return rest;
}

/** offset 0: inserts a new empty block BEFORE, original keeps its id and
 * children. Otherwise: front keeps the original id, back gets a new id and
 * takes the original's children. The new block never inherits per-item
 * state (`checked`, see splitProps). `opts.type` gives the BACK block (the
 * one created after the caret, offset > 0 only) a different type with
 * default props -- e.g. Enter at the end of a heading starts a paragraph. */
export function buildSplitBlockOps(store: Store, point: Point, opts: { type?: string } = {}): Op[] {
  const rec = store.records.get(point.blockId);
  if (!rec) return [];
  const { parentId, index } = siblingsOf(store, point.blockId);

  if (point.offset === 0) {
    const newBlock: Block = { id: newId(), type: rec.type, props: splitProps(rec.props), content: [] };
    return [{ type: "insertBlock", parentId, index, block: newBlock }];
  }

  const len = contentLength(rec.content);
  const backId = newId();
  const backType = opts.type ?? rec.type;
  const backProps = backType === rec.type ? splitProps(rec.props) : {};
  const ops: Op[] = [{ type: "insertBlock", parentId, index: index + 1, block: { id: backId, type: backType, props: backProps, content: [] } }];
  let i = 0;
  if (rec.type !== "toggle" || rec.props.open === true) {
    for (const childId of rec.childIds) ops.push(moveBlockOp(childId, backId, i++));
  }
  if (point.offset < len) ops.push(replaceContentOp(backId, 0, 0, sliceContent(rec.content ?? [], point.offset, len)));
  ops.push(replaceContentOp(point.blockId, point.offset, len, []));
  return ops;
}

// ---- mergeBackward (front id survives, focus's children appended) ----------

export function buildMergeBackwardOps(store: Store, blockId: string, registry: Registry): Op[] {
  const prevId = prevBlockInPreOrder(store, blockId);
  if (!prevId) return [];
  // When `blockId` is its own parent's FIRST child, prevBlockInPreOrder
  // returns that parent (siblingsOf's index<=0 branch) -- "merge backward"
  // then means "merge UP into the parent", not "delete a range spanning
  // parent-content..child-start". buildDeleteRangeOps's ancestor-is-start
  // branch (start===prevId, end===blockId, offset range width 0) would trim
  // nothing and leave `blockId` a separate (merely content-untouched) block,
  // since that branch's job is "truncate + keep the descendant", not "merge
  // the descendant's content into the ancestor and remove it". Build the
  // actual merge directly for this case instead.
  const { parentId } = siblingsOf(store, blockId);
  // Only a parent with an actual inline content slot is a valid merge target
  // (a nested list item merging up into its own parent list item, matching
  // Notion) -- a tableCell whose prevBlockInPreOrder resolves to its own
  // parent tableRow ("first cell of a row") must NOT take this branch:
  // tableRow has content:'none', so merging "into" it would silently store
  // content on a block that can never render it, then remove the cell
  // entirely (data loss). Falls through to the general buildDeleteRangeOps
  // call below instead, which already refuses to cross an isolating boundary
  // (tableRow is isolating too) and correctly no-ops.
  if (parentId === prevId && registry.blocks.get(store.records.get(prevId)?.type ?? "")?.content === "inline") {
    const rec = store.records.get(blockId);
    const prevRec = store.records.get(prevId);
    if (!rec || !prevRec) return [];
    const ops: Op[] = [];
    const prevLen = contentLength(prevRec.content);
    const content = rec.content ?? [];
    if (content.length > 0) ops.push(replaceContentOp(prevId, prevLen, prevLen, content));
    // `prevId` (content:'inline') might still have children:'none' (e.g.
    // a tableCell) -- never nest `rec`'s own children there; lift a refused
    // one to a following sibling of `prevId` instead.
    const prevSpec = registry.blocks.get(prevRec.type);
    const { parentId: prevParentId, index: prevIndex } = siblingsOf(store, prevId);
    let childIdx = prevRec.childIds.length;
    let sibIdx = prevIndex + 1;
    for (const childId of rec.childIds) {
      const childType = store.records.get(childId)?.type ?? "";
      if (canAdmit(registry, childType, prevRec.type, prevSpec?.children ?? "none")) ops.push(moveBlockOp(childId, prevId, childIdx++));
      else ops.push(moveBlockOp(childId, prevParentId, sibIdx++));
    }
    ops.push(removeBlockOp(blockId));
    return ops;
  }
  const prevLen = contentLength(store.records.get(prevId)?.content);
  return buildDeleteRangeOps(store, { type: "text", anchor: { blockId: prevId, offset: prevLen }, focus: { blockId, offset: 0 } }, registry);
}

// ---- indent / outdent (Notion behavior) -------------------------------------

export function buildIndentOps(store: Store, id: string, registry: Registry): Op[] {
  const rec = store.records.get(id);
  if (!rec) return [];
  if (registry.blocks.get(rec.type)?.indentable === false) return [];
  const { siblings, index } = siblingsOf(store, id);
  if (index <= 0) return [];
  const prevId = siblings[index - 1]!;
  const prevRec = store.records.get(prevId)!;
  const container = containerInfo(store, prevId, registry);
  if (!canAdmit(registry, rec.type, container.type, container.children)) return [];
  return [moveBlockOp(id, prevId, prevRec.childIds.length)];
}

export function buildOutdentOps(store: Store, id: string, registry: Registry): Op[] {
  const rec = store.records.get(id);
  if (!rec) return [];
  if (registry.blocks.get(rec.type)?.indentable === false) return [];
  const { parentId, siblings, index } = siblingsOf(store, id);
  if (parentId === null) return [];
  const { parentId: grandParentId, index: parentIndex } = siblingsOf(store, parentId);
  const container = containerInfo(store, grandParentId, registry);
  if (!canAdmit(registry, rec.type, container.type, container.children)) return [];
  const ops: Op[] = [moveBlockOp(id, grandParentId, parentIndex + 1)];
  // `id`'s own following siblings are normally adopted as ITS children
  // (Notion outdent) -- but `id` may not admit them at all (e.g. outdenting a
  // nested codeBlock/divider, children:'none') -- refused ones land as
  // following siblings of `id` at its NEW (post-outdent) position instead,
  // never silently nested where they'd vanish from every render/export.
  const idSpec = registry.blocks.get(rec.type);
  let childIdx = rec.childIds.length;
  let sibIdx = parentIndex + 2; // right after id's own new position
  let promote = false;
  for (const sibId of siblings.slice(index + 1)) {
    const sibType = store.records.get(sibId)?.type ?? "";
    if (!promote && canAdmit(registry, sibType, rec.type, idSpec?.children ?? "none")) ops.push(moveBlockOp(sibId, id, childIdx++));
    else {
      promote = true;
      if (!canAdmit(registry, sibType, container.type, container.children)) return [];
      ops.push(moveBlockOp(sibId, grandParentId, sibIdx++));
    }
  }
  return ops;
}

// ---- toggleMark --------------------------------------------------------------

/** The cell ids a `cells` selection rectangle covers (each merged cell once), in grid order. */
export function cellSelectionIds(store: Store, registry: Registry, selection: Extract<Selection, { type: "cells" }>): string[] {
  const grid = tableGrid(store, registry, selection.tableId);
  const minR = Math.min(selection.anchor[0], selection.focus[0]);
  const maxR = Math.max(selection.anchor[0], selection.focus[0]);
  const minC = Math.min(selection.anchor[1], selection.focus[1]);
  const maxC = Math.max(selection.anchor[1], selection.focus[1]);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let r = minR; r <= maxR && r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = minC; c <= maxC && c < row.length; c++) {
      const g = row[c];
      if (!g || seen.has(g.cellId)) continue;
      seen.add(g.cellId);
      ids.push(g.cellId);
    }
  }
  return ids;
}

/** The per-block content ranges a selection formats: a text range block by block, or every selected
 * cell's whole content for a `cells` rectangle. With a registry, blocks whose content is not rich
 * inline text (a codeBlock's `content: "code"`) are left out: they hold no marks. */
export function markRanges(store: Store, selection: Selection, registry?: Registry): { blockId: string; from: number; to: number }[] {
  let ranges: { blockId: string; from: number; to: number }[];
  if (selection.type === "cells") {
    if (!registry) return [];
    ranges = cellSelectionIds(store, registry, selection).map((blockId) => ({ blockId, from: 0, to: contentLength(store.records.get(blockId)?.content) }));
  } else if (selection.type === "text") {
    const [start, end] = orderPoints(store, selection.anchor, selection.focus);
    const blockIds: string[] = [start.blockId];
    let cur: string | null = start.blockId;
    while (cur !== end.blockId) {
      cur = nextBlockInPreOrder(store, cur);
      if (cur === null) break;
      blockIds.push(cur);
    }
    ranges = blockIds.map((blockId) => {
      const len = contentLength(store.records.get(blockId)?.content);
      return { blockId, from: blockId === start.blockId ? start.offset : 0, to: blockId === end.blockId ? end.offset : len };
    });
  } else return [];
  if (!registry) return ranges;
  return ranges.filter(({ blockId }) => {
    const type = store.records.get(blockId)?.type;
    return type !== undefined && registry.blocks.get(type)?.content === "inline";
  });
}

export function buildToggleMarkOps(store: Store, selection: Selection, markType: string, attrs: Record<string, Json> | undefined, registry?: Registry): Op[] {
  const ranges = markRanges(store, selection, registry);
  if (ranges.length === 0) return [];

  const isMarked = (inl: Inline): boolean => isText(inl) && (inl.marks ?? []).some((m) => m.type === markType);
  const allMarked = ranges.every(({ blockId, from, to }) => {
    const slice = sliceContent(store.records.get(blockId)?.content ?? [], from, to);
    return slice.every((inl) => !isText(inl) || isMarked(inl));
  });

  const ops: Op[] = [];
  for (const { blockId, from, to } of ranges) {
    if (from === to) continue;
    const slice = sliceContent(store.records.get(blockId)?.content ?? [], from, to);
    const toggled = slice.map((inl): Inline => {
      if (!isText(inl)) return inl; // mentions/generics pass through unaffected
      const marks = inl.marks ?? [];
      let nextMarks: Mark[];
      if (allMarked) nextMarks = marks.filter((m) => m.type !== markType);
      else nextMarks = marks.some((m) => m.type === markType) ? marks : [...marks, attrs ? { type: markType, attrs } : { type: markType }];
      return nextMarks.length ? { type: "text", text: inl.text, marks: nextMarks } : { type: "text", text: inl.text };
    });
    ops.push(replaceContentOp(blockId, from, to, toggled));
  }
  return ops;
}

// ---- setBlockType -------------------------------------------------------------

/** The blocks of `ids` a block-type change applies to: text blocks only (retyping a void would drop
 * its data), minus anything hidden inside a closed toggle. */
export function blockTypeTargets(store: Store, registry: Registry, ids: string[]): string[] {
  return ids.filter((id) => {
    const rec = store.records.get(id);
    const content = rec && registry.blocks.get(rec.type)?.content;
    if (!rec || (content !== "inline" && content !== "code")) return false;
    for (let parent = rec.parentId; parent; parent = store.records.get(parent)?.parentId ?? null) {
      const ancestor = store.records.get(parent);
      if (ancestor?.type === "toggle" && ancestor.props.open !== true) return false;
    }
    return true;
  });
}

export function buildSetBlockTypeOps(ids: string[], blockType: string, props?: Record<string, Json>): Op[] {
  return ids.map((id) => ({ type: "setType", id, blockType, props }));
}

// ---- paste/drop fragment insertion -------------------------------
// Inserts a fragment (an array of top-level Blocks already decoded by
// clipboard/fromHTML/fromMarkdown, with their own fresh ids) at a COLLAPSED
// point. Called by transaction.ts's `pasteFragment` against whatever `store`
// its own closure currently holds (i.e. already post-delete when the caller
// replaced a non-collapsed selection first) -- this function itself never
// deletes anything, only inserts. Returns the ops plus the resulting caret,
// since only this function knows the synthesized tail block's id.

function inlineTextOf(inl: Inline): string {
  if (isText(inl)) return inl.text;
  if (inl.type === "mention") return (inl as MentionInline).attrs.label ?? "";
  return "";
}

/** Plain-text flatten of a fragment's own content AND nested children,
 * recursively, blocks/levels joined by '\n' -- used only for a codeBlock
 * paste target (content:'code' has no marks/mentions of its own). */
function flattenFragmentToText(fragment: Block[]): string {
  function walk(b: Block): string {
    const own = (b.content ?? []).map(inlineTextOf).join("");
    const kids = (b.children ?? []).map(walk).filter(Boolean).join("\n");
    return kids ? (own ? `${own}\n${kids}` : kids) : own;
  }
  return fragment.map(walk).filter(Boolean).join("\n");
}

/** Inline-preserving flatten (marks/mentions kept) for a tableCell (or any
 * other isolating content:'inline' block) paste target, which has no notion
 * of nested blocks of its own -- every block/level in the fragment becomes
 * one run of inline content, separated by a single space. */
function flattenFragmentToInline(fragment: Block[]): Inline[] {
  const out: Inline[] = [];
  function walk(b: Block): void {
    const content = b.content ?? [];
    if (content.length > 0) {
      if (out.length > 0) out.push({ type: "text", text: " " });
      out.push(...content);
    }
    for (const child of b.children ?? []) walk(child);
  }
  for (const b of fragment) walk(b);
  return out;
}

export interface PasteFragmentResult {
  ops: Op[];
  caret: Point;
}

export function buildInsertFragmentOps(store: Store, registry: Registry, point: Point, fragment: Block[]): PasteFragmentResult {
  if (fragment.length === 0) return { ops: [], caret: point };
  const rec = store.records.get(point.blockId);
  if (!rec) return { ops: [], caret: point };
  const spec = registry.blocks.get(rec.type);
  const len = contentLength(rec.content);

  // codeBlock (or any content:'code' target): plain text only, no marks, no
  // nested blocks -- the fragment's own structure is irrelevant here.
  if (spec?.content === "code") {
    const text = flattenFragmentToText(fragment);
    if (!text) return { ops: [], caret: point };
    return {
      ops: [replaceContentOp(point.blockId, point.offset, point.offset, [{ type: "text", text }])],
      caret: { blockId: point.blockId, offset: point.offset + text.length },
    };
  }

  // A tableCell (or any other isolating content:'inline' block, e.g. cells hold
  // inline content only): flatten every block/level down to one inline run.
  if (nearestIsolatingAncestor(store, point.blockId, registry) === point.blockId) {
    const inline = flattenFragmentToInline(fragment);
    if (inline.length === 0) return { ops: [], caret: point };
    return {
      ops: [replaceContentOp(point.blockId, point.offset, point.offset, inline)],
      caret: { blockId: point.blockId, offset: point.offset + inline.reduce((n, i) => n + (isText(i) ? i.text.length : 1), 0) },
    };
  }

  const { parentId, index } = siblingsOf(store, point.blockId);
  const originalTailContent = sliceContent(rec.content ?? [], point.offset, len);
  const originalChildIds = rec.childIds;
  const allowsChildren = spec?.children !== "none";

  if (fragment.length === 1) {
    const only = fragment[0]!;
    const onlySpec = registry.blocks.get(only.type);
    if (onlySpec && onlySpec.content === "none") {
      // A single content-less (void) fragment block has nothing to merge
      // inline on either side -- split point.blockId at the caret (exactly
      // like Enter) and insert the void block in the gap.
      const ops: Op[] = [];
      if (point.offset < len) ops.push(replaceContentOp(point.blockId, point.offset, len, []));
      ops.push({ type: "insertBlock", parentId, index: index + 1, block: only });
      const backId = newId();
      ops.push({ type: "insertBlock", parentId, index: index + 2, block: { id: backId, type: rec.type, props: splitProps(rec.props), content: [] } });
      if (originalTailContent.length > 0) ops.push(replaceContentOp(backId, 0, 0, originalTailContent));
      let i = 0;
      for (const childId of originalChildIds) ops.push({ type: "moveBlock", id: childId, newParentId: backId, index: i++ });
      return { ops, caret: { blockId: backId, offset: 0 } };
    }
    // Single text-content fragment block: its inline content merges directly
    // into the current block at the caret (marks preserved); its own nested
    // children (if any) become new leading children of the current block.
    const ops: Op[] = [];
    const content = only.content ?? [];
    if (content.length > 0) ops.push(replaceContentOp(point.blockId, point.offset, point.offset, content));
    if (allowsChildren && (only.children ?? []).length > 0) {
      let i = 0;
      for (const child of only.children!) ops.push({ type: "insertBlock", parentId: point.blockId, index: i++, block: child });
    }
    const inserted = content.reduce((n, i) => n + (isText(i) ? i.text.length : 1), 0);
    return { ops, caret: { blockId: point.blockId, offset: point.offset + inserted } };
  }

  // Multi-block fragment: split point.blockId at the caret (Enter-like). The
  // first fragment block's inline content merges into the HEAD (point.blockId
  // itself, unchanged id) -- but only when it actually HAS an inline content
  // slot (content !== undefined); a content-less (void, e.g. an image) first
  // block can't merge anything, so it's inserted as its own sibling instead
  // (falls into `middle` below) rather than silently dropped. Symmetrically,
  // the last fragment block's inline content merges into a fresh TAIL block
  // (reusing the last fragment block's own id/type, extended with
  // point.blockId's original tail content/children) only when IT has content;
  // otherwise the original tail becomes its own fresh block (a plain split,
  // like Enter) and the void last block is inserted as a sibling too. Every
  // block strictly between the merged head/tail is inserted as its own
  // sibling either way (Notion/ProseMirror convention).
  const first = fragment[0]!;
  const last = fragment[fragment.length - 1]!;
  const firstMerges = first.content !== undefined;
  const lastMerges = last.content !== undefined;
  const middle = fragment.slice(firstMerges ? 1 : 0, fragment.length - (lastMerges ? 1 : 0));

  const ops: Op[] = [];
  if (point.offset < len) ops.push(replaceContentOp(point.blockId, point.offset, len, []));
  if (firstMerges) {
    if ((first.content ?? []).length > 0) ops.push(replaceContentOp(point.blockId, point.offset, point.offset, first.content ?? []));
    if (allowsChildren && (first.children ?? []).length > 0) {
      let i = 0;
      for (const child of first.children!) ops.push({ type: "insertBlock", parentId: point.blockId, index: i++, block: child });
    }
  }
  let insertIdx = index + 1;
  for (const b of middle) ops.push({ type: "insertBlock", parentId, index: insertIdx++, block: b });

  if (lastMerges) {
    const tailBlock: Block = {
      id: last.id,
      type: last.type,
      props: last.props,
      // insertBlock (unlike replaceContent) never runs normalizeInline itself
      // (ops.ts's opInsertBlock stores a block's content as given) -- normalize
      // here so adjacent equal-marks runs merge the same way a same-block
      // paste (which DOES go through replaceContent) already does.
      content: normalizeInline([...(last.content ?? []), ...originalTailContent], registry),
    };
    if (last.children?.length) tailBlock.children = last.children;
    ops.push({ type: "insertBlock", parentId, index: insertIdx, block: tailBlock });
    let j = (last.children ?? []).length;
    for (const childId of originalChildIds) ops.push({ type: "moveBlock", id: childId, newParentId: last.id, index: j++ });
    return { ops, caret: { blockId: last.id, offset: contentLength(last.content) } };
  }

  const backId = newId();
  ops.push({ type: "insertBlock", parentId, index: insertIdx, block: { id: backId, type: rec.type, props: rec.props, content: originalTailContent } });
  let j = 0;
  for (const childId of originalChildIds) ops.push({ type: "moveBlock", id: childId, newParentId: backId, index: j++ });
  return { ops, caret: { blockId: backId, offset: 0 } };
}
