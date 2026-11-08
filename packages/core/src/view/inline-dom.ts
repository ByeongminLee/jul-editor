// Inline runs (Inline[]) <-> DOM, inside one block's `data-jul-editor-content` div.
// Build: text -> bare Text node, marks -> nested strong/em/s/code/a, mention
// -> an EDITABLE span[data-mention].
// Read: the reverse, used by syncBlockFromDOM (ime.ts) to absorb whatever the
// browser actually put in the DOM (composition, autocomplete, spellcheck...).

import { isText, normalizeInline } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Inline, Mark, MentionInline } from "../model/types.js";
import { fontFamilyCss, sanitizeFontFamily, sanitizeFontSize } from "../model/font-style.js";
import { sanitizeUrl } from "../model/url.js";
import {
  LABEL_ATTR,
  MARK_TAG_TO_TYPE,
  MARK_TYPE_TO_TAG,
  MENTION_ATTR,
  MENTION_ID_ATTR,
  MENTION_KIND_ATTR,
  PLACEHOLDER_ATTR,
  WIDGET_ATTR,
} from "./dom.js";

/** Identity key for "is this run the same shape as before" (render.ts's
 * update-nodeValue fast path): same marks/mention-identity, text length may differ. */
export function runKey(inl: Inline): string {
  if (isText(inl)) return `t:${(inl.marks ?? []).map((m) => `${m.type}:${JSON.stringify(m.attrs ?? {})}`).join(",")}`;
  if (inl.type === "mention") {
    const a = (inl as MentionInline).attrs;
    return `mention:${a.kind}:${a.id}`;
  }
  return `g:${inl.type}:${JSON.stringify((inl as { attrs?: unknown }).attrs ?? {})}`;
}

/** Prefix of the DOM attributes carrying a generic (span-rendered) mark's string attrs. */
export const MARK_ATTR_PREFIX = "data-mark-";

export function displayMention(inl: MentionInline): string {
  return inl.attrs.kind === "tag" ? `#${inl.attrs.label}` : inl.attrs.label;
}

export function plainTextOf(inlines: Inline[]): string {
  return inlines.map((inl) => (isText(inl) ? inl.text : inl.type === "mention" ? displayMention(inl as MentionInline) : "")).join("");
}

function textNodeFor(text: string, marks: Mark[] | undefined, runNodes: (Text | HTMLElement)[]): Node {
  const t = document.createTextNode(text);
  runNodes.push(t);
  if (!marks || marks.length === 0) return t;
  let inner: Node = t;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;
    const tag = MARK_TYPE_TO_TAG[mark.type] ?? "span";
    const el = document.createElement(tag);
    if (mark.type === "link") {
      // Defense in depth: the model write paths (normalizeDoc/opInsertBlock/
      // opReplaceContent) already sanitize a link's href, but the DOM write is
      // the last line of defense against a javascript: URL actually
      // executing -- never trust that every path upstream got it right.
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      el.setAttribute("href", sanitizeUrl(href, "link") ?? "");
    } else if (mark.type === "highlight") {
      // only a non-default color needs an attribute at all (mirrors
      // serde/builtins-serde.ts's html.attrs -- a plain <mark> IS already a
      // legitimate default-color highlight).
      const color = String(mark.attrs?.color ?? "default");
      if (color !== "default") el.setAttribute("data-jul-editor-highlight", color);
    } else if (mark.type === "textColor") {
      el.setAttribute("data-jul-editor-color", String(mark.attrs?.color ?? "default"));
    }
    if (mark.type === "fontFamily") {
      // visible effect of the mark; the value is re-sanitized right at the DOM write
      const family = sanitizeFontFamily(mark.attrs?.family);
      if (family) el.style.fontFamily = fontFamilyCss(family);
    } else if (mark.type === "fontSize") {
      const size = sanitizeFontSize(mark.attrs?.size);
      if (size) el.style.fontSize = size;
    }
    if (tag === "span") {
      el.setAttribute("data-mark", mark.type); // future defineMark w/o a fixed tag
      // A generic mark's own attrs (e.g. a comment mark's threadId) ride along as
      // `data-mark-<kebab-name>` so host CSS/JS can query them AND readContentFromDOM
      // can restore them. textColor keeps its dedicated attribute above. Only
      // string values survive the round trip (other JSON values are skipped).
      if (mark.type !== "textColor") {
        for (const [k, v] of Object.entries(mark.attrs ?? {})) {
          if (typeof v === "string") el.setAttribute(MARK_ATTR_PREFIX + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), v);
        }
      }
    }
    el.appendChild(inner);
    inner = el;
  }
  return inner;
}

function mentionNodeFor(inl: MentionInline, runNodes: (Text | HTMLElement)[]): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute(MENTION_ATTR, "");
  span.setAttribute(MENTION_KIND_ATTR, inl.attrs.kind);
  span.setAttribute(MENTION_ID_ATTR, inl.attrs.id);
  span.setAttribute(LABEL_ATTR, inl.attrs.label);
  span.textContent = displayMention(inl);
  runNodes.push(span);
  return span;
}

export interface BuiltContent {
  nodes: Node[];
  runNodes: (Text | HTMLElement)[];
}

