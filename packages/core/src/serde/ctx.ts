// Shared RenderCtx construction for the registry-driven block/inline/mark
// serializer hooks. One ctx shape (model/schema.ts's RenderCtx) is
// reused by toMarkdown/toHTML/toText -- each format module supplies its own
// concrete inlines/children/escapeText/escapeAttr functions, this module only
// wires up the parts that are identical across formats: registry, lossy
// reporting, and children()-call tracking (a `children: 'any'` block that
// never calls ctx.children() has its children auto-flattened/auto-wrapped by
// the caller instead -- see model/schema.ts's RenderCtx doc comment).

import type { RenderCtx, Registry } from "../model/schema.js";
import type { Block, Inline } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";
import type { LossyEntry } from "./types.js";

export interface FormatHooks {
  inlines(content: Inline[] | undefined): string;
  /** Renders `block`'s children in this format. Called lazily, only if the
   * block's own hook asks for it via ctx.children(). */
  renderChildren(): string;
  escapeText(s: string): string;
  escapeAttr(s: string): string;
}

export function makeCtx(
  block: Block,
  registry: Registry,
  lossy: LossyEntry[],
  format: FormatHooks,
  extra: { indent?: number; orderedIndex?: number; strict?: boolean } = {},
): { ctx: RenderCtx; consumedChildren: () => boolean } {
  let consumed = false;
  const ctx: RenderCtx = {
    registry,
    inlines: format.inlines,
    children: () => {
      consumed = true;
      return format.renderChildren();
    },
    escapeText: format.escapeText,
    escapeAttr: format.escapeAttr,
    sanitizeUrl,
    lossy: (reason) => lossy.push({ blockId: block.id, type: block.type, reason }),
    pushLossy: (blockId, type, reason) => lossy.push({ blockId, type, reason }),
    indent: extra.indent ?? 0,
    orderedIndex: extra.orderedIndex ?? 1,
    strict: extra.strict ?? false,
  };
  return { ctx, consumedChildren: () => consumed };
}

/** Whether a block type is a Notion-style arbitrary-nesting candidate (as
 * opposed to a block with a fixed children shape, e.g. table -> tableRow,
 * which fully owns its own nesting and is exempt from the generic
 * flatten/wrap fallback). */
export function isFreeNesting(registry: Registry, type: string): boolean {
  return registry.blocks.get(type)?.children === "any";
}
