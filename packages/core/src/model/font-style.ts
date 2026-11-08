// Value sanitizers for the `fontFamily` / `fontSize` marks (DOCX style toolbar). Stored JSON, pasted
// HTML and the toolbar are all untrusted input for a value that ends up in a CSS declaration, so
// every write and every DOM/HTML emit goes through these. Pure and DOM-free.

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace"]);
// letters (any script), digits, space, dot, hyphen, underscore. No quotes, commas, semicolons, parens,
// slashes, braces or backslashes, so the value can never leave its CSS string/ident.
const FAMILY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;
const SIZE = /^(\d{1,3}(?:\.\d{1,2})?)(px|pt|em|rem|%)$/;
const MAX_BY_UNIT: Record<string, number> = { px: 400, pt: 300, em: 20, rem: 20, "%": 1000 };

/** One font family name (`Arial`, `Noto Sans KR`, `serif`), or null when it is not safe. Takes the
 * first entry of a CSS list (`"Calibri", sans-serif`) and strips its quotes, which is what a pasted
 * `font-family` style looks like. */
export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]!.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!first) return null;
  if (GENERIC_FAMILIES.has(first.toLowerCase())) return first.toLowerCase();
  return FAMILY_NAME.test(first) ? first : null;
}

/** `14pt`, `18px`, `1.2em`; null when malformed, zero or absurdly large. A bare number is taken as px. */
export function sanitizeFontSize(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = `${value}px`;
  if (typeof value !== "string") return null;
  const m = SIZE.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0) || n > MAX_BY_UNIT[m[2]!]!) return null;
  return `${n}${m[2]}`;
}

/** The `font-family` declaration value for an already sanitized family. */
export function fontFamilyCss(family: string): string {
  return GENERIC_FAMILIES.has(family) ? family : `"${family}"`;
}
