// <PagedEditor>: renders the editor inside Word-like paper sheets on a grey
// canvas. Thin React layer; all math lives in paginate.ts / settings.ts.
//
// APPROACH: "visual pagination over one continuous contenteditable".
//   - Children (normally <EditorContent/>) stay ONE contenteditable. Caret,
//     selection, IME, undo, copy/paste, drag all keep working because the DOM
//     structure the core editor owns is never split or re-parented.
//   - Page sheets are an absolutely positioned background layer (with header,
//     footer and {page}/{total}).
//   - After every content/size change we measure each top-level block
//     (offsetTop deltas, so CSS zoom does not distort them), run paginate()
//     and push blocks that would straddle a page boundary down to the next
//     sheet via extra margin-top. Margins are set imperatively on the DOM
//     node (not in the editor doc), the root is made a flex column so margins
//     never collapse and the math stays additive.
//
// TRADE-OFFS (be honest):
//   + zero changes to core, no document model coupling, cheap, robust IME.
//   - Whole-block pagination: a long paragraph/table/code block is never split
//     across pages. A block taller than a page flows across the sheet gap
//     (the gap strip is drawn behind the text, so it stays readable, but looks
//     off). Real line-level splitting needs a layout engine or per-line widget
//     decorations inside the text flow (core has no such hook yet).
//   - Pages can look emptier than Word's, since a block that does not fit moves
//     entirely. Headings use keepWithNext.
//   - Printing relies on beforeprint to re-layout with gap 0; browsers differ
//     (@page size support in Safari/Firefox is partial). Verify in Chrome.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { paginate } from "./paginate.js";
import type { PaginateBlock } from "./paginate.js";
import { isPageBreak } from "./page-break.js";
import { buildPrintCss } from "./print.js";
import { PAGE_SIZE_NAMES, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, normalizeSettings, pageGeometryPx } from "./settings.js";
import type { DocumentSettings, HeaderFooterAlign, PageOrientation, PageSizeName } from "./settings.js";
import { applyPageTokens } from "./tokens.js";

/** Visual gap between two sheets on screen, px (0 while printing). */
export const SCREEN_PAGE_GAP = 24;

export const PAGED_CSS = `
.jul-paged{--jul-paged-canvas:#e5e7eb;--jul-paged-sheet:#fff;--jul-paged-shadow:0 1px 3px rgba(0,0,0,.25);--jul-paged-hf:#6b7280;--jul-paged-break:#9ca3af;
  --jul-page-gap:${SCREEN_PAGE_GAP}px;background:var(--jul-paged-canvas);padding:24px;overflow:auto;box-sizing:border-box}
@media (prefers-color-scheme:dark){.jul-paged{--jul-paged-canvas:#2b2b2b;--jul-paged-shadow:0 1px 4px rgba(0,0,0,.6)}}
.jul-paged__zoomwrap{margin:0 auto;position:relative}
.jul-paged__stage{position:relative;transform-origin:top left}
.jul-paged__sheet{position:absolute;left:0;background:var(--jul-paged-sheet);box-shadow:var(--jul-paged-shadow);box-sizing:border-box;overflow:hidden;color:#111}
.jul-paged__hf{position:absolute;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--jul-paged-hf);pointer-events:none;user-select:none}
.jul-paged__hf img{display:block;max-width:100%}
.jul-paged__flow{position:relative;z-index:1}
.jul-paged__pagebreak{display:flex;align-items:center;gap:8px;color:var(--jul-paged-break);font-size:11px;user-select:none}
.jul-paged__pagebreak::before,.jul-paged__pagebreak::after{content:"";flex:1;border-top:1px dashed currentColor}
.jul-paged-zoom{display:inline-flex;align-items:center;gap:4px;font-size:13px}
.jul-paged-zoom button{min-width:28px}
.jul-paged-settings{display:grid;gap:8px;font-size:13px}
.jul-paged-settings label{display:grid;gap:2px}
.jul-paged-settings__row{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
@media print{.jul-paged{--jul-page-gap:0px !important}.jul-paged__zoomwrap{width:auto !important;height:auto !important}}
`;

