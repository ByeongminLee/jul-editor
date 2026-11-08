// Applies a single primitive Op to a Store, producing the new Store, the set
// of changed record ids (see commitPatch), and an inverse Op that undoes it.

import { normalizeBlock, normalizeInline, normalizeProps, sanitizeBlockProps } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline, Json } from "../model/types.js";
import { canAdmit, collectSubtreeIds, commitPatch, containerInfo, contentLength, flattenBlockRecords, recordToBlock, siblingsOf, sliceContent, spliceContent } from "./store.js";
import type { BlockRecord, Op, Store } from "./types.js";

export interface ApplyResult {
  store: Store;
  changedIds: Set<string>;
  inverse: Op;
}

function noop(store: Store, op: Op): ApplyResult {
  return { store, changedIds: new Set(), inverse: op };
}

function opInsertBlock(store: Store, op: Extract<Op, { type: "insertBlock" }>, registry: Registry): ApplyResult {
  const { parentId, index } = op;
  // a block reaching this op is untrusted (programmatic editor.update,
  // paste's per-block insertBlock ops, an inverse-of-removeBlock replay) --
  // normalize it (sanitizeUrl on link href/image src, schema defaults, mark
  // ordering) the same way a whole doc gets normalized, so nothing bypasses
  // sanitization just because it arrived one block at a time instead of
  // through createEditor/setDoc's normalizeDoc.
  const block = normalizeBlock(op.block, registry);
  // reject (no-op) rather than insert into a container whose schema
  // doesn't admit this type at all -- same admission rule opSetType/
  // opReplaceBlock use, so a stray insertBlock can never leave the doc
  // structurally invalid (e.g. a codeBlock inserted straight into a table row).
  if (parentId !== null && !store.records.has(parentId)) return noop(store, op);
  const container = containerInfo(store, parentId, registry);
  if (!canAdmit(registry, block.type, container.type, container.children)) return noop(store, op);
  const updated = new Map<string, BlockRecord | null>(flattenBlockRecords(block, parentId));
  let rootIds = store.rootIds;
  if (parentId === null) {
    rootIds = [...store.rootIds.slice(0, index), block.id, ...store.rootIds.slice(index)];
  } else {
    const parentRec = store.records.get(parentId)!;
    updated.set(parentId, { ...parentRec, childIds: [...parentRec.childIds.slice(0, index), block.id, ...parentRec.childIds.slice(index)] });
  }
  const { store: next, changedIds } = commitPatch(store, updated, rootIds);
  return { store: next, changedIds, inverse: { type: "removeBlock", id: block.id } };
}

function opRemoveBlock(store: Store, op: Extract<Op, { type: "removeBlock" }>): ApplyResult {
  const { id } = op;
  if (!store.records.has(id)) return noop(store, op);
  const { parentId, siblings, index } = siblingsOf(store, id);
  const snapshot = recordToBlock(store, id);
  const updated = new Map<string, BlockRecord | null>();
  for (const sid of collectSubtreeIds(store, id)) updated.set(sid, null);
  let rootIds = store.rootIds;
  if (parentId === null) {
    rootIds = siblings.filter((s) => s !== id);
  } else {
    const parentRec = store.records.get(parentId)!;
    updated.set(parentId, { ...parentRec, childIds: parentRec.childIds.filter((s) => s !== id) });
  }
  const { store: next, changedIds } = commitPatch(store, updated, rootIds);
  return { store: next, changedIds, inverse: { type: "insertBlock", parentId, index, block: snapshot } };
}

