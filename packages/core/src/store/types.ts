// Runtime store types (store, selection and id rules).

import type { Block, Json } from "../model";

/** Normalized record form of a Block: children referenced by id (not embedded),
 * with an explicit parentId back-pointer. `childIds`/`parentId` replace Block's
 * `children`/implicit position. Record identity == subtree identity (see Store). */
export interface BlockRecord {
  id: string;
  type: string;
  props: Record<string, Json>;
  content?: Block["content"];
  childIds: string[];
  parentId: string | null;
}

/** Normalized immutable store: a flat id->record map plus the top-level order.
 * Every commit path-copies the changed record(s) AND their ancestors up to the
 * root so that a BlockRecord's object identity can be used as a
 * cache key for "has this subtree changed" (toDoc's WeakMap<BlockRecord,Block>). */
export interface Store {
  records: Map<string, BlockRecord>;
  rootIds: string[];
}

export interface Point {
  blockId: string;
  offset: number;
}

export type Selection =
  | { type: "text"; anchor: Point; focus: Point }
  | { type: "block"; ids: string[] }
  | { type: "cells"; tableId: string; anchor: [number, number]; focus: [number, number] };

export interface EditorState {
  store: Store;
  selection: Selection | null;
}

export type Op =
  | { type: "insertBlock"; parentId: string | null; index: number; block: Block }
  | { type: "removeBlock"; id: string }
  | { type: "moveBlock"; id: string; newParentId: string | null; index: number }
  | { type: "setProps"; id: string; patch: Record<string, Json | undefined> }
  | { type: "setType"; id: string; blockType: string; props?: Record<string, Json> }
  | { type: "replaceContent"; id: string; from: number; to: number; inlines: NonNullable<Block["content"]> }
  /** Wholesale swap of `id`'s own block (type/props/content/children), same
   * position/id/parent kept -- unlike `setType` (store/ops.ts's opSetType),
   * this has NO "reject when content/children would be lost" guard: its
   * whole point is to carry an explicit, exact inverse (the block it
   * replaced) so a caller can convert e.g. a non-empty paragraph straight
   * into a void embed as ONE undo-safe op (view/embedPaste.ts's paste-to-
   * embed). Only schema admission (does `block.type` fit the CURRENT
   * parent) is checked; a caller wanting content-loss protection should use
   * `setType` instead. */
  | { type: "replaceBlock"; id: string; block: Block };
