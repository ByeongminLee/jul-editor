// Markdown -> Doc. DOM-free (must run in plain node / Cloudflare Workers).
// Parses with marked.lexer only -- never marked's HTML renderer.
// Registry-driven for the two truly-extensible seams: a fenced code
// block's language tag (BlockSpec.fromMarkdown.fence/.parse, e.g. mermaid /
// jul-editor-chart / a custom callout) and a markdown link's href
// (InlineSpec.fromMarkdownLink, e.g. mention's `jul-editor:` links, a custom
// hashtag). Native CommonMark/GFM block shapes (paragraph/heading/list/
// blockquote/table/hr) aren't fence-dispatched and stay a direct token walk
// here -- there's no "custom nesting syntax" seam to hook, only fenced code
// and links have one.

import { Marked, marked } from "marked";
import type { Token, TokenizerExtension, Tokens } from "marked";
import { coreRegistry } from "./builtins-serde.js";
import { embedLinkToBlock } from "./media-serde.js";
import { normalizeDoc } from "../model/canonical.js";
import { ensureUniqueIds, newId } from "../model/id.js";
import { CURRENT_VERSION } from "../model/migrate.js";
import type { FromMarkdownBlockCtx, MarkdownBlockToken, ParseCtx, Registry } from "../model/schema.js";
import type { Block, Inline, Json, Mark, TextInline } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";
import { CODE_TAB_PLACEHOLDER, EMPTY_MD_PLACEHOLDER } from "./escape.js";
import type { FromMarkdownOptions, FromMarkdownResult, LossyEntry } from "./types.js";

/** Builds a marked lexer scoped to `registry`'s own custom mark parse rules
 * -- a dedicated `Marked` instance, not the
 * shared default singleton, so one registry's custom marks (e.g. a
 * `==highlight==`) never leak into a call made with a different registry.
 * No custom marks at all: reuses the shared default instance untouched
 * (`marked.use()` is never called globally by this file). The returned
 * `lexer` takes no options -- `gfm` is already baked into each branch at
 * construction time; passing a call-time options object to a `Marked`
 * instance's own `.lexer()` was found (empirically) to silently drop that
 * instance's `.use()`-registered extensions instead of merging with them. */
function lexerFor(registry: Registry): { lexer(src: string): Token[] } {
  const extensions: TokenizerExtension[] = [];
  for (const [type, spec] of registry.marks) {
    const parse = spec.markdown?.parse;
    if (!parse) continue;
    extensions.push({
      name: type,
      level: "inline",
      start(src) {
        const i = src.indexOf(parse.start);
        return i >= 0 ? i : undefined;
      },
      tokenizer(src) {
        const match = parse.tokenizer.exec(src);
        if (!match) return undefined;
        // highlight's tokenizer has TWO alternative forms
        // (native "==...==" and the "<mark>...</mark>" HTML fallback, see
        // builtins-serde.ts) in one RegExp -- whichever branch matched fills
        // its own capture group, the other stays undefined.
        const inner = match[1] ?? match[2] ?? "";
        return { type, raw: match[0], text: inner, tokens: this.lexer.inlineTokens(inner) };
      },
    });
  }
  if (extensions.length === 0) return { lexer: (src) => marked.lexer(src, { gfm: true }) };
  const instance = new Marked({ gfm: true }).use({ extensions });
  return { lexer: (src) => instance.lexer(src) };
}

export function fromMarkdown(md: string, opts: FromMarkdownOptions = {}): FromMarkdownResult {
  const registry = opts.registry ?? coreRegistry;
  const lossy: LossyEntry[] = [];
  const safe = capHostileInput(md, lossy);
  const tokens = lexerFor(registry).lexer(safe);
  const blocks = convertBlockTokens(tokens, registry, lossy);
  const uniqued = ensureUniqueIds({ version: CURRENT_VERSION, blocks });
  const doc = normalizeDoc(uniqued, registry);
  return { doc, lossy };
}

// paste-DoS guards. Both of marked's own tokenizers are used
// as-is (no patching a third-party parser) -- instead the raw source is
// pre-scanned for the two specific pathological shapes and neutralized
// BEFORE lexing, so marked never sees them.
const MAX_BLOCKQUOTE_DEPTH = 64;
const HOSTILE_INLINE_LIMIT = 3000;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/** Caps a line's leading '>' run at MAX_BLOCKQUOTE_DEPTH: marked's
 * blockquote tokenizer recurses once per nesting level with no depth limit
 * of its own (a ~2000-deep run overflows the call stack). Excess
 * '>' markers are backslash-escaped (not just left bare) so they can't
 * either re-trigger nesting as "content" of the capped blockquote or defeat
 * the cap by being re-scanned. */
