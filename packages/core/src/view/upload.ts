// Files and object URLs are editor-lifetime state, never document data.
import { sanitizeImageSource, sanitizeUrl } from "../model/url.js";
export type UploadState = { status: "queued" | "uploading" } | { status: "error"; message?: string };
export type UploadResult = { src: string; assetId?: string };
export type UploadContext = { blockId: string; kind: "image" | "file" };
export type UploadFn = (file: File, ctx: UploadContext) => Promise<UploadResult>;
export type PendingUploadInfo = { blockId: string; file: File; status: UploadState["status"] };
export interface UploadRegistry {
  get(blockId: string): UploadState | undefined;
  getFile(blockId: string): File | undefined;
  getPreview(blockId: string): string | undefined;
  pending(): PendingUploadInfo[];
  queue(blockId: string, file: File): void;
  start(blockId: string, file: File): void;
  succeed(blockId: string): void;
  fail(blockId: string, message?: string): void;
  destroy(): void;
  onChange(listener: (blockId: string) => void): () => void;
}
export function createUploadRegistry(): UploadRegistry {
  const states = new Map<string, UploadState>();
  const files = new Map<string, File>();
  const previews = new Map<string, string>();
  const listeners = new Set<(blockId: string) => void>();
  function notify(id: string) { for (const listener of listeners) listener(id); }
  function keep(id: string, file: File) {
    if (files.has(id) && files.get(id) !== file) {
      const preview = previews.get(id);
      if (preview) URL.revokeObjectURL(preview);
      previews.delete(id);
    }
    files.set(id, file);
    if (!previews.has(id) && file.type.startsWith("image/") && typeof URL.createObjectURL === "function") {
      try { previews.set(id, URL.createObjectURL(file)); } catch { /* Preview is optional in non-browser hosts. */ }
    }
  }
  function clear(id: string) {
    const preview = previews.get(id);
    if (preview) URL.revokeObjectURL(preview);
    previews.delete(id); states.delete(id); files.delete(id); notify(id);
  }
  return {
    get: id => states.get(id), getFile: id => files.get(id), getPreview: id => previews.get(id),
    pending: () => [...files].map(([blockId, file]) => ({blockId, file, status: states.get(blockId)!.status})),
    queue(id, file) { keep(id, file); states.set(id, {status: "queued"}); notify(id); },
    start(id, file) { keep(id, file); states.set(id, {status: "uploading"}); notify(id); },
    succeed: clear,
    fail(id, message) { states.set(id, {status: "error", message}); notify(id); },
    destroy() { for (const id of files.keys()) clear(id); listeners.clear(); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export async function performUpload(registry: UploadRegistry, blockId: string, file: File, onUpload: UploadFn, applyResult: (result: UploadResult) => void, kind: UploadContext["kind"] = file.type.startsWith("image/") ? "image" : "file"): Promise<boolean> {
  registry.start(blockId, file);
  try {
    const result = await onUpload(file, { blockId, kind });
    if (registry.getFile(blockId) !== file) return false;
    const src = kind === "image" ? sanitizeImageSource(result.src) : sanitizeUrl(result.src, "image");
    if (!src) throw new Error("Upload must return a safe image source or permanent URL.");
    applyResult({...result, src});
    registry.succeed(blockId);
    return true;
  } catch (error) {
    if (registry.getFile(blockId) === file) registry.fail(blockId, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Decodes a `data:` URL (a pasted `<img src="data:...">`, or a paste's
 * fromHTML `pendingUploads` entry) into a File -- no `fetch` dependency
 * (works identically in a real browser and in a headless/jsdom test), just a
 * manual base64/percent decode. Returns null for a malformed data: URL. */
export function dataUrlToFile(dataUrl: string, filename = "pasted-image"): File | null {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const isBase64 = !!m[2];
  const data = m[3] ?? "";
  try {
    const binary = isBase64 ? atob(data) : decodeURIComponent(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}
