// Allowlisted iframe src transforms + the generic-iframe origin policy.
// DOM-free. The rule everywhere: an iframe src is NEVER taken from a stored
// prop as-is. It is either (a) CONSTRUCTED here from a url that matched a
// provider parser (ids are regex validated by providers.ts, so no quote or
// HTML injection can reach an attribute), or (b) a generic url whose ORIGIN
// is on the host's explicit allowlist (default deny: empty list = nothing).
import { embedIframeSrc } from "@jul-editor/core";
import { hostMatches, parseLink } from "./providers.js";

export interface IframeSpec {
  /** Provider key ("figma", "generic", ...). */
  provider: string;
  /** The iframe `src`. Omitted when `srcdoc` is used instead (gist). */
  src?: string;
  /** Inline document for providers that cannot be framed directly (gist). */
  srcdoc?: string;
  /** Sandbox tokens for THIS iframe. */
  sandbox: string;
  /** `allow` (Permissions Policy) attribute. */
  allow: string;
  /** Suggested initial height in px (an explicit block height wins). */
  height: number;
}

export interface IframePolicy {
  /** Origins a GENERIC iframe may load: "https://example.com" (exact) or
   * "https://*.example.com" (dot-boundary subdomains only, apex excluded).
   * Default deny: undefined/empty allows no generic iframe at all. Only
   * https origins are accepted, whatever is listed. */
  allowedOrigins?: readonly string[];
  /** Sandbox tokens for generic iframes. Default: scripts + same-origin +
   * popups + presentation. NEVER add the host app's own origin to
   * allowedOrigins while "allow-same-origin" is on: the pair would let the
   * frame strip its own sandbox. */
  sandbox?: string;
  /** `embed_host` for Figma's embed endpoint. Default "jul". */
  figmaEmbedHost?: string;
}

export const DEFAULT_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation";
const DEFAULT_ALLOW = "autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen";
// gist runs a script from github.com inside a srcdoc frame: no same-origin,
// so the script cannot reach the host page (null origin) but can still run.
const GIST_SANDBOX = "allow-scripts allow-popups";
export const MIN_IFRAME_HEIGHT = 120;
export const MAX_IFRAME_HEIGHT = 1600;
export const DEFAULT_IFRAME_HEIGHT = 420;

/** Clamps a stored/dragged height into a sane range; non-numbers get the default. */
export function clampIframeHeight(h: unknown): number {
  const n = typeof h === "number" && Number.isFinite(h) ? Math.round(h) : DEFAULT_IFRAME_HEIGHT;
  return Math.min(MAX_IFRAME_HEIGHT, Math.max(MIN_IFRAME_HEIGHT, n));
}

/** True when `url`'s origin matches one allowlist entry. Exact origin, or
 * "https://*.domain" for dot-boundary subdomains. Substring/suffix tricks
 * ("https://example.com.evil.com", "https://evilexample.com") never match. */
export function originAllowed(url: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  for (const entry of allowed) {
    const m = /^https:\/\/(\*\.)?([a-z0-9.-]+)(:[0-9]+)?$/i.exec(entry.trim());
    if (!m) continue;
    const domain = m[2]!.toLowerCase();
    const port = m[3] ?? "";
    if (u.port !== port.slice(1)) continue;
    if (m[1] ? u.hostname.endsWith(`.${domain}`) : u.hostname === domain) return true;
  }
  return false;
}

function figmaSpec(url: string, host: string): IframeSpec | null {
  const info = parseLink(url);
  if (info.provider !== "figma" || !info.ids.fileKey) return null;
  // Rebuild a canonical figma url from validated parts (drops any junk query).
  const u = new URL(info.url);
  const canonical = `https://www.figma.com${u.pathname}${u.search}`;
  const hostParam = /^[A-Za-z0-9_.-]{1,40}$/.test(host) ? host : "jul";
  return { provider: "figma", src: `https://www.figma.com/embed?embed_host=${hostParam}&url=${encodeURIComponent(canonical)}`, sandbox: DEFAULT_IFRAME_SANDBOX, allow: DEFAULT_ALLOW, height: 450 };
}

/** The iframe spec for an allowlisted PROVIDER url, or null when the url is
 * not an embeddable provider page. Providers: figma, youtube, vimeo, loom,
 * codepen, github gist (srcdoc), google docs/sheets/slides (/preview), google
 * maps (only an already-embed url). */
