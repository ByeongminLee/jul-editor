// Public serde types, including the lossy-reporting shape.

import type { Registry } from "../model/schema.js";
import type { Doc } from "../model/types.js";

export interface LossyEntry {
  blockId: string;
  type: string;
  reason: string;
}

export interface ToMarkdownOptions {
  registry?: Registry;
  /** When true, also reports jul-editor-only markdown extensions (currently just
   * `chart`) as lossy so a strict-CommonMark consumer can warn about them.
   * The markdown itself is unaffected -- this only changes what's reported. */
  strict?: boolean;
}

export interface ToMarkdownResult {
  markdown: string;
  lossy: LossyEntry[];
}

export interface FromMarkdownOptions {
  registry?: Registry;
}

export interface FromMarkdownResult {
  doc: Doc;
  lossy: LossyEntry[];
}

export interface ToHTMLOptions {
  registry?: Registry;
}

export interface ToTextOptions {
  registry?: Registry;
}

// ---- fromHTML -------------------------------------------

/** Minimal DOMParser surface fromHTML needs -- lets callers inject jsdom's
 * (or any other) implementation instead of depending on a global. */
export interface DOMParserLike {
  parseFromString(markup: string, mimeType: string): Document;
}

/** A pasted `data:` image src that was deliberately NOT stored in the doc
 * (never persist a data: URL) -- the caller's upload hook
 * turns this into a real src and patches the block afterward. */
export interface PendingUpload {
  blockId: string;
  dataUrl: string;
}

export interface FromHTMLOptions {
  registry?: Registry;
  /** Defaults to `new DOMParser()` when a global DOMParser exists (browser);
   * pass jsdom's (or another) implementation to run outside a browser. */
  parser?: DOMParserLike;
}

export interface FromHTMLResult {
  doc: Doc;
  lossy: LossyEntry[];
  pendingUploads: PendingUpload[];
}
