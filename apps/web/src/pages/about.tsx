import { useEffect, useState } from "react";
import { resolveMdx, type MdxModule, type MdxSources } from "../docs/localized-mdx.js";
import { Code } from "../components/code-block.js";
import { mdxComponents } from "../docs/mdx-components.js";
import { AboutDiagramFonts } from "../components/about/about-diagram-fonts.js";
import { AboutSwimlane } from "../components/about/about-swimlane.js";
import { AboutWalkthrough } from "../components/about/about-sequence.js";
import { AboutSummary } from "../components/about/about-overview.js";
import { ENGINE_CSS_VARS } from "../lib/about-engines.js";
import { useSiteSettings } from "../app/site-settings.js";
import "../styles/docs-live.css";
import "../styles/docs.css";
import "../styles/about.css";

// About prose lives in ../content/about/en.mdx and ko.mdx; each MDX exports `meta` (hero title and subtitle).
type AboutMeta = { title: string; subtitle: string };
const first = (modules: Record<string, () => Promise<MdxModule<AboutMeta>>>) => ({ about: Object.values(modules)[0]! });
const sources: MdxSources<AboutMeta> = {
  en: first(import.meta.glob<MdxModule<AboutMeta>>("../content/about/en.mdx")),
  ko: first(import.meta.glob<MdxModule<AboutMeta>>("../content/about/ko.mdx")),
};

const aboutComponents = { ...mdxComponents, AboutSwimlane, AboutWalkthrough, AboutSummary };

export default function About() {
  const { locale, t } = useSiteSettings();
  const [loaded, setLoaded] = useState<{ locale: string; module: MdxModule<AboutMeta> } | null>(null);
  useEffect(() => {
    let live = true;
    const hit = resolveMdx(sources, locale, "about");
    void hit?.loader().then((module) => { if (live) setLoaded({ locale: hit.locale, module }); });
    // Warm the other language so the toggle swaps the page without a network wait.
    void resolveMdx(sources, locale === "en" ? "ko" : "en", "about")?.loader();
    return () => { live = false; };
  }, [locale]);
  const AboutContent = loaded?.module.default;
  const meta = loaded?.module.meta;
  return <main className="interior-page about-page" style={ENGINE_CSS_VARS}>
    <AboutDiagramFonts />
    <div className="wrap about-wrap">
      <header className="about-hero">
        <div><span className="about-eyebrow">ABOUT / JULEDITOR</span>
          <h1>{meta?.title}</h1>
          <p>{meta?.subtitle}</p>
        </div>
        <div className="about-hero-model" aria-label={t("Document model illustration", "문서 모델 도식")}>
          <div><span>DOC / 01</span><span>JULEDITOR</span></div>
          <Code title="json" locale={locale}>{`{
  "version": 1,
  "blocks": [
    { "id": "b1", "type": "paragraph" }
  ]
}`}</Code>
          <div><span>{t("EDIT", "편집")}</span><b>→</b><span>{t("SAVE", "저장")}</span><b>→</b><span>{t("VIEW", "보기")}</span></div>
        </div>
      </header>
      <article className="mdx-doc-content about-article">{AboutContent ? <AboutContent components={aboutComponents} /> : <p role="status">{t("Loading About…", "About 페이지 불러오는 중…")}</p>}</article>
    </div>
  </main>;
}
