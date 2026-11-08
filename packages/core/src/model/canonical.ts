import { newId } from "./id.js";
import type { BlockSpec, ChildrenKind, Registry } from "./schema.js";
import type { Block, Doc, Inline, Json, Mark, TextInline } from "./types.js";
import { sanitizeFontFamily, sanitizeFontSize } from "./font-style.js";
import { sanitizeUrl } from "./url.js";

/** Sorted-key, undefined-omitting JSON stringify. Two logically-equal values
 * (different key order, different `undefined` presence) produce identical output. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = sortValue(val);
    }
    return out;
  }
  return v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

// `GenericInline.type` is `string`, so a plain `inl.type === "text"` check
// doesn't exclude GenericInline from the narrowed type (its type COULD be
// "text" as far as the type checker knows). An explicit type guard does.
export function isText(inl: Inline): inl is TextInline {
  return inl.type === "text";
}

/** Reads a prop, falling back to the block spec's default when absent. */
export function getProp<T extends Json = Json>(block: Block, key: string, registry: Registry): T | undefined {
  if (block.props && Object.prototype.hasOwnProperty.call(block.props, key) && block.props[key] !== undefined) {
    return block.props[key] as T;
  }
  const spec = registry.blocks.get(block.type);
  return spec?.props[key] as T | undefined;
}

/** Omits any prop whose value deep-equals the block spec's default (both
 * stored JSON and in-memory Block/BlockRecord.props omit default-equal values). */
export function normalizeProps(props: Record<string, Json> | undefined, defaults: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  const src = props ?? {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(defaults, k) && deepEqual(v, defaults[k])) continue;
    out[k] = v;
  }
  return out;
}

// Link marks are untrusted input (paste, fromMarkdown,
// stored JSON from an older/foreign client) -- sanitize here so an invalid
// href can never reach toHTML/DOM render. An invalid href drops the mark
// (keeps the run's text), it doesn't drop the whole run.
function sanitizeLinkMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks || marks.length === 0) return marks;
  const out: Mark[] = [];
  for (const m of marks) {
    if (m.type === "fontFamily" || m.type === "fontSize") {
      // untrusted value that reaches a CSS declaration: keep only a sanitized one
      const key = m.type === "fontFamily" ? "family" : "size";
      const clean = m.type === "fontFamily" ? sanitizeFontFamily(m.attrs?.[key]) : sanitizeFontSize(m.attrs?.[key]);
      if (clean !== null) out.push(clean === m.attrs?.[key] ? m : { ...m, attrs: { ...m.attrs, [key]: clean } });
      continue;
    }
    if (m.type !== "link") {
      out.push(m);
      continue;
    }
    const href = typeof m.attrs?.href === "string" ? m.attrs.href : "";
    const safe = sanitizeUrl(href, "link");
    if (safe === null) continue; // drop the mark, keep the text
    out.push(safe === href ? m : { ...m, attrs: { ...m.attrs, href: safe } });
  }
  return out;
}

// Sanitizes any prop that renders as a live URL so an
// unsafe scheme never reaches the DOM or survives a round trip -- shared by
// normalizeBlockDeep (doc-level) and store/ops.ts's opInsertBlock/opSetProps
// (a single op's own write path). Also covers embed.url (the
// link-card href for x/link providers, and the source url stored alongside
// an iframe embed) -- same treatment as image.src, one shared choke point.
function sanitizeUrlProp(props: Record<string, Json>, key: string, kind: "link" | "image"): Record<string, Json> {
  if (typeof props[key] !== "string") return props;
  const safe = sanitizeUrl(props[key] as string, kind);
  if (safe === props[key]) return props;
  const out = { ...props };
  if (!safe) delete out[key];
  else out[key] = safe;
  return out;
}

/** Block-level presentation props every block may carry (see view/dom.ts TEXT_ALIGN_ATTR). */
export const TEXT_ALIGN_VALUES = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGN_VALUES)[number];
const BLOCK_COLOR_TOKENS: readonly string[] = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

/** Drops an out-of-whitelist `textAlign`/`textColor`/`backgroundColor` (stored JSON is untrusted;
 * the values reach DOM attributes and CSS selectors). */
function sanitizeStyleProps(props: Record<string, Json>): Record<string, Json> {
  let out = props;
  const drop = (key: string, ok: readonly string[]) => {
    if (!(key in out)) return;
    const v = out[key];
    if (typeof v === "string" && ok.includes(v)) return;
    if (out === props) out = { ...props };
    delete out[key];
  };
  drop("textAlign", TEXT_ALIGN_VALUES);
  drop("textColor", BLOCK_COLOR_TOKENS);
  drop("backgroundColor", BLOCK_COLOR_TOKENS);
  return out;
}

