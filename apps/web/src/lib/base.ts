// The site can be served from a sub-path (GitHub Pages serves it at /jul-editor/).
// Routes and links in the source stay root-relative ("/docs/..."); these helpers
// add or strip the deploy base so the same code works at "/" and at a sub-path.

/** Deploy base without a trailing slash: "" at the root, "/jul-editor" on GitHub Pages. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** "/docs" -> "/jul-editor/docs". Leaves non-root-relative and already-prefixed paths alone. */
export function withBase(path: string): string {
  if (!BASE || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE || path.startsWith(`${BASE}/`)) return path;
  return `${BASE}${path}`;
}

/** "/jul-editor/docs" -> "/docs". */
export function stripBase(pathname: string): string {
  if (!BASE) return pathname;
  if (pathname === BASE) return "/";
  return pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length) : pathname;
}

/** Router path for a browser pathname: base stripped and trailing slashes dropped.
 * GitHub Pages serves each route from `<route>/index.html` and redirects `/playground`
 * to `/playground/`, so both spellings must resolve to the same route. */
export function routePath(pathname: string): string {
  const path = stripBase(pathname);
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function fix(el: Element) {
  const attr = el.tagName === "A" ? "href" : el.tagName === "IMG" ? "src" : null;
  if (!attr) return;
  const value = el.getAttribute(attr);
  if (value === null) return;
  const next = withBase(value);
  if (next !== value) el.setAttribute(attr, next);
}

function fixTree(root: Element | Document) {
  if (root instanceof Element) fix(root);
  for (const el of root.querySelectorAll("a[href^='/'], img[src^='/']")) fix(el);
}

/**
 * Under a sub-path, rewrite root-relative `href`/`src` attributes as they render
 * (headers, MDX docs, nav), so links opened in a new tab or copied also carry the base.
 * Does nothing when the site is served at the root.
 */
export function installBaseLinkFixer(): void {
  if (!BASE || typeof MutationObserver === "undefined") return;
  fixTree(document);
  // Only the changed nodes are visited, so editor typing stays cheap.
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") fix(record.target as Element);
      else for (const node of record.addedNodes) if (node instanceof Element) fixTree(node);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["href", "src"] });
}
