import { tocBlock, tocSlashItem } from "./block.js";
import { TocView } from "./toc-view.js";

export { tocBlock, tocSlashItem, readToc, parseTocMarker } from "./block.js";
export type { TocProps } from "./block.js";
export { extractOutline, extractOutlineFromDoc, headingLevelOf, outlineEqual, pickActiveIndex } from "./outline.js";
export type { OutlineEntry, OutlineOptions } from "./outline.js";
export { findBlockEl, navigateToHeading, scrollToHeading } from "./navigate.js";
export { TocView } from "./toc-view.js";
export type { TocViewProps, TocClassNames } from "./toc-view.js";
export { TocSidebar, TOC_CSS } from "./toc-sidebar.js";
export type { TocSidebarProps, TocSidebarClassNames } from "./toc-sidebar.js";
export { useOutline, TocDocProvider, TocDocContext } from "./use-outline.js";
export { fromMarkdownExt } from "../notion-shared/markdown-ext.js";
export type { MarkdownExtOptions } from "../notion-shared/markdown-ext.js";

/** Spread into `<Editor.Plugin {...tocPlugin} />`. */
export const tocPlugin = {
  blocks: [tocBlock],
  renderers: { toc: TocView },
  slashItems: [tocSlashItem],
};
