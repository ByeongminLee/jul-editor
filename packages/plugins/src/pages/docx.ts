// DOCX export / import with the libraries INJECTED by the host.
//
// `docx` (https://www.npmjs.com/package/docx) and `mammoth` are NOT
// dependencies of this package (neither is in node_modules), so nothing here
// imports them. The host does:
//
//   import * as docx from "docx";
//   const blob = await exportDocx(doc, settings, { docxLib: docx });
//
//   import mammoth from "mammoth";
//   const { doc } = await importDocx(arrayBuffer, { mammothLib: mammoth, fromHTML });
//
// DocxLib is typed structurally and loosely on purpose (constructors are
// `new (...args) => unknown`) so we compile without the package's types and
// tolerate minor version drift. Written against docx v8/v9 API names.
import type { Block, Doc, Inline } from "@jul-editor/core";
import { PAGE_SIZES_MM, mmToTwips, normalizeSettings } from "./settings.js";
import type { DocumentSettings } from "./settings.js";
import { splitPageTokens } from "./tokens.js";
import { PAGE_BREAK_HTML } from "./page-break.js";

type Ctor = new (...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DocxLib {
  Document: Ctor;
  Packer: { toBlob?(d: unknown): Promise<Blob>; toBuffer?(d: unknown): Promise<unknown> };
  Paragraph: Ctor;
  TextRun: Ctor;
  Header: Ctor;
  Footer: Ctor;
  PageBreak: Ctor;
  ImageRun?: Ctor;
  /** Needed for link marks; without it links export as plain styled text. */
  ExternalHyperlink?: Ctor;
  Table: Ctor;
  TableRow: Ctor;
  TableCell: Ctor;
  AlignmentType: Record<string, string>;
  HeadingLevel: Record<string, string>;
  PageNumber: { CURRENT: unknown; TOTAL_PAGES: unknown };
  PageOrientation: { PORTRAIT: unknown; LANDSCAPE: unknown };
  LevelFormat?: Record<string, string>;
  BorderStyle?: Record<string, string>;
}

export interface ExportDocxOptions {
  docxLib: DocxLib;
  /** "blob" (browser, default) or "buffer" (node). */
  output?: "blob" | "buffer";
  /** Image bytes for header.logoSrc and for image blocks whose src is not a data URL, when the host
   * resolved them (this module does no network). */
  resolveImage?: (src: string) => Promise<{ data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number } | null>;
}

export interface ExportDocxResult<T = unknown> {
  file: T;
  /** Blocks that were degraded (images, charts, ...). */
  lossy: { blockId: string; type: string; reason: string }[];
}

export async function exportDocx(doc: Doc, settingsInput: Partial<DocumentSettings> | undefined, opts: ExportDocxOptions): Promise<ExportDocxResult> {
  const L = opts.docxLib;
  const settings = normalizeSettings(settingsInput);
  const lossy: ExportDocxResult["lossy"] = [];
  const images = new Map<string, ImageData>();
  await collectImages(doc.blocks, opts, images);
  const ctx: Ctx = { L, lossy, images };
  const children = doc.blocks.flatMap((b) => blockToDocx(b, ctx, 0));
  const dims = PAGE_SIZES_MM[settings.size];
  const m = settings.margins;

  const align = (a: string) => L.AlignmentType[a === "left" ? "LEFT" : a === "right" ? "RIGHT" : "CENTER"];
  const tokenRuns = (tpl: string) =>
    splitPageTokens(tpl).map((p) => new L.TextRun(p.kind === "text" ? { text: p.text } : { children: [p.kind === "page" ? L.PageNumber.CURRENT : L.PageNumber.TOTAL_PAGES] }));

  const headerKids: unknown[] = [];
  if (settings.header.enabled && (settings.header.text || settings.header.logoSrc)) {
    const runs: unknown[] = tokenRuns(settings.header.text);
    if (settings.header.logoSrc && opts.resolveImage && L.ImageRun) {
      const img = await opts.resolveImage(settings.header.logoSrc);
      if (img) {
        const h = Math.round(((settings.header.logoHeight ?? 8) / 25.4) * 96);
        runs.push(new L.TextRun({ text: "\t" }), new L.ImageRun({ data: img.data, type: img.type, transformation: { width: Math.round((img.width / img.height) * h), height: h } }));
      }
    }
    headerKids.push(new L.Paragraph({ alignment: align(settings.header.align), children: runs, tabStops: [{ type: "right", position: mmToTwips(dims.width - m.left - m.right) }] }));
  }
  const footerKids: unknown[] = [];
  if (settings.footer.enabled && settings.footer.text) footerKids.push(new L.Paragraph({ alignment: align(settings.footer.align), children: tokenRuns(settings.footer.text) }));

  const document = new L.Document({
    numbering: L.LevelFormat
      ? { config: [{ reference: "jul-ordered", levels: [0, 1, 2, 3].map((level) => ({ level, format: L.LevelFormat!.DECIMAL, text: `%${level + 1}.`, alignment: L.AlignmentType.START ?? "start" })) }] }
      : undefined,
    sections: [
      {
        properties: {
          // docx swaps width/height itself for LANDSCAPE: always pass portrait dimensions.
          page: {
            size: { width: mmToTwips(dims.width), height: mmToTwips(dims.height), orientation: settings.orientation === "landscape" ? L.PageOrientation.LANDSCAPE : L.PageOrientation.PORTRAIT },
            margin: { top: mmToTwips(m.top), right: mmToTwips(m.right), bottom: mmToTwips(m.bottom), left: mmToTwips(m.left), header: mmToTwips(settings.headerDistance), footer: mmToTwips(settings.footerDistance) },
          },
          titlePage: !!(settings.header.skipFirstPage || settings.footer.skipFirstPage),
        },
        headers: { default: new L.Header({ children: headerKids.length ? headerKids : [new L.Paragraph({})] }) },
        footers: { default: new L.Footer({ children: footerKids.length ? footerKids : [new L.Paragraph({})] }) },
        children: children.length ? children : [new L.Paragraph({})],
      },
    ],
  });
  const file = opts.output === "buffer" ? await L.Packer.toBuffer?.(document) : await L.Packer.toBlob?.(document);
  if (file === undefined) throw new Error("docxLib.Packer lacks " + (opts.output === "buffer" ? "toBuffer" : "toBlob"));
  return { file, lossy };
}

interface ImageData {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
}

interface Ctx {
  L: DocxLib;
  lossy: ExportDocxResult["lossy"];
  images: Map<string, ImageData>;
}

/** Color tokens (core COLOR_PALETTE) -> hex. The editor is headless, so these are only the export defaults. */
const TEXT_HEX: Record<string, string> = { gray: "787774", brown: "9F6B53", orange: "D9730D", yellow: "CB912F", green: "448361", blue: "337EA9", purple: "9065B0", pink: "C14C8A", red: "D44C47" };
const HIGHLIGHT_HEX: Record<string, string> = { gray: "E3E2E0", brown: "EEE0DA", orange: "FADEC9", yellow: "FBF3DB", green: "DBEDDB", blue: "D3E5EF", purple: "E8DEEE", pink: "F5E0E9", red: "FFE2DD" };
const hexOf = (table: Record<string, string>, v: unknown): string | undefined => {
  const s = String(v ?? "");
  if (/^#?[0-9a-f]{6}$/i.test(s)) return s.replace("#", "").toUpperCase();
  return table[s];
};

/** `14pt` / `18px` / bare number -> docx half-points (size: 24 = 12pt). null when unusable. */
function halfPoints(size: unknown): number | null {
  const m = /^(\d+(?:\.\d+)?)(pt|px)?$/i.exec(String(size ?? "").trim());
  if (!m) return null;
  const pt = (m[2] ?? "px").toLowerCase() === "pt" ? Number(m[1]) : Number(m[1]) * 0.75;
  return pt > 0 ? Math.round(pt * 2) : null;
}

/** Image size from the file header (png, gif, jpeg, bmp); null when unknown. */
function sniffImage(bytes: Uint8Array): Pick<ImageData, "type" | "width" | "height"> | null {
  const u16 = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  const u32 = (i: number) => ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { type: "png", width: u32(16), height: u32(20) };
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) return { type: "gif", width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) return { type: "bmp", width: bytes[18]! | (bytes[19]! << 8), height: Math.abs(bytes[22]! | (bytes[23]! << 8)) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: "jpg", height: u16(i + 5), width: u16(i + 7) };
      i += 2 + u16(i + 2);
    }
    return { type: "jpg", width: 0, height: 0 };
  }
  return null;
}

