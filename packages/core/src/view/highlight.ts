// P2: code block syntax highlighting via the CSS Custom Highlight API
// (https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API).
// Headless and IME-safe by construction: this module never mutates the DOM
// tree (no wrapping spans, no attribute writes) -- it only *reads* a
// `codeBlock`'s already-rendered content div (built by inline-dom.ts/render.ts,
// owned by other tasks) and registers plain `Range` objects into the
// browser's own (per-Document, global) `CSS.highlights` registry. Composition
// never sees a DOM write from here, so there's nothing to cancel.
//
// `CSS.highlights` is feature-detected: current Chromium, WebKit (Safari)
// and Firefox all support it (verified across all three Playwright
// browsers); an older engine without it means every method below is a
// no-op, never a throw.
//
// A `Highlighter` maps a code string + language tag to token ranges. jul-editor
// only ever registers highlight names from the FIXED, documented
// `HIGHLIGHT_TOKENS` list below (as `jul-editor-<token>`) -- a highlighter
// implementation (e.g. @jul-editor/plugins' lowlight adapter) is responsible for
// mapping its own token vocabulary onto this list; anything else is dropped
// so a host page's `::highlight(jul-editor-...)` CSS never has to guess at an
// open-ended set of names.

import { getProp } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import { plainTextOf } from "./inline-dom.js";
import { findContentEl } from "./dom.js";
import type { EditorState } from "../store/types.js";

export const HIGHLIGHT_TOKENS = [
  "keyword",
  "string",
  "comment",
  "number",
  "title",
  "function",
  "attr",
  "built_in",
  "type",
  "literal",
  "meta",
  "variable",
  "punctuation",
] as const;
export type HighlightToken = (typeof HIGHLIGHT_TOKENS)[number];

const TOKEN_SET: ReadonlySet<string> = new Set(HIGHLIGHT_TOKENS);

/** A UTF-16 [from, to) offset range into the plain code string, tagged with
 * one of `HIGHLIGHT_TOKENS`. A `token` outside that fixed set is dropped. */
export interface HighlightRange {
  from: number;
  to: number;
  token: string;
}

export interface Highlighter {
  highlight(code: string, language: string): HighlightRange[] | Promise<HighlightRange[]>;
}

const DEBOUNCE_MS = 50;

// TypeScript's bundled lib.dom.d.ts (as of 5.9) only models `Highlight` as a
// read-only `{priority, type, forEach}` bag and `HighlightRegistry` as a bare
// `{forEach}` -- neither exposes the real spec's Set-like (`add`/`delete`)
// and Map-like (`set`/`get`/`delete`) members `CSS.highlights.set(name, h)`/
// `h.add(range)` actually have at runtime. Rather than risk a global
// `declare global` augmentation colliding with another package's own lib
// typings, these two narrow local shapes are cast to at the two call sites
// that need them.
interface HighlightSet {
  add(range: Range): void;
  delete(range: Range): boolean;
}
interface HighlightRegistryMap {
  set(name: string, highlight: Highlight): void;
  get(name: string): Highlight | undefined;
}

function highlightApiSupported(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined" && typeof Highlight !== "undefined";
}

// --- Document-scoped Highlight registry -----------------------------------
// `CSS.highlights` is global per-Document, not per-element -- several
// createView/createEditor instances on the same page (or several codeBlocks
// in one editor) must contribute Ranges to the SAME `Highlight` object per
// token name without one instance's update ever deleting another's Ranges.
// `contributions` tracks exactly which Range objects each (editor-instance,
// block-id) key has added, so `setContribution` can remove precisely those
// (and only those) before adding the replacement set.
interface DocRegistry {
  highlights: Map<string, Highlight>;
  contributions: Map<string, Map<string, Range[]>>;
}
const registries = new WeakMap<Document, DocRegistry>();

function getRegistry(doc: Document): DocRegistry {
  let reg = registries.get(doc);
  if (!reg) {
    reg = { highlights: new Map(), contributions: new Map() };
    registries.set(doc, reg);
  }
  return reg;
}

