// HTML -> Doc. Browser-only (or jsdom-injected): needs a DOMParser to build
// an inert document (scripts never execute) which is then walked into the
// model and NEVER inserted into a live DOM. Security boundary: attributes are dropped
// wholesale except href/src (through sanitizeUrl) and a small read-only
// allowlist (checkbox state, `class="language-x"`, data-mention/kind/id,
// data-jul-editor-type/props/block/children).
//
// Whitelist dispatch mirrors to-html.ts's own output shape (data-jul-editor-type
// tags, the free-nesting `data-jul-editor-block`/`data-jul-editor-children` wrapper,
// the void-figure `data-jul-editor-props` convention) so pasting our own toHTML
// output round-trips, while still accepting arbitrary third-party markup
// (Google Docs/Word/Notion/GitHub) via the plain tag-name whitelist.

import { coreRegistry } from "./builtins-serde.js";
import type { DOMParserLike, FromHTMLOptions, FromHTMLResult, LossyEntry, PendingUpload } from "./types.js";
import { COLOR_PALETTE } from "../model/builtins.js";
import { normalizeDoc, TEXT_ALIGN_VALUES } from "../model/canonical.js";
import { ensureUniqueIds, newId } from "../model/id.js";
import { CURRENT_VERSION } from "../model/migrate.js";
import type { ParseCtx, Registry } from "../model/schema.js";
import type { Block, Inline, Json, Mark } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";

interface Ctx {
  registry: Registry;
  lossy: LossyEntry[];
  pendingUploads: PendingUpload[];
}

export function fromHTML(html: string, opts: FromHTMLOptions = {}): FromHTMLResult {
  const registry = opts.registry ?? coreRegistry;
  const parser = resolveParser(opts.parser);
  const parsed = parser.parseFromString(html, "text/html");
  const ctx: Ctx = { registry, lossy: [], pendingUploads: [] };
  const blocks = convertBlockChildren(Array.from(parsed.body.childNodes), ctx);
  const uniqued = ensureUniqueIds({ version: CURRENT_VERSION, blocks });
  const doc = normalizeDoc(uniqued, registry);
  return { doc, lossy: ctx.lossy, pendingUploads: ctx.pendingUploads };
}

function resolveParser(parser?: DOMParserLike): DOMParserLike {
  if (parser) return parser;
  if (typeof DOMParser !== "undefined") return new DOMParser();
  throw new Error(
    "fromHTML needs a DOMParser: this isn't a browser, so pass `parser` (e.g. jsdom's `new JSDOM('').window.DOMParser`)",
  );
}

function makeParseCtx(ctx: Ctx): ParseCtx {
  return {
    registry: ctx.registry,
    sanitizeUrl,
    lossy: (blockId, type, reason) => ctx.lossy.push({ blockId, type, reason }),
  };
}

// ---- node-kind helpers (numeric Node.* constants -- stable across DOM impls) ----

function isElementNode(n: ChildNode): n is Element {
  return n.nodeType === 1;
}
function isTextNode(n: ChildNode): boolean {
  return n.nodeType === 3;
}

function matchesSelector(el: Element, selector: string): boolean {
  try {
    return typeof el.matches === "function" && el.matches(selector);
  } catch {
    return false;
  }
}

// Dropped entirely (never executed -- DOMParser is inert -- but also never
// even read into the model, so nothing they contain can reach toHTML/DOM
// render later): script/style/iframe/object/embed/svg/math/template/noscript.
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT"]);

// Tags that end an enclosing container's "own content" run (list item /
// blockquote content-vs-children split, see splitOwnAndChildren).
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE"]);

// Collapses runs of ASCII whitespace to one space, like a browser's
// text layout does for non-`<pre>` text. Doesn't model the full CSS
// whitespace algorithm (e.g. whitespace-only text nodes right at a block
// boundary aren't specially dropped here) -- upgrade if a real paste sample
// needs it; trimEdgeWhitespace below covers the common "leading/trailing
// space around a whole block" case, which is the one that actually shows up.
function collapseWs(s: string): string {
  return s.replace(/[\t\n\r ]+/g, " ");
}

