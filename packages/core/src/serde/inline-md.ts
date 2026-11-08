// Registry-driven inline (text run + mention + custom inline) rendering for
// markdown. Marks apply generically via MarkSpec.markdown (bold/italic/
// strike/a custom mark like highlight); "code" and "link" stay special-cased
// since they change escaping strategy / need a dynamic href, not a static
// wrap. Raw (untrimmed, no line-start escaping) -- to-markdown.ts's ctx.inlines
// wraps this with the block-own-line treatment (trim + escapeMdLines); table
// cells call this directly since a cell isn't at a markdown line start.
import { isText } from "../model/canonical.js";
import type { MarkSpec, RenderCtx, Registry } from "../model/schema.js";
import type { Inline, TextInline } from "../model/types.js";
import { escapeMdInline, mdHref, wrapCodespan } from "./escape.js";

export function renderInlineListMd(content: Inline[] | undefined, registry: Registry, ctx: RenderCtx): string {
  const nodes = content ?? [];
  // Two passes: first the "core" text each node would render on its own (for
  // a text run, escaped but not yet mark-wrapped), then the actual render --
  // a mark's flanking-safety depends on what character actually
  // ends up immediately before/after it, i.e. the PREVIOUS/NEXT sibling's own
  // edge character, which isn't known until that sibling has been rendered.
  const cores = nodes.map((inl) => (isText(inl) ? coreTextMd(inl) : renderInlineNodeMd(inl, registry, ctx)));
  return nodes
    .map((inl, i) => (isText(inl) ? wrapTextRunMd(inl, registry, ctx, cores[i - 1], cores[i + 1]) : cores[i]!))
    .join("");
}

function renderInlineNodeMd(inl: Inline, registry: Registry, ctx: RenderCtx): string {
  if (isText(inl)) return wrapTextRunMd(inl, registry, ctx, undefined, undefined);
  const spec = registry.inlines.get(inl.type);
  if (spec?.toMarkdown) return spec.toMarkdown(inl, ctx);
  return "";
}

/** A text run's own rendered form BEFORE any bold/italic/strike/custom-mark
 * wrapping -- codespan content is exempt (literal, not further escaped). */
function coreTextMd(run: TextInline): string {
  const hasCode = (run.marks ?? []).some((m) => m.type === "code");
  return hasCode ? wrapCodespan(run.text) : escapeMdInline(run.text);
}

// a registered custom mark's own delimiter (e.g. highlight's
// "==") has no reason to be in escapeMdInline's fixed char class, so plain
// text containing it must still be protected registry-drivenly. Marks whose
// delimiter already starts with one of escapeMdInline's fixed chars
// (bold "**", italic "*", strike "~~") are skipped -- that first char is
// already escaped per-occurrence, which already breaks up the delimiter run.
const FIXED_ESCAPE_CHARS = new Set(["\\", "*", "_", "[", "]", "~", "<", "&", "`"]);

function escapeRegisteredDelimiters(text: string, registry: Registry): string {
  let out = text;
  for (const spec of registry.marks.values()) {
    const open = spec.markdown?.open;
    if (!open || FIXED_ESCAPE_CHARS.has(open[0]!)) continue;
    if (out.includes(open)) out = out.split(open).join("\\" + open);
    const close = spec.markdown?.close;
    if (close && close !== open && !FIXED_ESCAPE_CHARS.has(close[0]!) && out.includes(close)) {
      out = out.split(close).join("\\" + close);
    }
  }
  return out;
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

function isWhitespaceOrEdge(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}
function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && ASCII_PUNCT.test(ch);
}

/** Approximates CommonMark's `*`-style (intraword-capable) flanking-
 * delimiter-run rule for wrapping `content` given the characters that will
 * actually end up immediately before/after it once rendered. `*`/`**` (and
 * any custom delimiter) may open/close inside a word, but NOT with edge
 * whitespace inside the run, and NOT when a punctuation edge character is
 * immediately followed/preceded by a non-whitespace, non-punctuation
 * character (bold ending in a quote directly before CJK). */
