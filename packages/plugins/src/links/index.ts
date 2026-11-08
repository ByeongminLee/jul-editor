import { newId } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export { parseLink, hostMatches } from "./providers.js";
export type { LinkInfo, LinkProvider } from "./providers.js";
export { providerIframe, resolveIframe, isEmbeddable, originAllowed, iframeSrcToUrl, clampIframeHeight, DEFAULT_IFRAME_SANDBOX } from "./iframe.js";
export type { IframeSpec, IframePolicy } from "./iframe.js";
export { resolveCard, fallbackCard, mergeMetadata, cacheFetchMetadata, createStaticMetadata, cardFromProps, safeAssetUrl } from "./metadata.js";
export type { CardData, CardState, CardStatus, FetchMetadata, FetchMetadataOptions, LinkMetadata, ResolveCardOptions } from "./metadata.js";
export { createLinkBlocks, createBookmarkBlock, createIframeBlock } from "./blocks.js";
export { installUrlPaste, createUrlPasteInterceptor, applyPasteChoice, blockForChoice, pasteChoicesFor } from "./paste.js";
export type { PasteChoice, PasteDefault, PasteMenuRequest, UrlPasteOptions } from "./paste.js";
export { LinkContextProvider, useLinkContext } from "./link-context.js";
export type { LinkContextValue } from "./link-context.js";
export { BookmarkView } from "./bookmark-view.js";
export type { BookmarkClassNames, BookmarkViewProps } from "./bookmark-view.js";
export { IframeView } from "./iframe-view.js";
export type { IframeClassNames, IframeViewProps } from "./iframe-view.js";

// Slash items. All four insert an empty block (the view shows "No URL" until a
// url is set via updateProps or the host's own input UI); /figma and /github are
// discovery aliases that reuse the iframe / bookmark block types.
export const bookmarkSlashItem: SlashItem = {
  type: "bookmark",
  title: "Bookmark",
  keywords: ["bookmark", "link", "card", "url", "북마크", "링크"],
  create: () => ({ id: newId(), type: "bookmark", props: {} }),
};
export const embedSlashItem: SlashItem = {
  type: "iframe",
  title: "Embed",
  keywords: ["embed", "iframe", "video", "loom", "codepen", "임베드", "삽입"],
  create: () => ({ id: newId(), type: "iframe", props: {} }),
};
export const figmaSlashItem: SlashItem = {
  type: "iframe",
  title: "Figma",
  keywords: ["figma", "design", "피그마", "디자인"],
  create: () => ({ id: newId(), type: "iframe", props: {} }),
};
export const githubSlashItem: SlashItem = {
  type: "bookmark",
  title: "GitHub",
  keywords: ["github", "repo", "issue", "pr", "gist", "깃허브"],
  create: () => ({ id: newId(), type: "bookmark", props: {} }),
};
export const linkSlashItems: SlashItem[] = [bookmarkSlashItem, embedSlashItem, figmaSlashItem, githubSlashItem];
