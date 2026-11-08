// Inline range / widget decorations: view-only visuals layered on a text block's content without
// touching the document model (suggestion-mode diffs, search hits, AI draft highlights ...).
//
// Why DOM wrapping and not the CSS Custom Highlight API (which highlight.ts uses for code):
// a decoration may carry arbitrary `attrs`/`class` and a widget is real DOM, neither of which a
// Highlight range can express. Selection and IME safety come from three rules instead:
//   1. a range decoration is a plain `<span data-jul-editor-deco>` with no `data-mark`, which
//      selection.ts (measure/domFromPoint) and inline-dom.ts (readContentFromDOM) already treat as
//      a transparent wrapper, exactly like a bare element around text;
//   2. a widget is `<span data-jul-editor-widget contenteditable=false>`, skipped (zero length)
//      by all of those readers, and excluded from the edit pipeline like a void (dom.ts isInsideVoid);
//   3. render.ts never patches a decorated content div in place: it rebuilds the pristine DOM from
//      the model first (so `runNodes` stays valid) and only then re-applies decorations, and it
//      does nothing at all to the block that is under IME composition.
// The model, undo history and serialization never see any of this.

import { isText } from "../model/canonical.js";
import type { Inline } from "../model/types.js";
import { DECORATION_SPAN_ATTR, MENTION_ATTR, WIDGET_ATTR } from "./dom.js";

/** Highlights `[from, to)` (UTF-16 offsets into the block's text, a mention counting as 1). */
export interface RangeDecoration {
  blockId: string;
  from: number;
  to: number;
  /** Space separated class tokens; anything outside [A-Za-z0-9_-] is dropped. */
  class?: string;
  /** Only `data-*`, `aria-*`, `title` and `role` are written; others are ignored. */
  attrs?: Record<string, string>;
}

/** Inserts a non-editable DOM widget at `offset` (zero-width for the model and for selection). */
export interface WidgetDecoration {
  blockId: string;
  offset: number;
  /** Called every time the block's decorations are (re)applied; return fresh DOM each call. */
  render(): HTMLElement;
}

export type Decoration = RangeDecoration | WidgetDecoration;

export function isWidgetDecoration(d: Decoration): d is WidgetDecoration {
  return typeof (d as WidgetDecoration).render === "function";
}

const ATTR_NAME = /^(data-[a-z0-9-]+|aria-[a-z0-9-]+|title|role)$/;
const CLASS_TOKEN = /[^A-Za-z0-9_-]/g;

function sanitizeClass(value: string | undefined): string {
  if (!value) return "";
  return value.split(/\s+/).map((t) => t.replace(CLASS_TOKEN, "")).filter(Boolean).join(" ");
}

/** Per-view store of decorations, grouped by caller `key` so independent features (diff, search,
 * AI) set and clear theirs without touching each other. `forBlock` returns an array whose IDENTITY
 * is stable until that block's merged list changes, which render.ts uses as its dirty check. */
export class DecorationSet {
  private byKey = new Map<string, Decoration[]>();
  private merged = new Map<string, Decoration[]>();

  /** Replaces the list for `key`; returns the ids of every block whose merged list changed. */
  set(key: string, decorations: readonly Decoration[]): Set<string> {
    const affected = new Set<string>();
    for (const d of this.byKey.get(key) ?? []) affected.add(d.blockId);
    for (const d of decorations) affected.add(d.blockId);
    if (decorations.length === 0) this.byKey.delete(key);
    else this.byKey.set(key, [...decorations]);
    const changed = new Set<string>();
    for (const id of affected) {
      const next: Decoration[] = [];
      for (const list of this.byKey.values()) for (const d of list) if (d.blockId === id) next.push(d);
      const prev = this.merged.get(id);
      if (next.length === 0) {
        if (prev) {
          this.merged.delete(id);
          changed.add(id);
        }
      } else if (!prev || prev.length !== next.length || prev.some((p, i) => p !== next[i])) {
        this.merged.set(id, next);
        changed.add(id);
      }
    }
    return changed;
  }

  get(key: string): readonly Decoration[] {
    return this.byKey.get(key) ?? [];
  }

  forBlock(blockId: string): readonly Decoration[] | undefined {
    return this.merged.get(blockId);
  }
}

function makeSpan(d: RangeDecoration): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute(DECORATION_SPAN_ATTR, "");
  const cls = sanitizeClass(d.class);
  if (cls) span.setAttribute("class", cls);
  for (const [name, value] of Object.entries(d.attrs ?? {})) {
    if (ATTR_NAME.test(name)) span.setAttribute(name, String(value));
  }
  return span;
}