/** Builds fresh DOM for a block's content. Empty content renders a placeholder
 * `<br>`; a trailing '\n' in the plain text gets one more trailing `<br>`.
 * Both are ignored by readContentFromDOM. */
export function buildContentDOM(inlines: Inline[]): BuiltContent {
  const out: BuiltContent = { nodes: [], runNodes: [] };
  for (const inl of inlines) {
    if (isText(inl)) out.nodes.push(textNodeFor(inl.text, inl.marks, out.runNodes));
    else if (inl.type === "mention") out.nodes.push(mentionNodeFor(inl as MentionInline, out.runNodes));
    else {
      // GenericInline (a future defineInline): atomic, rendered as its own tag.
      const span = document.createElement("span");
      span.setAttribute("data-inline", inl.type);
      out.runNodes.push(span);
      out.nodes.push(span);
    }
  }
  if (out.nodes.length === 0) {
    const br = document.createElement("br");
    br.setAttribute(PLACEHOLDER_ATTR, "");
    out.nodes.push(br);
  } else if (plainTextOf(inlines).endsWith("\n")) {
    out.nodes.push(document.createElement("br"));
  }
  return out;
}

/** Splits a mention span's actual text against its stored label: any text the
 * browser attached inside the span (composition, typing) is extracted as a
 * text run placed AFTER the mention -- the mention itself is restored to its
 * original label (mentions stay atomic; the DOM reader never
 * lets typed text merge into one). */
function readMentionSpan(el: HTMLElement, prior: MentionInline | undefined): Inline[] {
  const kind = el.getAttribute(MENTION_KIND_ATTR) ?? prior?.attrs.kind ?? "";
  const id = el.getAttribute(MENTION_ID_ATTR) ?? prior?.attrs.id ?? "";
  const label = el.getAttribute(LABEL_ATTR) ?? prior?.attrs.label ?? "";
  const actual = el.textContent ?? "";
  const mention: MentionInline = { type: "mention", attrs: { kind, id, label } };
  const displayed = displayMention(mention);
  if (actual === displayed) return [mention];
  let p = 0;
  while (p < displayed.length && p < actual.length && displayed[p] === actual[p]) p++;
  let s = 0;
  const maxS = Math.min(displayed.length - p, actual.length - p);
  while (s < maxS && displayed[displayed.length - 1 - s] === actual[actual.length - 1 - s]) s++;
  const inserted = actual.slice(p, actual.length - s);
  return inserted ? [mention, { type: "text", text: inserted }] : [mention];
}

/** rebuilds the Mark (with its dynamic attrs, if any) for a tag/
 * data-mark-driven `type` found while reading the live DOM back -- link's
 * href and highlight/textColor's color token are the only marks with
 * per-instance attrs today; anything else is a bare `{type}`. */
function markFor(type: string, el: HTMLElement): Mark {
  if (type === "link") return { type: "link", attrs: { href: el.getAttribute("href") ?? "" } };
  if (type === "highlight") {
    const color = el.getAttribute("data-jul-editor-highlight");
    return color ? { type: "highlight", attrs: { color } } : { type: "highlight" };
  }
  if (type === "textColor") {
    const color = el.getAttribute("data-jul-editor-color");
    return color ? { type: "textColor", attrs: { color } } : { type: "textColor" };
  }
  // generic mark: restore string attrs written by textNodeFor (data-mark-<kebab>)
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith(MARK_ATTR_PREFIX) && a.name.length > MARK_ATTR_PREFIX.length) {
      attrs[a.name.slice(MARK_ATTR_PREFIX.length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = a.value;
    }
  }
  return Object.keys(attrs).length ? { type, attrs } : { type };
}

/** Reads a content div's actual DOM back into Inline[] (the "absorb" side of
 * syncBlockFromDOM). `priorInlines` supplies a mention's kind/id/label
 * when the DOM's own data-* attributes were somehow lost (defensive only --
 * render.ts always sets them). Result is run through normalizeInline so a
 * browser-introduced split (e.g. two adjacent same-mark text nodes) collapses
 * back to canonical form before it's compared/committed. */
export function readContentFromDOM(contentEl: HTMLElement, registry: Registry, priorInlines: Inline[] | undefined): Inline[] {
  const priorMentions = new Map<string, MentionInline>();
  for (const inl of priorInlines ?? []) {
    if (inl.type === "mention") priorMentions.set((inl as MentionInline).attrs.id, inl as MentionInline);
  }
  const raw: Inline[] = [];
  function walk(node: Node, marks: Mark[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (text) raw.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR" || el.hasAttribute(WIDGET_ATTR)) return; // placeholder/trailing-newline marker or a decoration widget, not content
    if (el.hasAttribute(MENTION_ATTR)) {
      raw.push(...readMentionSpan(el, priorMentions.get(el.getAttribute(MENTION_ID_ATTR) ?? "")));
      return;
    }
    const markType = MARK_TAG_TO_TYPE[el.tagName] ?? (el.tagName === "SPAN" ? (el.getAttribute("data-mark") ?? undefined) : undefined);
    const nextMarks: Mark[] = markType ? [...marks, markFor(markType, el)] : marks;
    for (const child of Array.from(el.childNodes)) walk(child, nextMarks);
  }
  for (const child of Array.from(contentEl.childNodes)) walk(child, []);
  return normalizeInline(raw, registry);
}
