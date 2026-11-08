// Doc -> semantic HTML string. DOM-free: builds a string, never touches
// `document`. All text and attribute values are escaped.
// Registry-driven: each block/inline/mark's HTML form lives on its own
// spec (see builtins-serde.ts), not a hardcoded switch. A `children: 'any'`
// block whose own hook doesn't consume ctx.children() gets its children
// generically nested in a `data-jul-editor-children` wrapper (Notion-style
// nesting) -- see model/schema.ts's RenderCtx doc.

import { coreRegistry } from "./builtins-serde.js";
import { isFreeNesting, makeCtx } from "./ctx.js";
import { escapeHtmlAttr, escapeHtmlText } from "./escape.js";
import { renderInlineListHtml } from "./inline-html.js";
import { COLOR_PALETTE } from "../model/builtins.js";
import { TEXT_ALIGN_VALUES } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";
import type { LossyEntry, ToHTMLOptions } from "./types.js";

const LIST_TAG: Record<string, string> = { bulletListItem: "ul", orderedListItem: "ol", todoListItem: "ul" };

export function toHTML(doc: Doc, opts: ToHTMLOptions = {}): string {
  const registry = opts.registry ?? coreRegistry;
  return renderBlockList(doc.blocks, registry, 0);
}

function renderBlockList(blocks: Block[], registry: Registry, depth: number): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    const tag = LIST_TAG[block.type];
    if (tag) {
      const group: Block[] = [];
      while (i < blocks.length && blocks[i]!.type === block.type) {
        group.push(blocks[i]!);
        i++;
      }
      out.push(`<${tag} data-jul-editor-type="${block.type}">${group.map((b) => renderBlock(b, registry, depth)).join("")}</${tag}>`);
      continue;
    }
    out.push(renderBlock(block, registry, depth));
    i++;
  }
  return out.join("");
}

// Block-level presentation props (textAlign / textColor / backgroundColor, see model/canonical.ts)
// ride on the block's own opening tag: a real `style="text-align:..."` plus the same data
// attributes the live editor sets, so a paste of this output (fromHTML) restores them and a host
// stylesheet can map the color tokens. Values were whitelisted by normalization; checked again here.
function injectBlockStyle(html: string, block: Block, inline: boolean): string {
  if (!inline) return html;
  const attrs: string[] = [];
  const align = block.props?.textAlign;
  if (typeof align === "string" && align !== "left" && (TEXT_ALIGN_VALUES as readonly string[]).includes(align)) {
    attrs.push(`style="text-align:${align}"`, `data-jul-editor-text-align="${align}"`);
  }
  const color = block.props?.textColor;
  if (typeof color === "string" && color !== "default" && (COLOR_PALETTE as readonly string[]).includes(color)) attrs.push(`data-jul-editor-block-color="${color}"`);
  const bg = block.props?.backgroundColor;
  if (typeof bg === "string" && bg !== "default" && (COLOR_PALETTE as readonly string[]).includes(bg)) attrs.push(`data-jul-editor-block-bg="${bg}"`);
  if (attrs.length === 0) return html;
  const m = /^<([a-z][a-z0-9]*)(\s|>)/.exec(html);
  if (!m || /^<[a-z0-9]+[^>]*\sstyle=/.test(html)) return html;
  return `<${m[1]} ${attrs.join(" ")}${m[2] === ">" ? ">" : " "}${html.slice(m[0].length)}`;
}

function renderBlock(block: Block, registry: Registry, depth: number): string {
  const spec = registry.blocks.get(block.type);
  if (!spec || !spec.toHTML) {
    return `<div data-jul-editor-type="${escapeHtmlAttr(block.type)}" data-jul-editor-unknown></div>`;
  }

  // toHTML doesn't report a lossy result today (unlike toMarkdown) -- ctx
  // still exposes lossy()/pushLossy() for hook parity, they're just unread.
  const discardedLossy: LossyEntry[] = [];
  const { ctx, consumedChildren } = makeCtx(
    block,
    registry,
    discardedLossy,
    {
      inlines: (content) => renderInlineListHtml(content, registry, ctx),
      renderChildren: () => renderBlockList(block.children ?? [], registry, depth + 1),
      escapeText: escapeHtmlText,
      escapeAttr: escapeHtmlAttr,
    },
    { indent: depth },
  );

  const own = injectBlockStyle(spec.toHTML(block, ctx), block, spec.content === "inline");
  if (isFreeNesting(registry, block.type) && !consumedChildren() && block.children && block.children.length) {
    const childrenHtml = renderBlockList(block.children, registry, depth + 1);
    return `<div data-jul-editor-block data-jul-editor-type="${escapeHtmlAttr(block.type)}">${own}<div data-jul-editor-children>${childrenHtml}</div></div>`;
  }
  return own;
}
