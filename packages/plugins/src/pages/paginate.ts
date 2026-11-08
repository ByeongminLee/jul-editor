// Pagination math. Pure and DOM-free: block heights in, page assignment out.
//
// Model ("visual pagination", see paged-editor.tsx for the trade-offs): the
// document stays ONE continuous flow. Page sheets are a background layer; to
// keep blocks from straddling the gap between two sheets we push a block down
// by a `spacerBefore` (added to its margin-top) so it starts at the top of the
// next sheet's content area. Coordinates here are "flow" coordinates: y = 0 is
// the top of page 1's content area, and page p's content area begins at
//   p * (contentHeight + interPage)
// where interPage = marginBottom + pageGap + marginTop (the dead zone between
// one sheet's content area and the next one's).

export interface PaginateBlock {
  /** Natural height in px, including the block's own margins (top-to-top delta). */
  height: number;
  /** Force this block onto a fresh page (e.g. a pageBreak block's successor, a "page break before" heading). */
  breakBefore?: boolean;
  /** Force the NEXT block onto a fresh page (a pageBreak block). */
  breakAfter?: boolean;
  /** Keep with the next block: if this block fits but the next one does not, move both. */
  keepWithNext?: boolean;
}

export interface PaginateOptions {
  /** Height of one page's content area in px. Must be > 0. */
  contentHeight: number;
  /** Dead zone between two content areas (bottom margin + visual gap + top margin). */
  interPage: number;
}

export interface PlacedBlock {
  index: number;
  /** 0-based page the block STARTS on. */
  page: number;
  /** 0-based page the block ENDS on (> page only for blocks taller than a page). */
  endPage: number;
  /** Extra margin-top to apply so the block lands at the top of `page`; 0 when it stays on the current page. */
  spacerBefore: number;
  /** Top of the block in flow coordinates AFTER spacers are applied. */
  y: number;
}

export interface PaginateResult {
  blocks: PlacedBlock[];
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Total flow height after spacers (px), up to the end of the last block. */
  totalHeight: number;
}

export function paginate(blocks: readonly PaginateBlock[], opts: PaginateOptions): PaginateResult {
  const { contentHeight, interPage } = opts;
  if (!(contentHeight > 0)) throw new RangeError("contentHeight must be > 0");
  const period = contentHeight + interPage;
  const placed: PlacedBlock[] = [];
  let page = 0;
  let used = 0; // px used on the current page's content area
  let forceBreak = false;

  const startNewPage = (): number => {
    const spacer = contentHeight - used + interPage; // jump to the next content-area top
    page += 1;
    used = 0;
    return spacer;
  };
  const wouldOverflow = (h: number): boolean => used > 0 && used + h > contentHeight;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const h = Math.max(0, b.height);
    let spacer = 0;
    if (forceBreak || b.breakBefore) {
      if (used > 0) spacer = startNewPage();
      forceBreak = false;
    } else if (wouldOverflow(h)) {
      spacer = startNewPage();
    } else if (b.keepWithNext && i + 1 < blocks.length) {
      const next = Math.max(0, blocks[i + 1]!.height);
      // Only worth moving when the pair fits on a page at all.
      if (used > 0 && used + h + next > contentHeight && h + next <= contentHeight) spacer = startNewPage();
    }
    const y = page * period + used;
    const spanPages = h > contentHeight ? Math.ceil(h / contentHeight) - 1 : 0;
    const endPage = page + spanPages;
    placed.push({ index: i, page, endPage, spacerBefore: spacer, y });
    if (spanPages > 0) {
      // A block taller than one page overflows into the following page(s):
      // advance the cursor to the page where it ends.
      page = endPage;
      used = h - spanPages * contentHeight;
      if (used > contentHeight) used = contentHeight;
    } else {
      used += h;
    }
    if (b.breakAfter) forceBreak = true;
  }
  const last = placed[placed.length - 1];
  return {
    blocks: placed,
    pageCount: Math.max(1, (last ? last.endPage : 0) + 1, page + 1),
    totalHeight: page * period + used,
  };
}

/** Groups placed blocks by the page they start on. */
export function blocksByPage(result: PaginateResult): number[][] {
  const pages: number[][] = Array.from({ length: result.pageCount }, () => []);
  for (const b of result.blocks) pages[b.page]!.push(b.index);
  return pages;
}
