// Framework-agnostic heading outline for the table of contents (block + sidebar). Works on a live
// Store (editor state) or a plain Doc, so a server/read-only page can build the same outline.
// "Headings" are `heading` blocks and toggle headings (`toggle` with level 1-3), at any nesting
// depth (inside callouts, toggles, columns ...), in document order.
import { isText } from "@jul-editor/core";
import type { Block, Doc, Inline, Json, Store } from "@jul-editor/core";

export interface OutlineEntry {
  id: string;
  /** Heading level 1-6 as authored. */
  level: number;
  text: string;
  /** Indent steps relative to the shallowest level in this outline (0 = top). */
  depth: number;
}

export interface OutlineOptions {
  minLevel?: number;
  maxLevel?: number;
}

function plain(content: Inline[] | undefined): string {
  return (content ?? []).map((i) => (isText(i) ? i.text : i.type === "mention" ? String((i as { attrs?: { label?: string } }).attrs?.label ?? "") : "")).join("").replace(/\s+/g, " ").trim();
}

/** Heading level of a block type/props pair, or 0 when it is not a heading. */
export function headingLevelOf(type: string, props: Record<string, Json>): number {
  if (type === "heading") return Math.min(6, Math.max(1, Math.floor(Number(props.level ?? 1)) || 1));
  if (type === "toggle") {
    const l = Number(props.level ?? 0);
    return l >= 1 && l <= 3 ? l : 0;
  }
  return 0;
}

function finish(flat: Omit<OutlineEntry, "depth">[]): OutlineEntry[] {
  // depth = how many distinct shallower levels are "open" above this one (a skipped level, h1 then h3,
  // indents one step, not two): classic outline stack.
  const stack: number[] = [];
  return flat.map((e) => {
    while (stack.length && stack[stack.length - 1]! >= e.level) stack.pop();
    const depth = stack.length;
    stack.push(e.level);
    return { ...e, depth };
  });
}

function inRange(level: number, opts: OutlineOptions): boolean {
  return level >= (opts.minLevel ?? 1) && level <= (opts.maxLevel ?? 6);
}

export function extractOutline(store: Store, opts: OutlineOptions = {}): OutlineEntry[] {
  const flat: Omit<OutlineEntry, "depth">[] = [];
  const visit = (id: string) => {
    const rec = store.records.get(id);
    if (!rec) return;
    const level = headingLevelOf(rec.type, rec.props);
    if (level && inRange(level, opts)) flat.push({ id, level, text: plain(rec.content) });
    for (const c of rec.childIds) visit(c);
  };
  for (const id of store.rootIds) visit(id);
  return finish(flat);
}

export function extractOutlineFromDoc(doc: Doc, opts: OutlineOptions = {}): OutlineEntry[] {
  const flat: Omit<OutlineEntry, "depth">[] = [];
  const visit = (b: Block) => {
    const level = headingLevelOf(b.type, b.props ?? {});
    if (level && inRange(level, opts)) flat.push({ id: b.id, level, text: plain(b.content) });
    for (const c of b.children ?? []) visit(c);
  };
  for (const b of doc.blocks) visit(b);
  return finish(flat);
}

export function outlineEqual(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.id === b[i]!.id && e.level === b[i]!.level && e.text === b[i]!.text && e.depth === b[i]!.depth);
}

/** Index of the heading the reader is "in": the last one whose top edge is at or above `threshold`
 * (px from the viewport top); the first heading when none has scrolled past yet; -1 for no headings. */
export function pickActiveIndex(tops: readonly number[], threshold = 96): number {
  if (!tops.length) return -1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i]! <= threshold) active = i;
  return active;
}
