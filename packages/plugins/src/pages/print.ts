// Print / PDF stylesheet. `window.print()` (or the browser's "Save as PDF")
// should produce exactly the pages shown on screen. Strategy:
//  - @page declares the paper size with margin 0 (the sheet itself carries the
//    margins, so header/footer text and the logo can sit inside them).
//  - PagedEditor listens to beforeprint, switches to "print geometry" (page gap
//    0, zoom 1) and re-paginates, so one sheet == one physical page and the
//    spacers line up with the printer's own page boundaries.
//  - UI chrome (toolbar, zoom, canvas background) is hidden via the
//    `data-jul-no-print` attribute and the sheet backgrounds go flat.
import type { DocumentSettings } from "./settings.js";

/** The `@page` rule for a settings object. Chrome honours size; Firefox/Safari
 * honour it partially (they may still show the user's paper choice). */
export function pageRule(settings: Pick<DocumentSettings, "size" | "orientation">): string {
  return `@page { size: ${settings.size} ${settings.orientation}; margin: 0; }`;
}

/** Full print CSS. `scope` is the root class of PagedEditor (default
 * `.jul-paged`); include the string in a <style> next to the component
 * (PagedEditor does this itself unless `injectPrintStyles={false}`). */
export function buildPrintCss(settings: Pick<DocumentSettings, "size" | "orientation">, scope = ".jul-paged"): string {
  return `${pageRule(settings)}
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  [data-jul-no-print] { display: none !important; }
  ${scope} { background: none !important; padding: 0 !important; overflow: visible !important; height: auto !important; }
  ${scope} .jul-paged__stage { transform: none !important; margin: 0 !important; }
  ${scope} .jul-paged__sheet { box-shadow: none !important; margin: 0 !important; border: 0 !important; break-after: page; page-break-after: always; }
  ${scope} .jul-paged__sheet:last-child { break-after: auto; page-break-after: auto; }
  ${scope} .jul-paged__pagebreak { visibility: hidden; }
  ${scope} [contenteditable] { caret-color: transparent; }
  ${scope} img, ${scope} figure, ${scope} table { break-inside: avoid; }
}`;
}
