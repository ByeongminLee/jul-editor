import { createRegistry, defineBlock, defineInline, defineMark } from "./schema.js";

// Notion-style arbitrary nesting: any
// block may have children. paragraph/heading/quote/list items all use
// children: "any"; serde flattens unsupported markdown nesting (paragraph,
// heading) to following siblings but nests HTML/text generically.
export const paragraph = defineBlock({ type: "paragraph", content: "inline", children: "any", props: {} });

export const heading = defineBlock({
  type: "heading",
  content: "inline",
  children: "any",
  props: { level: 1 },
});

export const bulletListItem = defineBlock({
  type: "bulletListItem",
  content: "inline",
  children: "any",
  props: {},
});

export const orderedListItem = defineBlock({
  type: "orderedListItem",
  content: "inline",
  children: "any",
  props: {},
});

export const todoListItem = defineBlock({
  type: "todoListItem",
  content: "inline",
  children: "any",
  props: { checked: false },
});

export const quote = defineBlock({ type: "quote", content: "inline", children: "any", props: {} });

export const codeBlock = defineBlock({
  type: "codeBlock",
  content: "code",
  children: "none",
  props: { language: "" },
});

export const divider = defineBlock({ type: "divider", content: "none", children: "none", props: {} });

// width is a px number or a CSS percentage string ("50%"), null =
// natural size; align is one of ALIGN_VALUES (default "center"); caption is
// kept simple as a plain string (not rich Inline[] -- a deliberate
// simplification). assetId keeps its own prior meaning (an uploaded
// asset's id, distinct from `src`, see serde/media-serde.ts's image-meta
// lossy reason).
export const ALIGN_VALUES = ["left", "center", "right"] as const;
export type ImageAlign = (typeof ALIGN_VALUES)[number];

export const image = defineBlock({
  type: "image",
  content: "none",
  children: "none",
  props: { src: "", alt: "", assetId: null, width: null, align: "center", caption: "" },
});

// a void embed block (YouTube/Vimeo iframe allowlist, X/other as a
// link card -- see model/embed.ts's parseEmbedUrl/embedIframeSrc). `id` is
// the provider's own video/status id (validated by embedIframeSrc before
// ever reaching an iframe attribute); `title` is a plain string label.
export const embed = defineBlock({
  type: "embed",
  content: "none",
  children: "none",
  props: { provider: "link", url: "", id: "", title: "" },
});

export const table = defineBlock({
  type: "table",
  content: "none",
  children: ["tableRow"],
  isolating: true,
  props: { headerRow: true },
});

export const tableRow = defineBlock({
  type: "tableRow",
  content: "none",
  children: ["tableCell"],
  parent: ["table"],
  isolating: true,
  props: {},
});

export const tableCell = defineBlock({
  type: "tableCell",
  content: "inline",
  children: "none",
  parent: ["tableRow"],
  isolating: true,
  indentable: false,
  // merge/split (colspan/rowspan >= 2 -- store/table.ts's tableGrid).
  // A covered position (inside another cell's span) has NO block of its own
  // at all -- these props live only on the ANCHOR cell.
  props: { colspan: 1, rowspan: 1 },
});

export const chart = defineBlock({
  type: "chart",
  content: "none",
  children: "none",
  props: {
    kind: "bar",
    source: { type: "inline", csv: "" },
    range: null,
  },
});

export const diagram = defineBlock({
  type: "diagram",
  content: "none",
  children: "none",
  props: { code: "" },
});

export const dataTable = defineBlock({
  type: "dataTable",
  content: "none",
  children: "none",
  props: {},
});

export const coreBlocks = [
  paragraph,
  heading,
  bulletListItem,
  orderedListItem,
  todoListItem,
  quote,
  codeBlock,
  divider,
  image,
  embed,
  table,
  tableRow,
  tableCell,
  chart,
  diagram,
  dataTable,
];

export const bold = defineMark({ type: "bold" });
export const italic = defineMark({ type: "italic" });
export const strike = defineMark({ type: "strike" });
export const code = defineMark({ type: "code" });
export const link = defineMark({ type: "link", attrs: { href: "" } });

// a fixed color-token palette (not raw CSS) so the library stays
// headless -- textColor/highlight only ever store one of these names; the DOM
// renders it as a `data-jul-editor-color`/`data-jul-editor-highlight` attribute value
// and a host's own stylesheet decides what "red" actually looks like.
export const COLOR_PALETTE = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type ColorToken = (typeof COLOR_PALETTE)[number];

export const underline = defineMark({ type: "underline" });
export const subscript = defineMark({ type: "subscript" });
export const superscript = defineMark({ type: "superscript" });
export const textColor = defineMark({ type: "textColor", attrs: { color: "default" } });
export const highlight = defineMark({ type: "highlight", attrs: { color: "default" } });

// DOCX style toolbar marks: a free-form (but sanitized, see model/font-style.ts) font family name and
// size (`14pt`, `18px`). Rendered as an inline style, kept in toHTML/fromHTML, dropped from markdown.
export const fontFamily = defineMark({ type: "fontFamily", attrs: { family: "" }, omitFromMarkdown: true });
export const fontSize = defineMark({ type: "fontSize", attrs: { size: "" }, omitFromMarkdown: true });

export const coreMarks = [bold, italic, strike, code, link, underline, subscript, superscript, textColor, highlight, fontFamily, fontSize];

export const mention = defineInline({ type: "mention", attrs: { kind: "", id: "", label: "" } });

export const coreInlines = [mention];

export const coreRegistry = createRegistry({
  blocks: coreBlocks,
  inlines: coreInlines,
  marks: coreMarks,
});
