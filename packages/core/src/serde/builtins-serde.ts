// Attaches the registry-driven serde hooks (toMarkdown/toHTML/toText/
// fromMarkdown on BlockSpec; toMarkdown/toHTML/toText/fromMarkdownLink on
// InlineSpec; markdown/html on MarkSpec) onto the SAME spec objects
// model/builtins.ts exports and constructs coreRegistry from.
//
// Why here and not in model/builtins.ts: model must stay DOM-free *and*
// serde-agnostic (it's imported by store/diff, which never need marked's
// escaping helpers or fence/link dispatch). Since defineBlock/defineInline/
// defineMark return the exact same object they're given, attaching hooks by
// mutation after the fact keeps @jul-editor/core's model entry point small while
// giving serde's registry-driven dispatch (to-markdown.ts, to-html.ts,
// to-text.ts, from-markdown.ts) real per-type behavior. Every serde entry
// point imports `coreRegistry` from *this* module (not model/builtins.ts
// directly) so the mutations below are guaranteed to have run first.
//
// A consumer adding a custom block/inline/mark does the same thing this file
// does: defineBlock({...}).toMarkdown = ... (or just pass the hooks directly
// into defineBlock's spec object) then createRegistry({blocks:[...coreBlocks, custom]}).
// See extensibility.test.ts.

import {
  bold,
  bulletListItem,
  chart,
  code,
  codeBlock,
  coreRegistry,
  dataTable,
  diagram,
  divider,
  fontFamily,
  fontSize,
  heading,
  highlight,
  italic,
  link,
  mention,
  orderedListItem,
  paragraph,
  quote,
  strike,
  subscript,
  superscript,
  textColor,
  todoListItem,
  underline,
} from "../model/builtins.js";
import { canonicalStringify, getProp, isText } from "../model/canonical.js";
import { fontFamilyCss, sanitizeFontFamily, sanitizeFontSize } from "../model/font-style.js";
import { newId } from "../model/id.js";
import type { RenderCtx } from "../model/schema.js";
import type { Block, Inline } from "../model/types.js";
import { CODE_TAB_PLACEHOLDER, EMPTY_MD_PLACEHOLDER, codeFence, isListItemType } from "./escape.js";
import { renderInlineListHtml } from "./inline-html.js";
import { renderInlineListMd } from "./inline-md.js";

export { coreRegistry };

// ---- shared helpers ---------------------------------------------------------

function clampLevel(n: unknown): number {
  return Math.min(6, Math.max(1, Number(n ?? 1)));
}

function plainTextOf(content: Inline[] | undefined): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : "")).join("");
}

function pad(ctx: RenderCtx): string {
  return "  ".repeat(ctx.indent);
}

// paragraph/heading/quote/list items all render as "own line, then (if any)
// nested children at depth + 1" in plain text -- identical for all of them.
function defaultToText(block: Block, ctx: RenderCtx): string {
  const own = pad(ctx) + ctx.inlines(block.content);
  if (!block.children || block.children.length === 0) return own;
  return own + "\n" + ctx.children();
}

function voidFigureHtml(block: Block, ctx: RenderCtx): string {
  return `<figure data-jul-editor-type="${block.type}" data-jul-editor-props="${ctx.escapeAttr(canonicalStringify(block.props))}"></figure>`;
}

function fencedJson(block: Block, lang: string): string {
  const json = canonicalStringify(block.props);
  const fence = codeFence(json);
  return `${fence}${lang}\n${json}\n${fence}`;
}

// ---- paragraph ---------------------------------------------------------------

// an empty paragraph must not silently vanish (it's between two
// other blocks, e.g. deliberate spacing) -- a bare empty line reads as
// nothing at all once joined with its neighbors, so it gets a zero-width
// placeholder instead, stripped back out by from-markdown.ts.
paragraph.toMarkdown = (block, ctx) => ctx.inlines(block.content) || EMPTY_MD_PLACEHOLDER;
paragraph.toHTML = (block, ctx) => `<p data-jul-editor-type="paragraph">${ctx.inlines(block.content)}</p>`;
paragraph.toText = defaultToText;

// ---- heading -------------------------------------------------------------------

