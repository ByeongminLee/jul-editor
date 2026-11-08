import type { Block, Inline, Json, Mark } from "./types.js";

export type ContentKind = "inline" | "none" | "code";
export type ChildrenKind = "any" | "none" | readonly string[];

// keymap/inputRules are typed `unknown` here on purpose: their concrete shapes
// (`Keymap` from view/keymap.ts, `InputRuleEntry[]` from view/inputRules.ts)
// reference view-layer types (KeymapCtx needs EditorState/Registry/Dispatch
// from store/), and model/ must stay decoupled from store/ to avoid a layering
// cycle (store/ already depends on model/). The view layer casts these back to
// their real types when reading them (view/keymap.ts's currentBlockKeymap,
// view/inputRules.ts's currentBlockInputRules) -- see builtins-keymap.ts for
// how the built-in codeBlock/todoListItem/tableCell specs attach real ones.
// slash is still unused. toMarkdown/toHTML/toText/fromMarkdown
// are the registry-driven serde dispatch hooks (see serde/builtins-serde.ts
// for the built-in implementations, which live there instead of here).
export interface BlockHooks {
  keymap?: unknown;
  inputRules?: unknown;
  slash?: unknown;
  toMarkdown?(block: Block, ctx: RenderCtx): string | { text: string; lossy?: string };
  toHTML?(block: Block, ctx: RenderCtx): string;
  toText?(block: Block, ctx: RenderCtx): string;
  fromMarkdown?: FromMarkdownHook;
  /** Intercepts a block-level markdown token (blockquote, html, paragraph, ...)
   * BEFORE core's default conversion, for syntaxes the parser has no native
   * seam for: `> [!NOTE]` alerts, `<details>`, a `[TOC]` paragraph, an
   * `<!-- pagebreak -->` comment. Every registered block's hook is tried in
   * registry order; the first non-null result wins. Runs in fromMarkdown, in
   * the clipboard paste path (decodeClipboard) and for nested tokens (quote
   * children, list item bodies). */
  fromMarkdownBlock?: FromMarkdownBlockHook;
  /** Attributes mirrored onto this block's wrapper element (`data-*`, `aria-*`,
   * `class` is NOT allowed) by core's renderer, recomputed on every update of
   * the block. Lets a plugin expose presentational props (callout color,
   * toggle open) to CSS without a custom renderer. Names must match
   * /^(data|aria)-[a-z0-9-]+$/; others are ignored. */
  wrapperAttrs?(block: Block): Record<string, string | undefined>;
  /** a paste/fromHTML hook for a custom block type. `selector` is
   * matched via `element.matches(selector)`; `parse` returns the Block (own
   * fresh id) or null to fall back to serde/from-html.ts's generic handling
   * (whitelist tag dispatch, or unwrap-to-children for an unrecognized
   * element). Reuses the same `ParseCtx` shape as fromMarkdown's hook. */
  fromHTML?: FromHTMLHook;
}

/** DOM Element type: browser-only, but this is a type-only reference (no
 * runtime DOM access at module load) -- see BlockHooks.fromHTML. */
export interface FromHTMLHook {
  selector: string;
  parse(el: Element, ctx: ParseCtx): Block | null;
}

/** A fenced-code-block-language-tag-dispatched block parser (e.g. "mermaid",
 * "jul-editor-chart"). `fence` is matched against the code fence's info string
 * (a string, or any of an array of accepted aliases -- e.g. diagram accepts
 * both "mermaid" and legacy "jul-editor-mermaid"); `parse` returns the Block
 * (with its own fresh id) or null to fall back to a plain codeBlock (e.g. on
 * malformed content). */
export interface FromMarkdownHook {
  fence: string | readonly string[];
  parse(token: { text: string }, ctx: ParseCtx): Block | null;
}

/** The lexer token a `fromMarkdownBlock` hook sees: marked's block token, narrowed to
 * the fields a hook may rely on. `raw` is the exact source slice, `text` the token's own
 * text (a paragraph's source text, an html block's markup, a blockquote's inner source). */
export interface MarkdownBlockToken {
  type: string;
  raw: string;
  text: string;
}

