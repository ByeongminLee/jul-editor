// The `image`/`embed` block's
// own toMarkdown/toHTML/toText/fromMarkdown-fence/fromHTML hooks, attached
// onto the SAME spec objects model/builtins.ts exports (defineBlock returns
// its own argument -- see builtins-serde.ts's own header comment for why
// hooks live in serde/ and not model/). Split into its own file (rather than
// inlined in builtins-serde.ts, which is otherwise a shared file) -- see
// the side-effecting `import "./media-serde.js"`
// at the bottom of builtins-serde.ts.
//
// image was already a built-in; this task ADDS width/align/caption and
// moves its hooks here. embed is new (YouTube/Vimeo iframe allowlist, X/link
// as a link card -- model/embed.ts's parseEmbedUrl/embedIframeSrc do the
// actual URL classification, DOM-free and reused by the React EmbedView and
// view/embedPaste.ts).

import { embed, image } from "../model/builtins.js";
import { getProp } from "../model/canonical.js";
import { embedIframeSrc, embedWatchUrl, parseEmbedIframeSrc, parseEmbedUrl, type EmbedProvider } from "../model/embed.js";
import { sanitizeImageSource } from "../model/url.js";
import { newId } from "../model/id.js";
import type { ParseCtx } from "../model/schema.js";
import type { Block, Json } from "../model/types.js";

function pad(ctx: { indent: number }): string {
  return "  ".repeat(ctx.indent);
}

// ---- image ------------------------------------------------------------------------