function trimEdgeWhitespace(content: Inline[]): Inline[] {
  if (content.length === 0) return content;
  const out = content.map((inl) => ({ ...inl }) as Inline);
  const first = out[0]!;
  if (first.type === "text") (first as { text: string }).text = (first as { text: string }).text.replace(/^\s+/, "");
  const last = out[out.length - 1]!;
  if (last.type === "text") (last as { text: string }).text = (last as { text: string }).text.replace(/\s+$/, "");
  return out.filter((inl) => !(inl.type === "text" && (inl as { text: string }).text === ""));
}

// ---- block-level -------------------------------------------------------------

function convertBlockChildren(nodes: ChildNode[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const n of nodes) out.push(...convertOneBlockNode(n, ctx));
  return out;
}

// Reads block-level presentation (text-align style or our own data attributes) off the source
// element onto the single text block it produced. Only whitelisted values survive.
function applyBlockStyle(el: Element, blocks: Block[]): Block[] {
  if (blocks.length !== 1 || blocks[0]!.content === undefined) return blocks;
  const align = (el.getAttribute("data-jul-editor-text-align") ?? (el as HTMLElement).style?.textAlign ?? "").trim().toLowerCase().replace("-webkit-", "");
  const color = sanitizeColorToken(el.getAttribute("data-jul-editor-block-color"));
  const bg = sanitizeColorToken(el.getAttribute("data-jul-editor-block-bg"));
  const props: Record<string, Json> = { ...blocks[0]!.props };
  if (align !== "left" && (TEXT_ALIGN_VALUES as readonly string[]).includes(align)) props.textAlign = align;
  if (color && color !== "default") props.textColor = color;
  if (bg && bg !== "default") props.backgroundColor = bg;
  return [{ ...blocks[0]!, props }];
}

function convertOneBlockNode(n: ChildNode, ctx: Ctx): Block[] {
  const blocks = convertOneBlockNodeInner(n, ctx);
  return isElementNode(n as ChildNode) && /^(P|H[1-6]|BLOCKQUOTE|LI)$/.test((n as Element).tagName) ? applyBlockStyle(n as Element, blocks) : blocks;
}