function capBlockquoteDepth(md: string, lossy: LossyEntry[]): string {
  let truncated = false;
  const out = md
    .split("\n")
    .map((line) => {
      const m = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(line);
      if (!m) return line;
      const run = m[0];
      const count = (run.match(/>/g) ?? []).length;
      if (count <= MAX_BLOCKQUOTE_DEPTH) return line;
      truncated = true;
      let kept = 0;
      let rebuilt = "";
      for (const ch of run) {
        if (ch !== ">") {
          rebuilt += ch;
        } else if (kept < MAX_BLOCKQUOTE_DEPTH) {
          rebuilt += ">";
          kept++;
        } else {
          rebuilt += "\\>";
        }
      }
      return rebuilt + line.slice(run.length);
    })
    .join("\n");
  if (truncated) lossy.push({ blockId: newId(), type: "blockquote", reason: "depth-limit" });
  return out;
}

/** Escapes emphasis/strikethrough delimiters inside any hostile-length
 * "prose run" (consecutive non-blank, non-fenced-code lines) -- marked's
 * emphasis/strikethrough delimiter scan is quadratic in the length of a
 * single inline run (30 KB of "*a " takes seconds). Escaping
 * removes every delimiter candidate from that run so the scan has nothing
 * to do; fenced code content is left untouched (tracked separately so its
 * own `*`/`_`/`~` are never touched). */
function capHostileInline(md: string, lossy: LossyEntry[]): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fenceChar: string | null = null;
  let flagged = false;

  const flush = () => {
    if (prose.length === 0) return;
    const text = prose.join("\n");
    if (text.length > HOSTILE_INLINE_LIMIT) {
      flagged = true;
      out.push(text.replace(/[*_~]/g, "\\$&"));
    } else {
      out.push(text);
    }
    prose = [];
  };

  for (const line of lines) {
    if (fenceChar) {
      out.push(line);
      const m = FENCE_LINE.exec(line);
      if (m && m[1]![0] === fenceChar) fenceChar = null;
      continue;
    }
    const m = FENCE_LINE.exec(line);
    if (m) {
      flush();
      fenceChar = m[1]![0]!;
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flush();
  if (flagged) lossy.push({ blockId: newId(), type: "paragraph", reason: "hostile-input-capped" });
  return out.join("\n");
}

function capHostileInput(md: string, lossy: LossyEntry[]): string {
  return capHostileInline(capBlockquoteDepth(md, lossy), lossy);
}

function convertBlockTokens(tokens: Token[], registry: Registry, lossy: LossyEntry[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const hooked = tryBlockHooks(tokens, i, registry, lossy);
    if (hooked) {
      out.push(...hooked.blocks);
      i += hooked.consumed;
      continue;
    }
    out.push(...convertOneBlockToken(tokens[i]!, registry, lossy));
  }
  return out;
}

/** BlockSpec.fromMarkdownBlock dispatch: first hook (registry order) returning non-null wins. */
function tryBlockHooks(tokens: Token[], i: number, registry: Registry, lossy: LossyEntry[]): { blocks: Block[]; consumed: number } | null {
  const t = tokens[i]!;
  if (t.type === "space") return null;
  let ctx: FromMarkdownBlockCtx | undefined;
  for (const spec of registry.blocks.values()) {
    const hook = spec.fromMarkdownBlock;
    if (!hook) continue;
    ctx ??= {
      ...makeParseCtx(registry, lossy),
      default: () => convertOneBlockToken(t, registry, lossy),
      following: tokens.slice(i + 1).map(toHookToken),
      parseMarkdown: (md) => convertBlockTokens(lexerFor(registry).lexer(md), registry, lossy),
      parseInline: (md) => {
        const b = convertBlockTokens(lexerFor(registry).lexer(md), registry, lossy)[0];
        return b?.content ?? [];
      },
    };
    const r = hook(toHookToken(t), ctx);
    if (!r) continue;
    if (Array.isArray(r)) return { blocks: r, consumed: 0 };
    if ("blocks" in r) return { blocks: r.blocks, consumed: Math.max(0, Math.min(r.consumed, tokens.length - i - 1)) };
    return { blocks: [r], consumed: 0 };
  }
  return null;
}

function toHookToken(t: Token): MarkdownBlockToken {
  const g = t as Tokens.Generic;
  return { type: t.type, raw: t.raw ?? "", text: typeof g.text === "string" ? g.text : (t.raw ?? "") };
}

function convertOneBlockToken(t: Token, registry: Registry, lossy: LossyEntry[]): Block[] {
  switch (t.type) {
    case "space":
      return [];
    case "def": {
      const tk = t as Tokens.Def;
      lossy.push({ blockId: `def:${tk.tag}`, type: "def", reason: "reference-definition" });
      return [];
    }
    case "hr":
      return [{ id: newId(), type: "divider", props: {} }];
    case "heading": {
      const tk = t as Tokens.Heading;
      return [{ id: newId(), type: "heading", props: { level: tk.depth }, content: inlineTokensToInlines(tk.tokens ?? [], [], registry, lossy) }];
    }
    case "paragraph": {
      const tk = t as Tokens.Paragraph;
      return [paragraphTokensToBlock(tk.tokens ?? [], registry, lossy)];
    }
    case "code":
      return [codeTokenToBlock(t as Tokens.Code, registry, lossy)];
    case "blockquote":
      return [convertBlockquote(t as Tokens.Blockquote, registry, lossy)];
    case "list": {
      const tk = t as Tokens.List;
      return tk.items.map((item) => convertListItem(item, tk.ordered, registry, lossy));
    }
    case "table":
      return [convertTable(t as Tokens.Table, registry, lossy)];
    case "html": {
      const tk = t as Tokens.HTML;
      lossy.push({ blockId: newId(), type: "html", reason: "raw-html" });
      return [{ id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text: tk.text }] }];
    }
    default:
      lossy.push({ blockId: newId(), type: t.type, reason: "unknown-type" });
      return [];
  }
}

