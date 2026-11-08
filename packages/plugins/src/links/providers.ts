// Pure, DOM-free, network-free URL classification for the bookmark card and
// the iframe embed. Everything a card can show WITHOUT a metadata fetch comes
// from here: provider, kind (repo/issue/pr/...), a human title built from the
// URL alone, the domain and an icon key. Host checks follow the same rule as
// core's model/embed.ts: exact host or a genuine dot-boundary subdomain,
// NEVER a substring/suffix test, so "figma.com.evil.com" and
// "evilfigma.com" never classify as Figma. Never throws: anything that is
// not a parseable http(s) url comes back as the generic "link" provider.
import { parseEmbedUrl } from "@jul-editor/core";

export type LinkProvider =
  | "github"
  | "figma"
  | "youtube"
  | "vimeo"
  | "loom"
  | "notion"
  | "google-docs"
  | "linear"
  | "codepen"
  | "google-maps"
  | "link";

export interface LinkInfo {
  provider: LinkProvider;
  /** Provider specific sub-type: github repo|issue|pr|gist|user, figma file|design|proto|board,
   * google-docs doc|sheet|slide, youtube video, ... "page" for the generic provider. */
  kind: string;
  /** The normalized (trimmed) url. "" when the input was not an http(s) url. */
  url: string;
  /** Title derived from the URL alone ("owner/repo", "Figma: My file", ...). */
  title: string;
  /** Second line derived from the URL alone ("Issue #12", "Pull request #3", ...). */
  subtitle: string;
  /** Lowercased hostname without a leading "www.". */
  domain: string;
  /** Icon key a renderer maps to its own glyph (never a url, so nothing to sanitize). */
  icon: string;
  /** Provider specific ids (owner, repo, number, fileKey, videoId, ...). Always regex validated. */
  ids: Record<string, string>;
}

/** Exact host or dot-boundary subdomain match. Exported for the iframe policy. */
export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const NUM_RE = /^[0-9]{1,9}$/;
const FIGMA_KEY_RE = /^[A-Za-z0-9]{10,40}$/;
const LOOM_ID_RE = /^[A-Za-z0-9]{16,40}$/;
const NOTION_ID_RE = /([0-9a-f]{32})$/i;
const GDOC_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
const LINEAR_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,9}-[0-9]{1,7}$/;
const CODEPEN_ID_RE = /^[A-Za-z0-9]{5,12}$/;
const CODEPEN_USER_RE = /^[A-Za-z0-9_-]{1,40}$/;
const GIST_ID_RE = /^[0-9a-f]{8,40}$/i;
const SLUG_RE = /^[^/\s]{1,200}$/;