function convertOneBlockNodeInner(n: ChildNode, ctx: Ctx): Block[] {
  if (isTextNode(n)) {
    const text = collapseWs(n.textContent ?? "").trim();
    if (text === "") return [];
    return [{ id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text }] }];
  }
  if (!isElementNode(n)) return []; // comments etc.

  const el = n;
  const tag = el.tagName;

  // Custom BlockSpec.fromHTML hooks take priority over the built-in whitelist.
  for (const spec of ctx.registry.blocks.values()) {
    if (spec.fromHTML && matchesSelector(el, spec.fromHTML.selector)) {
      const block = spec.fromHTML.parse(el, makeParseCtx(ctx));
      if (block) return [block];
    }
  }

  if (DROP_TAGS.has(tag)) {
    ctx.lossy.push({ blockId: newId(), type: tag.toLowerCase(), reason: "dropped-element" });
    return [];
  }

  switch (tag) {
    case "P": {
      const img = soleImageChild(el);
      if (img) return [imageBlockFromEl(img, ctx)];
      const content = trimEdgeWhitespace(convertInlineChildren(Array.from(el.childNodes), [], ctx));
      return [{ id: newId(), type: "paragraph", props: {}, content }];
    }
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      // our own model supports heading level up to 6 (clampLevel
      // caps at 6, see builtins-serde.ts) and toHTML emits <h4>-<h6> directly
      // for those -- map every h-tag to its own numeric level instead of
      // clamping to 3, which only ever made sense for foreign markup this
      // model can't otherwise represent (there is none: h1-h6 all map 1:1).
      const level = Number(tag[1]);
      const content = trimEdgeWhitespace(convertInlineChildren(Array.from(el.childNodes), [], ctx));
      return [{ id: newId(), type: "heading", props: { level }, content }];
    }
    case "UL":
      return convertListContainer(el, false, ctx);
    case "OL":
      return convertListContainer(el, true, ctx);
    case "LI":
      // Stray <li> outside a list (malformed paste) -- treat as bullet.
      return [convertListItem(el, false, ctx)];
    case "BLOCKQUOTE": {
      const { content, children } = convertContainerContentAndChildren(el, ctx);
      const block: Block = { id: newId(), type: "quote", props: {}, content };
      if (children.length) block.children = children;
      return [block];
    }
    case "PRE":
      return [codeBlockFromPre(el, ctx)];
    case "HR":
      return [{ id: newId(), type: "divider", props: {} }];
    case "IMG":
      return [imageBlockFromEl(el, ctx)];
    case "TABLE":
      return [tableBlockFromEl(el, ctx)];
    case "BR":
      return [];
    default: {
      const blockType = el.getAttribute("data-jul-editor-type");
      if (blockType && ctx.registry.isKnown(blockType)) {
        const generic = genericJulEditorDispatch(el, blockType, ctx);
        if (generic) return [generic];
      }
      // Unknown container (div/span-at-block-level/section/article/figure/
      // the Google Docs `<b style="font-weight:normal">` wrapper, ...) --
      // unwrap to its children.
      return convertBlockChildren(Array.from(el.childNodes), ctx);
    }
  }
}

// Reconstructs a block from our own toHTML output's non-tag conventions: a
// void figure (`<figure data-jul-editor-type=X data-jul-editor-props='{...}'>`, used by
// chart/diagram/dataTable) or the free-nesting wrapper (`<div data-jul-editor-block
// data-jul-editor-type=X>OWN<div data-jul-editor-children>KIDS</div></div>`).
function genericJulEditorDispatch(el: Element, blockType: string, ctx: Ctx): Block | null {
  const propsAttr = el.getAttribute("data-jul-editor-props");
  if (propsAttr != null) {
    try {
      const props = JSON.parse(propsAttr) as Record<string, Json>;
      return { id: newId(), type: blockType, props };
    } catch {
      ctx.lossy.push({ blockId: newId(), type: blockType, reason: "invalid-jul-editor-props" });
      return null;
    }
  }
  if (tagNameOf(el) === "DIV" && el.hasAttribute("data-jul-editor-block")) {
    const kids = Array.from(el.children);
    const ownEl = kids[0];
    if (!ownEl) return null;
    const ownBlocks = convertOneBlockNode(ownEl, ctx);
    if (ownBlocks.length !== 1) return null;
    const block = ownBlocks[0]!;
    const childrenWrapper = kids.find((k) => k.hasAttribute("data-jul-editor-children"));
    if (childrenWrapper) {
      const children = convertBlockChildren(Array.from(childrenWrapper.childNodes), ctx);
      if (children.length) block.children = children;
    }
    return block;
  }
  return null;
}

function tagNameOf(el: Element): string {
  return el.tagName;
}

function soleImageChild(p: Element): Element | null {
  let found: Element | null = null;
  for (const n of Array.from(p.childNodes)) {
    if (isTextNode(n)) {
      if ((n.textContent ?? "").trim() !== "") return null;
      continue;
    }
    if (!isElementNode(n)) continue; // comment
    if (n.tagName === "IMG") {
      if (found) return null;
      found = n;
      continue;
    }
    return null;
  }
  return found;
}

