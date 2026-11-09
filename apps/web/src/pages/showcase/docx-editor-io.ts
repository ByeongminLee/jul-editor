import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";
import { fromHTML } from "@jul-editor/core/serde";
import { exportDocx, importDocx, pageBreak } from "@jul-editor/plugins/pages";
import type { DocumentSettings, DocxLib, DocxPendingImage, MammothLib } from "@jul-editor/plugins/pages";

// Browser glue for the pages plugin's docx adapters. `docx` and `mammoth` are large, so they are
// loaded on first use (dynamic import) and injected into the plugin, which itself imports neither.

/** Header logo: a small inline SVG so the demo needs no network or asset file. */
export const LOGO_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5"/><path d="M20 18h14l10 10v18a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2z" fill="#fff"/><path d="M34 18v10h10" fill="#c7d2fe"/><rect x="24" y="34" width="16" height="2.5" rx="1" fill="#4f46e5"/><rect x="24" y="40" width="11" height="2.5" rx="1" fill="#4f46e5"/></svg>',
)}`;

/** docx cannot embed SVG, so the logo is rasterised to PNG at export time. */
async function resolveImage(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  canvas.getContext("2d")!.drawImage(img, 0, 0, 128, 128);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), type: "png" as const, width: 128, height: 128 };
}

export interface DocxExportInfo {
  blob: Blob;
  bytes: number;
  /** True when the blob starts with the zip signature "PK" and holds word/document.xml. */
  validZip: boolean;
  lossy: number;
}

/** True for a zip that contains a word/document.xml entry (file names are stored uncompressed in the zip directory). */
async function looksLikeDocx(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return new TextDecoder("latin1").decode(bytes).includes("word/document.xml");
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(file);
  });
}

const DOCX_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp"]);

async function rasterise(src: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 400;
    canvas.height = img.naturalHeight || 300;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Images inserted or imported in this session have no permanent URL (the demo has no upload server):
 * their bytes live in the editor's pending uploads. Export reads them from there. */
async function withPendingImages(doc: Doc, files: ReadonlyMap<string, File>): Promise<Doc> {
  if (!files.size) return doc;
  const srcs = new Map<string, string>();
  for (const [id, file] of files) {
    const url = await fileToDataUrl(file);
    // docx embeds png/jpeg/gif/bmp only: anything else (webp, svg ...) is rasterised to png first.
    srcs.set(id, DOCX_IMAGE_TYPES.has(file.type) ? url : (await rasterise(url)) ?? url);
  }
  const walk = (blocks: Block[]): Block[] => blocks.map((b) => {
    const src = b.type === "image" && !b.props.src ? srcs.get(b.id) : undefined;
    const next = src ? { ...b, props: { ...b.props, src } } : b;
    return b.children?.length ? { ...next, children: walk(b.children) } : next;
  });
  return { ...doc, blocks: walk(doc.blocks) };
}

export async function buildDocx(doc: Doc, settings: DocumentSettings, pendingFiles: ReadonlyMap<string, File> = new Map()): Promise<DocxExportInfo> {
  const docxLib = (await import("docx")) as unknown as DocxLib;
  const { file, lossy } = await exportDocx(await withPendingImages(doc, pendingFiles), settings, { docxLib, resolveImage });
  const blob = file as Blob;
  return { blob, bytes: blob.size, validZip: await looksLikeDocx(blob), lossy: lossy.length };
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The editor's schema (core blocks plus pageBreak) so imported page breaks parse back as blocks. */
const registry = createRegistry({ blocks: [...coreBlocks, pageBreak], inlines: coreInlines, marks: coreMarks });

export async function readDocx(file: File): Promise<{ doc: Doc; messages: string[]; images: DocxPendingImage[] }> {
  const mammoth = ((await import("mammoth")) as unknown as { default?: MammothLib } & MammothLib);
  const mammothLib: MammothLib = mammoth.default ?? mammoth;
  const { doc, messages, images } = await importDocx(await file.arrayBuffer(), { mammothLib, fromHTML: (html) => fromHTML(html, { registry }) });
  return { doc, messages, images };
}