// Escapes a markdown image title (the `"..."` after the src): reuses the
// same inline escaping as alt (ctx.escapeText), plus backslash-escaping any
// literal '"' so it can't prematurely close the title -- CommonMark's own
// title syntax honors a backslash-escaped delimiter inside "...".
function mdTitle(ctx: { escapeText(s: string): string }, s: string): string {
  return ctx.escapeText(s).replace(/"/g, '\\"');
}

image.toMarkdown = (block, ctx) => {
  const alt = String(getProp(block, "alt", ctx.registry) ?? "");
  const src = String(getProp(block, "src", ctx.registry) ?? "");
  const caption = String(getProp(block, "caption", ctx.registry) ?? "");
  const assetId = block.props.assetId;
  const width = block.props.width;
  const align = getProp(block, "align", ctx.registry) ?? "center";
  // width/align/assetId have no markdown spelling at all -- caption DOES
  // (the title, below), so it's deliberately NOT included in this check.
  if ((typeof assetId === "string" && assetId) || (width !== undefined && width !== null) || align !== "center") ctx.lossy("image-meta");
  const title = caption ? ` "${mdTitle(ctx, caption)}"` : "";
  return `![${ctx.escapeText(alt)}](${ctx.escapeAttr(src)}${title})`;
};
image.toHTML = (block, ctx) => {
  const alt = String(getProp(block, "alt", ctx.registry) ?? "");
  const src = sanitizeImageSource(String(getProp(block, "src", ctx.registry) ?? "")) ?? "";
  const width = block.props.width;
  const align = String(getProp(block, "align", ctx.registry) ?? "center");
  const caption = String(getProp(block, "caption", ctx.registry) ?? "");
  const widthAttr = typeof width === "number" || typeof width === "string" ? ` width="${ctx.escapeAttr(String(width))}"` : "";
  const figcaption = caption ? `<figcaption>${ctx.escapeText(caption)}</figcaption>` : "";
  return `<figure data-jul-editor-type="image" data-align="${ctx.escapeAttr(align)}"><img src="${ctx.escapeAttr(src)}" alt="${ctx.escapeAttr(alt)}"${widthAttr}>${figcaption}</figure>`;
};
image.toText = (_block, ctx) => pad(ctx) + "[image]";

// Reconstructs width/align/caption from OUR OWN toHTML output (the
// `<figure data-jul-editor-type="image" data-align="...">` wrapper) -- a plain
// pasted `<img>` (no such wrapper, e.g. from a third-party page) still goes
// through from-html.ts's own generic `imageBlockFromEl`/`soleImageChild`
// path unaffected (custom fromHTML hooks are matched by selector, so this
// one only ever fires for our own figure shape).
image.fromHTML = {
  selector: 'figure[data-jul-editor-type="image"]',
  parse(el, ctx: ParseCtx): Block | null {
    const img = el.querySelector("img");
    if (!img) return null;
    const alt = img.getAttribute("alt") ?? "";
    const src = sanitizeImageSource(img.getAttribute("src") ?? "") ?? "";
    const props: Record<string, Json> = { src, alt };
    const align = el.getAttribute("data-align");
    if (align === "left" || align === "right") props.align = align;
    const widthAttr = img.getAttribute("width");
    if (widthAttr) {
      const n = Number(widthAttr);
      props.width = Number.isFinite(n) && widthAttr.trim() !== "" ? n : widthAttr;
    }
    const caption = el.querySelector("figcaption")?.textContent;
    if (caption) props.caption = caption;
    return { id: newId(), type: "image", props };
  },
};

// ---- embed --------------------------------------------------------------------------

const EMBED_IFRAME_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

embed.toMarkdown = (block, ctx) => {
  const provider = String(getProp(block, "provider", ctx.registry) ?? "link") as EmbedProvider;
  const url = String(getProp(block, "url", ctx.registry) ?? "");
  const title = String(getProp(block, "title", ctx.registry) ?? "");
  // youtube/vimeo round-trip losslessly (from-markdown.ts's paragraph-of-one-
  // link intercept re-derives provider+id from the same href via
  // parseEmbedUrl); x/link don't (that intercept only accepts youtube/vimeo,
  // by design -- a plain link paragraph is the more useful markdown form for
  // those two) so only THEY get flagged lossy.
  if (provider === "x" || provider === "link") ctx.lossy("embed-provider");
  const label = title || url;
  return `[${ctx.escapeText(label)}](${ctx.escapeAttr(url)})`;
};

embed.toHTML = (block, ctx) => {
  const provider = String(getProp(block, "provider", ctx.registry) ?? "link") as EmbedProvider;
  const url = ctx.sanitizeUrl(String(getProp(block, "url", ctx.registry) ?? ""), "link") ?? "";
  const id = String(block.props.id ?? "");
  const title = String(getProp(block, "title", ctx.registry) ?? "");
  // a real title is carried separately (`data-jul-editor-title`,
  // only when non-empty) from the iframe's own `title` attribute -- the
  // latter always falls back to the provider name for accessibility (a
  // screen reader shouldn't hear an untitled iframe), but that fallback must
  // never be READ BACK as if it were a real title (see embed.fromHTML below).
  const titleAttr = title ? ` data-jul-editor-title="${ctx.escapeAttr(title)}"` : "";
  const iframeSrc = embedIframeSrc(provider, id);
  if (iframeSrc) {
    return (
      `<div data-jul-editor-type="embed" data-provider="${ctx.escapeAttr(provider)}"${titleAttr}>` +
      `<iframe src="${ctx.escapeAttr(iframeSrc)}" title="${ctx.escapeAttr(title || provider)}" ` +
      `sandbox="${EMBED_SANDBOX}" allow="${EMBED_IFRAME_ALLOW}" referrerpolicy="strict-origin-when-cross-origin" ` +
      `loading="lazy" frameborder="0" allowfullscreen></iframe></div>`
    );
  }
  // x / link (or an id that failed embedIframeSrc's own re-validation): a
  // plain link card, never an iframe -- this is the one invariant the XSS
  // suite checks (toHTML never emits an iframe for a non-allowlisted
  // provider).
  return (
    `<div data-jul-editor-type="embed" data-provider="${ctx.escapeAttr(provider)}"${titleAttr}>` +
    `<a href="${ctx.escapeAttr(url)}">${ctx.escapeText(title || url)}</a></div>`
  );
};

embed.toText = (block, ctx) => {
  const provider = String(getProp(block, "provider", ctx.registry) ?? "link");
  const url = String(getProp(block, "url", ctx.registry) ?? "");
  const title = String(getProp(block, "title", ctx.registry) ?? "");
  return pad(ctx) + `[${provider}: ${title || url}]`;
};

// Recognizes an allowlisted iframe (our own toHTML output, or a third-party
// page's youtube-nocookie/player.vimeo embed) pasted as raw HTML, AND our own
// x/link "card" shape (`<div data-jul-editor-type="embed"><a>...`,
// which has no iframe at all -- toHTML's own non-allowlisted-provider branch,
// above). Selector matches either shape at the TOP-level element; `parse`
// branches on which one it got. Anything that returns null here falls
// through to from-html.ts's generic handling (DROP_TAGS for a bare
// unrecognized iframe, or unwrap-to-children for the div, which is how a
// third-party/hostile link card -- e.g. a javascript: href -- degrades: no
// live href reaches the model either way, see media-serde.test.ts).
embed.fromHTML = {
  selector: 'iframe, div[data-jul-editor-type="embed"]',
  parse(el, ctx: ParseCtx): Block | null {
    const iframe = el.tagName === "IFRAME" ? el : el.querySelector("iframe");
    if (iframe) {
      const src = iframe.getAttribute("src") ?? "";
      const parsed = parseEmbedIframeSrc(src);
      if (!parsed) return null;
      const url = embedWatchUrl(parsed.provider, parsed.id);
      const safeUrl = ctx.sanitizeUrl(url, "link") ?? "";
      // the DIV wrapper's own `data-jul-editor-title` (present only
      // when a real title was set) is the source of truth for OUR OWN
      // output -- the iframe's own `title` attribute always carries at least
      // the provider name (accessibility fallback, see embed.toHTML) so
      // reading it back here would resurrect that fallback as a fake title.
      // A bare third-party iframe (no wrapping div) has no such attribute to
      // prefer, so its own `title` (a real one, if any) is used instead.
      const title = el.tagName === "DIV" ? (el.getAttribute("data-jul-editor-title") ?? "") : (iframe.getAttribute("title") ?? "");
      return { id: newId(), type: "embed", props: { provider: parsed.provider, url: safeUrl, id: parsed.id, title } };
    }
    if (el.tagName !== "DIV") return null;
    // The x/link card shape: no iframe, just a plain <a>.
    const a = el.querySelector("a");
    if (!a) return null;
    const url = ctx.sanitizeUrl(a.getAttribute("href") ?? "", "link") ?? "";
    if (!url) return null;
    const provider = (el.getAttribute("data-provider") || "link") as EmbedProvider;
    const text = a.textContent ?? "";
    const title = text && text !== url ? text : "";
    return { id: newId(), type: "embed", props: { provider, url, id: "", title } };
  },
};

// A paragraph consisting solely of one markdown link, when that link's href
// is a youtube/vimeo url, converts back to an embed block -- the reverse of
// embed.toMarkdown's `[title or url](url)` export. Dispatched from
// from-markdown.ts's paragraphTokensToBlock (mirrors imageTokenToBlock's own
// "paragraph = one image" intercept, right next to it).
export function embedLinkToBlock(href: string, text: string): Block | null {
  const parsed = parseEmbedUrl(href);
  if (parsed.provider !== "youtube" && parsed.provider !== "vimeo") return null;
  const title = text === href ? "" : text;
  return { id: newId(), type: "embed", props: { provider: parsed.provider, url: parsed.url, id: parsed.id, title } };
}