function decodeDataUrl(src: string): Uint8Array | null {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  try {
    if (m[1]) {
      const bin = atob(m[2]!);
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }
    return new TextEncoder().encode(decodeURIComponent(m[2]!));
  } catch {
    return null;
  }
}

/** Resolves the bytes of every image block up front (export is async, block mapping is not). */
async function collectImages(blocks: Block[], opts: ExportDocxOptions, out: Map<string, ImageData>): Promise<void> {
  for (const b of blocks) {
    if (b.type === "image" && opts.docxLib.ImageRun) {
      const src = String(b.props.src ?? "");
      if (src) {
        const bytes = src.startsWith("data:") ? decodeDataUrl(src) : null;
        const sniffed = bytes ? sniffImage(bytes) : null;
        if (bytes && sniffed) out.set(b.id, { data: bytes, ...sniffed, width: sniffed.width || 400, height: sniffed.height || 300 });
        else if (!src.startsWith("data:") && opts.resolveImage) {
          const img = await opts.resolveImage(src);
          if (img) out.set(b.id, img);
        }
      }
    }
    if (b.children?.length) await collectImages(b.children, opts, out);
  }
}

/** Page content width in px at 96 dpi for A4 minus default margins; images are scaled to fit. */
const MAX_IMAGE_PX = 600;