function opMoveBlock(store: Store, op: Extract<Op, { type: "moveBlock" }>, registry: Registry): ApplyResult {
  const { id, newParentId, index } = op;
  const rec = store.records.get(id);
  if (!rec) return noop(store, op);
  if (newParentId !== null && !store.records.has(newParentId)) return noop(store, op);
  // same admission rule as opInsertBlock/opSetType/opReplaceBlock -- moving
  // a block into a container whose schema doesn't admit its type is a no-op.
  const container = containerInfo(store, newParentId, registry);
  if (!canAdmit(registry, rec.type, container.type, container.children)) return noop(store, op);
  // Cycle guard: never move a block into its own subtree.
  for (let cur: string | null = newParentId; cur !== null; cur = store.records.get(cur)?.parentId ?? null) {
    if (cur === id) return noop(store, op);
  }
  const { parentId: oldParentId, siblings: oldSiblings, index: oldIndex } = siblingsOf(store, id);
  if (oldParentId === newParentId && oldIndex === Math.max(0, Math.min(index, oldSiblings.length - 1))) return noop(store, op);
  const updated = new Map<string, BlockRecord | null>([[id, { ...rec, parentId: newParentId }]]);
  let rootIds = store.rootIds;

  if (oldParentId === newParentId) {
    const without = oldSiblings.filter((s) => s !== id);
    const at = Math.max(0, Math.min(index, without.length));
    const reordered = [...without.slice(0, at), id, ...without.slice(at)];
    if (newParentId === null) rootIds = reordered;
    else updated.set(newParentId, { ...store.records.get(newParentId)!, childIds: reordered });
  } else {
    if (oldParentId === null) rootIds = oldSiblings.filter((s) => s !== id);
    else updated.set(oldParentId, { ...store.records.get(oldParentId)!, childIds: oldSiblings.filter((s) => s !== id) });

    if (newParentId === null) {
      rootIds = [...rootIds.slice(0, index), id, ...rootIds.slice(index)];
    } else {
      const parentRec = store.records.get(newParentId)!;
      updated.set(newParentId, { ...parentRec, childIds: [...parentRec.childIds.slice(0, index), id, ...parentRec.childIds.slice(index)] });
    }
  }

  const { store: next, changedIds } = commitPatch(store, updated, rootIds);
  return { store: next, changedIds, inverse: { type: "moveBlock", id, newParentId: oldParentId, index: oldIndex } };
}

function opSetProps(store: Store, op: Extract<Op, { type: "setProps" }>, registry: Registry): ApplyResult {
  const { id, patch } = op;
  const rec = store.records.get(id);
  if (!rec) return noop(store, op);
  const spec = registry.blocks.get(rec.type);
  const merged = { ...rec.props };
  const oldPatch: Record<string, Json | undefined> = {};
  for (const k of Object.keys(patch)) {
    oldPatch[k] = Object.prototype.hasOwnProperty.call(rec.props, k) ? rec.props[k] : undefined;
    if (patch[k] === undefined) delete merged[k];
    else merged[k] = patch[k]!;
  }
  const props = sanitizeBlockProps(rec.type, normalizeProps(merged, spec?.props ?? {}));
  const { store: next, changedIds } = commitPatch(store, new Map([[id, { ...rec, props }]]));
  return { store: next, changedIds, inverse: { type: "setProps", id, patch: oldPatch } };
}

// a code target has no notion of marks OR non-text inlines (a
// mention, etc.) -- flatten each to its plain-text representation ("@label"
// for a mention) instead of silently dropping it (the old stripMarks-only
// call kept the inline object itself, invisible to every serializer/renderer
// downstream, since content:'code' readers only ever look at text runs).
function inlineToCodeText(inl: Inline): Inline {
  if (inl.type === "text") return inl;
  const label = (inl as { attrs?: { label?: string } }).attrs?.label;
  return { type: "text", text: label ? `@${label}` : "" };
}

function opSetType(store: Store, op: Extract<Op, { type: "setType" }>, registry: Registry): ApplyResult {
  const { id, blockType, props: newProps } = op;
  const rec = store.records.get(id);
  const newSpec = registry.blocks.get(blockType);
  if (!rec || !newSpec) return noop(store, op);

  // Reject (no-op) rather than silently destroy data: a real content/children
  // mismatch needs an explicit higher-level op (e.g. move the children out
  // first), not a lossy setType. `canAdmit` checks BOTH directions (the
  // container's own children allow-list AND the new type's own `parent`
  // allow-list) -- the old check here only ever tested the latter, so it
  // missed e.g. a tableRow's ["tableCell"]-only allow-list and let a table
  // cell turn into a codeBlock (schema-legal anywhere on ITS side, but never
  // admitted inside a tableRow).
  if (newSpec.content === "none" && (rec.content ?? []).length > 0) return noop(store, op);
  if (newSpec.children === "none" && rec.childIds.length > 0) return noop(store, op);
  const container = containerInfo(store, rec.parentId, registry);
  if (!canAdmit(registry, blockType, container.type, container.children)) return noop(store, op);

  // sanitize the same way opSetProps/opInsertBlock/normalizeDoc do --
  // setType is a write path too (e.g. an input rule converting a paragraph to
  // an embed/image), and an unsanitized url/src must never reach the store.
  const props = sanitizeBlockProps(blockType, normalizeProps(newProps ?? rec.props, newSpec.props));
  const newRec: BlockRecord = { id: rec.id, type: blockType, props, childIds: rec.childIds, parentId: rec.parentId };
  if (newSpec.content === "code") newRec.content = normalizeInline((rec.content ?? []).map(inlineToCodeText), registry, { stripMarks: true });
  else if (newSpec.content === "inline") newRec.content = normalizeInline(rec.content, registry);

  const { store: next, changedIds } = commitPatch(store, new Map([[id, newRec]]));
  return { store: next, changedIds, inverse: { type: "setType", id, blockType: rec.type, props: rec.props } };
}