function highlightFor(reg: DocRegistry, token: string): Highlight {
  let h = reg.highlights.get(token);
  if (!h) {
    h = new Highlight();
    reg.highlights.set(token, h);
    (CSS.highlights as unknown as HighlightRegistryMap).set(`jul-editor-${token}`, h);
  }
  return h;
}

function setContribution(doc: Document, key: string, next: Map<string, Range[]>): void {
  const reg = getRegistry(doc);
  const prev = reg.contributions.get(key);
  if (prev) {
    for (const [token, ranges] of prev) {
      const h = reg.highlights.get(token);
      if (!h) continue;
      const set = h as unknown as HighlightSet;
      for (const r of ranges) set.delete(r);
    }
  }
  for (const [token, ranges] of next) {
    const h = highlightFor(reg, token) as unknown as HighlightSet;
    for (const r of ranges) h.add(r);
  }
  if (next.size > 0) reg.contributions.set(key, next);
  else reg.contributions.delete(key);
}

function clearContribution(doc: Document, key: string): void {
  setContribution(doc, key, new Map());
}

function clearAllForInstance(doc: Document, instanceKey: string): void {
  const reg = registries.get(doc);
  if (!reg) return;
  const prefix = `${instanceKey}:`;
  for (const key of Array.from(reg.contributions.keys())) {
    if (key.startsWith(prefix)) clearContribution(doc, key);
  }
}

// --- Offset -> DOM Range mapping -------------------------------------------

export interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

/** Flattens a content div's Text nodes in document order, each tagged with
 * its [start,end) offset into the div's own plain text (matching
 * `plainTextOf`'s concatenation order) -- mirrors render.ts's `domPlainText`
 * walk (skip `<br>`, recurse into everything else) so offsets always agree
 * with what was actually rendered, whether the code has marks/mentions
 * wrapping it or not. */
export function collectTextNodes(root: HTMLElement): TextNodeSpan[] {
  const out: TextNodeSpan[] = [];
  let pos = 0;
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      if (len > 0) out.push({ node: node as Text, start: pos, end: pos + len });
      pos += len;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") return;
      for (const c of Array.from(el.childNodes)) walk(c);
    }
  }
  for (const c of Array.from(root.childNodes)) walk(c);
  return out;
}

function locate(spans: readonly TextNodeSpan[], offset: number): { node: Text; offset: number } | null {
  for (const s of spans) {
    if (offset >= s.start && offset <= s.end) return { node: s.node, offset: offset - s.start };
  }
  return null;
}

/** Builds a real DOM `Range` for a [from,to) plain-text offset pair, possibly
 * spanning several Text nodes (adjacent marked runs). Returns null for an
 * empty/out-of-bounds range rather than throwing -- a highlighter's own
 * ranges are untrusted input the DOM may have already moved on from by the
 * time this runs (async highlight, debounced against a live-edited block). */
export function mapRangeToDOM(doc: Document, spans: readonly TextNodeSpan[], from: number, to: number): Range | null {
  if (from >= to) return null;
  const start = locate(spans, from);
  const end = locate(spans, to);
  if (!start || !end) return null;
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  if (range.collapsed) return null;
  return range;
}

// --- Controller -------------------------------------------------------------

export interface HighlightController {
  /** Replaces (or, with `null`, clears) the active highlighter and
   * re-highlights every codeBlock currently in the doc. */
  setHighlighter(highlighter: Highlighter | null): void;
  /** Call after every commit with its `changedIds` (undefined for a full
   * reset e.g. setDoc) -- (re)schedules a debounced highlight pass for every
   * touched codeBlock, and clears highlighting for one that was removed. */
  onCommit(changedIds: ReadonlySet<string> | undefined): void;
  destroy(): void;
}

export interface CreateHighlightControllerOptions {
  root: HTMLElement;
  registry: Registry;
  getState: () => EditorState;
  /** True while `blockId` is under active IME composition -- a pass is
   * skipped entirely for that block until composition ends (the DOM's own
   * text node boundaries are in flux, and touching selection/DOM mid-
   * composition is never safe). */
  isComposing: (blockId: string) => boolean;
}

let nextInstanceId = 0;

