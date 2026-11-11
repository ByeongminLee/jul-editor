// Word-like paged document support. Wiring (done by the integration agent):
//   <Editor blocks={[pageBreak]} renderers={{ pageBreak: PageBreakView }}>
//     <PagedEditor settings={settings} zoom={zoom}><EditorContent /></PagedEditor>
//   </Editor>
export { PagedEditor, pageFlags, blockTypeOf, PageBreakView, ZoomControl, PageSettingsPanel, PAGED_CSS, SCREEN_PAGE_GAP } from "./paged-editor.js";
export type { PagedEditorProps, PagedEditorClassNames } from "./paged-editor.js";
export { paginate, blocksByPage } from "./paginate.js";
export type { PaginateBlock, PaginateOptions, PaginateResult, PlacedBlock } from "./paginate.js";
export { pageBreak, pageBreakSlashItem, createPageBreak, restorePageBreaks, isPageBreak, PAGE_BREAK_MARKDOWN, PAGE_BREAK_HTML } from "./page-break.js";
export {
  DEFAULT_SETTINGS, PAGE_SIZES_MM, PAGE_SIZE_NAMES, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, MIN_CONTENT_MM,
  normalizeSettings, pageDimensionsMm, pageGeometryPx, mmToPx, mmToTwips, clampZoom,
} from "./settings.js";
export type { DocumentSettings, PageSizeName, PageOrientation, PageMargins, HeaderFooterSettings, HeaderFooterAlign, PageGeometryPx } from "./settings.js";
export { applyPageTokens, splitPageTokens } from "./tokens.js";
export { buildPrintCss, pageRule } from "./print.js";
export { exportDocx, importDocx, restoreDocxPageBreaks } from "./docx.js";
export type { DocxLib, DocxPendingImage, MammothLib, ExportDocxOptions, ExportDocxResult, ImportDocxOptions, ImportDocxResult } from "./docx.js";