function paragraphTokensToBlock(tokens: Token[], registry: Registry, lossy: LossyEntry[]): Block {
  if (tokens.length === 1 && tokens[0]!.type === "image") {
    return imageTokenToBlock(tokens[0] as Tokens.Image);
  }
  // a paragraph that's exactly one youtube/vimeo link converts back
  // to an embed block -- the reverse of embed.toMarkdown's own
  // `[title or url](url)` export (see media-serde.ts's embedLinkToBlock).
  // x/link providers are deliberately NOT recognized here (embed.toMarkdown
  // never round-trips those -- see its own comment), so a plain link stays
  // a plain link, same as any other paragraph-of-one-link.
  if (tokens.length === 1 && tokens[0]!.type === "link") {
    const linkTk = tokens[0] as Tokens.Link;
    const href = sanitizeUrl(linkTk.href, "link");
    if (href !== null) {
      const embed = embedLinkToBlock(href, plainText(linkTk.tokens ?? []));
      if (embed) return embed;
    }
  }
  const content = stripEmptyPlaceholder(inlineTokensToInlines(tokens, [], registry, lossy));
  return { id: newId(), type: "paragraph", props: {}, content };
}

// The placeholder toMarkdown emits for an otherwise-empty
// inline-content block (paragraph/list-item/quote own content, see
// builtins-serde.ts) parses back as ordinary text -- strip it back to
// genuinely empty content here, the one place all of those paths converge.
function stripEmptyPlaceholder(content: Inline[]): Inline[] {
  if (content.length === 1) {
    const only = content[0]!;
    if (only.type === "text" && (only as TextInline).text === EMPTY_MD_PLACEHOLDER && !(only as TextInline).marks?.length) {
      return [];
    }
  }
  return content;
}

function imageTokenToBlock(img: Tokens.Image): Block {
  const src = sanitizeUrl(img.href, "image") ?? "";
  // img.text is the RAW (unescaped) source of the alt label --
  // img.tokens is the already-resolved form (an "escape" token's `\*`
  // decoded to a plain "*"), reusing the same plainText() helper `link`
  // tokens already rely on below.
  const props: Record<string, Json> = { src, alt: plainText(img.tokens ?? []) };
  // the image title (`![alt](src "caption")`) round-trips as caption;
  // width/align have no markdown spelling, see image.toMarkdown's own
  // conditional lossy report.
  if (img.title) props.caption = img.title;
  return { id: newId(), type: "image", props };
}

function makeParseCtx(registry: Registry, lossy: LossyEntry[]): ParseCtx {
  return {
    registry,
    sanitizeUrl,
    lossy: (blockId, type, reason) => lossy.push({ blockId, type, reason }),
  };
}