export function providerIframe(rawUrl: string, policy: IframePolicy = {}): IframeSpec | null {
  const info = parseLink(rawUrl);
  const base = { sandbox: DEFAULT_IFRAME_SANDBOX, allow: DEFAULT_ALLOW };
  switch (info.provider) {
    case "figma":
      return figmaSpec(rawUrl, policy.figmaEmbedHost ?? "jul");
    case "youtube":
    case "vimeo": {
      const src = embedIframeSrc(info.provider, info.ids.videoId ?? "");
      return src ? { provider: info.provider, src, ...base, height: 360 } : null;
    }
    case "loom":
      return info.ids.videoId ? { provider: "loom", src: `https://www.loom.com/embed/${info.ids.videoId}`, ...base, height: 360 } : null;
    case "codepen":
      return info.ids.user && info.ids.penId ? { provider: "codepen", src: `https://codepen.io/${info.ids.user}/embed/${info.ids.penId}?default-tab=result`, ...base, height: 400 } : null;
    case "google-docs": {
      const { docId, type } = info.ids;
      if (!docId || !type) return null;
      return { provider: "google-docs", src: `https://docs.google.com/${type}/d/${docId}/${type === "presentation" ? "embed" : "preview"}`, ...base, height: 480 };
    }
    case "google-maps":
      // Only an already-embed url: building one from a place query needs an API key.
      return info.kind === "embed" ? { provider: "google-maps", src: info.url, ...base, height: 400 } : null;
    case "github":
      if (info.kind !== "gist" || !info.ids.id) return null;
      // gist pages send X-Frame-Options: deny, so the page cannot be framed.
      // Its documented embed is a <script src=".../<id>.js">: run that inside
      // a srcdoc iframe with a null origin (no allow-same-origin) so the
      // script's document.write stays contained. id/user are regex validated.
      return {
        provider: "gist",
        srcdoc: `<!doctype html><html><head><base target="_blank"></head><body style="margin:0"><script src="https://gist.github.com/${info.ids.user ? info.ids.user + "/" : ""}${info.ids.id}.js"></script></body></html>`,
        sandbox: GIST_SANDBOX,
        allow: "",
        height: 360,
      };
    default:
      return null;
  }
}

/** Whether a url can become an iframe through a built-in provider transform
 * (what the paste menu's "Embed" entry and /embed use; no host policy involved). */
export function isEmbeddable(rawUrl: string): boolean {
  return providerIframe(rawUrl) !== null;
}

/** The final iframe spec for a stored `url`: a provider transform first, then
 * the host's generic origin allowlist. null = blocked (render a card/link). */
export function resolveIframe(rawUrl: string, policy: IframePolicy = {}): IframeSpec | null {
  const p = providerIframe(rawUrl, policy);
  if (p) return p;
  const u = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (originAllowed(u, policy.allowedOrigins)) return { provider: "generic", src: u, sandbox: policy.sandbox ?? DEFAULT_IFRAME_SANDBOX, allow: DEFAULT_ALLOW, height: DEFAULT_IFRAME_HEIGHT };
  return null;
}

/** Reverse transform used by fromHTML: recovers the original page url from
 * one of OUR constructed iframe srcs (so a round trip stores the url, not
 * the embed endpoint). Anything else is returned untouched for the caller to
 * run through resolveIframe's allowlist. */
export function iframeSrcToUrl(src: string): string {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return src;
  }
  if (u.protocol === "https:" && u.hostname === "www.figma.com" && u.pathname === "/embed") return u.searchParams.get("url") ?? src;
  if (u.protocol === "https:" && u.hostname === "www.loom.com") {
    const m = /^\/embed\/([A-Za-z0-9]{16,40})$/.exec(u.pathname);
    if (m) return `https://www.loom.com/share/${m[1]}`;
  }
  if (u.protocol === "https:" && u.hostname === "codepen.io") {
    const m = /^\/([A-Za-z0-9_-]{1,40})\/embed\/([A-Za-z0-9]{5,12})$/.exec(u.pathname);
    if (m) return `https://codepen.io/${m[1]}/pen/${m[2]}`;
  }
  if (u.protocol === "https:" && hostMatches(u.hostname, "youtube-nocookie.com")) {
    const m = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(u.pathname);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  if (u.protocol === "https:" && u.hostname === "player.vimeo.com") {
    const m = /^\/video\/([0-9]{5,12})$/.exec(u.pathname);
    if (m) return `https://vimeo.com/${m[1]}`;
  }
  return src;
}