function imageBlockFromEl(img: Element, ctx: Ctx): Block {
  const alt = img.getAttribute("alt") ?? "";
  const rawSrc = img.getAttribute("src") ?? "";
  if (/^data:/i.test(rawSrc.trim())) {
    const id = newId();
    ctx.pendingUploads.push({ blockId: id, dataUrl: rawSrc });
    return { id, type: "image", props: { src: "", alt } };
  }
  const safe = sanitizeUrl(rawSrc, "image") ?? "";
  return { id: newId(), type: "image", props: { src: safe, alt } };
}

function languageFromClass(cls: string): string {
  const m = /(?:^|\s)language-([\w-]+)/.exec(cls);
  return m ? m[1]! : "";
}

function codeBlockFromPre(pre: Element, ctx: Ctx): Block {
  void ctx;
  const codeEl = pre.querySelector("code") ?? pre;
  const lang = languageFromClass(codeEl.getAttribute("class") ?? "") || languageFromClass(pre.getAttribute("class") ?? "");
  const text = codeEl.textContent ?? "";
  return { id: newId(), type: "codeBlock", props: { language: lang }, content: [{ type: "text", text }] };
}

function convertListContainer(el: Element, ordered: boolean, ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName === "LI") out.push(...applyBlockStyle(child, [convertListItem(child, ordered, ctx)]));
  }
  return out;
}

// A checkbox belongs to THIS li only if it's part of the li's own
// content run (before any nested list) -- `li.querySelector` searches every
// descendant, so a nested todoListItem's checkbox was making the OUTER
// (non-todo) li a todo too. Mirrors splitOwnAndChildren's own content/children
// split so a checkbox inside a nested <li> is never found here.
function findOwnCheckbox(ownNodes: ChildNode[]): Element | null {
  for (const n of ownNodes) {
    if (!isElementNode(n)) continue;
    if (n.tagName === "INPUT" && (n.getAttribute("type") ?? "").toLowerCase() === "checkbox") return n;
    const found = n.querySelector('input[type="checkbox"]');
    if (found) return found;
  }
  return null;
}

function convertListItem(li: Element, ordered: boolean, ctx: Ctx): Block {
  const { ownNodes } = splitOwnAndChildren(li);
  const checkbox = findOwnCheckbox(ownNodes);
  const { content, children } = convertContainerContentAndChildren(li, ctx);
  if (checkbox) {
    const checked = (checkbox as HTMLInputElement).checked || checkbox.hasAttribute("checked");
    const block: Block = { id: newId(), type: "todoListItem", props: checked ? { checked: true } : {}, content };
    if (children.length) block.children = children;
    return block;
  }
  const block: Block = { id: newId(), type: ordered ? "orderedListItem" : "bulletListItem", props: {}, content };
  if (children.length) block.children = children;
  return block;
}

// Splits a container's (li/blockquote) direct children into "own content"
// (leading inline-ish nodes, or -- the common Google Docs/Notion pattern -- a
// single leading wrapping <p>) and "children" (everything from the first
// real block-level element onward). Mirrors from-markdown.ts's
// convertListItem/convertBlockquote treatment of marked's own token shape.
function splitOwnAndChildren(el: Element): { ownNodes: ChildNode[]; childNodes: ChildNode[] } {
  const all = Array.from(el.childNodes);
  let breakIdx = -1;
  for (let i = 0; i < all.length; i++) {
    const n = all[i]!;
    if (isElementNode(n) && (BLOCK_TAGS.has(n.tagName) || (n.tagName === "FIGURE" && n.getAttribute("data-jul-editor-type") === "image"))) {
      breakIdx = i;
      break;
    }
  }
  if (breakIdx === -1) return { ownNodes: all, childNodes: [] };

  const breakEl = all[breakIdx] as Element;
  const isLeadingWrap = breakEl.tagName === "P" && all.slice(0, breakIdx).every((n) => isTextNode(n) && (n.textContent ?? "").trim() === "");
  if (isLeadingWrap) {
    return { ownNodes: Array.from(breakEl.childNodes), childNodes: all.slice(breakIdx + 1) };
  }
  return { ownNodes: all.slice(0, breakIdx), childNodes: all.slice(breakIdx) };
}