export function sanitizeBlockProps(type: string, props: Record<string, Json>): Record<string, Json> {
  props = sanitizeStyleProps(props);
  if (type === "image" || type === "attachment") return sanitizeUrlProp(props, "src", "image");
  if (type === "embed") return sanitizeUrlProp(props, "url", "link");
  return props;
}

function normalizeMarks(marks: Mark[] | undefined, registry: Registry): Mark[] | undefined {
  const sanitized = sanitizeLinkMarks(marks);
  if (!sanitized || sanitized.length === 0) return undefined;
  const seen = new Map<string, Mark>();
  for (const m of sanitized) {
    seen.set(canonicalStringify(m), m);
  }
  const deduped = [...seen.values()];
  deduped.sort((a, b) => {
    const oa = registry.markOrder.get(a.type) ?? Number.MAX_SAFE_INTEGER;
    const ob = registry.markOrder.get(b.type) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return canonicalStringify(a) < canonicalStringify(b) ? -1 : 1;
  });
  return deduped.length ? deduped : undefined;
}

/** Merges adjacent text runs with equal (normalized) marks, drops empty runs,
 * sorts/dedupes each run's marks. Non-text inlines (mention, etc.) pass through. */
export function normalizeInline(
  inlines: Inline[] | undefined,
  registry: Registry,
  opts: { stripMarks?: boolean } = {},
): Inline[] {
  const list = inlines ?? [];
  const step1: Inline[] = list.map((inl) => {
    if (isText(inl)) {
      const marks = opts.stripMarks ? undefined : normalizeMarks(inl.marks, registry);
      const t: TextInline = marks ? { type: "text", text: inl.text, marks } : { type: "text", text: inl.text };
      return t;
    }
    return inl;
  });

  const merged: Inline[] = [];
  for (const inl of step1) {
    const prev = merged[merged.length - 1];
    if (isText(inl) && prev && isText(prev)) {
      const prevKey = canonicalStringify(prev.marks ?? []);
      const curKey = canonicalStringify(inl.marks ?? []);
      if (prevKey === curKey) {
        prev.text += inl.text;
        continue;
      }
    }
    merged.push(inl);
  }

  return merged.filter((inl) => !(isText(inl) && inl.text === ""));
}

/** Whether `childType` may live under a container of `containerType` with the
 * given `containerChildren` allow-list (checks both directions: the container's
 * children allow-list AND the child's own `parent` allow-list). Exported for
 * reuse by the store's indent/outdent (they need the same admission rule). */
export function admit(
  childType: string,
  childSpec: BlockSpec | undefined,
  containerType: string | null,
  containerChildren: ChildrenKind,
): boolean {
  if (containerChildren === "none") return false;
  if (Array.isArray(containerChildren) && !containerChildren.includes(childType)) return false;
  if (childSpec?.parent && (containerType === null || !childSpec.parent.includes(containerType))) return false;
  return true;
}

// Precondition fix: a doc must always end somewhere a text
// cursor can be placed. Any block whose own content kind isn't 'inline'/'code'
// has no such slot at its end -- this covers true leaf voids (content:'none',
// children:'none', e.g. divider/image) AND container-only blocks like table
// (content:'none', children:['tableRow']): a doc ending in a table needs the
// same trailing paragraph a doc ending in a divider needs.
function endsWithoutCursorSlot(spec: BlockSpec): boolean {
  return spec.content !== "inline" && spec.content !== "code";
}

interface NormResult {
  block: Block;
  /** This block's own children rejected by its schema; the caller must place
   * them as this block's following siblings (re-testing them there). */
  overflow: Block[];
}