// github.com first path segments that are site sections, not owners.
const GITHUB_RESERVED = new Set(["settings", "orgs", "marketplace", "topics", "sponsors", "login", "join", "about", "pricing", "features", "explore", "notifications", "new", "search", "pulls", "issues"]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function humanizeSlug(slug: string): string {
  const t = safeDecode(slug).replace(/[-_+]+/g, " ").trim();
  return t;
}

function parseHttp(raw: string): URL | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  try {
    const u = new URL(/^www\./i.test(s) ? `https://${s}` : s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function bareDomain(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

function info(u: URL, p: Partial<LinkInfo> & { provider: LinkProvider }): LinkInfo {
  return { kind: "page", title: "", subtitle: "", icon: p.provider, ids: {}, ...p, url: u.href, domain: bareDomain(u) };
}

function github(u: URL): LinkInfo | null {
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "gist.github.com") {
    const id = segs[segs.length - 1] ?? "";
    const user = segs.length >= 2 ? segs[0]! : "";
    if (!GIST_ID_RE.test(id) || (user && !OWNER_RE.test(user))) return null;
    return info(u, { provider: "github", kind: "gist", icon: "github-gist", title: user ? `${user}/${id.slice(0, 8)}` : `gist ${id.slice(0, 8)}`, subtitle: "Gist", ids: { user, id } });
  }
  if (host !== "github.com" && host !== "www.github.com") return null;
  const [owner, repo, sec, num] = segs;
  if (!owner || !OWNER_RE.test(owner) || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
  if (!repo) return info(u, { provider: "github", kind: "user", icon: "github-user", title: owner, subtitle: "GitHub profile", ids: { owner } });
  if (!REPO_RE.test(repo)) return null;
  const full = `${owner}/${repo}`;
  if ((sec === "issues" || sec === "pull") && num && NUM_RE.test(num)) {
    const pr = sec === "pull";
    return info(u, { provider: "github", kind: pr ? "pr" : "issue", icon: pr ? "github-pr" : "github-issue", title: `${full}#${num}`, subtitle: pr ? `Pull request #${num}` : `Issue #${num}`, ids: { owner, repo, number: num } });
  }
  return info(u, { provider: "github", kind: "repo", icon: "github-repo", title: full, subtitle: "GitHub repository", ids: { owner, repo } });
}

function figma(u: URL): LinkInfo | null {
  if (!hostMatches(u.hostname.toLowerCase(), "figma.com")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const type = segs[0] ?? "";
  if (!["file", "design", "proto", "board", "slides", "make"].includes(type)) return null;
  const key = segs[1] ?? "";
  if (!FIGMA_KEY_RE.test(key)) return null;
  const slug = segs[2] && SLUG_RE.test(segs[2]) ? humanizeSlug(segs[2]) : "";
  return info(u, { provider: "figma", kind: type, icon: "figma", title: slug || "Figma file", subtitle: type === "proto" ? "Figma prototype" : type === "board" ? "FigJam board" : "Figma design", ids: { fileKey: key, type } });
}

function youtubeVimeo(u: URL): LinkInfo | null {
  const p = parseEmbedUrl(u.href);
  if (p.provider === "youtube") return info(u, { provider: "youtube", kind: "video", icon: "youtube", title: "YouTube video", subtitle: "youtube.com", ids: { videoId: p.id } });
  if (p.provider === "vimeo") return info(u, { provider: "vimeo", kind: "video", icon: "vimeo", title: "Vimeo video", subtitle: "vimeo.com", ids: { videoId: p.id } });
  return null;
}

function loom(u: URL): LinkInfo | null {
  if (!hostMatches(u.hostname.toLowerCase(), "loom.com")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs[0] !== "share" && segs[0] !== "embed") return null;
  const id = segs[1] ?? "";
  if (!LOOM_ID_RE.test(id)) return null;
  return info(u, { provider: "loom", kind: "video", icon: "loom", title: "Loom video", subtitle: "loom.com", ids: { videoId: id } });
}

function notion(u: URL): LinkInfo | null {
  const host = u.hostname.toLowerCase();
  if (!hostMatches(host, "notion.so") && !hostMatches(host, "notion.site")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  const m = NOTION_ID_RE.exec(last);
  const slug = m ? last.slice(0, last.length - m[1]!.length).replace(/-$/, "") : last;
  return info(u, { provider: "notion", kind: "page", icon: "notion", title: humanizeSlug(slug) || "Notion page", subtitle: "Notion", ids: m ? { pageId: m[1]!.toLowerCase() } : {} });
}

function googleDocs(u: URL): LinkInfo | null {
  if (u.hostname.toLowerCase() !== "docs.google.com") return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const kinds: Record<string, [string, string, string]> = {
    document: ["doc", "google-doc", "Google Docs"],
    spreadsheets: ["sheet", "google-sheet", "Google Sheets"],
    presentation: ["slide", "google-slide", "Google Slides"],
  };
  const k = kinds[segs[0] ?? ""];
  if (!k || segs[1] !== "d") return null;
  const id = segs[2] ?? "";
  if (!GDOC_ID_RE.test(id)) return null;
  return info(u, { provider: "google-docs", kind: k[0], icon: k[1], title: k[2], subtitle: "docs.google.com", ids: { docId: id, type: segs[0]! } });
}

function linear(u: URL): LinkInfo | null {
  if (!hostMatches(u.hostname.toLowerCase(), "linear.app")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const [workspace, sec, key, slug] = segs;
  if (!workspace || sec !== "issue" || !key || !LINEAR_KEY_RE.test(key)) return null;
  const t = slug && SLUG_RE.test(slug) ? humanizeSlug(slug) : "";
  return info(u, { provider: "linear", kind: "issue", icon: "linear", title: t ? `${key.toUpperCase()} ${t}` : key.toUpperCase(), subtitle: "Linear issue", ids: { workspace, key: key.toUpperCase() } });
}

function codepen(u: URL): LinkInfo | null {
  if (!hostMatches(u.hostname.toLowerCase(), "codepen.io")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const [user, type, id] = segs;
  if (!user || !CODEPEN_USER_RE.test(user) || (type !== "pen" && type !== "full" && type !== "embed") || !id || !CODEPEN_ID_RE.test(id)) return null;
  return info(u, { provider: "codepen", kind: "pen", icon: "codepen", title: `${user}'s pen`, subtitle: "CodePen", ids: { user, penId: id } });
}

function googleMaps(u: URL): LinkInfo | null {
  const host = u.hostname.toLowerCase();
  if (host !== "www.google.com" && host !== "google.com") return null;
  if (!u.pathname.startsWith("/maps")) return null;
  return info(u, { provider: "google-maps", kind: u.pathname.startsWith("/maps/embed") ? "embed" : "map", icon: "google-maps", title: "Google Maps", subtitle: "google.com/maps", ids: {} });
}

const PARSERS = [github, figma, youtubeVimeo, loom, notion, googleDocs, linear, codepen, googleMaps];

/** Classifies any url into a LinkInfo; unknown hosts get the generic "link" provider
 * (title = domain, so a card can always render something without a network call). */
export function parseLink(rawUrl: string): LinkInfo {
  const u = parseHttp(rawUrl);
  if (!u) return { provider: "link", kind: "page", url: "", title: typeof rawUrl === "string" ? rawUrl.trim() : "", subtitle: "", domain: "", icon: "link", ids: {} };
  for (const parse of PARSERS) {
    const r = parse(u);
    if (r) return r;
  }
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  const domain = bareDomain(u);
  return info(u, { provider: "link", kind: "page", icon: "link", title: domain + safeDecode(path).slice(0, 60), subtitle: domain });
}