function makeWidget(d: WidgetDecoration): HTMLElement {
  const host = document.createElement("span");
  host.setAttribute(WIDGET_ATTR, "");
  host.setAttribute("contenteditable", "false");
  try {
    host.appendChild(d.render());
  } catch {
    // a widget bug must not break rendering the block
  }
  return host;
}

/** Applies `decorations` to a PRISTINE content div (freshly built by buildContentDOM; never call
 * this on an already decorated one). Splits text nodes at range boundaries and wraps each covered
 * piece in one span per covering decoration; inserts widgets at their offsets. */
export function applyDecorations(content: HTMLElement, inlines: readonly Inline[], decorations: readonly Decoration[]): void {
  let total = 0;
  for (const inl of inlines) total += isText(inl) ? inl.text.length : 1;
  const ranges: RangeDecoration[] = [];
  const widgets: WidgetDecoration[] = [];
  for (const d of decorations) {
    if (isWidgetDecoration(d)) widgets.push({ ...d, offset: Math.max(0, Math.min(total, Math.floor(d.offset))) });
    else {
      const from = Math.max(0, Math.min(total, Math.floor(d.from)));
      const to = Math.max(0, Math.min(total, Math.floor(d.to)));
      if (to > from) ranges.push({ ...d, from, to });
    }
  }
  if (ranges.length === 0 && widgets.length === 0) return;
  const widgetsAt = (offset: number) => widgets.filter((w) => w.offset === offset);
  const insertWidgetsBefore = (parent: Node, ref: Node | null, offset: number) => {
    for (const w of widgetsAt(offset)) parent.insertBefore(makeWidget(w), ref);
  };

  // wraps `node` (text or mention element) covering model offsets [start, end) in the spans of
  // every range covering the WHOLE piece (callers pre-split so a piece is never partially covered)
  const wrap = (node: Node, start: number, end: number): Node => {
    let out: Node = node;
    for (const r of ranges) {
      if (r.from <= start && r.to >= end) {
        const span = makeSpan(r);
        out.parentNode?.replaceChild(span, out);
        span.appendChild(out);
        out = span;
      }
    }
    return out;
  };

  let offset = 0;
  const handled = new Set<number>(); // widget offsets already inserted (a widget goes before the first thing at its offset)
  const flushWidgets = (parent: Node, ref: Node | null, at: number) => {
    if (handled.has(at)) return;
    handled.add(at);
    insertWidgetsBefore(parent, ref, at);
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      const len = text.data.length;
      const start = offset;
      const end = start + len;
      offset = end;
      if (len === 0) return;
      // cut points strictly inside (start, end)
      const cuts = new Set<number>();
      for (const r of ranges) {
        if (r.from > start && r.from < end) cuts.add(r.from);
        if (r.to > start && r.to < end) cuts.add(r.to);
      }
      for (const w of widgets) if (w.offset > start && w.offset < end) cuts.add(w.offset);
      const points = [start, ...[...cuts].sort((a, b) => a - b), end];
      const parent = text.parentNode!;
      const pieces: Array<{ node: Text; from: number; to: number }> = [];
      let rest: Text = text;
      for (let i = 1; i < points.length - 1; i++) {
        const tail = rest.splitText(points[i]! - points[i - 1]!);
        pieces.push({ node: rest, from: points[i - 1]!, to: points[i]! });
        rest = tail;
      }
      pieces.push({ node: rest, from: points[points.length - 2]!, to: end });
      for (const p of pieces) {
        flushWidgets(parent, p.node, p.from);
        wrap(p.node, p.from, p.to);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") return;
    if (el.hasAttribute(MENTION_ATTR)) {
      flushWidgets(el.parentNode!, el, offset);
      const start = offset;
      offset += 1;
      wrap(el, start, offset);
      return;
    }
    for (const child of Array.from(el.childNodes)) visit(child);
  };
  for (const child of Array.from(content.childNodes)) visit(child);

  // widgets at (or clamped to) the very end go before a trailing placeholder/newline <br>
  const leftover = widgets.filter((w) => !handled.has(w.offset));
  if (leftover.length) {
    const lastBr = Array.from(content.childNodes).reverse().find((c) => c.nodeName === "BR") ?? null;
    for (const w of leftover) content.insertBefore(makeWidget(w), lastBr);
  }
}