// Fenced code blocks: dispatched by info-string language tag through the
// registry (BlockSpec.fromMarkdown.fence/.parse) -- see builtins-serde.ts for
// mermaid/jul-editor-chart/jul-editor-datatable. A tag matching no registered block
// (including a parse() that returns null, e.g. malformed JSON) falls back to
// a plain codeBlock.
function codeTokenToBlock(tk: Tokens.Code, registry: Registry, lossy: LossyEntry[]): Block {
  const langRaw = (tk.lang ?? "").trim().split(/\s+/)[0] ?? "";
  for (const spec of registry.blocks.values()) {
    const hook = spec.fromMarkdown;
    const fenceMatches = hook !== undefined && (Array.isArray(hook.fence) ? hook.fence.includes(langRaw) : hook.fence === langRaw);
    if (fenceMatches && hook) {
      const block = hook.parse({ text: tk.text }, makeParseCtx(registry, lossy));
      if (block) return block;
      break;
    }
  }
  // unconditionally reverse the nested-tab placeholder swap (a
  // no-op when it was never applied -- see codeBlock.toMarkdown/
  // CODE_TAB_PLACEHOLDER's own comment).
  const text = tk.text.split(CODE_TAB_PLACEHOLDER).join("\t");
  return { id: newId(), type: "codeBlock", props: { language: langRaw }, content: [{ type: "text", text }] };
}

function convertBlockquote(tk: Tokens.Blockquote, registry: Registry, lossy: LossyEntry[]): Block {
  const inner = convertBlockTokens(tk.tokens ?? [], registry, lossy);
  let content: Inline[] = [];
  let children = inner;
  if (inner.length && inner[0]!.type === "paragraph") {
    content = inner[0]!.content ?? [];
    children = inner.slice(1);
  }
  const block: Block = { id: newId(), type: "quote", props: {}, content };
  if (children.length) block.children = children;
  return block;
}

function convertListItem(item: Tokens.ListItem, ordered: boolean, registry: Registry, lossy: LossyEntry[]): Block {
  let checked: boolean | undefined;
  let contentTokens: Token[] | undefined;
  const children: Block[] = [];

  for (const t of item.tokens) {
    if (t.type === "checkbox") {
      checked = (t as Tokens.Checkbox).checked;
      continue;
    }
    if (t.type === "space") continue;
    if (!contentTokens && (t.type === "paragraph" || t.type === "text")) {
      // For a *loose* task item, marked nests the checkbox token inside
      // this wrapper (item.tokens[0].tokens[0]) instead of as a sibling of
      // it (verified empirically) -- the tight case is already handled by
      // the top-level "checkbox" branch above.
      let inner = (t as Tokens.Paragraph | Tokens.Text).tokens ?? [];
      if (inner.length && inner[0]!.type === "checkbox") {
        checked = (inner[0] as Tokens.Checkbox).checked;
        inner = inner.slice(1);
      }
      contentTokens = inner;
      continue;
    }
    children.push(...(tryBlockHooks([t], 0, registry, lossy)?.blocks ?? convertOneBlockToken(t, registry, lossy)));
  }

  const content = paragraphTokensToBlock(contentTokens ?? [], registry, lossy);
  const type = item.task ? "todoListItem" : ordered ? "orderedListItem" : "bulletListItem";
  const props: Record<string, Json> = item.task ? { checked: !!checked } : {};
  const block: Block = { id: newId(), type, props };
  if (content.type === "paragraph") {
    block.content = content.content ?? [];
  } else {
    block.content = [];
    children.unshift(content);
  }
  if (children.length) block.children = children;
  return block;
}

function convertTable(tk: Tokens.Table, registry: Registry, lossy: LossyEntry[]): Block {
  const cellBlock = (cell: Tokens.TableCell): Block => ({
    id: newId(),
    type: "tableCell",
    props: {},
    content: inlineTokensToInlines(cell.tokens ?? [], [], registry, lossy),
  });
  const headerRow: Block = { id: newId(), type: "tableRow", props: {}, children: tk.header.map(cellBlock) };
  const bodyRows: Block[] = tk.rows.map((row) => ({ id: newId(), type: "tableRow", props: {}, children: row.map(cellBlock) }));
  return { id: newId(), type: "table", props: { headerRow: true }, children: [headerRow, ...bodyRows] };
}