export interface PagedEditorClassNames {
  root?: string;
  sheet?: string;
  header?: string;
  footer?: string;
}

export interface PagedEditorProps {
  /** The editor content, e.g. `<EditorContent />` inside an `<Editor>`. */
  children: ReactNode;
  settings?: Partial<DocumentSettings>;
  /** Zoom percent (40-200). Controlled when given. */
  zoom?: number;
  defaultZoom?: number;
  onPageCountChange?: (count: number) => void;
  /** Inject PAGED_CSS + the @page print rules. Set false to ship your own. */
  injectStyles?: boolean;
  classNames?: PagedEditorClassNames;
  className?: string;
  style?: CSSProperties;
}

/** Pagination flags of one top-level block wrapper: a page break ends its page, a heading stays with
 * the block after it. Exported for tests (the layout itself needs real layout metrics). */
export function pageFlags(el: Element): { breakAfter: boolean; keepWithNext: boolean } {
  const type = blockTypeOf(el);
  return {
    breakAfter: isPageBreak({ type }) || el.hasAttribute("data-jul-page-break") || !!el.querySelector("[data-jul-page-break]"),
    keepWithNext: /^h[1-6]$/i.test(el.tagName) || type === "heading",
  };
}

/** Block type of a top-level wrapper element: `data-type` (core) or `data-jul-editor-type`. */
export function blockTypeOf(el: Element): string {
  return el.getAttribute("data-type") ?? el.getAttribute("data-jul-editor-type") ?? "";
}

