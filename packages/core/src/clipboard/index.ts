// Clipboard codec: Doc fragment <-> the three MIME payloads we put on
// (`encodeClipboard`) and read off (`decodeClipboard`) the system clipboard.
//
// decodeClipboard priority: application/x-jul-editor+json > text/html > text/plain
// (a same-origin jul-editor copy carries perfect-fidelity JSON; most other apps
// only offer HTML; a bare-text source only offers plain text). ONE exception
// to html > text/plain: when the plain text looks like markdown and the html is
// only a styling wrapper around that same text (VS Code, raw GitHub/textarea
// copies, Slack, ...), the markdown is parsed instead -- otherwise the user
// would see raw `#`, `**` etc. (see `preferMarkdownOverHtml`). `plain: true`
// (Cmd/Ctrl+Shift+V) skips every conversion and pastes the text verbatim.
// The jul-editor
// JSON payload is UNTRUSTED (another site can write that MIME type too) --
// it goes through fromJSON (migrate/validate/normalize, incl. sanitizeUrl on
// every href/src) and then has every single block id reissued, never just
// the ones fromJSON's own ensureUniqueIds happened to find colliding.

import { fromHTML } from "../serde/from-html.js";
import { fromMarkdown } from "../serde/from-markdown.js";
import { toHTML } from "../serde/to-html.js";
import { toMarkdown } from "../serde/to-markdown.js";
import type { DOMParserLike, FromHTMLResult, LossyEntry, PendingUpload } from "../serde/types.js";
import { coreRegistry } from "../serde/builtins-serde.js";
import { normalizeDoc } from "../model/canonical.js";
import { newId } from "../model/id.js";
import { CURRENT_VERSION, fromJSON, toJSON } from "../model/migrate.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";

export type { PendingUpload } from "../serde/types.js";

export interface ClipboardEncodeResult {
  "text/plain": string;
  "text/html": string;
  "application/x-jul-editor+json": string;
}

export function encodeClipboard(fragment: Doc, opts: { registry?: Registry } = {}): ClipboardEncodeResult {
  const registry = opts.registry ?? coreRegistry;
  return {
    "text/plain": toMarkdown(fragment, { registry }).markdown,
    "text/html": toHTML(fragment, { registry }),
    "application/x-jul-editor+json": toJSON(fragment),
  };
}

/** The subset of the DOM `DataTransfer` interface decodeClipboard needs --
 * lets callers pass a real ClipboardEvent.clipboardData/DragEvent.dataTransfer
 * or a test double. */
export interface DataTransferLike {
  getData(format: string): string;
  files?: ArrayLike<File>;
}

export interface ClipboardDecodeResult {
  doc: Doc;
  lossy: LossyEntry[];
  pendingUploads: PendingUpload[];
  /** Files present on the clipboard/drop (the caller chooses image or attachment handling). */
  files: File[];
}

export function decodeClipboard(
  data: DataTransferLike,
  opts: { registry?: Registry; parser?: DOMParserLike; plain?: boolean } = {},
): ClipboardDecodeResult {
  const registry = opts.registry ?? coreRegistry;
  const files = extractFiles(data);

  // "paste as plain text": ignore json/html and never run markdown, one
  // paragraph per line (still falls back to nothing if there is no text/plain).
  if (opts.plain) {
    const text = safeGetData(data, "text/plain");
    if (text || !safeGetData(data, "text/html")) return { doc: plainTextToDoc(text, registry), lossy: [], pendingUploads: [], files };
  }

  const julEditorJson = safeGetData(data, "application/x-jul-editor+json");
  if (julEditorJson) {
    const decoded = decodeJulEditorJson(julEditorJson, registry);
    if (decoded) return { ...decoded, files };
  }

  const html = safeGetData(data, "text/html");
  const plainText = safeGetData(data, "text/plain");
  if (html && !preferMarkdownOverHtml(plainText, html, safeGetData(data, "vscode-editor-data"))) {
    const { doc, lossy, pendingUploads }: FromHTMLResult = fromHTML(html, { registry, parser: opts.parser });
    return { doc, lossy, pendingUploads, files };
  }

  const { doc, lossy } = decodePlainText(plainText, registry);
  return { doc, lossy, pendingUploads: [], files };
}

function safeGetData(data: DataTransferLike, format: string): string {
  try {
    return data.getData(format) ?? "";
  } catch {
    return "";
  }
}

function extractFiles(data: DataTransferLike): File[] {
  if (!data.files) return [];
  return Array.from(data.files);
}

