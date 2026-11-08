// Doc -> plain text. DOM-free. Registry-driven: each block/inline's
// text form lives on its own spec (see builtins-serde.ts), not a hardcoded
// switch. Indentation for nesting is generic: a hook computes its own
// "  ".repeat(ctx.indent) pad and, if it has children, appends ctx.children()
// (rendered at ctx.indent + 1).

import { coreRegistry } from "./builtins-serde.js";
import { makeCtx } from "./ctx.js";
import { renderInlineListText } from "./inline-text.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";
import type { LossyEntry, ToTextOptions } from "./types.js";

export function toText(doc: Doc, opts: ToTextOptions = {}): string {
  const registry = opts.registry ?? coreRegistry;
  return renderBlockList(doc.blocks, registry, 0).join("\n");
}

function renderBlockList(blocks: Block[], registry: Registry, depth: number): string[] {
  const out: string[] = [];
  for (const block of blocks) out.push(...renderBlock(block, registry, depth));
  return out;
}

function renderBlock(block: Block, registry: Registry, depth: number): string[] {
  const spec = registry.blocks.get(block.type);
  if (!spec || !spec.toText) return [];

  const discardedLossy: LossyEntry[] = [];
  const { ctx } = makeCtx(
    block,
    registry,
    discardedLossy,
    {
      inlines: (content) => renderInlineListText(content, registry, ctx),
      renderChildren: () => renderBlockList(block.children ?? [], registry, depth + 1).join("\n"),
      escapeText: (s) => s,
      escapeAttr: (s) => s,
    },
    { indent: depth },
  );

  return spec.toText(block, ctx).split("\n");
}
