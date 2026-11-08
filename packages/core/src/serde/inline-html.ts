// Registry-driven inline rendering for HTML. Marks apply generically via
// MarkSpec.html (bold/italic/strike/code/a custom mark like highlight);
// "link" stays special-cased (dynamic href, needs sanitizeUrl).
import { isText } from "../model/canonical.js";
import type { RenderCtx, Registry } from "../model/schema.js";
import type { Inline, TextInline } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";
import { escapeHtmlAttr, escapeHtmlText } from "./escape.js";

export function renderInlineListHtml(content: Inline[] | undefined, registry: Registry, ctx: RenderCtx): string {
  return (content ?? []).map((inl) => renderInlineNodeHtml(inl, registry, ctx)).join("");
}

function renderInlineNodeHtml(inl: Inline, registry: Registry, ctx: RenderCtx): string {
  if (isText(inl)) return renderTextRunHtml(inl, registry);
  const spec = registry.inlines.get(inl.type);
  if (spec?.toHTML) return spec.toHTML(inl, ctx);
  return "";
}

function renderTextRunHtml(run: TextInline, registry: Registry): string {
  // a raw "\n" renders as (at most) a collapsed space in HTML and
  // fromHTML's own whitespace collapsing (collapseWs) erases it entirely --
  // <br> is the only HTML spelling of a hard break that survives both ways
  // (fromHTML's BR case already turns it back into a "\n" text run).
  let s = escapeHtmlText(run.text).replace(/\n/g, "<br>");
  const marks = run.marks ?? [];
  for (const m of marks) {
    if (m.type === "link") continue;
    const spec = registry.marks.get(m.type);
    if (!spec?.html) continue;
    const attrs = spec.html.attrs?.(m) ?? {};
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeHtmlAttr(String(v))}"`)
      .join("");
    s = `<${spec.html.tag}${attrStr}>${s}</${spec.html.tag}>`;
  }
  const link = marks.find((m) => m.type === "link");
  if (link) {
    const href = sanitizeUrl(String(link.attrs?.href ?? ""), "link") ?? "";
    s = `<a href="${escapeHtmlAttr(href)}">${s}</a>`;
  }
  return s;
}