function normalizeBlockDeep(raw: Block, registry: Registry): NormResult {
  const spec = registry.blocks.get(raw.type);
  if (!spec) {
    // Unknown type: preserve opaquely. We don't know its constraints, so we
    // don't repair its subtree structurally -- just pass it through.
    return { block: { ...raw }, overflow: [] };
  }

  const props = sanitizeBlockProps(raw.type, normalizeProps(raw.props, spec.props));
  const block: Block = { id: raw.id, type: raw.type, props };

  if (spec.content === "inline") {
    block.content = normalizeInline(raw.content, registry);
  } else if (spec.content === "code") {
    block.content = normalizeInline(raw.content, registry, { stripMarks: true });
  }
  // content omitted entirely when spec.content === 'none'

  let overflow: Block[] = [];
  if (spec.children === "none") {
    if (raw.children && raw.children.length) {
      // Nothing is allowed to nest here at all -- everything bubbles up.
      // a child that ISN'T even admissible under a permissive
      // "any" policy (e.g. a stray tableRow, parent-constrained to "table")
      // lands in that inner call's own `overflow`, not `kept` -- it must
      // still bubble up too, or it's silently discarded instead of reaching
      // repairRootOrphans/the next real parent up.
      const { kept, overflow: rejected } = normalizeList(raw.children, raw.type, "any", registry);
      overflow = [...kept, ...rejected];
    }
  } else {
    const { kept, overflow: childOverflow } = normalizeList(raw.children ?? [], raw.type, spec.children, registry);
    if (kept.length) block.children = raw.type === "table" ? padTableRows(kept, registry) : kept;
    overflow = childOverflow;
  }

  return { block, overflow };
}

function normalizeList(
  rawList: Block[],
  containerType: string | null,
  containerChildren: ChildrenKind,
  registry: Registry,
): { kept: Block[]; overflow: Block[] } {
  const kept: Block[] = [];
  const overflow: Block[] = [];
  for (const raw of rawList) {
    const spec = registry.blocks.get(raw.type);
    const { block, overflow: childOverflow } = normalizeBlockDeep(raw, registry);
    const ok = !spec || admit(raw.type, spec, containerType, containerChildren);
    if (ok) {
      kept.push(block);
      for (const co of childOverflow) {
        const coSpec = registry.blocks.get(co.type);
        if (!coSpec || admit(co.type, coSpec, containerType, containerChildren)) kept.push(co);
        else overflow.push(co);
      }
    } else {
      overflow.push(block, ...childOverflow);
    }
  }
  return { kept, overflow };
}

// a tableRow's childIds list only the cells that are their own
// ANCHOR (see the grid model in store/table.ts) -- padding
// by childIds COUNT (the old body here) is span-unaware and corrupts any
// merged table on every reload (phantom cells inserted at positions a span
// already covers). `blockTableGrid` below is the same HTML-table-layout
// algorithm as store/table.ts's `tableGrid`/`tableFragmentGrid`, reimplemented
// over a plain (already schema-normalized) Block tree -- this runs from
// normalizeDoc, store-free and DOM-free, before any Store exists (fromJSON/
// fromHTML/fromMarkdown/paste all funnel through here).
const MAX_SPAN = 100;
function clampSpanValue(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_SPAN);
}

interface BlockGridSlot {
  cell: Block;
  anchor: [number, number];
  isAnchor: boolean;
  colspan: number;
  rowspan: number;
}

/** Span-aware grid over a table's raw (already schema-normalized) rows.
 * a colspan is ALSO clamped to the table's own "natural" width (the
 * widest row's raw cell count) -- store/table.ts's tableGrid only clamps
 * rowspan against the row count (an independent, already-known quantity);
 * colspan has no such bound of its own, so a hostile colspan (e.g. 99999,
 * already capped to MAX_SPAN by clampSpanValue) would otherwise still blow
 * the grid out to MAX_SPAN columns. Two guards keep this from squeezing a
 * LEGITIMATE merge:
 *  - only engaged with 2+ rows -- a single-row table has no OTHER row to
 *    measure a "natural" width against (a table-serde test pins a single-row
 *    `colspan="99999"` cell clamping to exactly 100, not 1).
 *  - only applied to a row that itself has 2+ raw cells of its own -- a row
 *    consisting of just ONE (possibly wide) cell is exactly what a genuine
 *    colspan/rowspan merge looks like from the raw-childIds side (fewer,
 *    wider cells is the whole point of colspan), so its own raw count of 1
 *    is never treated as a width ceiling for itself (a copy/paste fragment of
 *    a merged 2x2 region -- one cell, colspan=2 rowspan=2 -- must round-trip
 *    unclamped; only a row that ALSO carries independent normal-width
 *    evidence, i.e. 2+ cells, ever constrains another row's span). */