heading.toMarkdown = (block, ctx) => {
  // ATX headings are a single physical line -- a raw embedded
  // hard break (ctx.inlines would leave it as a literal "\n") truncates the
  // heading right there and turns the rest into a following paragraph. `<br>`
  // stays inline HTML on the same physical line; from-markdown.ts reads it
  // back as a "\n" text run (see inlineTokensToInlines's "html" case), and
  // ctx.inlines' own line-start escaping doesn't apply here (heading text
  // never starts a physical line -- "# " already does), so this renders the
  // inline list directly instead.
  const level = clampLevel(getProp(block, "level", ctx.registry));
  const raw = renderInlineListMd(block.content, ctx.registry, ctx).trim();
  return "#".repeat(level) + " " + raw.replace(/\n/g, "<br>");
};
heading.toHTML = (block, ctx) => {
  const level = clampLevel(getProp(block, "level", ctx.registry));
  return `<h${level} data-jul-editor-type="heading">${ctx.inlines(block.content)}</h${level}>`;
};
heading.toText = defaultToText;

// ---- quote --------

function quotePrefix(text: string): string {
  if (text === "") return ">";
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : "> " + line))
    .join("\n");
}

quote.toMarkdown = (block, ctx) => {
  // an empty own-content with a real first child must still get
  // its OWN line (a placeholder when empty) -- otherwise from-markdown.ts's
  // "promote the first paragraph to the quote's own content" rule (mirroring
  // marked's own blockquote shape) swallows that first child as if it WERE
  // the quote's content, losing the content/children distinction.
  const own = ctx.inlines(block.content) || EMPTY_MD_PLACEHOLDER;
  const childMd = block.children && block.children.length ? ctx.children() : "";
  const parts = childMd !== "" ? [own, childMd] : [own];
  return quotePrefix(parts.join("\n\n"));
};
quote.toHTML = (block, ctx) => {
  const own = block.content && block.content.length ? `<p data-jul-editor-type="paragraph">${ctx.inlines(block.content)}</p>` : "";
  const kids = block.children && block.children.length ? ctx.children() : "";
  return `<blockquote data-jul-editor-type="quote">${own}${kids}</blockquote>`;
};
quote.toText = defaultToText;

// ---- codeBlock -----------------------------------------------------------------

codeBlock.toMarkdown = (block, ctx) => {
  const lang = String(getProp(block, "language", ctx.registry) ?? "");
  // Design decision: diagram reclaimed the plain "mermaid" fence (see
  // diagram.toMarkdown above) -- a codeBlock tagged "mermaid" round-trips as
  // a diagram block instead, so that type change is reported lossy rather
  // than silently happening.
  if (lang === "mermaid") ctx.lossy("mermaid-code-becomes-diagram");
  const raw = plainTextOf(block.content);
  const fence = codeFence(raw);
  // only swap tabs for the placeholder when this code block will
  // actually be nested (indented) under a list item/quote -- see
  // CODE_TAB_PLACEHOLDER's own comment for why a real tab can't survive that.
  // A top-level code block keeps its tabs literal (nothing mangles them).
  const text = ctx.indent > 0 ? raw.replace(/\t/g, CODE_TAB_PLACEHOLDER) : raw;
  return `${fence}${lang}\n${text}\n${fence}`;
};
codeBlock.toHTML = (block, ctx) => {
  const lang = String(getProp(block, "language", ctx.registry) ?? "");
  const text = plainTextOf(block.content);
  const cls = lang ? ` class="language-${ctx.escapeAttr(lang)}"` : "";
  return `<pre data-jul-editor-type="codeBlock"><code${cls}>${ctx.escapeText(text)}</code></pre>`;
};
codeBlock.toText = (block, ctx) => {
  const p = pad(ctx);
  return plainTextOf(block.content)
    .split("\n")
    .map((l) => p + l)
    .join("\n");
};

// ---- divider ---------------------------------------------------------------------

divider.toMarkdown = () => "---";
divider.toHTML = () => `<hr data-jul-editor-type="divider">`;
divider.toText = (_block, ctx) => pad(ctx) + "---";

// ---- image / embed -------------------------------------------------------------------
// moved to serde/media-serde.ts (this file's own header comment
// explains why -- image+embed serde hooks are a separate
// carve-out of this otherwise-shared file). media-serde.ts is
// pulled in via the side-effecting import at the bottom of this file.

// ---- list items ----------------------------------------------------------------------

