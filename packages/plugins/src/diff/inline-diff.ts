// Inline compare model ("Snapshot Compare" style): ONE document tree where inserted text/blocks,
// deleted text/blocks, modified blocks and moved blocks are annotated in place, instead of the
// two-sided/GitHub-like block list DiffView renders. DOM-free and React-free (runs in plain node).
//
// It is a second projection of the SAME engine: `diffDocs` (./diff.ts) does the classification
// (id-based match, LIS move detection, fast-diff over flattened inline text). This file only
//  1. maps the DiffTree into display blocks that carry text SEGMENTS (same/ins/del/fmt) holding
//     real marked `Inline[]` runs (so a React layer can render marks via renderPlainContent), and
//  2. enumerates the discrete, individually decidable CHANGES with stable ids. The change list is
//     the contract shared with `applyDecisions` (./apply-decisions.ts) and the suggestion UI.
//
// Change ids are deterministic functions of (before, after) so a host can persist decisions:
//   insert:<blockId>        root of an inserted subtree (descendants ride along)
//   delete:<blockId>        root of a deleted subtree (descendants ride along)
//   move:<blockId>          reparent or reorder
//   props:<blockId>         prop and/or block type change (one change per block)
//   text:<blockId>:<n>      n-th contiguous replace/insert/delete hunk of the block's text
//   format:<blockId>:<n>    n-th mark-only (same text, different marks) range

import { isText, normalizeInline } from "@jul-editor/core";
import type { Block, Doc, Inline, Registry } from "@jul-editor/core";
import { coreRegistry } from "@jul-editor/core";
import { wordifyOps, type DiffOp } from "./word-diff.js";
import { diffDocs, type DiffNode, type DiffStats, type DiffTree, type PropChange } from "./diff.js";

export type ChangeKind = "insert" | "delete" | "move" | "props" | "text" | "format";

/** Who made a change. All optional: a host maps its own author model onto this. */
export interface ChangeAttribution {
  id?: string;
  name?: string;
  /** Any CSS color; exposed to styling as `--jul-editor-diff-author`. */
  color?: string;
}

export interface InlineChange {
  id: string;
  kind: ChangeKind;
  blockId: string;
  blockType: string;
  /** Short human readable description, e.g. `"brave " inserted` (truncated). */
  summary: string;
  attribution?: ChangeAttribution;
}

export interface InlineDiffSegment {
  kind: "same" | "ins" | "del" | "fmt";
  /** Flattened text (atomic inlines as U+FFFC). */
  text: string;
  /** Marked runs to display (the NEW side for same/ins/fmt, the OLD side for del). */
  content: Inline[];
  /** `fmt` only: the old-side runs (same text, previous marks). */
  oldContent?: Inline[];
  /** Owning change (absent for `same`). A del+ins replacement shares one id. */
  changeId?: string;
}

export interface InlineDiffBlock {
  id: string;
  type: string;
  status: DiffNode["status"];
  /** Block to display: the old one for deletes, the new one otherwise. */
  block: Block;
  /** Present for blocks whose text changed. Inserted/deleted blocks have none (all-ins / all-del). */
  segments?: InlineDiffSegment[];
  props?: PropChange[];
  /** Set only when the block type changed. */
  beforeType?: string;
  afterType?: string;
  from?: { parentId: string | null; index: number };
  /** Change ids this block owns (insert/delete/move/props/text/format), document order. */
  changeIds: string[];
  /** Descendants of an inserted/deleted root: id of that root's change. */
  coverId?: string;
  children: InlineDiffBlock[];
}

export interface InlineDiff {
  blocks: InlineDiffBlock[];
  changes: InlineChange[];
  changeById: Map<string, InlineChange>;
  blockById: Map<string, InlineDiffBlock>;
  stats: DiffStats;
  /** The underlying block-level tree (same object diffDocs returned). */
  tree: DiffTree;
}

export interface ComputeInlineDiffOptions {
  registry?: Registry;
  /** Called once per change; the result lands on `change.attribution`. */
  attribute?: (change: InlineChange) => ChangeAttribution | undefined;
  /** Text hunk granularity. "word" (default): edits grow to word boundaries and nearby delete +
   * insert pairs merge into one replacement. "char": raw character-level hunks. */
  granularity?: "char" | "word";
}

const OBJ = "￼";