export function PagedEditor(props: PagedEditorProps): ReactNode {
  const { children, injectStyles = true, classNames, className, style, onPageCountChange } = props;
  const settings = useMemo(() => normalizeSettings(props.settings), [props.settings]);
  const geo = useMemo(() => pageGeometryPx(settings), [settings]);
  const zoom = clampZoom(props.zoom ?? props.defaultZoom ?? 100);
  const scale = zoom / 100;

  const flowRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef(SCREEN_PAGE_GAP);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [pageCount, setPageCount] = useState(1);
  const countRef = useRef(1);
  const onCount = useRef(onPageCountChange);
  onCount.current = onPageCountChange;

  const layout = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const root = (flow.querySelector("[contenteditable]") as HTMLElement | null) ?? (flow.firstElementChild as HTMLElement | null);
    if (!root) return;
    const g = geoRef.current;
    // Flex column: sibling margins add instead of collapsing, so the spacer math is additive.
    if (root.style.display !== "flex") {
      root.style.display = "flex";
      root.style.flexDirection = "column";
    }
    const kids = Array.from(root.children) as HTMLElement[];
    // 1) clear previous spacers, 2) read natural margins + positions, 3) apply.
    for (const k of kids) k.style.marginTop = "";
    const naturalMt = kids.map((k) => parseFloat(getComputedStyle(k).marginTop) || 0);
    const tops = kids.map((k) => k.offsetTop);
    const rootBottom = kids.length ? kids[kids.length - 1]!.offsetTop + kids[kids.length - 1]!.offsetHeight : 0;
    const blocks: PaginateBlock[] = kids.map((k, i) => {
      const next = i + 1 < kids.length ? tops[i + 1]! - naturalMt[i + 1]! : rootBottom;
      return {
        // offsetTop is the border box top; the previous block's trailing margin is part of this delta.
        height: Math.max(0, next - tops[i]!) + naturalMt[i]!,
        ...pageFlags(k),
      };
    });
    const interPage = g.margins.bottom + gapRef.current + g.margins.top;
    const result = paginate(blocks, { contentHeight: g.contentHeight, interPage });
    for (const p of result.blocks) if (p.spacerBefore > 0) kids[p.index]!.style.marginTop = `${naturalMt[p.index]! + p.spacerBefore}px`;
    if (result.pageCount !== countRef.current) {
      countRef.current = result.pageCount;
      setPageCount(result.pageCount);
      onCount.current?.(result.pageCount);
    }
  }, []);

  // Re-measure on settings change (before paint) and on any content/size change.
  useLayoutEffect(() => {
    layout();
  }, [layout, geo]);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layout);
    };
    const root = (flow.querySelector("[contenteditable]") as HTMLElement | null) ?? flow;
    // childList/characterData only (NOT attributes): our own margin writes must not retrigger us.
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(root);
    root.addEventListener("load", schedule, true); // images
    const before = () => {
      gapRef.current = 0;
      layout();
    };
    const after = () => {
      gapRef.current = SCREEN_PAGE_GAP;
      layout();
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      root.removeEventListener("load", schedule, true);
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [layout]);

  const gap = "var(--jul-page-gap)";
  const stageHeight = `calc(${pageCount * geo.pageHeight}px + ${pageCount - 1} * ${gap})`;
  const css = useMemo(() => (injectStyles ? PAGED_CSS + buildPrintCss(settings) : ""), [injectStyles, settings]);

  return (
    <div className={["jul-paged", classNames?.root, className].filter(Boolean).join(" ")} style={style}>
      {injectStyles ? <style>{css}</style> : null}
      <div className="jul-paged__zoomwrap" style={{ width: geo.pageWidth * scale, height: `calc((${stageHeight}) * ${scale})` }}>
        <div className="jul-paged__stage" style={{ width: geo.pageWidth, height: stageHeight, transform: `scale(${scale})` }}>
          {Array.from({ length: pageCount }, (_, p) => (
            <Sheet key={p} index={p} total={pageCount} settings={settings} geo={geo} classNames={classNames} />
          ))}
          <div
            ref={flowRef}
            className="jul-paged__flow"
            style={{ paddingTop: geo.margins.top, paddingLeft: geo.margins.left, paddingRight: geo.margins.right, paddingBottom: geo.margins.bottom, boxSizing: "border-box", width: geo.pageWidth }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sheet(props: { index: number; total: number; settings: DocumentSettings; geo: ReturnType<typeof pageGeometryPx>; classNames?: PagedEditorClassNames }): ReactNode {
  const { index, total, settings, geo, classNames } = props;
  const mm = (v: number) => (v * 96) / 25.4;
  const page = index + 1;
  const { header, footer } = settings;
  const showHeader = header.enabled && !(header.skipFirstPage && index === 0);
  const showFooter = footer.enabled && !(footer.skipFirstPage && index === 0);
  const justify = (a: HeaderFooterAlign) => (a === "left" ? "flex-start" : a === "right" ? "flex-end" : "center");
  const sideStyle = { left: geo.margins.left, right: geo.margins.right };
  return (
    <div
      className={["jul-paged__sheet", classNames?.sheet].filter(Boolean).join(" ")}
      data-page={page}
      style={{ top: `calc(${index} * (${geo.pageHeight}px + var(--jul-page-gap)))`, width: geo.pageWidth, height: geo.pageHeight }}
    >
      {showHeader ? (
        <div className={["jul-paged__hf", classNames?.header].filter(Boolean).join(" ")} data-jul-paged-header style={{ ...sideStyle, top: mm(settings.headerDistance), justifyContent: "space-between" }}>
          <span style={{ textAlign: header.align }}>{applyPageTokens(header.text, page, total)}</span>
          {header.logoSrc ? <img src={header.logoSrc} alt="" style={{ height: mm(header.logoHeight ?? 8) }} /> : null}
        </div>
      ) : null}
      {showFooter ? (
        <div className={["jul-paged__hf", classNames?.footer].filter(Boolean).join(" ")} data-jul-paged-footer style={{ ...sideStyle, bottom: mm(settings.footerDistance), justifyContent: justify(footer.align) }}>
          <span>{applyPageTokens(footer.text, page, total)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Renderer for the `pageBreak` void block (register under key "pageBreak"). */
export function PageBreakView(props: { block?: { id: string; type: string }; locale?: "en" | "ko" }): ReactNode {
  return (
    <div className="jul-paged__pagebreak" data-jul-page-break data-jul-editor-type="pageBreak" contentEditable={false}>
      {props.locale === "ko" ? "페이지 나누기" : "Page break"}
    </div>
  );
}

/** "- 100% +" control. Controlled: pass zoom + onZoomChange. */
export function ZoomControl(props: { zoom: number; onZoomChange: (zoom: number) => void; className?: string }): ReactNode {
  const { zoom, onZoomChange } = props;
  return (
    <div className={["jul-paged-zoom", props.className].filter(Boolean).join(" ")} data-jul-no-print>
      <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}>
        -
      </button>
      <span role="status" aria-live="polite" style={{ minWidth: "3.5ch", textAlign: "center" }}>
        {zoom}%
      </span>
      <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}>
        +
      </button>
    </div>
  );
}

const L10N = {
  en: { size: "Page size", orientation: "Orientation", portrait: "Portrait", landscape: "Landscape", margins: "Margins (mm)", top: "Top", right: "Right", bottom: "Bottom", left: "Left", header: "Header text", logo: "Header logo URL", footer: "Footer text", footerAlign: "Footer alignment", skipFirst: "Hide header/footer on first page", hint: "Use {page} and {total}" },
  ko: { size: "용지 크기", orientation: "방향", portrait: "세로", landscape: "가로", margins: "여백 (mm)", top: "위", right: "오른쪽", bottom: "아래", left: "왼쪽", header: "머리글", logo: "머리글 로고 URL", footer: "바닥글", footerAlign: "바닥글 정렬", skipFirst: "첫 페이지 머리글/바닥글 숨김", hint: "{page}, {total} 사용 가능" },
};

/** Controlled settings form. Emits a NORMALIZED settings object on every change. */
export function PageSettingsPanel(props: { value: Partial<DocumentSettings>; onChange: (next: DocumentSettings) => void; locale?: "en" | "ko"; className?: string }): ReactNode {
  const s = normalizeSettings(props.value);
  const t = L10N[props.locale ?? "en"];
  const emit = (patch: Partial<DocumentSettings>) => props.onChange(normalizeSettings({ ...s, ...patch }));
  const margin = (k: keyof DocumentSettings["margins"]) => (
    <label key={k}>
      {t[k]}
      <input type="number" min={0} step={0.1} value={Number(s.margins[k].toFixed(1))} onChange={(e) => emit({ margins: { ...s.margins, [k]: Number(e.target.value) } })} />
    </label>
  );
  return (
    <div className={["jul-paged-settings", props.className].filter(Boolean).join(" ")} data-jul-no-print>
      <label>
        {t.size}
        <select value={s.size} onChange={(e) => emit({ size: e.target.value as PageSizeName })}>
          {PAGE_SIZE_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.orientation}
        <select value={s.orientation} onChange={(e) => emit({ orientation: e.target.value as PageOrientation })}>
          <option value="portrait">{t.portrait}</option>
          <option value="landscape">{t.landscape}</option>
        </select>
      </label>
      <fieldset>
        <legend>{t.margins}</legend>
        <div className="jul-paged-settings__row">{(["top", "right", "bottom", "left"] as const).map(margin)}</div>
      </fieldset>
      <label>
        {t.header}
        <input value={s.header.text} onChange={(e) => emit({ header: { ...s.header, text: e.target.value } })} />
      </label>
      <label>
        {t.logo}
        <input value={s.header.logoSrc ?? ""} onChange={(e) => emit({ header: { ...s.header, logoSrc: e.target.value } })} />
      </label>
      <label>
        {t.footer} ({t.hint})
        <input value={s.footer.text} onChange={(e) => emit({ footer: { ...s.footer, text: e.target.value } })} />
      </label>
      <label>
        {t.footerAlign}
        <select value={s.footer.align} onChange={(e) => emit({ footer: { ...s.footer, align: e.target.value as HeaderFooterAlign } })}>
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={!!s.header.skipFirstPage} onChange={(e) => emit({ header: { ...s.header, skipFirstPage: e.target.checked }, footer: { ...s.footer, skipFirstPage: e.target.checked } })} />
        {t.skipFirst}
      </label>
    </div>
  );
}
