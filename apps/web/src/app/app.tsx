import { Suspense, lazy, useEffect, useState } from "react";
import { SiteFooter } from "./site-footer.js";
import { SiteHeader, siteLinks } from "./site-header.js";
import { SiteProvider, useSiteSettings } from "./site-settings.js";

const Home = lazy(() => import("../pages/home.js"));
const Playground = lazy(() => import("../pages/playground.js"));
const Showcase = lazy(() => import("../pages/showcase.js"));
const Docs = lazy(() => import("../pages/docs.js"));
const About = lazy(() => import("../pages/about.js"));

// Keep old bookmarks useful without keeping a duplicate demo page.
if (window.location.pathname === "/demo") {
  window.history.replaceState(null, "", `/showcase${window.location.search}${window.location.hash}`);
}

function Shell() {
  const { locale, t } = useSiteSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);
  const page = path === "/playground" ? <Playground /> : path === "/showcase" ? <Showcase /> : path === "/about" ? <About /> : path.startsWith("/docs") ? <Docs path={path} /> : <Home />;

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin !== window.location.origin || (next.pathname === window.location.pathname && next.search === window.location.search && next.hash)) return;
      event.preventDefault();
      if (next.href === window.location.href) { window.scrollTo(0, 0); return; }
      window.history.pushState(null, "", next.pathname + next.search + next.hash);
      setPath(next.pathname);
      setMenuOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onLinkClick);
    return () => { window.removeEventListener("popstate", onPopState); document.removeEventListener("click", onLinkClick); };
  }, []);

  useEffect(() => {
    if (!path.startsWith("/docs")) {
      const label = siteLinks.find((link) => link.href === path)?.label;
      document.title = label ? `${label} | JulEditor` : "JulEditor";
    }
    document.querySelector('meta[name="description"]')?.setAttribute("content", t(
      "JulEditor combines a standalone document core, React editing controls, and optional visual plugins.",
      "JulEditor는 문서 코어와 React 편집 UI에 필요한 플러그인을 추가할 수 있는 블록 에디터입니다.",
    ));
  }, [locale, path]);

  return <>
    <SiteHeader path={path} menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} />
    <Suspense fallback={<div className="page-loading" role="status">{t("Opening the editor…", "에디터를 여는 중…")}</div>}>{page}</Suspense>
    <SiteFooter />
  </>;
}

export function App() {
  return <SiteProvider><Shell /></SiteProvider>;
}
