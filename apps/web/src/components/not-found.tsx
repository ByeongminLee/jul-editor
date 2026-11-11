import { useSiteSettings } from "../app/site-settings.js";

/** Shown for URLs that match no page, inside the normal site chrome. */
export function NotFound({ docs = false }: { docs?: boolean }) {
  const { t } = useSiteSettings();
  return <section className="not-found" role="region" aria-labelledby="not-found-title">
    <span className="not-found-code">404</span>
    <h1 id="not-found-title">{docs ? t("This guide does not exist", "없는 문서입니다") : t("Page not found", "페이지를 찾을 수 없습니다")}</h1>
    <p>{t("The link may be old or mistyped. Start from one of these pages instead.", "링크가 오래되었거나 잘못 입력되었을 수 있습니다. 아래 페이지에서 다시 시작하세요.")}</p>
    <div className="not-found-links">
      <a className="button button-primary button-small" href="/">{t("Go to Home", "홈으로 가기")}</a>
      <a className="button button-outline button-small" href="/docs/getting-started">{t("Read the docs", "문서 보기")}</a>
    </div>
  </section>;
}