function inlineLength(i: Inline): number {
  return isText(i) ? i.text.length : 1;
}

/** Text of an inline list in the flattened convention (atomic inlines as U+FFFC). */
export function inlineText(list: Inline[]): string {
  return list.map((i) => (isText(i) ? i.text : OBJ)).join("");
}

/** Slices `[start, end)` (flattened offsets) out of an already normalized inline list, keeping marks. */
export function sliceInline(list: Inline[], start: number, end: number): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  for (const inl of list) {
    const len = inlineLength(inl);
    const from = Math.max(start, pos);
    const to = Math.min(end, pos + len);
    if (to > from) {
      if (isText(inl)) out.push({ ...inl, text: inl.text.slice(from - pos, to - pos) });
      else out.push(inl);
    }
    pos += len;
    if (pos >= end) break;
  }
  return out;
}

function clip(s: string, n = 40): string {
  const t = s.replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
}

function blockPreview(block: Block): string {
  return clip((block.content ?? []).map((i) => (isText(i) ? i.text : "")).join("")) || block.type;
}

function indexBlocks(doc: Doc): Map<string, Block> {
  const map = new Map<string, Block>();
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      map.set(b.id, b);
      if (b.children) walk(b.children);
    }
  };
  walk(doc.blocks);
  return map;
}

interface Collector {
  changes: InlineChange[];
  push(change: Omit<InlineChange, "attribution">): string;
}

/** Builds same/ins/del/fmt segments for one block from the engine's fast-diff ops. A run of
 * non-equal ops between two equal ops is ONE hunk (delete + insert pair = one replacement). */
function buildSegments(
  block: { id: string; type: string },
  oldContent: Inline[] | undefined,
  newContent: Inline[] | undefined,
  node: DiffNode,
  registry: Registry,
  col: Collector,
  ownerIds: string[],
  granularity: "char" | "word",
): InlineDiffSegment[] {
  const oldList = normalizeInline(oldContent ?? [], registry);
  const newList = normalizeInline(newContent ?? [], registry);
  const segs: InlineDiffSegment[] = [];
  let oi = 0;
  let ni = 0;
  let textN = 0;
  let fmtN = 0;
  let hunk: { of: number; ot: number; nf: number; nt: number } | null = null;

  const flush = (): void => {
    if (!hunk) return;
    const del = sliceInline(oldList, hunk.of, hunk.ot);
    const ins = sliceInline(newList, hunk.nf, hunk.nt);
    const delText = inlineText(del);
    const insText = inlineText(ins);
    const summary =
      delText && insText ? `"${clip(delText, 20)}" replaced by "${clip(insText, 20)}"` : insText ? `"${clip(insText)}" inserted` : `"${clip(delText)}" deleted`;
    const id = col.push({ id: `text:${block.id}:${textN++}`, kind: "text", blockId: block.id, blockType: block.type, summary });
    ownerIds.push(id);
    if (delText) segs.push({ kind: "del", text: delText, content: del, changeId: id });
    if (insText) segs.push({ kind: "ins", text: insText, content: ins, changeId: id });
    hunk = null;
  };

  const ops: readonly DiffOp[] = granularity === "word" ? wordifyOps((node.inline ?? []) as DiffOp[]) : ((node.inline ?? []) as DiffOp[]);
  for (const [type, s] of ops) {
    const len = s.length;
    if (type === 0) {
      flush();
      // Mark-only changes only exist when the text is identical on both sides (one equal op), and
      // their ranges are in (== old) text coordinates; split the equal run around them.
      const ranges = (node.formatRanges ?? []).filter(([a, b]) => b > ni && a < ni + len);
      let cur = ni;
      for (const [ra, rb] of ranges) {
        const a = Math.max(ra, ni);
        const b = Math.min(rb, ni + len);
        if (a > cur) {
          const c = sliceInline(newList, cur, a);
          segs.push({ kind: "same", text: inlineText(c), content: c });
        }
        const nc = sliceInline(newList, a, b);
        const oc = sliceInline(oldList, a - ni + oi, b - ni + oi);
        const id = col.push({ id: `format:${block.id}:${fmtN++}`, kind: "format", blockId: block.id, blockType: block.type, summary: `formatting of "${clip(inlineText(nc), 30)}" changed` });
        ownerIds.push(id);
        segs.push({ kind: "fmt", text: inlineText(nc), content: nc, oldContent: oc, changeId: id });
        cur = b;
      }
      if (cur < ni + len) {
        const c = sliceInline(newList, cur, ni + len);
        segs.push({ kind: "same", text: inlineText(c), content: c });
      }
      oi += len;
      ni += len;
    } else {
      hunk ??= { of: oi, ot: oi, nf: ni, nt: ni };
      if (type === -1) {
        oi += len;
        hunk.ot = oi;
      } else {
        ni += len;
        hunk.nt = ni;
      }
    }
  }
  flush();
  return segs;
}