export interface FromMarkdownBlockCtx extends ParseCtx {
  /** Core's default conversion of THIS token (no hooks re-entered for it, but nested
   * tokens still go through hooks). Lets a hook post-process: `quoteToCallout(ctx.default()[0])`. */
  default(): Block[];
  /** The sibling tokens that follow this one, for multi-token constructs (a `<details>`
   * whose body is split into several tokens by blank lines). Return `consumed` to swallow them. */
  following: readonly MarkdownBlockToken[];
  /** Parses a markdown fragment into blocks with the same registry (hooks included). */
  parseMarkdown(md: string): Block[];
  /** Parses a single line/paragraph of markdown into inline content. */
  parseInline(md: string): Inline[];
}

/** Result of a fromMarkdownBlock hook. `null`/`undefined` = not mine (try the next hook, then
 * the default conversion). `consumed` = how many of `ctx.following` tokens were also used. */
export type FromMarkdownBlockResult = Block | Block[] | { blocks: Block[]; consumed: number } | null | undefined;
export type FromMarkdownBlockHook = (token: MarkdownBlockToken, ctx: FromMarkdownBlockCtx) => FromMarkdownBlockResult;

/** Context passed to a block's fromMarkdown.parse hook. There is no "current
 * block" yet (the hook is building one), so lossy reports are addressed explicitly. */
export interface ParseCtx {
  registry: Registry;
  sanitizeUrl(url: string, kind: "link" | "image"): string | null;
  lossy(blockId: string, type: string, reason: string): void;
}

/** Context passed to a block/inline/mark's toMarkdown/toHTML/toText hook.
 * The concrete functions differ per output format (e.g. `escapeText` is
 * markdown-inline-escaping for toMarkdown, HTML-entity-escaping for toHTML)
 * but the shape is the same so a hook can be written once per format without
 * caring which registry-driven entry point is calling it. */
export interface RenderCtx {
  registry: Registry;
  /** Serializes inline content as this block's own text in the current
   * output format (marks/mentions/generic inlines dispatched via the
   * registry). For markdown this also trims edge whitespace and escapes any
   * markdown-significant line-start sequence -- the safe default for a
   * block's own rendered line(s). */
  inlines(content: Inline[] | undefined): string;
  /** Serializes this block's `children` list in the current output format.
   * Calling this marks the children as "handled" by this hook -- a
   * `children: 'any'` block that does NOT call it has its children
   * auto-flattened to following siblings (markdown, lossy `nesting-flattened`)
   * or auto-wrapped in a generic `<div data-jul-editor-children>` (HTML) by the
   * registry-driven dispatcher instead. Blocks with a fixed (non-'any')
   * children shape (e.g. table -> tableRow -> tableCell) are exempt from
   * both fallbacks and may ignore this entirely. */
  children(): string;
  /** Escapes a plain-text fragment (not full inline content, e.g. an image alt or a prop). */
  escapeText(s: string): string;
  /** Escapes/quotes a value for an attribute or link-destination position. */
  escapeAttr(s: string): string;
  sanitizeUrl(url: string, kind: "link" | "image"): string | null;
  /** Records a lossy-conversion reason against THIS block/inline. */
  lossy(reason: string): void;
  /** Records a lossy-conversion reason against an arbitrary (e.g. nested) block/inline. */
  pushLossy(blockId: string, type: string, reason: string): void;
  /** Current nesting depth (0 = top level). */
  indent: number;
  /** 1-based count of consecutive preceding siblings sharing this block's
   * type (including this one) -- e.g. for a numbered-list-style marker. */
  orderedIndex: number;
  /** toMarkdown only: whether the caller asked for jul-editor-extension warnings (opts.strict). */
  strict: boolean;
}

export interface BlockSpec extends BlockHooks {
  type: string;
  content: ContentKind;
  children: ChildrenKind;
  /** Allowed parent block types. Undefined = allowed at doc root or inside any 'any'-children container. */
  parent?: readonly string[];
  /** Merges/splits/indents may not cross this block's boundary. */
  isolating?: boolean;
  indentable?: boolean;
  /** a non-void block gets a "decorated" non-editable sibling beside its
   * editable content or children, mounted the same way a void container is -- see
   * view/decorations.ts. A host that registers a renderer for a non-void
   * type without setting this is still covered (the React layer sets it
   * automatically in that case); this flag is for a spec that wants the slot
   * unconditionally, even before any renderer is registered. */
  decorated?: boolean;
  /** Default prop values. Normalized/stored docs omit props equal to these. */
  props: Record<string, Json>;
}

