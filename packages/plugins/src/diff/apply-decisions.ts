// Suggestion / tracked-changes resolution. DOM-free and React-free.
//
// `applyDecisions(base, proposed, decisions)` resolves every InlineChange (see ./inline-diff.ts for
// the change ids) to accept or reject and returns the resulting Doc:
//   * accept every change  => structurally `proposed`
//   * reject every change  => structurally `base`
//   * mixed                => base with the accepted changes applied
//
// Mixed resolution works on a mutable working tree cloned from `base`:
//   a. accepted moves are detached (they get re-placed in step c),
//   b. accepted delete roots are removed; a descendant that still exists in `proposed` (it moved
//      away and that move was rejected) is hoisted into the deleted block's slot instead of lost,
//   c. `proposed` is walked in document order; accepted inserts are created and accepted moves are
//      re-attached, each right after its nearest earlier proposed sibling that is present under
//      the same parent (else before the nearest later one, else appended),
//   d. per-block content/props/type are taken from the side each decision selects; a text hunk
//      rebuilds the runs from the diff segments (accepted: ins/new, rejected: del/old).
// Interactions that would otherwise corrupt the tree are resolved conservatively: an accepted move
// whose new parent is a rejected insert is treated as rejected.

import { normalizeInline } from "@jul-editor/core";
import type { Block, Doc, Inline, Registry } from "@jul-editor/core";
import { coreRegistry } from "@jul-editor/core";
import { computeInlineDiff, type InlineDiff, type InlineDiffSegment } from "./inline-diff.js";

export type ChangeDecision = "accept" | "reject";
export type DecisionMap = Readonly<Record<string, ChangeDecision>> | ReadonlyMap<string, ChangeDecision>;

export interface ApplyDecisionsOptions {
  registry?: Registry;
  /** Decision for changes missing from `decisions` (pending). Default "reject" (keep base). */
  defaultDecision?: ChangeDecision;
  /** Precomputed diff of (base, proposed); skips recomputation (must match the docs). */
  diff?: InlineDiff;
  /** Text hunk granularity used when `diff` is not given; must match the one the ids came from. */
  granularity?: "char" | "word";
}

export function getDecision(decisions: DecisionMap, id: string): ChangeDecision | undefined {
  return decisions instanceof Map ? decisions.get(id) : (decisions as Record<string, ChangeDecision>)[id];
}

/** Decision map that applies `decision` to every change of `diff` (Accept all / Reject all). */
export function decideAll(diff: InlineDiff, decision: ChangeDecision): Record<string, ChangeDecision> {
  const out: Record<string, ChangeDecision> = {};
  for (const c of diff.changes) out[c.id] = decision;
  return out;
}

interface WNode {
  block: Block;
  kids: WNode[];
}

function indexDoc(doc: Doc): Map<string, { block: Block; parentId: string | null }> {
  const map = new Map<string, { block: Block; parentId: string | null }>();
  const walk = (blocks: Block[], parentId: string | null): void => {
    for (const b of blocks) {
      map.set(b.id, { block: b, parentId });
      if (b.children) walk(b.children, b.id);
    }
  };
  walk(doc.blocks, null);
  return map;
}

function rebuildContent(segs: InlineDiffSegment[], dec: (id: string) => ChangeDecision, registry: Registry): Inline[] {
  const out: Inline[] = [];
  for (const s of segs) {
    if (s.kind === "same") out.push(...s.content);
    else if (s.kind === "ins") {
      if (dec(s.changeId!) === "accept") out.push(...s.content);
    } else if (s.kind === "del") {
      if (dec(s.changeId!) === "reject") out.push(...s.content);
    } else out.push(...(dec(s.changeId!) === "accept" ? s.content : (s.oldContent ?? s.content)));
  }
  return normalizeInline(out, registry);
}

