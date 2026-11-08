// Turns "make this live document equal that target document" into Transaction calls, so a
// suggestion decision lands in the editor as ONE undoable step (instead of editor.setDoc, which
// resets history and selection). Blocks are matched by id; applyDecisions keeps ids stable, so the
// result is a small set of insert / move / remove / replaceContent / setProps / setType calls.
// DOM-free and React-free.

import { contentLength, normalizeInline } from "@jul-editor/core";
import type { Block, Doc, Registry, Transaction } from "@jul-editor/core";

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

interface Entry {
  block: Block;
  parentId: string | null;
}

function indexDoc(doc: Doc): Map<string, Entry> {
  const map = new Map<string, Entry>();
  const walk = (blocks: Block[], parentId: string | null): void => {
    for (const b of blocks) {
      map.set(b.id, { block: b, parentId });
      if (b.children) walk(b.children, b.id);
    }
  };
  walk(doc.blocks, null);
  return map;
}

function withoutChildren(b: Block): Block {
  const { children: _children, ...rest } = b;
  return rest;
}

/** Appends to `tx` the calls that turn `current` into `target`. Returns the same tx (chainable). */
export function reconcileDoc(tx: Transaction, current: Doc, target: Doc, registry: Registry): Transaction {
  const cur = indexDoc(current);
  const tgt = indexDoc(target);
  // simulated child order per parent, kept in step with the calls emitted so indexes stay right
  const sim = new Map<string | null, string[]>();
  const parentOf = new Map<string, string | null>();
  sim.set(null, current.blocks.map((b) => b.id));
  for (const [id, e] of cur) {
    parentOf.set(id, e.parentId);
    sim.set(id, (e.block.children ?? []).map((c) => c.id));
  }
  const detach = (id: string): void => {
    const list = sim.get(parentOf.get(id) ?? null);
    if (list) {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }
  };

  const place = (parentId: string | null, targets: Block[]): void => {
    targets.forEach((t, i) => {
      const existing = cur.get(t.id);
      if (!existing) {
        tx = tx.insertBlock(parentId, i, withoutChildren(t));
        sim.get(parentId)!.splice(i, 0, t.id);
        sim.set(t.id, []);
        parentOf.set(t.id, parentId);
      } else {
        if (parentOf.get(t.id) !== parentId || sim.get(parentId)![i] !== t.id) {
          detach(t.id);
          sim.get(parentId)!.splice(i, 0, t.id);
          parentOf.set(t.id, parentId);
          tx = tx.moveBlock(t.id, parentId, i);
        }
        const old = existing.block;
        if (old.type !== t.type) {
          tx = tx.setType(t.id, t.type, t.props);
        } else if (stable(old.props) !== stable(t.props)) {
          const patch: Record<string, never | unknown> = {};
          for (const k of new Set([...Object.keys(old.props ?? {}), ...Object.keys(t.props ?? {})])) {
            if (stable(old.props?.[k]) !== stable(t.props?.[k])) patch[k] = t.props?.[k];
          }
          tx = tx.setProps(t.id, patch as Record<string, never>);
        }
        const oldContent = normalizeInline(old.content ?? [], registry);
        const newContent = normalizeInline(t.content ?? [], registry);
        if (stable(oldContent) !== stable(newContent)) tx = tx.replaceContent(t.id, 0, contentLength(old.content), newContent);
      }
      place(t.id, t.children ?? []);
    });
  };
  place(null, target.blocks);

  // removals last, so a block hoisted out of a removed parent has already been moved away.
  // Only subtree roots are removed (a removed parent takes its remaining children with it).
  const sweep = (blocks: Block[]): void => {
    for (const b of blocks) {
      if (!tgt.has(b.id)) {
        tx = tx.removeBlock(b.id);
        continue;
      }
      if (b.children) sweep(b.children);
    }
  };
  sweep(current.blocks);
  return tx;
}
