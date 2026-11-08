// Escaping shared by toMarkdown and toHTML. No DOM.

// the codeBlock <-> nested-list-item round trip. marked's own
// list-item continuation-line scan unconditionally rewrites a LEADING tab in
// any nested line into literal spaces (its `leadingSpaceTab`/tab-expansion
// logic runs regardless of column alignment) -- there is no markdown
// spelling of "this fenced code line starts with a real tab" that survives
// being nested under a list item. We swap a literal tab for this private-use
// sentinel before nesting (codeBlock.toMarkdown, only when ctx.indent > 0)
// and swap it back unconditionally in from-markdown's plain-codeBlock
// fallback. A user's code containing a literal U+E000 character
// (never producable by typing) would round-trip as a tab instead -- fine.
export const CODE_TAB_PLACEHOLDER = "";

// CommonMark has no spelling for "this line's content is the
// empty string" that both (a) isn't silently dropped/merged by our own block
// joiner and (b) still gives GFM's task-checkbox regex (`\S` after `[ ] `)
// and marked's list continuation-line indentation math something to anchor
// on. A zero-width space is invisible, counts as non-whitespace content for
// both of those, and is never produced by typing -- so it's a safe stand-in
// for "no content here", stripped back out in from-markdown.ts.
export const EMPTY_MD_PLACEHOLDER = "​";

// Tight lists: consecutive list items of the SAME type join with a
// single "\n" (no blank line) instead of the generic block separator -- a
// blank line between sibling items of the same list is exactly what makes
// marked (and every other CommonMark parser) classify the list as "loose"
// on re-import; a Notion-style editor's own lists are tight by default,
// same as GitHub/editorcn. Shared by to-markdown.ts (sibling blocks) and
// builtins-serde.ts (a list item's own transition into its nested children,
// which is a "sibling" relationship in exactly the same tight/loose sense).
const LIST_ITEM_TYPES = new Set(["bulletListItem", "orderedListItem", "todoListItem"]);

export function isListItemType(type: string): boolean {
  return LIST_ITEM_TYPES.has(type);
}

/** Joins each `{type, text}` in order, using "\n" (tight) between two
 * consecutive list items of the same type and "\n\n" (loose/separator)
 * everywhere else -- including when the list TYPE changes (a bullet list
 * followed directly by an ordered list is still two separate lists in
 * CommonMark, so they need the blank line to not visually/structurally
 * merge). Empty text entries (an unknown/hookless block) are skipped
 * entirely, same as the old plain `chunks.filter(Boolean).join("\n\n")`. */
export function joinBlocksMd(items: { type: string; text: string }[]): string {
  let out = "";
  let prevType: string | null = null;
  for (const item of items) {
    if (item.text === "") continue;
    if (out !== "") out += prevType !== null && isListItemType(item.type) && item.type === prevType ? "\n" : "\n\n";
    out += item.text;
    prevType = item.type;
  }
  return out;
}

/** Escapes markdown inline special chars (and a literal backslash itself),
 * plus GFM's other implicit inline triggers: `~`/`<`/`&` (strikethrough,
 * raw HTML or an autolink like `<https://x>`, an HTML entity) and the
 * extended-autolink literal `www.`/`http(s)://`/`ftp://` prefixes
 * -- inserting a backslash escape breaks the literal substring
 * marked's autolink scanner requires while decoding back to the exact same
 * visible text. Must run BEFORE mark-wrapping (**bold** etc.) is added
 * around a run, so the wrapper syntax we add isn't itself escaped. Not used
 * for codespan content, which is literal (see wrapCodespan). */
export function escapeMdInline(text: string): string {
  let s = text.replace(/\\/g, "\\\\").replace(/([*_[\]~<&`])/g, "\\$1");
  s = s.replace(/\bwww\./g, "www\\.");
  s = s.replace(/\b(https?|ftp):\/\//gi, (_m, scheme: string) => `${scheme}:\\/` + "/");
  return s;
}

// A line consisting only of -, *, _, =, ~ (and spaces) reads as a thematic
// break, a setext-heading underline, or a tilde-fence no matter how short;
// escaping the first char is always safe (never changes the visible text)
// so we don't bother distinguishing exact CommonMark thresholds here.
const RISKY_ALLCHAR_LINE = /^[ \t]{0,3}[-*_=~][ \t\-*_=~]*$/;

/** Escapes a single markdown line's leading control sequence (#, >, -, +, *,
 * "1.", a leading "<" that would start an HTML block, a backtick/tilde fence
 * run) so re-parsing it doesn't produce a different block type than the
 * paragraph/heading/list-item/quote text it actually is. Block-type
 * sniffing in CommonMark only looks at the start of a line, so escaping
 * just the first char (or, for an ordered marker, the delimiter after the
 * digits -- escaping a digit doesn't escape anything) is enough. */
// HTML-block start conditions that trigger regardless of what follows on the
// SAME line (CommonMark conditions 1-5: comment / processing instruction /
// declaration / CDATA / script-pre-style-textarea) -- these are the ones
// worth guarding against unconditionally. Condition 7 (a bare inline tag
// like "<strong>" alone on the line) and condition 6's long block-tag-name
// list are deliberately NOT covered here: with real trailing content on the
// line (as our own <strong>/<em>/<del> HTML-tag-fallback wrapping always
// has, see inline-md.ts) neither actually starts an HTML block, so escaping
// them would be pure noise (and would defeat that fallback's own opening tag).
const HTML_BLOCK_START = /^<(?:!--|[?!]|\/?(?:script|pre|style|textarea)(?:[ \t>/]|$))/i;

export function escapeMdLineStart(line: string): string {
  if (RISKY_ALLCHAR_LINE.test(line)) return "\\" + line;
  if (/^(`{3,}|~{3,})/.test(line)) return "\\" + line;
  if (HTML_BLOCK_START.test(line)) return "\\" + line;
  if (/^#{1,6}(?:[ \t]|$)/.test(line)) return "\\" + line;
  if (/^>/.test(line)) return "\\" + line;
  if (/^[-+*](?:[ \t]|$)/.test(line)) return "\\" + line;
  const m = /^(\d+)([.)])(?=[ \t]|$)/.exec(line);
  if (m) {
    const numLen = m[1]!.length;
    return line.slice(0, numLen) + "\\" + m[2] + line.slice(numLen + 1);
  }
  return line;
}

/** Applies escapeMdLineStart to every line of a (possibly multi-line) run of
 * rendered inline markdown. */
export function escapeMdLines(text: string): string {
  return text.split("\n").map(escapeMdLineStart).join("\n");
}

/** Wraps <>-quotes a link/image destination when it contains characters
 * that would otherwise break the `(...)` destination syntax. */
export function mdHref(href: string): string {
  return /[\s()]/.test(href) ? `<${href}>` : href;
}

function longestBacktickRun(text: string): number {
  let max = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) max = Math.max(max, m[0].length);
  return max;
}

/** Fence for a ``` code block: longer than any backtick run inside the text,
 * minimum 3. */
export function codeFence(text: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
}

/** Wraps an inline codespan: fence longer than any internal backtick run
 * (minimum 1), padded with a single space if the text starts/ends with a
 * backtick or is all spaces (CommonMark codespan rule). */
export function wrapCodespan(text: string): string {
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const needsPad = text.startsWith("`") || text.endsWith("`") || (text.length > 0 && text.trim() === "");
  const body = needsPad ? ` ${text} ` : text;
  return fence + body + fence;
}

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
