import { useSiteSettings } from "./site-settings.js";

export function SiteFooter() {
  const { t } = useSiteSettings();
  return (
  <footer className="site-footer">
      <div className="footer-main">
        <a className="brand" href="/" aria-label={t("JulEditor home", "JulEditor 홈")}><img className="brand-mark" src="/favicon.svg" alt="" /><span>JulEditor</span></a>
        <p>{t("A composable block editor with its own core.", "독립적인 문서 코어와 조합 가능한 React UI를 갖춘 에디터.")}</p>
        <div className="footer-links"><a href="/playground">{"Playground"}</a><a href="/showcase">{"Showcase"}</a><a href="/docs">{"Docs"}</a><a href="/about">{"About"}</a></div>
      </div>
      <div className="footer-bottom"><span>{t("MIT licensed · Available on npm", "MIT 라이선스 · npm에서 설치")}</span><span>{t("Editor core built in this repository", "에디터 코어를 이 저장소에서 직접 개발")}</span></div>
    </footer>
  );
}
