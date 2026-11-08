// Table of contents block: a void block whose renderer lists the document's headings live (it
// subscribes to editor changes), indented by level, click to jump. The block itself only stores
// which heading levels to include; the entries are derived, never persisted (nothing to keep in sync).
//
// Serde forms: markdown `[TOC]` (or `[TOC 2-4]` for a level range; read back by the
// fromMarkdownBlock paragraph hook), html `<nav data-jul-editor-type="toc" data-min-level data-max-level>`
// (empty: a static export has no live outline; hosts render one with extractOutlineFromDoc).
import { defineBlock, newId } from "@jul-editor/core";
import type { Block, Json } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export interface TocProps {
  minLevel: number;
  maxLevel: number;
}

function clampLevel(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : fallback;
}

export function readToc(props: Record<string, Json>): TocProps {
  const minLevel = clampLevel(props.minLevel, 1);
  const maxLevel = Math.max(minLevel, clampLevel(props.maxLevel, 3));
  return { minLevel, maxLevel };
}

/** Parses `[TOC]` / `[TOC 2-4]`; null when the text is not a TOC marker. */
export function parseTocMarker(text: string): Record<string, Json> | null {
  const m = /^\[TOC(?: ([1-6])-([1-6]))?\]$/i.exec(text.trim());
  if (!m) return null;
  const props: Record<string, Json> = {};
  if (m[1]) {
    const min = Number(m[1]);
    const max = Math.max(min, Number(m[2]));
    if (min !== 1) props.minLevel = min;
    if (max !== 3) props.maxLevel = max;
  }
  return props;
}

export const tocBlock = defineBlock({
  type: "toc",
  content: "none",
  children: "none",
  props: { minLevel: 1, maxLevel: 3 },
  fromMarkdownBlock(token) {
    if (token.type !== "paragraph") return null;
    const props = parseTocMarker(token.text);
    return props ? { id: newId(), type: "toc", props } : null;
  },
  toMarkdown(block) {
    const { minLevel, maxLevel } = readToc(block.props);
    return minLevel === 1 && maxLevel === 3 ? "[TOC]" : `[TOC ${minLevel}-${maxLevel}]`;
  },
  toHTML(block) {
    const { minLevel, maxLevel } = readToc(block.props);
    return `<nav data-jul-editor-type="toc" data-min-level="${minLevel}" data-max-level="${maxLevel}" aria-label="Table of contents"></nav>`;
  },
  toText: (block, ctx) => "  ".repeat(ctx.indent) + (readToc(block.props).maxLevel === 3 ? "[TOC]" : `[TOC ${readToc(block.props).minLevel}-${readToc(block.props).maxLevel}]`),
  fromHTML: {
    selector: 'nav[data-jul-editor-type="toc"]',
    parse(el): Block {
      const props: Record<string, Json> = {};
      const min = clampLevel(el.getAttribute("data-min-level"), 1);
      const max = Math.max(min, clampLevel(el.getAttribute("data-max-level"), 3));
      if (min !== 1) props.minLevel = min;
      if (max !== 3) props.maxLevel = max;
      return { id: newId(), type: "toc", props };
    },
  },
});

export const tocSlashItem: SlashItem = {
  type: "toc",
  title: "Table of contents",
  keywords: ["toc", "table of contents", "outline", "contents", "목차", "차례", "개요"],
  create: () => ({ id: newId(), type: "toc", props: {} }),
};
