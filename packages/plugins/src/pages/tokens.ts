// Header/footer template tokens: {page} (1-based current page) and {total}.
// Plain string replacement so it works in DOM, print and DOCX text alike.
// Unknown braces are left untouched, so "{foo}" survives.

export function applyPageTokens(template: string, page: number, total: number): string {
  return template.replace(/\{page\}/g, String(page)).replace(/\{total\}/g, String(total));
}

/** Splits a template into literal / token parts, for exporters (DOCX) that
 * must emit a live field instead of a baked-in number. */
export type TokenPart = { kind: "text"; text: string } | { kind: "page" } | { kind: "total" };

export function splitPageTokens(template: string): TokenPart[] {
  const parts: TokenPart[] = [];
  const re = /\{(page|total)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) parts.push({ kind: "text", text: template.slice(last, m.index) });
    parts.push({ kind: m[1] as "page" | "total" });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ kind: "text", text: template.slice(last) });
  return parts;
}