function imageSize(img: ImageData, width: unknown): { width: number; height: number } {
  let w = img.width;
  if (typeof width === "number" && width > 0) w = width;
  else if (typeof width === "string" && /^\d+(\.\d+)?%$/.test(width)) w = (parseFloat(width) / 100) * MAX_IMAGE_PX;
  w = Math.min(w, MAX_IMAGE_PX);
  return { width: Math.round(w), height: Math.round((w / img.width) * img.height) };
}

function inlineRuns(content: Inline[] | undefined, L: DocxLib, base: Record<string, unknown> = {}): unknown[] {
  const runs: unknown[] = [];
  for (const inl of content ?? []) {
    if (inl.type === "text") {
      const t = inl as { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
      const mark = (k: string) => t.marks?.find((m) => m.type === k);
      const has = (k: string) => !!mark(k);
      const style: Record<string, unknown> = { ...base, text: t.text, bold: has("bold") || base.bold, italics: has("italic") || base.italics, strike: has("strike"), underline: has("underline") ? {} : undefined, subScript: has("subscript"), superScript: has("superscript") };
      if (has("code")) style.font = "Courier New";
      const family = mark("fontFamily")?.attrs?.family;
      if (family) style.font = String(family);
      const size = halfPoints(mark("fontSize")?.attrs?.size);
      if (size) style.size = size;
      const color = hexOf(TEXT_HEX, mark("textColor")?.attrs?.color);
      if (color) style.color = color;
      const fill = hexOf(HIGHLIGHT_HEX, mark("highlight")?.attrs?.color);
      if (fill) style.shading = { type: "clear", color: "auto", fill };
      const href = mark("link")?.attrs?.href;
      if (href && L.ExternalHyperlink) {
        runs.push(new L.ExternalHyperlink({ link: String(href), children: [new L.TextRun({ ...style, color: color ?? "0563C1", underline: style.underline ?? { type: "single" } })] }));
      } else runs.push(new L.TextRun(style));
    } else if (inl.type === "mention") {
      runs.push(new L.TextRun({ ...base, text: "@" + ((inl as { attrs?: { label?: string } }).attrs?.label ?? "") }));
    }
  }
  return runs;
}

/** Block `textAlign` -> docx paragraph alignment (`justify` -> BOTH). Absent when the block has none. */
function alignmentOf(b: Block, L: DocxLib): { alignment: string } | Record<string, never> {
  const a = String(b.props.textAlign ?? "");
  const key = a === "left" ? "LEFT" : a === "right" ? "RIGHT" : a === "center" ? "CENTER" : a === "justify" ? "JUSTIFIED" : "";
  const v = key && (L.AlignmentType[key] ?? (key === "JUSTIFIED" ? L.AlignmentType.BOTH : undefined));
  return v ? { alignment: v } : {};
}

function blockToDocx(b: Block, ctx: Ctx, depth: number): unknown[] {
  const { L, lossy } = ctx;
  const out: unknown[] = [];
  const indent = depth ? { indent: { left: 720 * depth } } : {};
  const align = alignmentOf(b, L);
  switch (b.type) {
    case "paragraph":
      out.push(new L.Paragraph({ children: inlineRuns(b.content, L), ...align, ...indent }));
      break;
    case "heading": {
      const lvl = Math.min(6, Math.max(1, Number(b.props.level) || 1));
      out.push(new L.Paragraph({ heading: L.HeadingLevel[`HEADING_${lvl}`], children: inlineRuns(b.content, L), ...align, ...indent }));
      break;
    }
    case "bulletListItem":
      out.push(new L.Paragraph({ bullet: { level: Math.min(depth, 8) }, children: inlineRuns(b.content, L), ...align }));
      break;
    case "orderedListItem":
      out.push(new L.Paragraph({ numbering: { reference: "jul-ordered", level: Math.min(depth, 3) }, children: inlineRuns(b.content, L), ...align }));
      break;
    case "todoListItem":
      out.push(new L.Paragraph({ children: [new L.TextRun({ text: b.props.checked ? "☑ " : "☐ " }), ...inlineRuns(b.content, L)], ...align, ...indent }));
      break;
    case "quote":
      out.push(new L.Paragraph({ indent: { left: 720 * (depth + 1) }, children: inlineRuns(b.content, L, { italics: true }), ...align }));
      break;
    case "codeBlock": {
      const text = (b.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "")).join("");
      for (const line of text.split("\n")) out.push(new L.Paragraph({ children: [new L.TextRun({ text: line, font: "Courier New" })], ...indent }));
      break;
    }
    case "divider":
      out.push(new L.Paragraph({ border: L.BorderStyle ? { bottom: { style: L.BorderStyle.SINGLE, size: 6, space: 1, color: "999999" } } : undefined, children: [] }));
      break;
    case "pageBreak":
      out.push(new L.Paragraph({ children: [new L.PageBreak()] }));
      break;
    case "table": {
      const rows = (b.children ?? []).map((r) => new L.TableRow({ children: (r.children ?? []).map((c) => new L.TableCell({ children: [new L.Paragraph({ children: inlineRuns(c.content, L), ...alignmentOf(c, L) })] })) }));
      out.push(new L.Table({ rows }));
      break;
    }
    case "image": {
      const img = ctx.images.get(b.id);
      if (img && L.ImageRun) {
        const caption = String(b.props.caption ?? "");
        const imgAlign = b.props.align === "left" ? L.AlignmentType.LEFT : b.props.align === "right" ? L.AlignmentType.RIGHT : L.AlignmentType.CENTER;
        out.push(new L.Paragraph({ alignment: imgAlign, children: [new L.ImageRun({ data: img.data, type: img.type, transformation: imageSize(img, b.props.width), altText: { name: String(b.props.alt ?? "image"), description: String(b.props.alt ?? ""), title: String(b.props.alt ?? "") } })], ...indent }));
        if (caption) out.push(new L.Paragraph({ alignment: L.AlignmentType.CENTER, children: [new L.TextRun({ text: caption, italics: true })] }));
        break;
      }
      lossy.push({ blockId: b.id, type: b.type, reason: "no-docx-mapping" });
      out.push(new L.Paragraph({ children: [new L.TextRun({ text: `[${b.type}]`, italics: true })] }));
      break;
    }
    default:
      lossy.push({ blockId: b.id, type: b.type, reason: "no-docx-mapping" });
      out.push(new L.Paragraph({ children: [new L.TextRun({ text: `[${b.type}]`, italics: true })] }));
  }
  if (b.children?.length && b.type !== "table") for (const c of b.children) out.push(...blockToDocx(c, ctx, depth + 1));
  return out;
}

