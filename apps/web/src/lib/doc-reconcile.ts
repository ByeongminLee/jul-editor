import { canonicalStringify, fromDoc, newId, normalizeDoc, toDoc, type Block, type Doc, type Editor, type Registry, type Transaction } from "@jul-editor/core";

/** The document exactly as the editor stores it: schema-normalized, default props omitted.
 * Comparing a hand-written sample with an edited document only makes sense in this form. */
export function canonicalDoc(doc: Doc, registry: Registry): Doc {
  return toDoc(fromDoc(normalizeDoc(doc, registry), registry), doc.version);
}

function withoutIds(block: Block): unknown {
  return { type: block.type, props: block.props, content: block.content, children: block.children?.map(withoutIds) };
}

/** Content identity of a block and its children, ignoring every block id. */
export function blockSignature(block: Block): string {
  return canonicalStringify(withoutIds(block));
}

/** Longest common subsequence of equal keys, as index pairs in order. */
function commonPairs(before: string[], after: string[]): Array<[number, number]> {
  const n = before.length;
  const m = after.length;
  // Very large lists fall back to an in-order greedy walk instead of an O(n*m) table.
  if (n * m > 4_000_000) {
    const pairs: Array<[number, number]> = [];
    let from = 0;
    for (let j = 0; j < m && from < n; j++) {
      const i = before.indexOf(after[j]!, from);
      if (i >= 0) { pairs.push([i, j]); from = i + 1; }
    }
    return pairs;
  }
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function reconcileList(previous: Block[], next: Block[], key: (block: Block) => string): Block[] {
  const previousKeys = previous.map(key);
  const nextKeys = next.map(key);
  const match = new Array<number>(next.length).fill(-1);
  const exact = new Array<boolean>(next.length).fill(false);
  const taken = new Array<boolean>(previous.length).fill(false);

  const anchors = commonPairs(previousKeys, nextKeys);
  for (const [i, j] of anchors) { match[j] = i; exact[j] = true; taken[i] = true; }

  // An unchanged block that only moved keeps its id, so Diff reports a move.
  const free = new Map<string, number[]>();
  previousKeys.forEach((value, i) => { if (!taken[i]) free.set(value, [...(free.get(value) ?? []), i]); });
  nextKeys.forEach((value, j) => {
    if (match[j] !== -1) return;
    const i = free.get(value)?.shift();
    if (i !== undefined) { match[j] = i; exact[j] = true; taken[i] = true; }
  });

  // Between two anchors, a block of the same type in the same slot is the same block, edited.
  const bounds: Array<[number, number]> = [[-1, -1], ...anchors, [previous.length, next.length]];
  for (let gap = 0; gap < bounds.length - 1; gap++) {
    const [previousStart, nextStart] = bounds[gap]!;
    const [previousEnd, nextEnd] = bounds[gap + 1]!;
    let from = previousStart + 1;
    for (let j = nextStart + 1; j < nextEnd; j++) {
      if (match[j] !== -1) continue;
      for (let i = from; i < previousEnd; i++) {
        if (taken[i] || previous[i]!.type !== next[j]!.type) continue;
        match[j] = i;
        taken[i] = true;
        from = i + 1;
        break;
      }
    }
  }

  const result: Block[] = [];
  next.forEach((block, j) => {
    const i = match[j]!;
    if (i === -1) { result.push(block); return; }
    const old = previous[i]!;
    if (exact[j]) { result.push(old); return; }
    const edited: Block = { ...block, id: old.id };
    if (block.children) edited.children = reconcileList(old.children ?? [], block.children, key);
    result.push(edited);
  });
  return result;
}

/**
 * Gives a freshly parsed document the ids of the blocks it came from, so applying edited
 * Markdown or HTML changes only the blocks that were edited. A block whose `key` is unchanged
 * keeps the previous block as it was (including props the source format cannot express);
 * an edited block keeps its id; a new block keeps its new id.
 */
export function reconcileIds(previous: Doc, next: Doc, key: (block: Block) => string = blockSignature): Doc {
  // A matching source must not restore descendants the parser could not retain.
  const shape = (block: Block): unknown => [block.type, (block.children ?? []).map(shape)];
  const sourceKey = (block: Block): string => {
    const value = key(block);
    if (block.type === "tableRow" || block.type === "tableCell" || !value || value.includes("data-jul-editor-unknown")) return blockSignature(block);
    return canonicalStringify([shape(block), value]);
  };
  return { ...next, blocks: reconcileList(previous.blocks, next.blocks, sourceKey) };
}

/** Turns the editor's document into `next` as one undoable edit. Blocks that are the
 * same object in both documents are left alone, so their rendered views stay mounted. */
export function replaceDocument(editor: Editor, next: Doc): void {
  const current = editor.getDoc();
  const nextIds = new Set(next.blocks.map((block) => block.id));
  const currentById = new Map(current.blocks.map((block) => [block.id, block]));
  // A new block must not reuse an id that a kept block (or one of its children) still owns,
  // e.g. a sample block the person dragged inside another block before restoring the sample.
  const owned = new Set<string>();
  const collect = (block: Block) => { owned.add(block.id); block.children?.forEach(collect); };
  for (const block of current.blocks) if (nextIds.has(block.id)) collect(block);
  const fresh = (block: Block): Block => {
    const children = block.children?.map(fresh);
    const id = owned.has(block.id) ? newId() : block.id;
    return id === block.id && children === undefined ? block : { ...block, id, ...(children ? { children } : {}) };
  };
  const order = current.blocks.map((block) => block.id).filter((id) => nextIds.has(id));
  editor.update((tx) => {
    let result: Transaction = tx.setSelection(null);
    for (const block of current.blocks) if (!nextIds.has(block.id)) result = result.removeBlock(block.id);
    next.blocks.forEach((block, index) => {
      const existing = currentById.get(block.id);
      if (!existing) {
        result = result.insertBlock(null, index, fresh(block));
        order.splice(index, 0, block.id);
        return;
      }
      if (existing !== block && blockSignature(existing) !== blockSignature(block)) result = result.replaceBlock(block.id, block);
      const at = order.indexOf(block.id);
      if (at !== index) {
        order.splice(at, 1);
        order.splice(index, 0, block.id);
        result = result.moveBlock(block.id, null, index);
      }
    });
    return result;
  });
}