function convertContainerContentAndChildren(el: Element, ctx: Ctx): { content: Inline[]; children: Block[] } {
  const { ownNodes, childNodes } = splitOwnAndChildren(el);
  const content = trimEdgeWhitespace(convertInlineChildren(ownNodes, [], ctx));
  const children = convertBlockChildren(childNodes, ctx);
  return { content, children };
}

function tableBlockFromEl(table: Element, ctx: Ctx): Block {
  const rows: Element[] = [];
  let sawThead = false;
  for (const child of Array.from(table.children)) {
    if (child.tagName === "THEAD") {
      sawThead = true;
      for (const tr of Array.from(child.children)) if (tr.tagName === "TR") rows.push(tr);
    } else if (child.tagName === "TBODY" || child.tagName === "TFOOT") {
      for (const tr of Array.from(child.children)) if (tr.tagName === "TR") rows.push(tr);
    } else if (child.tagName === "TR") {
      rows.push(child);
    }
  }
  const firstRowAllTh = rows.length > 0 && Array.from(rows[0]!.children).every((c) => c.tagName === "TH");
  const headerRow = sawThead || firstRowAllTh;
  const block: Block = { id: newId(), type: "table", props: { headerRow } };
  const rowBlocks = rows.map((tr) => rowBlockFromEl(tr, ctx));
  if (rowBlocks.length) block.children = rowBlocks;
  return block;
}

/** reads a <td>/<th>'s own `colspan`/`rowspan` attribute back, clamped
 * to a sane positive integer (<= 100 -- an adversarial/malformed paste could
 * otherwise hand the model an enormous or negative span). */