// ---- import (optional) ------------------------------------------------------------

export interface MammothLib {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { styleMap?: string | string[] }): Promise<{ value: string; messages: { type: string; message: string }[] }>;
}

/** A data: image fromHTML could not keep in the doc (core never stores data: URLs): the image
 * block is left with an empty src, and the host stages the bytes as an upload
 * (`editor.attachUpload(blockId, dataUrlToFile(dataUrl))` once the doc is loaded). */
export interface DocxPendingImage {
  blockId: string;
  dataUrl: string;
}

export interface ImportDocxOptions {
  mammothLib: MammothLib;
  /** `fromHTML` from @jul-editor/core/serde (injected to keep this module DOM/serde free). Needs a DOM or a `parser` the host binds into it.
   * Pass a registry that includes `pageBreak` so page breaks come back as blocks. */
  fromHTML: (html: string) => { doc: Doc; pendingUploads?: DocxPendingImage[] };
  /** Extra mammoth style map lines (run after the page break mapping). */
  styleMap?: string[];
}

export interface ImportDocxResult {
  doc: Doc;
  settings: DocumentSettings;
  messages: string[];
  /** Embedded images (mammoth emits them as data: URLs), keyed by the image block they belong to. */
  images: DocxPendingImage[];
}

// mammoth drops <w:br w:type="page"/> unless a style map names it. It is mapped to a marker <hr>
// (mammoth writes it inside the paragraph that held the break) and swapped for the pageBreak html.
const PAGE_BREAK_CLASS = "jul-page-break";
const PAGE_BREAK_STYLE = `br[type='page'] => hr.${PAGE_BREAK_CLASS}`;
const MARKER = new RegExp(`<hr class="${PAGE_BREAK_CLASS}"\\s*/?>`, "g");

