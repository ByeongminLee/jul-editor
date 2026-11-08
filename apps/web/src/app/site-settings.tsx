import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

type Locale = "en" | "ko";
type Theme = "dark" | "light";
type Settings = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: (en: string, ko: string) => string;
};

const SiteSettingsContext = createContext<Settings | null>(null);

function saved(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => saved("jul-editor-locale") === "ko" ? "ko" : "en");
  const [theme, setTheme] = useState<Theme>(() => saved("jul-editor-theme") === "light" ? "light" : "dark");

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    try { localStorage.setItem("jul-editor-locale", locale); } catch { /* Storage may be disabled. */ }
  }, [locale]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("jul-editor-theme", theme); } catch { /* Storage may be disabled. */ }
  }, [theme]);

  return <SiteSettingsContext.Provider value={{ locale, setLocale, theme, setTheme, t: (en, ko) => locale === "ko" ? ko : en }}>
    {children}
  </SiteSettingsContext.Provider>;
}

export function useSiteSettings() {
  const settings = useContext(SiteSettingsContext);
  if (!settings) throw new Error("useSiteSettings must be used inside SiteProvider");
  return settings;
}