function canWrapWithAsterisks(content: string, prevChar: string | undefined, nextChar: string | undefined): boolean {
  if (content === "" || /^\s/.test(content) || /\s$/.test(content)) return false;
  const first = content[0]!;
  const last = content[content.length - 1]!;
  const openOk = !isWhitespaceOrEdge(first) && (!isPunct(first) || isWhitespaceOrEdge(prevChar) || isPunct(prevChar));
  const closeOk = !isWhitespaceOrEdge(last) && (!isPunct(last) || isWhitespaceOrEdge(nextChar) || isPunct(nextChar));
  return openOk && closeOk;
}

// highlight is the only mark whose native markdown spelling
// ("==") differs from its own HTML-tag fallback ("<mark>") -- every other
// mark's `.open` IS its fallback form (bold/italic/strike's fallback is a
// DIFFERENT tag, but their native "**"/"*"/"~~" is already escaped char-by-
// char wherever it occurs in plain text, see escapeMdInline/
// escapeRegisteredDelimiters, so it can never collide with itself). A literal
// "==" inside highlighted content survives (escapeRegisteredDelimiters above
// already backslash-escapes it before this runs), but re-parsing that through
// "==...==" would rely on marked re-decoding the escape inside our own custom
// tokenizer -- simpler and more robust to just use `<mark>` for that content,
// same as an embedded hard break (a raw "\n" can't survive "==...==" at all).
function canUseNativeDelimiter(spec: MarkSpec, s: string): boolean {
  if (spec.markdown?.open !== "==") return true;
  return !s.includes("==") && !s.includes("\n");
}

/** Wraps `s` in one mark layer, choosing between the mark's static markdown
 * delimiter and its HTML-tag form: a delimiter that would
 * not flank correctly here -- edge whitespace inside the run, or a
 * punctuation edge directly touching non-punctuation/non-whitespace, most
 * commonly CJK text -- falls back to `<strong>`/`<em>`/`<del>` etc, which
 * from-markdown.ts reads back via the same registry-driven mark.markdown.parse
 * extension mechanism a custom mark uses (see builtins-serde.ts). */
function wrapMark(spec: MarkSpec, s: string, prevChar: string | undefined, nextChar: string | undefined): string {
  if (spec.markdown && canWrapWithAsterisks(s, prevChar, nextChar) && canUseNativeDelimiter(spec, s)) {
    return spec.markdown.open + s + spec.markdown.close;
  }
  if (spec.html) return `<${spec.html.tag}>${s}</${spec.html.tag}>`;
  if (spec.markdown) return spec.markdown.open + s + spec.markdown.close;
  return s;
}

function wrapTextRunMd(run: TextInline, registry: Registry, ctx: RenderCtx, prevCore: string | undefined, nextCore: string | undefined): string {
  const marks = run.marks ?? [];
  const hasCode = marks.some((m) => m.type === "code");
  let s = coreTextMd(run);
  if (!hasCode) s = escapeRegisteredDelimiters(s, registry);

  // Every mark layer on this run is flanking-checked against the
  // SAME external neighbor characters (the run's true siblings), not against
  // whatever delimiter an inner layer just added -- exactly right for a
  // single mark and a reasonable approximation for
  // several stacked marks on one run, which nobody has hit yet.
  const prevChar = prevCore ? prevCore[prevCore.length - 1] : undefined;
  const nextChar = nextCore ? nextCore[0] : undefined;
  for (const m of marks) {
    if (m.type === "code" || m.type === "link") continue;
    // textColor has no markdown representation at all (a raw <span>
    // fallback is unusually verbose for plain markdown) -- keep the text,
    // report the color loss, skip wrapping. highlight DOES wrap (native
    // "==x=="), but a non-default color still can't survive to markdown, so
    // it's reported lossy too while the highlight marker itself is kept.
    if (m.type === "textColor") {
      ctx.lossy("text-color");
      continue;
    }
    if (m.type === "highlight" && String(m.attrs?.color ?? "default") !== "default") {
      ctx.lossy("highlight-color");
    }
    const spec = registry.marks.get(m.type);
    if (!spec || spec.omitFromMarkdown) continue;
    s = wrapMark(spec, s, prevChar, nextChar);
  }
  const link = marks.find((m) => m.type === "link");
  if (link) s = `[${s}](${mdHref(String(link.attrs?.href ?? ""))})`;
  return s;
}