/** Replaces mammoth's page break markers with the pageBreak block's html. A paragraph that holds
 * only breaks becomes the breaks; a break inside text splits that paragraph around it. */
export function restoreDocxPageBreaks(html: string): string {
  if (!html.includes(PAGE_BREAK_CLASS)) return html;
  return html
    .replace(/<p>([^]*?)<\/p>/g, (m, inner: string) => {
      if (!inner.includes(PAGE_BREAK_CLASS)) return m;
      return inner.split(MARKER).map((part) => (part.trim() ? `<p>${part}</p>` : "")).join(PAGE_BREAK_HTML);
    })
    .replace(MARKER, PAGE_BREAK_HTML);
}

/** DOCX -> Doc via mammoth's HTML output. Page size/margins/header/footer are
 * NOT recovered (mammoth ignores section properties): returns default settings. */
export async function importDocx(data: ArrayBuffer, opts: ImportDocxOptions): Promise<ImportDocxResult> {
  const res = await opts.mammothLib.convertToHtml({ arrayBuffer: data }, { styleMap: [PAGE_BREAK_STYLE, ...(opts.styleMap ?? [])] });
  const { doc, pendingUploads } = opts.fromHTML(restoreDocxPageBreaks(res.value));
  return { doc, settings: normalizeSettings(), messages: res.messages.map((m) => `${m.type}: ${m.message}`), images: pendingUploads ?? [] };
}