/** Computes the inline compare model. Pure; same cost profile as `diffDocs` plus one pass over the
 * changed nodes. */
export function computeInlineDiff(before: Doc, after: Doc, opts: ComputeInlineDiffOptions = {}): InlineDiff {
  const registry = opts.registry ?? coreRegistry;
  const tree = diffDocs(before, after, registry);
  const oldMap = indexBlocks(before);
  const newMap = indexBlocks(after);
  const changes: InlineChange[] = [];
  const changeById = new Map<string, InlineChange>();
  const blockById = new Map<string, InlineDiffBlock>();
  const col: Collector = {
    changes,
    push(c) {
      const change: InlineChange = { ...c };
      changes.push(change);
      changeById.set(change.id, change);
      return change.id;
    },
  };

  /** Unchanged subtree (Merkle match): plain "same" blocks straight from the doc. */
  function plain(block: Block, cover?: string): InlineDiffBlock {
    const b: InlineDiffBlock = { id: block.id, type: block.type, status: "same", block, changeIds: [], coverId: cover, children: (block.children ?? []).map((c) => plain(c, cover)) };
    blockById.set(b.id, b);
    return b;
  }

  function map(node: DiffNode, cover?: string): InlineDiffBlock {
    const oldBlock = oldMap.get(node.id);
    const newBlock = newMap.get(node.id);
    const display = (node.status === "delete" ? oldBlock : newBlock) ?? (oldBlock as Block);
    const out: InlineDiffBlock = { id: node.id, type: display.type, status: node.status, block: display, changeIds: [], coverId: cover, children: [] };
    blockById.set(out.id, out);
    const label = blockPreview(display);

    let childCover = cover;
    if (node.status === "insert" && !cover) {
      const id = col.push({ id: `insert:${node.id}`, kind: "insert", blockId: node.id, blockType: display.type, summary: `${display.type} "${label}" added` });
      out.changeIds.push(id);
      out.coverId = childCover = id;
    } else if (node.status === "delete" && !cover) {
      const id = col.push({ id: `delete:${node.id}`, kind: "delete", blockId: node.id, blockType: display.type, summary: `${display.type} "${label}" removed` });
      out.changeIds.push(id);
      out.coverId = childCover = id;
    }
    if (node.status === "move") {
      out.from = node.from;
      out.changeIds.push(col.push({ id: `move:${node.id}`, kind: "move", blockId: node.id, blockType: display.type, summary: `${display.type} "${label}" moved` }));
    }
    if (node.status !== "insert" && node.status !== "delete") {
      if (node.props?.length || node.before) {
        out.props = node.props;
        if (node.before) {
          out.beforeType = node.before;
          out.afterType = node.after;
        }
        const keys = [...(node.props ?? []).map((p) => p.key), ...(node.before ? ["type"] : [])];
        out.changeIds.push(col.push({ id: `props:${node.id}`, kind: "props", blockId: node.id, blockType: display.type, summary: `${display.type} "${label}": ${keys.join(", ")} changed` }));
      }
      if (node.inline && oldBlock && newBlock) {
        const segs = buildSegments({ id: node.id, type: display.type }, oldBlock.content, newBlock.content, node, registry, col, out.changeIds, opts.granularity ?? "word");
        if (segs.some((s) => s.kind !== "same")) out.segments = segs;
      }
    }

    if (node.collapsed) out.children = (display.children ?? []).map((c) => plain(c, childCover));
    else out.children = node.children.map((c) => map(c, childCover));
    return out;
  }

  const blocks = tree.root.map((n) => map(n));
  if (opts.attribute) {
    for (const c of changes) {
      const a = opts.attribute(c);
      if (a) c.attribution = a;
    }
  }
  return { blocks, changes, changeById, blockById, stats: tree.stats, tree };
}
