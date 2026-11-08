// Pure, DOM-free provider
// detection for the `embed` block (YouTube/Vimeo iframe allowlist, X/other
// as a plain link card). Uses the global WHATWG `URL` (a JS-language
// built-in, not a DOM API -- available in plain Node) instead of any
// substring/`.includes()` matching: a lookalike host like
// "youtube.com.evil.com" must NEVER classify as the real "youtube.com", so
// every host check below is an exact match or a genuine dot-boundary
// subdomain match, never a suffix/substring test.

export type EmbedProvider = "youtube" | "vimeo" | "x" | "link";

export interface ParsedEmbed {
  provider: EmbedProvider;
  /** The original (trimmed) url, as given -- never the constructed iframe src. */
  url: string;
  /** The provider's video id, when one was found; "" otherwise (x/link, or
   * an id that failed its strict format check). */
  id: string;
}

// YouTube ids are 11 chars of [A-Za-z0-9_-]; Vimeo ids are a run of digits.
// Both are validated again by embedIframeSrc/parseEmbedIframeSrc below --
// nothing downstream ever trusts an id string that hasn't passed one of
// these, so quote/HTML injection in an id can never reach an attribute.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^[0-9]{5,12}$/;

function sameHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function parseYoutubeId(u: URL): string | null {
  if (sameHost(u.hostname, "youtu.be")) {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (!sameHost(u.hostname, "youtube.com") && !sameHost(u.hostname, "youtube-nocookie.com")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs[0] === "watch") {
    const id = u.searchParams.get("v") ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (segs[0] === "shorts" || segs[0] === "embed") {
    const id = segs[1] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  return null;
}

function parseVimeoId(u: URL): string | null {
  if (!sameHost(u.hostname, "vimeo.com")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const id = segs[0] === "video" ? (segs[1] ?? "") : (segs[0] ?? "");
  return VIMEO_ID_RE.test(id) ? id : null;
}

function isXStatus(u: URL): boolean {
  if (!sameHost(u.hostname, "x.com") && !sameHost(u.hostname, "twitter.com")) return false;
  return /\/status\/\d+/.test(u.pathname);
}

/** Classifies a pasted/stored url. Never throws: an unparseable url (or any
 * non-http(s) scheme, e.g. "javascript:") always comes back as `provider:
 * "link"` -- the caller renders that as a plain link card, never an iframe. */
export function parseEmbedUrl(rawUrl: string): ParsedEmbed {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { provider: "link", url, id: "" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { provider: "link", url, id: "" };

  const yt = parseYoutubeId(parsed);
  if (yt) return { provider: "youtube", url, id: yt };

  const vimeo = parseVimeoId(parsed);
  if (vimeo) return { provider: "vimeo", url, id: vimeo };

  if (isXStatus(parsed)) return { provider: "x", url, id: "" };

  return { provider: "link", url, id: "" };
}

/** The sandboxed iframe src for an ALLOWLISTED provider+id, or null (x/link,
 * or an id that doesn't pass the strict format check -- re-validated here
 * independently of parseEmbedUrl, since `id` may instead have come straight
 * off a stored/pasted Block's props). Only these two hosts are ever used:
 * youtube-nocookie.com (no tracking cookie until playback starts) and
 * player.vimeo.com -- never the provider's own watch-page domain. */
export function embedIframeSrc(provider: EmbedProvider, id: string): string | null {
  if (provider === "youtube" && YOUTUBE_ID_RE.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === "vimeo" && VIMEO_ID_RE.test(id)) return `https://player.vimeo.com/video/${id}`;
  return null;
}

/** The reverse of embedIframeSrc: recognizes one of OUR allowlisted iframe
 * srcs (our own toHTML output, or a third-party page's youtube-nocookie/
 * player.vimeo embed) and recovers {provider, id} -- used by fromHTML to map
 * an iframe back to an `embed` block. Any other iframe src (including a
 * plain (non-nocookie) youtube.com/embed/ URL) returns null. */
export function parseEmbedIframeSrc(src: string): { provider: EmbedProvider; id: string } | null {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (sameHost(u.hostname, "youtube-nocookie.com")) {
    const segs = u.pathname.split("/").filter(Boolean);
    const id = segs[0] === "embed" ? (segs[1] ?? "") : "";
    return YOUTUBE_ID_RE.test(id) ? { provider: "youtube", id } : null;
  }
  if (sameHost(u.hostname, "player.vimeo.com")) {
    const segs = u.pathname.split("/").filter(Boolean);
    const id = segs[0] === "video" ? (segs[1] ?? "") : "";
    return VIMEO_ID_RE.test(id) ? { provider: "vimeo", id } : null;
  }
  return null;
}

/** The canonical "watch" url reconstructed from provider+id, for a Block
 * whose only known form is an iframe src (fromHTML has no other url to
 * store on the reconstructed embed block's `url` prop). */
export function embedWatchUrl(provider: EmbedProvider, id: string): string {
  if (provider === "youtube") return `https://www.youtube.com/watch?v=${id}`;
  if (provider === "vimeo") return `https://vimeo.com/${id}`;
  return "";
}
