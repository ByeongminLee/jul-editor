// Doc -> Markdown. DOM-free (must run in plain node / Cloudflare Workers).
// Registry-driven: each block/inline/mark type's markdown form lives on
// its own spec (see builtins-serde.ts for the built-ins), not a hardcoded
// switch here -- a custom block/inline/mark registered via defineBlock/
// defineInline/defineMark works without touching this file.
// Nesting: paragraph/heading/quote/list items all allow children (Notion-style
// nesting). Escaping rules live in escape.ts.

import { coreRegistry } from "./builtins-serde.js";
import { isFreeNesting, makeCtx } from "./ctx.js";
import { escapeMdInline, escapeMdLines, joinBlocksMd, mdHref } from "./escape.js";
import { renderInlineListMd } from "./inline-md.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";
import type { LossyEntry, ToMarkdownOptions, ToMarkdownResult } from "./types.js";

interface RenderedBlock {
  type: string;
  text: string;
}

export function toMarkdown(doc: Doc, opts: ToMarkdownOptions = {}): ToMarkdownResult {
  const registry = opts.registry ?? coreRegistry;
  const lossy: LossyEntry[] = [];
  const items = renderBlockList(doc.blocks, registry, opts, lossy, 0);
  return { markdown: joinBlocksMd(items), lossy };
}

// returns each block's own {type, text} (instead of a pre-joined
// string) so the CALLER decides tight-vs-loose joining (joinBlocksMd) --
// needed at every nesting level (top-level siblings AND a block's own
// children via ctx.children(), see renderOneBlock below), not just the doc root.
function renderBlockList(blocks: Block[], registry: Registry, opts: ToMarkdownOptions, lossy: LossyEntry[], depth: number): RenderedBlock[] {
  const items: RenderedBlock[] = [];
  let prevType: string | null = null;
  let run = 0;
  for (const block of blocks) {
    run = block.type === prevType ? run + 1 : 1;
    prevType = block.type;
    const { text, extraChildren } = renderOneBlock(block, registry, opts, lossy, depth, run);
    items.push({ type: block.type, text });
    if (extraChildren.length) {
      for (const c of extraChildren) lossy.push({ blockId: c.id, type: c.type, reason: "nesting-flattened" });
      items.push(...renderBlockList(extraChildren, registry, opts, lossy, depth));
    }
  }
  return items;
}

function renderOneBlock(
  block: Block,
  registry: Registry,
  opts: ToMarkdownOptions,
  lossy: LossyEntry[],
  depth: number,
  orderedIndex: number,
): { text: string; extraChildren: Block[] } {
  const spec = registry.blocks.get(block.type);
  if (!spec || !spec.toMarkdown) {
    lossy.push({ blockId: block.id, type: block.type, reason: "unknown-type" });
    // Unchanged from the pre-registry behavior: an unknown/hookless block's own line
    // is dropped, but its children still get a chance to render as
    // following siblings (each individually reported nesting-flattened).
    return { text: "", extraChildren: block.children ?? [] };
  }

  const { ctx, consumedChildren } = makeCtx(
    block,
    registry,
    lossy,
    {
      inlines: (content) => escapeMdLines(renderInlineListMd(content, registry, ctx).trim()),
      renderChildren: () => joinBlocksMd(renderBlockList(block.children ?? [], registry, opts, lossy, depth + 1)),
      escapeText: escapeMdInline,
      escapeAttr: mdHref,
    },
    { indent: depth, orderedIndex, strict: !!opts.strict },
  );

  const result = spec.toMarkdown(block, ctx);
  const text = typeof result === "string" ? result : result.text;
  if (typeof result !== "string" && result.lossy) lossy.push({ blockId: block.id, type: block.type, reason: result.lossy });

  const extraChildren = isFreeNesting(registry, block.type) && !consumedChildren() ? (block.children ?? []) : [];
  return { text, extraChildren };
}