function renderListItemMd(block: Block, ctx: RenderCtx, marker: string, structuralWidth: number = marker.length): string {
  // an empty item's own line needs a placeholder --
  // otherwise a to-do's checkbox has no following \S (GFM's task-list regex
  // requires one, so it silently reverts to a plain bullet showing literal
  // "[x]" text) and, for any list item with a nested child, marked's own
  // continuation-line indentation math doesn't establish a real content
  // column on a wholly-blank first line, so the child is lifted out instead
  // of nested.
  const firstLine = marker + (ctx.inlines(block.content) || EMPTY_MD_PLACEHOLDER);
  if (!block.children || block.children.length === 0) return firstLine;
  const body = indentLines(ctx.children(), structuralWidth);
  // a nested SUBLIST (the item's children are themselves list items)
  // joins tight -- no blank line before it -- same as sibling list items;
  // anything else nested (a paragraph, codeBlock, ...) keeps the blank line
  // (that item genuinely has more than one block of content, which is what
  // makes an enclosing list "loose" in the first place).
  const tight = isListItemType(block.children[0]!.type);
  return tight ? `${firstLine}\n${body}` : `${firstLine}\n\n${body}`;
}

function indentLines(text: string, width: number): string {
  const p = " ".repeat(width);
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : p + line))
    .join("\n");
}

function renderListItemHtml(block: Block, ctx: RenderCtx, checkboxHtml: string): string {
  const nested = block.children && block.children.length ? ctx.children() : "";
  return `<li data-jul-editor-type="${block.type}">${checkboxHtml}${ctx.inlines(block.content)}${nested}</li>`;
}

bulletListItem.toMarkdown = (block, ctx) => renderListItemMd(block, ctx, "- ");
bulletListItem.toHTML = (block, ctx) => renderListItemHtml(block, ctx, "");
bulletListItem.toText = defaultToText;

orderedListItem.toMarkdown = (block, ctx) => renderListItemMd(block, ctx, `${ctx.orderedIndex}. `);
orderedListItem.toHTML = (block, ctx) => renderListItemHtml(block, ctx, "");
orderedListItem.toText = defaultToText;

todoListItem.toMarkdown = (block, ctx) => {
  const checked = getProp<boolean>(block, "checked", ctx.registry);
  // Structural indent for nested content is the *bullet's* width ("- "), not
  // the visual "- [ ] "/"- [x] " prefix width: GFM task checkboxes are
  // inline content after a plain bullet marker, not part of the block
  // marker itself.
  return renderListItemMd(block, ctx, checked ? "- [x] " : "- [ ] ", 2);
};
todoListItem.toHTML = (block, ctx) => {
  const checked = getProp<boolean>(block, "checked", ctx.registry);
  const checkbox = `<input type="checkbox" disabled${checked ? " checked" : ""}> `;
  return renderListItemHtml(block, ctx, checkbox);
};
todoListItem.toText = defaultToText;

// ---- chart / dataTable (fenced JSON) / diagram (fenced mermaid) --------------------

chart.toMarkdown = (block, ctx) => {
  if (ctx.strict) ctx.lossy("jul-editor-extension");
  return fencedJson(block, "jul-editor-chart");
};
chart.toHTML = (block, ctx) => voidFigureHtml(block, ctx);
chart.toText = (_block, ctx) => pad(ctx) + "[chart]";
chart.fromMarkdown = {
  fence: "jul-editor-chart",
  parse(token, ctx) {
    try {
      return { id: newId(), type: "chart", props: JSON.parse(token.text) };
    } catch {
      ctx.lossy(newId(), "jul-editor-chart", "invalid-json");
      return null;
    }
  },
};

dataTable.toMarkdown = (block) => fencedJson(block, "jul-editor-datatable");
dataTable.toHTML = (block, ctx) => voidFigureHtml(block, ctx);
dataTable.toText = (_block, ctx) => pad(ctx) + "[dataTable]";
dataTable.fromMarkdown = {
  fence: "jul-editor-datatable",
  parse(token, ctx) {
    try {
      return { id: newId(), type: "dataTable", props: JSON.parse(token.text) };
    } catch {
      ctx.lossy(newId(), "jul-editor-datatable", "invalid-json");
      return null;
    }
  },
};

// Diagram exports as plain ```mermaid for GitHub/Notion interop;
// fromMarkdown also accepts the namespaced "jul-editor-mermaid" fence. The
// collision this reintroduces (a real ```mermaid codeBlock re-imports as a
// diagram) is made explicit instead: codeBlock.toMarkdown below reports it
// lossy with reason "mermaid-code-becomes-diagram".
diagram.toMarkdown = (block, ctx) => {
  const code = String(getProp(block, "code", ctx.registry) ?? "");
  const fence = codeFence(code);
  return `${fence}mermaid\n${code}\n${fence}`;
};
diagram.toHTML = (block, ctx) => voidFigureHtml(block, ctx);
diagram.toText = (_block, ctx) => pad(ctx) + "[diagram]";
diagram.fromMarkdown = {
  fence: ["mermaid", "jul-editor-mermaid"],
  parse(token) {
    return { id: newId(), type: "diagram", props: { code: token.text } };
  },
};