function clampSpanAttr(v: string | null): number {
  const n = v ? parseInt(v, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

function rowBlockFromEl(tr: Element, ctx: Ctx): Block {
  const cells = Array.from(tr.children)
    .filter((c) => c.tagName === "TD" || c.tagName === "TH")
    .map((cell) => {
      const colspan = clampSpanAttr(cell.getAttribute("colspan"));
      const rowspan = clampSpanAttr(cell.getAttribute("rowspan"));
      const props: Record<string, Json> = {};
      if (colspan !== 1) props.colspan = colspan;
      if (rowspan !== 1) props.rowspan = rowspan;
      return {
        id: newId(),
        type: "tableCell",
        props,
        content: trimEdgeWhitespace(convertInlineChildren(Array.from(cell.childNodes), [], ctx)),
      };
    });
  return { id: newId(), type: "tableRow", props: {}, children: cells };
}

// ---- inline-level -------------------------------------------------------------

function tryMentionFromAnchor(el: Element, text: string, registry: Registry): Inline | null {
  if (el.hasAttribute("data-mention")) {
    const kind = el.getAttribute("data-kind") ?? "";
    const id = el.getAttribute("data-id") ?? "";
    return { type: "mention", attrs: { kind, id, label: text.replace(kind === "tag" ? /^#/ : /^@/, "") } };
  }
  const href = el.getAttribute("href") ?? "";
  if (!/^jul-editor:/i.test(href)) return null;
  for (const spec of registry.inlines.values()) {
    if (spec.fromMarkdownLink) {
      const inline = spec.fromMarkdownLink(href, text);
      if (inline) return inline;
    }
  }
  return null;
}

// Only font-weight/font-style are ever read off an inline style attribute
// ("속성은 전부 버리고 href/src만 sanitizeUrl을 거쳐 추출한다" --
// same spirit for style: read only these two properties, ignore everything
// else). An explicit "normal"/"400" overrides a <b>/<strong>/<em>/<i> tag's
// default (the Google Docs `<b style="font-weight:normal" id="docs-internal-
// guid-...">` paste wrapper is "not bold" this way, generically, with no
// tag-name or id special-casing needed).
function styleWeight(el: Element): "bold" | "normal" | undefined {
  const fw = (el as HTMLElement).style?.fontWeight?.toLowerCase().trim();
  if (!fw) return undefined;
  const n = Number(fw);
  if (!Number.isNaN(n)) return n >= 600 ? "bold" : "normal";
  if (fw === "bold" || fw === "bolder") return "bold";
  if (fw === "normal" || fw === "lighter") return "normal";
  return undefined;
}

function styleItalic(el: Element): "italic" | "normal" | undefined {
  const fs = (el as HTMLElement).style?.fontStyle?.toLowerCase().trim();
  if (fs === "italic" || fs === "oblique") return "italic";
  if (fs === "normal") return "normal";
  return undefined;
}

function computeBold(tag: string, weight: "bold" | "normal" | undefined): boolean {
  if (weight === "bold") return true;
  if (weight === "normal") return false;
  return tag === "STRONG" || tag === "B";
}

function computeItalic(tag: string, style: "italic" | "normal" | undefined): boolean {
  if (style === "italic") return true;
  if (style === "normal") return false;
  return tag === "EM" || tag === "I";
}

// Google Docs (and other rich-text sources) spell underline/
// sub/sup as an inline style on a plain <span> (`text-decoration:underline`,
// `vertical-align:super|sub`), never our own <u>/<sub>/<sup> tags -- read
// that style the same way styleWeight/styleItalic already do for bold/
// italic. underline/subscript/superscript are excluded from the generic
// registry-driven tag loop below (like bold/italic/strike/code/link/
// textColor already are) so each gets exactly one check here that covers
// BOTH its own tag name and this style spelling, instead of two independent
// paths that could double up a mark.
function styleUnderline(el: Element): boolean {
  return ((el as HTMLElement).style?.textDecoration ?? "").toLowerCase().includes("underline");
}
function styleVerticalAlign(el: Element): "super" | "sub" | undefined {
  const va = (el as HTMLElement).style?.verticalAlign?.toLowerCase().trim();
  return va === "super" || va === "sub" ? va : undefined;
}
function computeUnderline(tag: string, el: Element): boolean {
  return tag === "U" || styleUnderline(el);
}
function computeSubscript(tag: string, va: "super" | "sub" | undefined): boolean {
  return tag === "SUB" || va === "sub";
}
function computeSuperscript(tag: string, va: "super" | "sub" | undefined): boolean {
  return tag === "SUP" || va === "super";
}

// fromHTML only ever accepts a COLOR_PALETTE token for
// textColor/highlight (model/builtins.ts's own contract) -- anything else
// (a hostile `url(x)`/`javascript:x`, or just foreign markup's own color
// scheme) is dropped rather than stored verbatim, same spirit as href/src
// going through sanitizeUrl.
function sanitizeColorToken(v: string | null): string | undefined {
  return v && (COLOR_PALETTE as readonly string[]).includes(v) ? v : undefined;
}

function convertInlineChildren(nodes: ChildNode[], marks: Mark[], ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) out.push(...convertOneInlineNode(n, marks, ctx));
  return out;
}

function textInline(text: string, marks: Mark[]): Inline {
  return marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text };
}

function convertOneInlineNode(n: ChildNode, marks: Mark[], ctx: Ctx): Inline[] {
  if (isTextNode(n)) {
    const text = collapseWs(n.textContent ?? "");
    return text === "" ? [] : [textInline(text, marks)];
  }
  if (!isElementNode(n)) return []; // comment
  const el = n;
  const tag = el.tagName;

  if (DROP_TAGS.has(tag)) {
    ctx.lossy.push({ blockId: newId(), type: tag.toLowerCase(), reason: "dropped-element" });
    return [];
  }
  if (tag === "BR") return [textInline("\n", marks)];

  if (tag === "A") {
    const text = el.textContent ?? "";
    const mention = tryMentionFromAnchor(el, text, ctx.registry);
    if (mention) return [mention];
    const href = el.getAttribute("href") ?? "";
    const safe = sanitizeUrl(href, "link");
    const children = Array.from(el.childNodes);
    return safe === null ? convertInlineChildren(children, marks, ctx) : convertInlineChildren(children, [...marks, { type: "link", attrs: { href: safe } }], ctx);
  }

  if (tag === "IMG") {
    // Inline (non-standalone) image: our model only has block-level images
    // (the standalone "paragraph = one image" case is intercepted in
    // convertOneBlockNode) -- fall back to alt text, mirroring fromMarkdown.
    const alt = el.getAttribute("alt") ?? "";
    return alt ? [textInline(alt, marks)] : [];
  }

  if (tag === "CODE") {
    const text = el.textContent ?? "";
    return text ? [textInline(text, [...marks, { type: "code" }])] : [];
  }

  let nextMarks = marks;
  if (computeBold(tag, styleWeight(el))) nextMarks = [...nextMarks, { type: "bold" }];
  if (computeItalic(tag, styleItalic(el))) nextMarks = [...nextMarks, { type: "italic" }];
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") nextMarks = [...nextMarks, { type: "strike" }];
  // underline/sub/sup are checked here (tag name OR the Google-
  // Docs-style inline-style spelling) instead of the generic tag-only loop
  // below, so each is recognized exactly once either way.
  const va = styleVerticalAlign(el);
  if (computeUnderline(tag, el)) nextMarks = [...nextMarks, { type: "underline" }];
  if (computeSubscript(tag, va)) nextMarks = [...nextMarks, { type: "subscript" }];
  if (computeSuperscript(tag, va)) nextMarks = [...nextMarks, { type: "superscript" }];
  // a custom mark's MarkSpec.html.tag (e.g. highlight's <mark>)
  // was write-only -- toHTML emitted it but fromHTML had no reverse lookup,
  // so pasting our own output back lost the mark. bold/italic/strike/code
  // are excluded (already handled above, with style-attribute nuance code
  // doesn't have).
  // textColor's tag is a bare <span> -- far too generic a wrapper
  // (Word/Google Docs/every framework use it for countless other reasons) to
  // treat as a mark just by tag name the way bold/italic/highlight's own
  // more semantic tags can. Only recognized when it actually carries OUR OWN
  // color-token attribute (i.e. pasting our own toHTML output back).
  if (tag === "SPAN") {
    const color = sanitizeColorToken(el.getAttribute("data-jul-editor-color"));
    if (color) nextMarks = [...nextMarks, { type: "textColor", attrs: { color } }];
  }
  for (const [type, spec] of ctx.registry.marks) {
    if (
      type === "bold" ||
      type === "italic" ||
      type === "strike" ||
      type === "code" ||
      type === "link" ||
      type === "textColor" ||
      type === "underline" ||
      type === "subscript" ||
      type === "superscript"
    ) {
      continue;
    }
    if (spec.html?.tag.toUpperCase() === tag) {
      if (spec.html.parse) {
        const parsed = spec.html.parse(el);
        if (parsed) nextMarks = [...nextMarks, parsed];
        continue;
      }
      // highlight carries a color TOKEN as a data attribute (our own
      // toHTML output, see builtins-serde.ts) when non-default -- read it
      // back so a paste of our own markup round-trips the color too, not
      // just the mark type; a bare <mark> with no such attribute is still a
      // legitimate (default-color) highlight, unlike <span>'s no-signal case.
      const color = type === "highlight" ? sanitizeColorToken(el.getAttribute("data-jul-editor-highlight")) : undefined;
      nextMarks = [...nextMarks, color ? { type, attrs: { color } } : { type }];
    }
  }

  return convertInlineChildren(Array.from(el.childNodes), nextMarks, ctx);
}
