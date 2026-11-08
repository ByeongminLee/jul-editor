import { Copy, Check, ArrowRight } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSiteSettings } from "../app/site-settings.js";
import { groups, pages, resolveDocsPath, type DocPage, type Locale } from "../docs/nav.js";
import { mdxComponents } from "../docs/mdx-components.js";
import { lazyMdx, prefetchMdx, resolveMdx, type MdxSources } from "../docs/localized-mdx.js";
import "../styles/docs-live.css";
import "../styles/docs.css";

// One MDX file per language: ../docs/pages/<slug>/en.mdx and ko.mdx.
const globKey = (file: string) => file.slice("../docs/pages/".length, file.lastIndexOf("/"));
const collect = (modules: Record<string, () => Promise<never>>) => Object.fromEntries(Object.entries(modules).map(([file, load]) => [globKey(file), load]));
const sources: MdxSources = {
  en: collect(import.meta.glob("../docs/pages/**/en.mdx") as Record<string, () => Promise<never>>),
  ko: collect(import.meta.glob("../docs/pages/**/ko.mdx") as Record<string, () => Promise<never>>),
};
const docKey = (path: string) => path.slice("/docs/".length);
const prefetchDoc = (path: string, locale: Locale) => prefetchMdx(sources, locale, docKey(path));

function ReadySignal({ onReady }: { onReady: (ready: boolean) => void }) {
  useEffect(() => onReady(true), [onReady]);
  return null;
}

function DocsNav({ current, locale, mobile = false }: { current: DocPage; locale: Locale; mobile?: boolean }) {
  return <nav className="mdx-doc-nav" aria-label={mobile ? locale === "ko" ? "모바일 개발 문서" : "Mobile documentation" : locale === "ko" ? "개발 문서" : "Documentation"}>
    {groups.map((group) => <div className="mdx-doc-group" key={group.en}>
      <div className="mdx-doc-group-label">{group[locale]}</div>
      {group.pages.map((page) => <a key={page.path} href={page.path} onPointerEnter={() => prefetchDoc(page.path, locale)} onFocus={() => prefetchDoc(page.path, locale)} aria-current={page.path === current.path ? "page" : undefined}>{page[locale]}</a>)}
    </div>)}
  </nav>;
}

function copyableMarkdown(article: HTMLElement): string {
  return Array.from(article.querySelectorAll("h1, h2, h3, p, li, pre, table"))
    .filter((node) => !node.closest(".docs-live, .docs-live-loading"))
    .map((node) => {
      const value = node.textContent?.trim() ?? "";
      if (!value) return "";
      if (node.tagName === "H1") return `# ${value}`;
      if (node.tagName === "H2") return `## ${value}`;
      if (node.tagName === "H3") return `### ${value}`;
      if (node.tagName === "LI") return `- ${value}`;
      if (node.tagName === "PRE") return `\`\`\`\n${value}\n\`\`\``;
      if (node.tagName === "TABLE") {
        const rows = Array.from((node as HTMLTableElement).rows).map((row) => Array.from(row.cells).map((cell) => (cell.textContent ?? "").trim().replaceAll("|", "\\|")));
        return rows.map((cells, index) => `| ${cells.join(" | ")} |${index === 0 ? `\n| ${cells.map(() => "---").join(" | ")} |` : ""}`).join("\n");
      }
      return value;
    }).filter(Boolean).join("\n\n");
}

export default function Docs({ path }: { path: string }) {
  const { locale, t } = useSiteSettings();
  const page = resolveDocsPath(path, window.location.hash);
  const index = pages.findIndex((item) => item.path === page.path);
  const previous = pages[index - 1];
  const next = pages[index + 1];
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [readyPath, setReadyPath] = useState("");
  const headingTitle = page.path === "/docs/core/document-model" ? t("Document model and state", "문서 모델과 상태") : page[locale];
  const resolved = resolveMdx(sources, locale, docKey(page.path));
  const modulePath = `${docKey(page.path)}/${resolved?.locale ?? locale}`;
  const Content = useMemo(() => lazyMdx(resolved!.loader), [resolved?.loader]);
  const contentReady = readyPath === modulePath;
  const otherLocale: Locale = locale === "en" ? "ko" : "en";
  useEffect(() => { prefetchDoc(page.path, otherLocale); }, [page.path, otherLocale]);

  useEffect(() => {
    if (window.location.pathname !== page.path) window.history.replaceState(null, "", page.path);
    document.title = `${headingTitle} | JulEditor`;
  }, [page.path, headingTitle]);

  async function copyPage() {
    const article = document.querySelector<HTMLElement>(".mdx-doc-article");
    if (!article || !contentReady) return;
    try {
      await navigator.clipboard.writeText(copyableMarkdown(article));
      setCopyState("done");
    } catch { setCopyState("error"); }
    window.setTimeout(() => setCopyState("idle"), 2000);
  }

  return <main className="interior-page docs-page mdx-docs">
    <div className="mdx-doc-mobile-nav wrap"><details><summary>{t("Browse documentation", "문서 목차 열기")}</summary><DocsNav current={page} locale={locale} mobile /></details></div>
    <div className="mdx-doc-layout wrap">
      <aside className="mdx-doc-sidebar">
        <div className="mdx-doc-sidebar-head"><span className="mdx-doc-mark">{`{ }`}</span><span>{t("Developer docs", "개발 문서")}</span></div>
        <DocsNav current={page} locale={locale} />
        <a className="mdx-doc-playground" href="/playground">{t("Open the playground", "플레이그라운드 열기")} <ArrowRight size={14} /></a>
      </aside>
      <div className="mdx-doc-main">
        <div className="mdx-doc-breadcrumb"><span>{t("Docs", "문서")}</span><span aria-hidden="true">/</span><span>{groups.find((group) => group.pages.includes(page))?.[locale]}</span></div>
        <article id={page.id} className="mdx-doc-article">
          <header className="mdx-doc-header">
            <div><span className="mdx-doc-eyebrow">JulEditor / {page.path.slice("/docs/".length)}</span><h1>{headingTitle}</h1></div>
            <button className="docs-copy-page" type="button" onClick={copyPage} disabled={!contentReady}>{copyState === "done" ? <Check size={15} /> : <Copy size={15} />}{copyState === "done" ? t("Copied", "복사됨") : copyState === "error" ? t("Copy failed. Try again", "복사 실패. 다시 시도하세요") : t("Copy page", "페이지 내용 복사")}</button>
          </header>
          <div className="mdx-doc-content"><Suspense fallback={<div className="page-loading" role="status">{t("Opening the guide…", "문서를 여는 중…")}</div>}><Content components={mdxComponents} /><ReadySignal onReady={() => setReadyPath(modulePath)} /></Suspense></div>
        </article>
        <nav className="mdx-doc-pager" aria-label={t("Adjacent pages", "앞뒤 문서")}>
          {previous ? <a href={previous.path}><small>{t("Previous", "이전")}</small><span>← {previous[locale]}</span></a> : <span />}
          {next ? <a href={next.path}><small>{t("Next", "다음")}</small><span>{next[locale]} →</span></a> : <span />}
        </nav>
      </div>
    </div>
  </main>;
}