export interface InlineSpec {
  type: string;
  attrs?: Record<string, Json>;
  toMarkdown?(inline: Inline, ctx: RenderCtx): string;
  toHTML?(inline: Inline, ctx: RenderCtx): string;
  toText?(inline: Inline, ctx: RenderCtx): string;
  /** Parses a markdown link token into this inline type (e.g. mention's
   * `jul-editor:<kind>/<id>` links). Returns null when `href` doesn't match. */
  fromMarkdownLink?(href: string, text: string): Inline | null;
}

export interface MarkSpec {
  type: string;
  attrs?: Record<string, Json>;
  /** Static wrap syntax for the common case (bold/italic/strike/a custom
   * mark like highlight's `==text==`). Marks needing dynamic content (link's
   * href, code's different escaping) are special-cased by the renderer
   * instead of using this. `parse` is the reverse direction: without
   * it, `open`/`close` only round-trips through toMarkdown -- marked (the
   * fromMarkdown parser, serde/from-markdown.ts) has no native syntax for an
   * arbitrary custom mark, so it would otherwise come back as plain text.
   * `start` is a plain substring marked's own `start(src)` hook uses to find
   * the EARLIEST candidate position of this mark in the remaining source
   * (an optimization/priority signal, same role as marked's own built-in
   * token starts); `tokenizer` matches from the very beginning of the
   * remaining source and must capture the wrapped inner text in its first
   * capture group (e.g. `/^==([^=\n]+)==/` for `==highlight==`). */
  markdown?: { open: string; close: string; parse?: { start: string; tokenizer: RegExp } };
  html?: {
    tag: string;
    attrs?(mark: Mark): Record<string, string>;
    /** Reverse of `attrs` for fromHTML (paste): given an element whose tag
     * matched `tag`, returns the Mark to apply or null to NOT treat this
     * element as the mark (needed when `tag` is a generic wrapper like
     * `span`, which would otherwise mark every pasted span). Without it,
     * a tag match applies a bare `{type}` mark. */
    parse?(el: Element): Mark | null;
  };
  /** toMarkdown drops this mark and emits the plain text (for marks with no markdown
   * form, e.g. a comment anchor). Without it a mark that only declares `html` is
   * written as its inline HTML tag in markdown. Not reported as lossy. */
  omitFromMarkdown?: boolean;
  /** Typing at a mark's boundary inherits it by default (bold continues).
   * `false` = the mark only covers text typed strictly INSIDE its range, so
   * typing right before/after it starts a plain run (comment anchors, links
   * in most editors). Read by view/marks.ts's consumeInsertMarks. */
  inclusive?: boolean;
}

export function defineBlock(spec: BlockSpec): BlockSpec {
  return spec;
}

/** True for a "void" block (image/chart/diagram/dataTable/divider): no text
 * content and no children slots of its own, so a renderer owns its entire
 * DOM subtree. Pure/DOM-free (model/ has no document access at all) so both
 * view/render.ts (the DOM renderer) and @jul-editor/react's DiffView (no DOM,
 * read-only) can share this ONE definition instead of each keeping their own
 * copy. */
export function isVoidBlockSpec(spec: BlockSpec | undefined): boolean {
  return !!spec && spec.content === "none" && spec.children === "none";
}

export function defineInline(spec: InlineSpec): InlineSpec {
  return spec;
}

export function defineMark(spec: MarkSpec): MarkSpec {
  return spec;
}

export interface Registry {
  blocks: Map<string, BlockSpec>;
  inlines: Map<string, InlineSpec>;
  marks: Map<string, MarkSpec>;
  /** Registration order, used to sort a text run's marks deterministically. */
  markOrder: Map<string, number>;
  isKnown(type: string): boolean;
  isKnownInline(type: string): boolean;
  isKnownMark(type: string): boolean;
}

export function createRegistry(opts: {
  blocks: BlockSpec[];
  inlines: InlineSpec[];
  marks: MarkSpec[];
}): Registry {
  const blocks = new Map(opts.blocks.map((b) => [b.type, b] as const));
  const inlines = new Map(opts.inlines.map((i) => [i.type, i] as const));
  const marks = new Map(opts.marks.map((m) => [m.type, m] as const));
  const markOrder = new Map(opts.marks.map((m, i) => [m.type, i] as const));
  return {
    blocks,
    inlines,
    marks,
    markOrder,
    isKnown: (type) => blocks.has(type),
    isKnownInline: (type) => type === "text" || inlines.has(type),
    isKnownMark: (type) => marks.has(type),
  };
}
