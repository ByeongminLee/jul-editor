// BlockSpecs for the two new void blocks, with their serde hooks:
//   bookmark: a link card. props {url, title, description, image, favicon, siteName}
//             (fetched metadata is cached in the props, so a saved doc never refetches).
//   iframe:   a framed embed. props {url, title, height}. `url` is the PAGE url
//             (a figma file, a youtube watch url, or a generic allowlisted origin);
//             the iframe src is derived at render/serialize time by resolveIframe().
// Hosts register them: createRegistry({ blocks: [...coreBlocks, ...createLinkBlocks(policy)], ... }).
//
// Markdown has no card or iframe syntax, so both serialize as a plain link
// line `[title](url)` and are flagged lossy ("bookmark-as-link"/"iframe-as-link");
// reading that line back gives an ordinary link paragraph (core already turns
// a lone youtube/vimeo link into its own `embed` block). HTML round-trips fully:
// a bookmark is `<div data-jul-editor-type="bookmark"><a>` and an iframe is
// `<div data-jul-editor-type="iframe"><iframe>` emitted ONLY when the url
// passes the same policy that gates the live view (otherwise an anchor card).
import { defineBlock, getProp, newId, sanitizeUrl, type Block, type BlockSpec, type RenderCtx } from "@jul-editor/core";
import { clampIframeHeight, DEFAULT_IFRAME_HEIGHT, iframeSrcToUrl, resolveIframe, type IframePolicy } from "./iframe.js";
import { cardFromProps, safeAssetUrl } from "./metadata.js";

export const BOOKMARK_DEFAULTS = { url: "", title: "", description: "", image: "", favicon: "", siteName: "" };
export const IFRAME_DEFAULTS = { url: "", title: "", height: DEFAULT_IFRAME_HEIGHT };

const str = (b: Block, k: string, ctx: RenderCtx): string => String(getProp(b, k, ctx.registry) ?? "");

function linkLine(ctx: RenderCtx, label: string, url: string): string {
  return `[${ctx.escapeText(label || url)}](${ctx.escapeAttr(url)})`;
}

export function createBookmarkBlock(): BlockSpec {
  return defineBlock({
    type: "bookmark",
    content: "none",
    children: "none",
    props: { ...BOOKMARK_DEFAULTS },
    toMarkdown(block, ctx) {
      const url = ctx.sanitizeUrl(str(block, "url", ctx), "link") ?? "";
      if (!url) return { text: "", lossy: "bookmark-empty" };
      return { text: linkLine(ctx, str(block, "title", ctx), url), lossy: "bookmark-as-link" };
    },
    toHTML(block, ctx) {
      const url = ctx.sanitizeUrl(str(block, "url", ctx), "link") ?? "";
      const image = safeAssetUrl(str(block, "image", ctx), url);
      const favicon = safeAssetUrl(str(block, "favicon", ctx), url);
      const attrs =
        (image ? ` data-image="${ctx.escapeAttr(image)}"` : "") +
        (favicon ? ` data-favicon="${ctx.escapeAttr(favicon)}"` : "") +
        (str(block, "siteName", ctx) ? ` data-site="${ctx.escapeAttr(str(block, "siteName", ctx))}"` : "");
      const title = str(block, "title", ctx);
      const desc = str(block, "description", ctx);
      return (
        `<div data-jul-editor-type="bookmark"${attrs}><a href="${ctx.escapeAttr(url)}">` +
        `<strong data-title>${ctx.escapeText(title || url)}</strong>` +
        (desc ? `<span data-description>${ctx.escapeText(desc)}</span>` : "") +
        `</a></div>`
      );
    },
    toText(block, ctx) {
      const url = str(block, "url", ctx);
      const title = str(block, "title", ctx);
      return "  ".repeat(ctx.indent) + `[bookmark: ${title || url}]`;
    },
    fromHTML: {
      selector: 'div[data-jul-editor-type="bookmark"]',
      parse(el, ctx) {
        const a = el.querySelector("a");
        const url = ctx.sanitizeUrl(a?.getAttribute("href") ?? "", "link") ?? "";
        if (!url) return null; // hostile/empty href: fall back to generic unwrap (no live href)
        const title = el.querySelector("[data-title]")?.textContent ?? "";
        return {
          id: newId(),
          type: "bookmark",
          props: {
            url,
            title: title === url ? "" : title,
            description: el.querySelector("[data-description]")?.textContent ?? "",
            image: safeAssetUrl(el.getAttribute("data-image"), url),
            favicon: safeAssetUrl(el.getAttribute("data-favicon"), url),
            siteName: el.getAttribute("data-site") ?? "",
          },
        };
      },
    },
  });
}

export function createIframeBlock(policy: IframePolicy = {}): BlockSpec {
  return defineBlock({
    type: "iframe",
    content: "none",
    children: "none",
    props: { ...IFRAME_DEFAULTS },
    toMarkdown(block, ctx) {
      const url = ctx.sanitizeUrl(str(block, "url", ctx), "link") ?? "";
      if (!url) return { text: "", lossy: "iframe-empty" };
      return { text: linkLine(ctx, str(block, "title", ctx), url), lossy: "iframe-as-link" };
    },
    toHTML(block, ctx) {
      const url = ctx.sanitizeUrl(str(block, "url", ctx), "link") ?? "";
      const title = str(block, "title", ctx);
      const spec = url ? resolveIframe(url, policy) : null;
      // gist (srcdoc) has no stable src to round-trip: it degrades to the anchor card.
      if (spec?.src) {
        const h = clampIframeHeight(getProp(block, "height", ctx.registry));
        return (
          `<div data-jul-editor-type="iframe"${title ? ` data-jul-editor-title="${ctx.escapeAttr(title)}"` : ""} data-height="${h}">` +
          `<iframe src="${ctx.escapeAttr(spec.src)}" title="${ctx.escapeAttr(title || spec.provider)}" sandbox="${ctx.escapeAttr(spec.sandbox)}" ` +
          `allow="${ctx.escapeAttr(spec.allow)}" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" frameborder="0" allowfullscreen></iframe></div>`
        );
      }
      return `<div data-jul-editor-type="iframe"><a href="${ctx.escapeAttr(url)}">${ctx.escapeText(title || url)}</a></div>`;
    },
    toText(block, ctx) {
      return "  ".repeat(ctx.indent) + `[iframe: ${str(block, "title", ctx) || str(block, "url", ctx)}]`;
    },
    fromHTML: {
      selector: 'div[data-jul-editor-type="iframe"]',
      parse(el, ctx) {
        const iframe = el.querySelector("iframe");
        const raw = iframe ? iframeSrcToUrl(iframe.getAttribute("src") ?? "") : (el.querySelector("a")?.getAttribute("href") ?? "");
        const url = ctx.sanitizeUrl(raw, "link") ?? "";
        // Default deny on the way IN too: a pasted iframe whose url is neither a
        // provider page nor on the host allowlist never becomes an iframe block.
        if (!url || !resolveIframe(url, policy)) return null;
        const h = Number(el.getAttribute("data-height"));
        return { id: newId(), type: "iframe", props: { url, title: el.getAttribute("data-jul-editor-title") ?? "", height: clampIframeHeight(Number.isFinite(h) && h > 0 ? h : undefined) } };
      },
    },
  });
}

/** [bookmark, iframe] specs, the iframe one bound to the host's policy. */
export function createLinkBlocks(policy: IframePolicy = {}): BlockSpec[] {
  return [createBookmarkBlock(), createIframeBlock(policy)];
}

export { cardFromProps };