function opReplaceContent(store: Store, op: Extract<Op, { type: "replaceContent" }>, registry: Registry): ApplyResult {
  const { id, from, to, inlines } = op;
  const rec = store.records.get(id);
  if (!rec) return noop(store, op);
  const spec = registry.blocks.get(rec.type);
  // a block whose schema says content:'none' (a void, e.g. divider) has
  // nowhere to put inline content -- rejecting here (rather than silently
  // storing it, invisible to render/toMarkdown/toHTML) is what stops a click
  // + type into a just-converted void's stale content div from ever reaching
  // the model.
  if (spec?.content === "none") return noop(store, op);
  const current = rec.content ?? [];
  const oldSlice = sliceContent(current, from, to);
  const spliced = spliceContent(current, from, to, inlines);
  const content: Inline[] = normalizeInline(spliced, registry, { stripMarks: spec?.content === "code" });

  const { store: next, changedIds } = commitPatch(store, new Map([[id, { ...rec, content }]]));
  return { store: next, changedIds, inverse: { type: "replaceContent", id, from, to: from + contentLength(inlines), inlines: oldSlice } };
}

/** Wholesale swap of `op.id`'s whole subtree for `op.block` (same id, same
 * parent/position) -- see Op's own "replaceBlock" doc comment for why this
 * exists alongside (not instead of) opSetType. Rejects (no-op) only when the
 * CURRENT parent's schema doesn't admit `op.block.type` there; unlike
 * opSetType it never rejects for "would drop existing content/children" --
 * that's the one thing a caller reaches for this op to deliberately do. */
// a `block` payload is caller-authored (TurnInto's replaceBlock, undo
// replay, etc.) and its own subtree can carry an id that already exists
// SOMEWHERE ELSE in the doc (outside the subtree being replaced) -- writing
// it as-is would make that id resolve to two different blocks at once
// (siblingsOf/recordToBlock/etc. all key off `id`, so the older one becomes
// unreachable while still occupying its old slot). Reissue every colliding id
// (except the root, which always keeps `op.id`) instead of rejecting the
// whole op -- same "don't lose the caller's content" spirit as opReplaceBlock
// never rejecting for a content/children mismatch.
function reissueCollidingIds(block: Block, keepId: string, collideWith: ReadonlySet<string>): Block {
  const children = block.children?.map((c) => reissueCollidingIds(c, keepId, collideWith));
  if (block.id !== keepId && collideWith.has(block.id)) {
    return { ...block, id: newId(), ...(children ? { children } : {}) };
  }
  return children ? { ...block, children } : block;
}

function opReplaceBlock(store: Store, op: Extract<Op, { type: "replaceBlock" }>, registry: Registry): ApplyResult {
  const { id, block } = op;
  const rec = store.records.get(id);
  if (!rec) return noop(store, op);
  const container = containerInfo(store, rec.parentId, registry);
  if (!canAdmit(registry, block.type, container.type, container.children)) return noop(store, op);
  const snapshot = recordToBlock(store, id);
  const oldSubtreeIds = new Set(collectSubtreeIds(store, id));
  const collideWith = new Set([...store.records.keys()].filter((rid) => !oldSubtreeIds.has(rid)));
  const normalized = normalizeBlock(reissueCollidingIds({ ...block, id }, id, collideWith), registry);
  const updated = new Map<string, BlockRecord | null>();
  for (const sid of collectSubtreeIds(store, id)) if (sid !== id) updated.set(sid, null);
  for (const [rid, rrec] of flattenBlockRecords(normalized, rec.parentId)) updated.set(rid, rrec);
  const { store: next, changedIds } = commitPatch(store, updated);
  return { store: next, changedIds, inverse: { type: "replaceBlock", id, block: snapshot } };
}

export function applyOp(store: Store, op: Op, registry: Registry): ApplyResult {
  switch (op.type) {
    case "insertBlock":
      return opInsertBlock(store, op, registry);
    case "removeBlock":
      return opRemoveBlock(store, op);
    case "moveBlock":
      return opMoveBlock(store, op, registry);
    case "setProps":
      return opSetProps(store, op, registry);
    case "setType":
      return opSetType(store, op, registry);
    case "replaceContent":
      return opReplaceContent(store, op, registry);
    case "replaceBlock":
      return opReplaceBlock(store, op, registry);
  }
}
