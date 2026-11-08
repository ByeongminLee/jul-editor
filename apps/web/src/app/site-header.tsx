import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { useSiteSettings } from "./site-settings.js";

export const siteLinks = [
  { href: "/playground", label: "Playground" },
  { href: "/showcase", label: "Showcase" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
];

export function SiteHeader({ path, menuOpen, onMenuOpenChange }: { path: string; menuOpen: boolean; onMenuOpenChange: (open: boolean) => void }) {
  const { locale, setLocale, theme, setTheme, t } = useSiteSettings();
  const links = siteLinks;
  const setMenuOpen = onMenuOpenChange;
  return (
  <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" href="/" aria-label={t("JulEditor home", "JulEditor 홈")}><img className="brand-mark" src="/favicon.svg" alt="" /><span>JulEditor</span></a>
        <nav className={`site-nav${menuOpen ? " site-nav-open" : ""}`} aria-label={t("Main navigation", "기본 메뉴")}>
          {links.map((link) => <a key={link.href} href={link.href} aria-current={path === link.href || (link.href === "/docs" && path.startsWith("/docs/")) ? "page" : undefined} onClick={() => setMenuOpen(false)}>{link.label}</a>)}
        </nav>
        <div className="header-actions">
          <button className="header-icon-button" type="button" disabled title={t("GitHub link coming soon", "GitHub 링크 준비 중")} aria-label={t("GitHub link coming soon", "GitHub 링크 준비 중")}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.1-1.45-1.1-1.45-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.82.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.81c.85 0 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.69.92.69 1.85v2.77c0 .26.18.57.69.48A10 10 0 0 0 12 2Z" /></svg></button>
          <button className="header-icon-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("Switch to light theme", "라이트 테마로 전환") : t("Switch to dark theme", "다크 테마로 전환")} title={theme === "dark" ? t("Light theme", "라이트 테마") : t("Dark theme", "다크 테마")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="header-language-button" type="button" onClick={() => setLocale(locale === "en" ? "ko" : "en")} aria-label={locale === "en" ? "한국어" : "English"} title={locale === "en" ? "한국어" : "English"}><span aria-hidden="true">{locale.toUpperCase()}</span></button>
          <a className="header-cta" href="/docs/getting-started">{t("Get started", "시작하기")} <ArrowUpRight size={15} /></a>
          <button className="mobile-menu-button" type="button" aria-label={menuOpen ? t("Close menu", "메뉴 닫기") : t("Open menu", "메뉴 열기")} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
      </div>
  </header>
  );
}
