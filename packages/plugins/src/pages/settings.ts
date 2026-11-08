// Document (page layout) settings: an adapter-friendly, JSON-serializable
// object. Nothing here touches the DOM or the editor store, so a host can
// persist it anywhere (a doc meta field, its own DB column, localStorage...)
// and pass it back in. All lengths are millimetres (print friendly: maps 1:1
// onto CSS `mm`, @page and, via mmToTwips, onto DOCX).

export type PageSizeName = "A3" | "A4" | "A5" | "Letter" | "Legal";
export type PageOrientation = "portrait" | "landscape";
export type HeaderFooterAlign = "left" | "center" | "right";

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Header/footer text supports the tokens {page} and {total} (see tokens.ts). */
export interface HeaderFooterSettings {
  enabled: boolean;
  /** Text shown on the left (header) or in the `align` slot (footer). */
  text: string;
  align: HeaderFooterAlign;
  /** Optional logo shown on the right side (header only in the Tiptap template). */
  logoSrc?: string;
  /** Logo height in mm. */
  logoHeight?: number;
  /** Hide on page 1 (a "different first page" like Word). */
  skipFirstPage?: boolean;
}

export interface DocumentSettings {
  size: PageSizeName;
  orientation: PageOrientation;
  margins: PageMargins;
  header: HeaderFooterSettings;
  footer: HeaderFooterSettings;
  /** Distance from the page edge to the header/footer text, in mm. */
  headerDistance: number;
  footerDistance: number;
}

/** Portrait sizes in mm. */
export const PAGE_SIZES_MM: Record<PageSizeName, { width: number; height: number }> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

export const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZES_MM) as PageSizeName[];

export const MM_PER_INCH = 25.4;
export const CSS_PX_PER_INCH = 96;

export const mmToPx = (mm: number): number => (mm * CSS_PX_PER_INCH) / MM_PER_INCH;
export const mmToTwips = (mm: number): number => Math.round((mm / MM_PER_INCH) * 1440);

export const DEFAULT_SETTINGS: DocumentSettings = {
  size: "A4",
  orientation: "portrait",
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  header: { enabled: true, text: "", align: "left" },
  footer: { enabled: true, text: "{page} / {total}", align: "center" },
  headerDistance: 12.7,
  footerDistance: 12.7,
};

/** Smallest content box we allow, so a silly margin never yields a zero-height page. */
export const MIN_CONTENT_MM = 20;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Fills missing fields from the defaults, drops unknown values and clamps
 * margins so the content box stays at least MIN_CONTENT_MM. Always safe to
 * call on untrusted/persisted input. Pure. */
export function normalizeSettings(input?: Partial<DocumentSettings> | null): DocumentSettings {
  const d = DEFAULT_SETTINGS;
  const src = input ?? {};
  const size: PageSizeName = src.size && src.size in PAGE_SIZES_MM ? src.size : d.size;
  const orientation: PageOrientation = src.orientation === "landscape" ? "landscape" : "portrait";
  const dims = pageDimensionsMm({ size, orientation });
  const m = src.margins ?? d.margins;
  let left = clamp(num(m.left, d.margins.left), 0, dims.width);
  let right = clamp(num(m.right, d.margins.right), 0, dims.width);
  let top = clamp(num(m.top, d.margins.top), 0, dims.height);
  let bottom = clamp(num(m.bottom, d.margins.bottom), 0, dims.height);
  // Shrink the larger side proportionally until the content box is usable.
  const fit = (a: number, b: number, total: number): [number, number] => {
    const over = a + b - (total - MIN_CONTENT_MM);
    if (over <= 0) return [a, b];
    const sum = a + b || 1;
    return [Math.max(0, a - (over * a) / sum), Math.max(0, b - (over * b) / sum)];
  };
  [left, right] = fit(left, right, dims.width);
  [top, bottom] = fit(top, bottom, dims.height);
  const hf = (v: Partial<HeaderFooterSettings> | undefined, base: HeaderFooterSettings): HeaderFooterSettings => ({
    enabled: typeof v?.enabled === "boolean" ? v.enabled : base.enabled,
    text: typeof v?.text === "string" ? v.text : base.text,
    align: v?.align === "left" || v?.align === "center" || v?.align === "right" ? v.align : base.align,
    ...(typeof v?.logoSrc === "string" && v.logoSrc ? { logoSrc: v.logoSrc } : {}),
    ...(typeof v?.logoHeight === "number" && v.logoHeight > 0 ? { logoHeight: v.logoHeight } : {}),
    ...(v?.skipFirstPage ? { skipFirstPage: true } : {}),
  });
  return {
    size,
    orientation,
    margins: { top, right, bottom, left },
    header: hf(src.header, d.header),
    footer: hf(src.footer, d.footer),
    headerDistance: clamp(num(src.headerDistance, d.headerDistance), 0, top),
    footerDistance: clamp(num(src.footerDistance, d.footerDistance), 0, bottom),
  };
}

/** Page dimensions in mm with orientation applied. */
export function pageDimensionsMm(s: Pick<DocumentSettings, "size" | "orientation">): { width: number; height: number } {
  const { width, height } = PAGE_SIZES_MM[s.size];
  return s.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

export interface PageGeometryPx {
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  contentHeight: number;
  margins: PageMargins;
}

/** Everything the pagination math and the CSS layer need, in CSS px. */
export function pageGeometryPx(settings: DocumentSettings): PageGeometryPx {
  const { width, height } = pageDimensionsMm(settings);
  const m = settings.margins;
  const margins = { top: mmToPx(m.top), right: mmToPx(m.right), bottom: mmToPx(m.bottom), left: mmToPx(m.left) };
  const pageWidth = mmToPx(width);
  const pageHeight = mmToPx(height);
  return {
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - margins.left - margins.right,
    contentHeight: pageHeight - margins.top - margins.bottom,
    margins,
  };
}

export const ZOOM_MIN = 40;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const clampZoom = (z: number): number => clamp(Math.round(Number.isFinite(z) ? z : 100), ZOOM_MIN, ZOOM_MAX);