function blockTableGrid(rows: Block[], registry: Registry): (BlockGridSlot | null)[][] {
  const naturalWidth = rows.length > 1 ? rows.reduce((m, r) => Math.max(m, (r.children ?? []).length), 0) : 0;
  const grid: (BlockGridSlot | null)[][] = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const rowChildren = row.children ?? [];
    const clampColspan = naturalWidth > 0 && rowChildren.length >= 2;
    let col = 0;
    for (const cellBlock of rowChildren) {
      while (grid[r]![col]) col++;
      const rawColspan = clampSpanValue(getProp<number>(cellBlock, "colspan", registry));
      const colspan = clampColspan ? Math.max(1, Math.min(rawColspan, naturalWidth - col)) : rawColspan;
      const rowspan = Math.min(clampSpanValue(getProp<number>(cellBlock, "rowspan", registry)), rows.length - r);
      for (let rr = r; rr < r + rowspan; rr++) {
        (grid[rr] ??= []);
        for (let cc = col; cc < col + colspan; cc++) {
          grid[rr]![cc] = { cell: cellBlock, anchor: [r, col], isAnchor: rr === r && cc === col, colspan, rowspan };
        }
      }
      col += colspan;
    }
  }
  const width = grid.reduce((m, row) => Math.max(m, row.length), 0);
  for (const row of grid) for (let c = 0; c < width; c++) if (row[c] === undefined) row[c] = null;
  return grid;
}

function padTableRows(rows: Block[], registry: Registry): Block[] {
  const grid = blockTableGrid(rows, registry);
  return rows.map((row, r) => {
    const gridRow = grid[r] ?? [];
    const padded: Block[] = [];
    for (const slot of gridRow) {
      if (slot === null) {
        padded.push({ id: newId(), type: "tableCell", props: {}, content: [] }); // genuine hole
        continue;
      }
      if (!slot.isAnchor) continue; // covered by another cell's span -- no block of its own
      const cell = slot.cell;
      const curColspan = getProp<number>(cell, "colspan", registry) ?? 1;
      const curRowspan = getProp<number>(cell, "rowspan", registry) ?? 1;
      if (curColspan === slot.colspan && curRowspan === slot.rowspan) {
        padded.push(cell);
        continue;
      }
      // A hostile/oversized span got clamped above -- write the clamped value
      // back so the stored prop matches the grid it was just placed into.
      const props = { ...cell.props };
      if (slot.colspan === 1) delete props.colspan;
      else props.colspan = slot.colspan;
      if (slot.rowspan === 1) delete props.rowspan;
      else props.rowspan = slot.rowspan;
      padded.push({ ...cell, props });
    }
    return { ...row, children: padded };
  });
}

// normalizeList's admit() check already keeps a parent-constrained
// block (tableRow/tableCell) OUT of `kept` at the root -- it lands in
// `overflow` instead, which normalizeDoc used to append AS-IS, leaving a
// structurally invalid doc (validateDoc: parent-violation). Repairs each
// orphan into something root-legal instead of merely relocating it: a bare
// tableCell becomes a paragraph carrying its own content; one or more
// consecutive bare tableRows are wrapped together in a single fresh table.
function repairRootOrphans(blocks: Block[], registry: Registry): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type === "tableCell") {
      out.push({ id: b.id, type: "paragraph", props: {}, content: b.content ?? [] });
      continue;
    }
    if (b.type === "tableRow") {
      const rows: Block[] = [b];
      while (blocks[i + 1]?.type === "tableRow") rows.push(blocks[++i]!);
      out.push({ id: newId(), type: "table", props: {}, children: padTableRows(rows, registry) });
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Normalizes a single block deeply (props/content/children). Cross-boundary
 * lifting needs sibling-list context, so use `normalizeDoc` for full repair;
 * this is the per-block piece it's built from. */
export function normalizeBlock(block: Block, registry: Registry): Block {
  return normalizeBlockDeep(block, registry).block;
}

function isVoidBlock(block: Block, registry: Registry): boolean {
  const spec = registry.blocks.get(block.type);
  if (!spec) return false;
  return endsWithoutCursorSlot(spec);
}

/** Normalizes an entire doc: schema defaults, mark ordering, structural
 * repair (table padding, disallowed-child lifting, trailing paragraph).
 * Idempotent: normalizeDoc(normalizeDoc(doc, r), r) deep-equals normalizeDoc(doc, r). */
export function normalizeDoc(doc: Doc, registry: Registry): Doc {
  const { kept, overflow } = normalizeList(doc.blocks, null, "any", registry);
  // Root has no further parent to bubble into -- append overflow rather than lose content.
  let blocks = repairRootOrphans(kept.concat(overflow), registry);
  if (blocks.length === 0 || isVoidBlock(blocks[blocks.length - 1]!, registry)) {
    blocks = [...blocks, { id: newId(), type: "paragraph", props: {}, content: [] }];
  }
  return { version: doc.version, blocks };
}
