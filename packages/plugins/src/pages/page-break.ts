// `pageBreak` block: a void block that forces the next block onto a new page.
// Serde (no core change needed):
//   markdown  `<!-- pagebreak -->` out; in via BlockSpec.fromMarkdownBlock (html comment
//             token, works in fromMarkdown and paste). `\pagebreak` / `\newpage`
//             (pandoc/LaTeX) are accepted on the way in too.
//             restorePageBreaks(doc) is kept as a deprecated post-pass alias.
//   html      `<div data-jul-editor-type="pageBreak" style="break-after:page"></div>`;
//             parsed back through BlockSpec.fromHTML.
//   text      "" (a form feed would be invisible and break diffing).
import { defineBlock, newId } from "@jul-editor/core";
import type { Block, BlockSpec, Doc } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export const pageBreak: BlockSpec = defineBlock({
  type: "pageBreak",
  content: "none",
  children: "none",
  props: {},
  fromMarkdownBlock: (token) => ((token.type === "html" || token.type === "paragraph") && PAGEBREAK_TEXT.test(token.text) ? createPageBreak() : null),
  toMarkdown: () => PAGE_BREAK_MARKDOWN,
  toHTML: () => PAGE_BREAK_HTML,
  toText: () => "",
  fromHTML: {
    selector: 'div[data-jul-editor-type="pageBreak"], div[style*="break-after"][style*="page"], div[style*="page-break-after"]',
    parse: (el) => {
      const style = (el.getAttribute("style") ?? "").replace(/\s+/g, "");
      const typed = el.getAttribute("data-jul-editor-type") === "pageBreak";
      // Word/Google Docs exports use these styles on an otherwise empty div.
      if (!typed && !/(break|page-break)-after:(page|always)/.test(style)) return null;
      if (!typed && (el.textContent ?? "").trim()) return null;
      return createPageBreak();
    },
  },
});

export const PAGE_BREAK_MARKDOWN = "<!-- pagebreak -->";
export const PAGE_BREAK_HTML = '<div data-jul-editor-type="pageBreak" style="break-after:page"></div>';

export const createPageBreak = (): Block => ({ id: newId(), type: "pageBreak", props: {} });

export const pageBreakSlashItem: SlashItem = {
  type: "pageBreak",
  title: "Page break",
  keywords: ["page-break", "pagebreak", "page", "break", "페이지", "페이지 나누기", "쪽 나누기"],
  create: createPageBreak,
};

const PAGEBREAK_TEXT = /^\s*(?:<!--\s*pagebreak\s*-->|\\pagebreak|\\newpage)\s*$/i;

/** @deprecated The pageBreak block now parses markers itself (BlockSpec.fromMarkdownBlock); a
 * registry that includes `pageBreak` needs no post-pass. Kept for docs parsed without it.
 * Post-pass for fromMarkdown(): turns paragraphs that consist solely of a
 * page break marker into pageBreak blocks. Returns a new Doc (input is not
 * mutated). Recurses into children so a marker inside a quote also works. */
export function restorePageBreaks(doc: Doc): Doc {
  const walk = (blocks: Block[]): Block[] =>
    blocks.map((b) => {
      if (b.type === "paragraph" && isMarkerParagraph(b)) return { ...createPageBreak(), id: b.id };
      return b.children?.length ? { ...b, children: walk(b.children) } : b;
    });
  return { ...doc, blocks: walk(doc.blocks) };
}

function isMarkerParagraph(b: Block): boolean {
  if (b.children?.length || !b.content || b.content.length !== 1) return false;
  const only = b.content[0]!;
  return only.type === "text" && !(only as { marks?: unknown[] }).marks?.length && PAGEBREAK_TEXT.test((only as { text: string }).text);
}

/** Pagination hint for a block: pageBreak forces the next block to a new page. */
export const isPageBreak = (b: { type: string }): boolean => b.type === "pageBreak";