function inlineTokensToInlines(tokens: Token[], marks: Mark[], registry: Registry, lossy: LossyEntry[]): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens) {
    // a custom mark's own parse extension (lexerFor above) emits a
    // token whose `type` is exactly that mark's registry type name -- check
    // BEFORE the switch (its cases are compile-time literals, so a
    // registry-driven type can't be one of them) so it wraps its inner
    // tokens in that mark instead of falling into the generic passthrough.
    const markSpec = registry.marks.get(t.type);
    if (markSpec?.markdown?.parse) {
      const generic = t as Tokens.Generic;
      out.push(...inlineTokensToInlines(generic.tokens ?? [], [...marks, { type: t.type }], registry, lossy));
      continue;
    }
    switch (t.type) {
      case "text":
      case "escape": {
        const text = (t as Tokens.Text | Tokens.Escape).text;
        out.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
        break;
      }
      case "strong":
        out.push(...inlineTokensToInlines((t as Tokens.Strong).tokens, [...marks, { type: "bold" }], registry, lossy));
        break;
      case "em":
        out.push(...inlineTokensToInlines((t as Tokens.Em).tokens, [...marks, { type: "italic" }], registry, lossy));
        break;
      case "del":
        out.push(...inlineTokensToInlines((t as Tokens.Del).tokens, [...marks, { type: "strike" }], registry, lossy));
        break;
      case "codespan": {
        const text = (t as Tokens.Codespan).text;
        out.push({ type: "text", text, marks: [...marks, { type: "code" }] });
        break;
      }
      case "link": {
        const tk = t as Tokens.Link;
        const text = plainText(tk.tokens ?? []);
        const fromLink = fromMarkdownLinkInline(tk.href, text, registry);
        if (fromLink) {
          out.push(fromLink);
          break;
        }
        const safe = sanitizeUrl(tk.href, "link");
        if (safe === null) {
          out.push(...inlineTokensToInlines(tk.tokens ?? [], marks, registry, lossy));
        } else {
          out.push(...inlineTokensToInlines(tk.tokens ?? [], [...marks, { type: "link", attrs: { href: safe } }], registry, lossy));
        }
        break;
      }
      case "image": {
        // Inline (non-standalone) image -- our model only has block-level
        // images. Fall back to the alt text; the standalone case (a
        // paragraph consisting solely of one image) is intercepted earlier.
        out.push({ type: "text", text: (t as Tokens.Image).text ?? "" });
        break;
      }
      case "br":
        out.push({ type: "text", text: "\n" });
        break;
      case "html": {
        const tk = t as Tokens.Tag;
        // a literal `<br>` is our own (and GFM table cells'/
        // Notion's/etc) spelling of an inline hard break where a raw "\n"
        // can't be used (e.g. inside a heading, a single ATX line) --
        // recognized losslessly instead of falling into the generic
        // degrade-to-text-and-report-lossy path below.
        if (/^<br\s*\/?>$/i.test(tk.text)) {
          out.push(marks.length ? { type: "text", text: "\n", marks: [...marks] } : { type: "text", text: "\n" });
          break;
        }
        lossy.push({ blockId: newId(), type: "html", reason: "raw-html" });
        out.push({ type: "text", text: tk.text });
        break;
      }
      default: {
        const generic = t as Tokens.Generic;
        if (Array.isArray(generic.tokens)) {
          out.push(...inlineTokensToInlines(generic.tokens, marks, registry, lossy));
        } else if (typeof generic.text === "string") {
          out.push(marks.length ? { type: "text", text: generic.text, marks: [...marks] } : { type: "text", text: generic.text });
        }
      }
    }
  }
  return out;
}

// A markdown link becomes a custom inline (mention, hashtag, ...) when some
// registered InlineSpec's fromMarkdownLink recognizes the href -- checked
// before falling back to a plain link mark.
function fromMarkdownLinkInline(href: string, text: string, registry: Registry): Inline | null {
  for (const spec of registry.inlines.values()) {
    if (spec.fromMarkdownLink) {
      const inline = spec.fromMarkdownLink(href, text);
      if (inline) return inline;
    }
  }
  return null;
}

function plainText(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    if (t.type === "text" || t.type === "escape" || t.type === "codespan") out += (t as Tokens.Text | Tokens.Escape | Tokens.Codespan).text;
    else if ("tokens" in t && Array.isArray((t as Tokens.Generic).tokens)) out += plainText((t as Tokens.Generic).tokens!);
  }
  return out;
}