// ---- marks: bold/italic/strike wrap generically; code/link stay special-cased
// in inline-md.ts/inline-html.ts (dynamic href, different escaping) --------------

// `_` cannot open/close INSIDE a word (CommonMark's intraword
// restriction is `_`-specific) -- `*` has no such restriction, so italic
// switches to it (강조/foo_bar_baz). Each mark's `markdown.parse`
// registers its `html.tag` FORM (e.g. "<strong>...</strong>") as a marked
// inline extension too (the same generic mechanism a custom mark like
// highlight uses, see from-markdown.ts's lexerFor/inlineTokensToInlines) --
// inline-md.ts's wrapMark falls back to that HTML form when `**`/`*`/`~~`
// wouldn't flank correctly (bold ending in punctuation directly before
// CJK; a marked run starting with a space), so the mark still round-trips.
// the inner group is lazy (shortest match first), so a raw
// (unescaped-looking) "</tag>" substring that's actually part of escaped
// content (inline-md.ts's escapeMdInline backslash-escapes a literal "<",
// e.g. "a</u>b" -> "a\</u>b") would otherwise end the match right there,
// leaking the rest as plain text outside the mark. `(?:\\.|[\s\S])*?`
// consumes a backslash-escaped pair as one atomic step so the scan can never
// stop in the middle of one -- it still finds the REAL closing tag past it.
const TAG_FALLBACK_BODY = "(?:\\\\.|[\\s\\S])*?";
bold.markdown = { open: "**", close: "**", parse: { start: "<strong>", tokenizer: new RegExp(`^<strong>(${TAG_FALLBACK_BODY})<\\/strong>`, "i") } };
bold.html = { tag: "strong" };
italic.markdown = { open: "*", close: "*", parse: { start: "<em>", tokenizer: new RegExp(`^<em>(${TAG_FALLBACK_BODY})<\\/em>`, "i") } };
italic.html = { tag: "em" };
strike.markdown = { open: "~~", close: "~~", parse: { start: "<del>", tokenizer: new RegExp(`^<del>(${TAG_FALLBACK_BODY})<\\/del>`, "i") } };
strike.html = { tag: "del" };
code.html = { tag: "code" };
void link; // link has no static markdown/html wrap (dynamic href) -- special-cased

// underline/subscript/superscript have no native CommonMark syntax at
// all -- their markdown.open/close IS the HTML-tag fallback form itself, so
// wrapMark's flanking-check-then-fallback logic (inline-md.ts) always lands on
// the same "<u>x</u>"-shaped output either way; `.parse` registers that exact
// tag as a marked inline extension (same mechanism bold/italic/strike's own
// HTML-fallback-readback uses) so it round-trips back on fromMarkdown too.
underline.markdown = { open: "<u>", close: "</u>", parse: { start: "<u>", tokenizer: new RegExp(`^<u>(${TAG_FALLBACK_BODY})<\\/u>`, "i") } };
underline.html = { tag: "u" };
subscript.markdown = { open: "<sub>", close: "</sub>", parse: { start: "<sub>", tokenizer: new RegExp(`^<sub>(${TAG_FALLBACK_BODY})<\\/sub>`, "i") } };
subscript.html = { tag: "sub" };
superscript.markdown = { open: "<sup>", close: "</sup>", parse: { start: "<sup>", tokenizer: new RegExp(`^<sup>(${TAG_FALLBACK_BODY})<\\/sup>`, "i") } };
superscript.html = { tag: "sup" };

// highlight: native "==x==" GFM-ish syntax (no color channel in markdown --
// inline-md.ts's wrapTextRunMd reports a color other than "default" lossy,
// but still keeps the `==...==` wrap so the highlight itself isn't lost).
// the native form can't carry a literal "=" next to the
// delimiter's own "==", nor an embedded hard break -- allow a single "=" (one
// not immediately followed by another, i.e. not the closing delimiter itself)
// and an escaped char inside the content; inline-md.ts's wrapMark falls back
// to the `<mark>` HTML form (below) instead of "==...==" for content that
// still can't round-trip that way (a literal "==" or a "\n"), and this same
// tokenizer reads BOTH forms back (marked tries a custom inline extension's
// tokenizer at every cursor position regardless of which literal `start` hint
// matched, so registering just one -- "==" -- is enough for both branches).
highlight.markdown = {
  open: "==",
  close: "==",
  parse: { start: "==", tokenizer: /^(?:==((?:\\.|=(?!=)|[^=\n])+)==|<mark>((?:\\.|[\s\S])*?)<\/mark>)/i },
};
highlight.html = {
  tag: "mark",
  attrs: (mark): Record<string, string> => {
    const color = String(mark.attrs?.color ?? "default");
    return color === "default" ? {} : { "data-jul-editor-highlight": color };
  },
};

