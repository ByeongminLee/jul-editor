// Bookmark card data model + the metadata adapter. The package ships NO
// network code: the host implements `fetchMetadata` against its own server or
// proxy (CORS/SSRF are the host's concern) and passes it in. Without it, a
// card is built from URL rules only (providers.ts), which already covers
// GitHub/Figma/YouTube/... without any request.
import { sanitizeUrl } from "@jul-editor/core";
import { parseLink, type LinkInfo } from "./providers.js";

export interface LinkMetadata {
  title?: string;
  description?: string;
  /** Thumbnail / og:image url. */
  image?: string;
  favicon?: string;
  siteName?: string;
}

export interface FetchMetadataOptions {
  signal: AbortSignal;
}

/** Host provided. Reject (throw) on failure; the card then shows its error state with the fallback content. */
export type FetchMetadata = (url: string, opts: FetchMetadataOptions) => Promise<LinkMetadata>;

/** Everything a card renders. All strings are plain text; image/favicon already sanitized (http/https only or ""). */
export interface CardData {
  url: string;
  provider: LinkInfo["provider"];
  kind: string;
  icon: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
  domain: string;
}

export type CardStatus = "idle" | "loading" | "ready" | "error";

export interface CardState {
  status: CardStatus;
  card: CardData;
  error?: string;
}

const MAX_TEXT = 300;
const clip = (s: unknown, n = MAX_TEXT): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Resolves an image/favicon url (absolute, or relative to the page url) and keeps it only when http(s). */
export function safeAssetUrl(raw: unknown, base: string): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  let abs: string;
  try {
    abs = new URL(raw.trim(), base || undefined).href;
  } catch {
    return "";
  }
  return sanitizeUrl(abs, "image") ?? "";
}

/** The no-network card: URL rules only. */
export function fallbackCard(url: string): CardData {
  const info = parseLink(url);
  return { url: info.url, provider: info.provider, kind: info.kind, icon: info.icon, title: info.title, description: info.subtitle, image: "", favicon: "", siteName: info.domain, domain: info.domain };
}

/** Layers fetched metadata over the URL-rule card. Empty/invalid fields keep the fallback value. */
export function mergeMetadata(base: CardData, meta: LinkMetadata | null | undefined): CardData {
  if (!meta || typeof meta !== "object") return base;
  return {
    ...base,
    title: clip(meta.title) || base.title,
    description: clip(meta.description, 500) || base.description,
    image: safeAssetUrl(meta.image, base.url) || base.image,
    favicon: safeAssetUrl(meta.favicon, base.url) || base.favicon,
    siteName: clip(meta.siteName, 80) || base.siteName,
  };
}

export interface ResolveCardOptions {
  fetchMetadata?: FetchMetadata;
  signal?: AbortSignal;
  /** Gives up (error state) after this many ms. Default 8000. */
  timeoutMs?: number;
}

/** Never throws. No callback: "ready" with the fallback card. Callback ok: "ready" with merged data.
 * Callback rejects/times out/aborts: "error" with the fallback card (the card can still render and link). */
export async function resolveCard(url: string, opts: ResolveCardOptions = {}): Promise<CardState> {
  const base = fallbackCard(url);
  if (!opts.fetchMetadata || !base.url) return { status: "ready", card: base };
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Error("metadata timeout"));
      }, opts.timeoutMs ?? 8000);
    });
    if (opts.signal?.aborted) ctl.abort();
    const meta = await Promise.race([opts.fetchMetadata(base.url, { signal: ctl.signal }), timeout]);
    return { status: "ready", card: mergeMetadata(base, meta) };
  } catch (e) {
    return { status: "error", card: base, error: e instanceof Error ? e.message : "metadata failed" };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Wraps a host fetcher with an in-memory cache + in-flight dedupe (successes only;
 * failures are retried on the next call). Handy for the same url pasted many times. */
export function cacheFetchMetadata(fetcher: FetchMetadata): FetchMetadata {
  const done = new Map<string, LinkMetadata>();
  const inflight = new Map<string, Promise<LinkMetadata>>();
  return (url, opts) => {
    const hit = done.get(url);
    if (hit) return Promise.resolve(hit);
    let p = inflight.get(url);
    if (!p) {
      p = fetcher(url, opts)
        .then((m) => {
          done.set(url, m);
          return m;
        })
        .finally(() => inflight.delete(url));
      inflight.set(url, p);
    }
    return p;
  };
}

/** Demo/in-memory adapter: answers from a fixed url -> metadata map, rejects for unknown urls. */
export function createStaticMetadata(map: Record<string, LinkMetadata>, delayMs = 0): FetchMetadata {
  return (url) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        const m = map[url];
        if (m) resolve(m);
        else reject(new Error("no metadata"));
      }, delayMs);
    });
}

/** Reads a card from a bookmark block's props (props are untrusted: everything is re-validated). */
export function cardFromProps(props: Record<string, unknown>): CardData {
  const url = typeof props.url === "string" ? sanitizeUrl(props.url, "link") ?? "" : "";
  const base = fallbackCard(url);
  return mergeMetadata(base, {
    title: typeof props.title === "string" ? props.title : undefined,
    description: typeof props.description === "string" ? props.description : undefined,
    image: typeof props.image === "string" ? props.image : undefined,
    favicon: typeof props.favicon === "string" ? props.favicon : undefined,
    siteName: typeof props.siteName === "string" ? props.siteName : undefined,
  });
}
