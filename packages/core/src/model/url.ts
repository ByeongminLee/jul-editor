// Common URL sanitizer used by model writes, toHTML, and DOM render.

const LINK_SCHEMES = new Set(["http", "https", "mailto", "jul-editor"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);?/g, (_m, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}

// Strips ASCII control chars, space and DEL from anywhere in the string.
// Browsers strip control/whitespace when parsing URLs, and attackers rely on
// that to split up scheme names ("java\tscript:"); we do the same stripping
// before checking the scheme so a hidden control char can't hide a scheme.
function stripControlAndWhitespace(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000- \u007f]/g, "");
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

// stripControlAndWhitespace is deliberately over-broad (it
// removes control chars AND spaces from ANYWHERE, so a hidden control char
// can't hide a scheme) -- correct for deciding what to DO with the url, but
// wrong to also use as the value that gets STORED/returned: it silently
// deletes legitimate inner spaces from a path ("my file.png" -> "myfile.png").
// Only the leading/trailing run is genuinely never part of a real url.
function trimEdgeControlAndWhitespace(input: string): string {
  return input.replace(/^[\u0000- \u007f]+/, "").replace(/[\u0000- \u007f]+$/, "");
}

export function sanitizeUrl(url: string, kind: "link" | "image", opts: { allowBlob?: boolean } = {}): string | null {
  if (typeof url !== "string") return null;
  const decoded = decodeEntities(url);
  // Scheme-sniffing only -- never returned as-is (see above).
  const cleaned = stripControlAndWhitespace(decoded);
  if (cleaned === "") return "";
  const out = trimEdgeControlAndWhitespace(decoded).replace(/ /g, "%20");

  const m = SCHEME_RE.exec(cleaned);
  if (!m) {
    // No scheme: relative path, "#fragment", etc. -- safe.
    return out;
  }
  const scheme = m[1]!.toLowerCase();

  if (kind === "link") {
    return LINK_SCHEMES.has(scheme) ? out : null;
  }
  if (IMAGE_SCHEMES.has(scheme)) return out;
  if (scheme === "blob" && opts.allowBlob) return out;
  return null;
}