// Untrusted (another site can also write this MIME type): fromJSON's own
// migrate/validate/normalize (incl. sanitizeUrl on every link/image) runs
// first, then EVERY block id is reissued -- not only the duplicates
// ensureUniqueIds would have caught -- so a foreign id can never collide
// with (or be trusted to identify) anything already in this doc.
function decodeJulEditorJson(jsonStr: string, registry: Registry): { doc: Doc; lossy: LossyEntry[]; pendingUploads: PendingUpload[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  try {
    const { doc } = fromJSON(parsed, registry);
    return { doc: reissueAllIds(doc), lossy: [], pendingUploads: [] };
  } catch {
    return null;
  }
}

function reissueAllIds(doc: Doc): Doc {
  function walk(blocks: Block[]): Block[] {
    return blocks.map((b) => {
      const next: Block = { ...b, id: newId() };
      if (b.children) next.children = walk(b.children);
      return next;
    });
  }
  return { version: doc.version, blocks: walk(doc.blocks) };
}

// Markdown sniffing heuristic. Two tiers:
//  * STRONG signals decide on their own: a line starting with a block marker
//    (heading, `-`/`*`/`+` bullet, `- [ ]`/`- [x]` task, `1.`/`1)` ordered,
//    `>` quote, a ``` fence, a GFM table row `| a | b |`, or a thematic
//    break `---`/`***`/`___`), or a bracket-paren pair (real links / `[x](y)`).
//    All are anchored to the line start, so "a - b" never trips them.
//  * INLINE-only signals (`**bold**`, `__bold__`, `~~strike~~`, `` `code` ``,
//    `==hl==`) are weaker (a lone `**x**` or backtick word is ordinary chat
//    prose), so they need 2+ hits or a multi-line text (2+ non-empty lines).
// Anything else (including a prose line with a single stray asterisk) stays
// plain paragraphs.
const MD_LINE_RE = /^[ \t]{0,3}(#{1,6}(?=[ \t]|$)|[-*+][ \t]|\d+[.)][ \t]|>|```|\|.*\||([-*_])(?:[ \t]*\2){2,}[ \t]*$)/m;
const MD_BRACKET_RE = /\[[^\]]*\]\([^)]*\)/;
const MD_INLINE_RES = [/\*\*[^*\n]+\*\*/g, /(?:^|\s)__[^_\n]+__(?=\s|$)/g, /~~[^~\n]+~~/g, /`[^`\n]+`/g, /==[^=\n]+==/g];

function looksLikeMarkdown(text: string): boolean {
  if (MD_LINE_RE.test(text) || MD_BRACKET_RE.test(text)) return true;
  let hits = 0;
  for (const re of MD_INLINE_RES) hits += text.match(re)?.length ?? 0;
  if (hits === 0) return false;
  if (hits >= 2) return true;
  return text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length >= 2;
}

// Tags a "plain text in a costume" html payload may contain: wrappers/styling
// only. Anything else (h1-h6, ul/ol/li, table, blockquote, strong/b/em/i/a/img/
// del/s/mark/u/hr, <code> outside <pre>, ...) means the source really has
// structure and the html path (fromHTML) is the better decoder.
const NON_SEMANTIC_TAGS = new Set(["html", "head", "body", "meta", "style", "div", "span", "pre", "br", "p", "title", "font"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, "&");
}

/** Cheap regex-based check (no DOM, so it works under test/SSR without a
 * parser): is `html` just a non-semantic wrapper whose text equals `plain`
 * modulo whitespace? */
function isNonSemanticHtml(html: string, plain: string): boolean {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let codeOk = 0;
  for (let m = tagRe.exec(body); m; m = tagRe.exec(body)) {
    const name = m[1]!.toLowerCase();
    if (NON_SEMANTIC_TAGS.has(name)) continue;
    // `<pre><code>` (GitHub raw / copy-as-code wrappers) is still just a wrapper.
    if (name === "code" && /<pre\b[^>]*>\s*$/i.test(body.slice(0, m.index))) {
      codeOk++;
      continue;
    }
    if (name === "code" && codeOk > 0) continue; // its own closing tag
    return false;
  }
  const text = decodeEntities(body.replace(/<[^>]*>/g, ""));
  return text.replace(/\s+/g, "") === plain.replace(/\s+/g, "");
}

/** True when the plain text is markdown that the html payload would only
 * flatten into raw `#`/`**` text: either the source says it is a code editor
 * (VS Code's `vscode-editor-data`), or the html is a non-semantic wrapper of
 * that same text. */
function preferMarkdownOverHtml(plain: string, html: string, vscodeEditorData: string): boolean {
  if (!plain || !looksLikeMarkdown(plain)) return false;
  return Boolean(vscodeEditorData) || isNonSemanticHtml(html, plain);
}

function decodePlainText(text: string, registry: Registry): { doc: Doc; lossy: LossyEntry[] } {
  if (looksLikeMarkdown(text)) return fromMarkdown(text, { registry });
  return { doc: plainTextToDoc(text, registry), lossy: [] };
}

function plainTextToDoc(text: string, registry: Registry): Doc {
  const lines = text.split(/\r\n|\r|\n/);
  const blocks: Block[] = lines.map((line) => ({
    id: newId(),
    type: "paragraph",
    props: {},
    content: line ? [{ type: "text", text: line }] : [],
  }));
  return normalizeDoc({ version: CURRENT_VERSION, blocks }, registry);
}