// textColor: no markdown representation at all (a `<span>` HTML fallback
// would be unusually verbose for plain markdown output) -- inline-md.ts skips
// it from the generic mark-wrap loop entirely and reports it lossy instead,
// keeping the run's own text. HTML output still carries the color losslessly.
textColor.html = {
  tag: "span",
  attrs: (mark) => ({ "data-jul-editor-color": String(mark.attrs?.color ?? "default") }),
};

// fontFamily / fontSize: an inline `style` on a <span> (the only spelling Word, Google Docs and
// every browser agree on). Values are sanitized again on the way out and on the way back in
// (`parse`), so a hostile `style` string can never become a mark. `parse` returns null for a span
// that carries no usable value, which keeps ordinary spans from becoming marks. No markdown form
// (omitFromMarkdown): the text stays, the style is dropped silently.
fontFamily.html = {
  tag: "span",
  attrs: (mark): Record<string, string> => {
    const family = sanitizeFontFamily(mark.attrs?.family);
    return family ? { style: `font-family:${fontFamilyCss(family)}` } : {};
  },
  parse: (el) => {
    const family = sanitizeFontFamily((el as HTMLElement).style?.fontFamily);
    return family ? { type: "fontFamily", attrs: { family } } : null;
  },
};
fontSize.html = {
  tag: "span",
  attrs: (mark): Record<string, string> => {
    const size = sanitizeFontSize(mark.attrs?.size);
    return size ? { style: `font-size:${size}` } : {};
  },
  parse: (el) => {
    const size = sanitizeFontSize((el as HTMLElement).style?.fontSize);
    return size ? { type: "fontSize", attrs: { size } } : null;
  },
};

// ---- mention (inline) -----------------------------------------------------------------

function parseMentionHref(href: string): { kind: string; id: string } | null {
  const m = /^jul-editor:([^/]+)\/(.*)$/.exec(href);
  if (!m) return null;
  try {
    return { kind: decodeURIComponent(m[1]!), id: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}

mention.toMarkdown = (inl, ctx) => {
  const { kind, id, label } = (inl as { attrs: { kind: string; id: string; label: string } }).attrs;
  return `[${kind === "tag" ? "#" : "@"}${ctx.escapeText(label)}](jul-editor:${encodeURIComponent(kind)}/${encodeURIComponent(id)})`;
};
mention.toHTML = (inl, ctx) => {
  const { kind, id, label } = (inl as { attrs: { kind: string; id: string; label: string } }).attrs;
  const href = `jul-editor:${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
  return `<a data-mention data-kind="${ctx.escapeAttr(kind)}" data-id="${ctx.escapeAttr(id)}" href="${ctx.escapeAttr(href)}">${kind === "tag" ? "#" : "@"}${ctx.escapeText(label)}</a>`;
};
mention.toText = (inl) => {
  const { kind, label } = (inl as { attrs: { kind: string; label: string } }).attrs;
  return `${kind === "tag" ? "#" : "@"}${label}`;
};
mention.fromMarkdownLink = (href, text) => {
  const m = parseMentionHref(href);
  if (!m) return null;
  return { type: "mention", attrs: { kind: m.kind, id: m.id, label: text.replace(m.kind === "tag" ? /^#/ : /^@/, "") } };
};

// attaches image/embed's own toMarkdown/toHTML/toText/fromMarkdown-
// fence/fromHTML hooks (see media-serde.ts) onto the SAME `image`/`embed`
// spec objects this file's own `coreRegistry` is built from -- a plain
// side-effecting import (mutation happens at module-load time, same
// convention as every hook assignment above), so every one of this file's
// four consumers (to-markdown/to-html/from-markdown/from-html.ts) gets them
// automatically just by importing `coreRegistry` from here. Kept in a
// separate file (not inlined above) so the image/embed carve-out
// of this shared file stays a one-line addition instead of a scattered diff;
// package.json's `sideEffects` allowlist only needs to name this one file's
// src path -- media-serde.ts is reached transitively through it.
import "./media-serde.js";
// same pattern -- table's own toMarkdown/toHTML/toText hooks (colspan/
// rowspan-aware, see table-serde.ts) live in their own file, one line here.
import "./table-serde.js";