export function applyDecisions(base: Doc, proposed: Doc, decisions: DecisionMap, opts: ApplyDecisionsOptions = {}): Doc {
  const registry = opts.registry ?? coreRegistry;
  const fallback = opts.defaultDecision ?? "reject";
  const diff = opts.diff ?? computeInlineDiff(base, proposed, { registry, granularity: opts.granularity });
  const dec = (id: string): ChangeDecision => getDecision(decisions, id) ?? fallback;

  const accepted = diff.changes.filter((c) => dec(c.id) === "accept").length;
  if (diff.changes.length === 0 || accepted === 0) return structuredClone(base);
  if (accepted === diff.changes.length) return structuredClone(proposed);

  const baseIdx = indexDoc(base);
  const propIdx = indexDoc(proposed);

  // --- working tree from base -------------------------------------------------------------
  const nodes = new Map<string, WNode>();
  const parentOf = new Map<string, string | null>();
  const rootKids: WNode[] = [];
  const clone = (b: Block, parentId: string | null): WNode => {
    const n: WNode = { block: { ...b }, kids: [] };
    delete n.block.children;
    nodes.set(b.id, n);
    parentOf.set(b.id, parentId);
    n.kids = (b.children ?? []).map((c) => clone(c, b.id));
    return n;
  };
  for (const b of base.blocks) rootKids.push(clone(b, null));
  const arrOf = (parentId: string | null): WNode[] => (parentId === null ? rootKids : nodes.get(parentId)!.kids);

  // --- effective decisions ----------------------------------------------------------------
  const insertRootDecision = (id: string): ChangeDecision => {
    // Inserted ids all sit under exactly one insert root; walk up to it.
    let cur: string | null = id;
    let root = id;
    while (cur !== null && !baseIdx.has(cur)) {
      root = cur;
      cur = propIdx.get(cur)!.parentId;
    }
    return dec(`insert:${root}`);
  };
  const isInserted = (id: string): boolean => propIdx.has(id) && !baseIdx.has(id);
  const moveAccepted = (id: string): boolean => {
    if (!diff.changeById.has(`move:${id}`) || dec(`move:${id}`) !== "accept") return false;
    const pid = propIdx.get(id)!.parentId;
    return pid === null || !isInserted(pid) || insertRootDecision(pid) === "accept";
  };

  // --- a. detach accepted moves ------------------------------------------------------------
  const detach = (id: string): WNode => {
    const n = nodes.get(id)!;
    const arr = arrOf(parentOf.get(id) ?? null);
    arr.splice(arr.indexOf(n), 1);
    parentOf.delete(id);
    return n;
  };
  const detached = new Map<string, WNode>();
  for (const c of diff.changes) {
    if (c.kind === "move" && moveAccepted(c.blockId)) detached.set(c.blockId, detach(c.blockId));
  }

  // --- b. accepted deletes ------------------------------------------------------------------
  const forget = (n: WNode): void => {
    nodes.delete(n.block.id);
    parentOf.delete(n.block.id);
  };
  // Drops `n`; any descendant still present in `proposed` is hoisted into `arr` at `at`.
  const drop = (n: WNode, arr: WNode[], parentId: string | null, at: { i: number }): void => {
    forget(n);
    for (const k of n.kids) {
      if (propIdx.has(k.block.id)) {
        arr.splice(at.i++, 0, k);
        parentOf.set(k.block.id, parentId);
      } else drop(k, arr, parentId, at);
    }
  };
  for (const c of diff.changes) {
    if (c.kind !== "delete" || dec(c.id) !== "accept") continue;
    const n = nodes.get(c.blockId);
    if (!n) continue;
    const pid = parentOf.get(c.blockId) ?? null;
    const arr = arrOf(pid);
    const at = { i: arr.indexOf(n) };
    arr.splice(at.i, 1);
    drop(n, arr, pid, at);
  }

  // --- c. place inserts/moves in proposed order ---------------------------------------------
  const place = (n: WNode, pid: string | null, sibs: Block[], index: number): void => {
    const arr = arrOf(pid);
    let at = -1;
    for (let i = index - 1; i >= 0 && at < 0; i--) {
      const s = nodes.get(sibs[i]!.id);
      if (s && parentOf.get(s.block.id) === pid) at = arr.indexOf(s) + 1;
    }
    for (let i = index + 1; i < sibs.length && at < 0; i++) {
      const s = nodes.get(sibs[i]!.id);
      if (s && parentOf.get(s.block.id) === pid) at = arr.indexOf(s);
    }
    if (at < 0) at = arr.length;
    arr.splice(at, 0, n);
    nodes.set(n.block.id, n);
    parentOf.set(n.block.id, pid);
  };
  const walk = (sibs: Block[], pid: string | null): void => {
    sibs.forEach((b, i) => {
      if (isInserted(b.id)) {
        if (insertRootDecision(b.id) === "accept") {
          const nb: Block = { ...b };
          delete nb.children;
          place({ block: nb, kids: [] }, pid, sibs, i);
        }
      } else if (detached.has(b.id)) {
        place(detached.get(b.id)!, pid, sibs, i);
      }
      if (b.children) walk(b.children, b.id);
    });
  };
  walk(proposed.blocks, null);

  // --- d. per-block props/type/content ------------------------------------------------------
  for (const [id, n] of nodes) {
    const bi = baseIdx.get(id);
    const pi = propIdx.get(id);
    if (!bi || !pi) continue; // inserted blocks were copied verbatim from proposed
    const model = diff.blockById.get(id);
    const next: Block = { ...n.block };
    if (dec(`props:${id}`) === "accept" && diff.changeById.has(`props:${id}`)) {
      next.type = pi.block.type;
      next.props = pi.block.props;
    }
    if (model?.segments) next.content = rebuildContent(model.segments, dec, registry);
    n.block = next;
  }

  // --- e. materialize -----------------------------------------------------------------------
  const out = (list: WNode[]): Block[] =>
    list.map((n) => {
      const b: Block = { ...n.block };
      const src = propIdx.get(b.id)?.block ?? baseIdx.get(b.id)?.block;
      if (n.kids.length) b.children = out(n.kids);
      else if (src?.children !== undefined) b.children = [];
      return b;
    });
  return { ...base, blocks: structuredClone(out(rootKids)) };
}
