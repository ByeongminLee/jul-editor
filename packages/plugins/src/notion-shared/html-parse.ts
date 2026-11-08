// Helpers shared by the callout/toggle/columns fromHTML hooks. A BlockSpec.fromHTML.parse(el, ctx)
// only receives the matched element, not the serde walker, so nested content
// is converted by serializing the (already inert, parser-owned) subtree back
// to a string and feeding it through core's own fromHTML again. That keeps every
// sanitization rule (attribute allowlist, url checks, dropped tags) in ONE place.
import { fromHTML } from "@jul-editor/core/serde";
import type { Block, Inline, ParseCtx } from "@jul-editor/core";

/** A DOMParser stand-in that works inside a DOMParser-created document (whose
 * `defaultView` is null, so `new defaultView.DOMParser()` is not available):
 * `implementation.createHTMLDocument` is inert too (no scripts, no loads). */
function parserFor(el: Element) {
  const impl = el.ownerDocument.implementation;
  return {
    parseFromString(html: string): Document {
      const doc = impl.createHTMLDocument("");
      doc.body.innerHTML = html;
      return doc;
    },
  };
}

/** Child blocks of an element's inner HTML. */
export function blocksFromHTML(el: Element | null, ctx: ParseCtx): Block[] {
  if (!el || !el.innerHTML.trim()) return [];
  return fromHTML(el.innerHTML, { registry: ctx.registry, parser: parserFor(el) }).doc.blocks;
}

/** Inline content of an element's inner HTML (marks/mentions preserved). */
export function inlinesFromHTML(el: Element | null, ctx: ParseCtx): Inline[] {
  if (!el || !el.innerHTML.trim()) return [];
  const first = fromHTML(`<p>${el.innerHTML}</p>`, { registry: ctx.registry, parser: parserFor(el) }).doc.blocks[0];
  return first?.content ?? [];
}
