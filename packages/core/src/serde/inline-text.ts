// Registry-driven inline rendering for plain text. No marks, no escaping.
import { isText } from "../model/canonical.js";
import type { RenderCtx, Registry } from "../model/schema.js";
import type { Inline } from "../model/types.js";

export function renderInlineListText(content: Inline[] | undefined, registry: Registry, ctx: RenderCtx): string {
  return (content ?? []).map((inl) => renderInlineNodeText(inl, registry, ctx)).join("");
}

function renderInlineNodeText(inl: Inline, registry: Registry, ctx: RenderCtx): string {
  if (isText(inl)) return inl.text;
  const spec = registry.inlines.get(inl.type);
  if (spec?.toText) return spec.toText(inl, ctx);
  return "";
}