export function createHighlightController(opts: CreateHighlightControllerOptions): HighlightController {
  const { root, registry, getState, isComposing } = opts;
  const instanceKey = `hl${++nextInstanceId}`;
  let highlighter: Highlighter | null = null;
  let destroyed = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const seq = new Map<string, number>(); // per-block: invalidates a stale (superseded or out-of-order) async result

  function isCodeBlock(type: string): boolean {
    return registry.blocks.get(type)?.content === "code";
  }

  function codeBlockIds(): string[] {
    const ids: string[] = [];
    for (const [id, rec] of getState().store.records) if (isCodeBlock(rec.type)) ids.push(id);
    return ids;
  }

  function clearTimer(id: string): void {
    const t = timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(id);
    }
  }

  function clearBlock(id: string): void {
    clearTimer(id);
    clearContribution(root.ownerDocument, `${instanceKey}:${id}`);
  }

  function schedule(id: string): void {
    if (destroyed || !highlighter || !highlightApiSupported()) return;
    clearTimer(id);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        run(id);
      }, DEBOUNCE_MS),
    );
  }

  function run(id: string): void {
    if (destroyed || !highlighter) return;
    // a scheduled pass that lands mid-IME-composition can't touch the
    // DOM (the browser's own composition owns it) -- reschedule instead of
    // just dropping it, so the FIRST retry after compositionend actually
    // re-highlights the composed text (nothing else re-triggers a schedule
    // for this block: compositionend's own sync can be a genuine no-op
    // commit, e.g. when the DOM already matched, so its changedIds can end
    // up empty).
    if (isComposing(id)) {
      schedule(id);
      return;
    }
    const rec = getState().store.records.get(id);
    if (!rec || !isCodeBlock(rec.type)) return;
    const code = plainTextOf(rec.content ?? []);
    const language = (getProp({ id: rec.id, type: rec.type, props: rec.props }, "language", registry) as string | undefined) ?? "";
    const mySeq = (seq.get(id) ?? 0) + 1;
    seq.set(id, mySeq);
    const activeHighlighter = highlighter;
    Promise.resolve(activeHighlighter.highlight(code, language))
      .then((ranges) => {
        if (destroyed || highlighter !== activeHighlighter || seq.get(id) !== mySeq) return; // superseded
        applyRanges(id, ranges);
      })
      .catch(() => {
        // A broken/throwing highlighter must never break editing --
        // it just leaves this block unhighlighted.
      });
  }

  function applyRanges(id: string, ranges: HighlightRange[]): void {
    const key = `${instanceKey}:${id}`;
    const doc = root.ownerDocument;
    if (!highlightApiSupported()) {
      clearContribution(doc, key);
      return;
    }
    const contentEl = findContentEl(root, id);
    if (!contentEl) {
      clearContribution(doc, key);
      return;
    }
    const spans = collectTextNodes(contentEl);
    const byToken = new Map<string, Range[]>();
    for (const r of ranges) {
      if (!TOKEN_SET.has(r.token)) continue;
      const range = mapRangeToDOM(doc, spans, r.from, r.to);
      if (!range) continue;
      const list = byToken.get(r.token) ?? [];
      list.push(range);
      byToken.set(r.token, list);
    }
    setContribution(doc, key, byToken);
  }

  return {
    setHighlighter(next) {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      highlighter = next;
      if (!next) {
        clearAllForInstance(root.ownerDocument, instanceKey);
        return;
      }
      for (const id of codeBlockIds()) schedule(id);
    },
    onCommit(changedIds) {
      if (!highlighter) return;
      if (!changedIds) {
        for (const id of codeBlockIds()) schedule(id);
        return;
      }
      const { store } = getState();
      for (const id of changedIds) {
        const rec = store.records.get(id);
        if (!rec) {
          clearBlock(id);
          continue;
        }
        // the reverse transition (a highlighted codeBlock's type just
        // flipped to something else) must clear its stale ranges too -- only
        // a MISSING record cleared before this, so a codeBlock->paragraph
        // conversion left its old Ranges registered forever.
        if (isCodeBlock(rec.type)) schedule(id);
        else clearBlock(id);
      }
    },
    destroy() {
      destroyed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      clearAllForInstance(root.ownerDocument, instanceKey);
    },
  };
}
