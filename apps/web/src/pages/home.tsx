import type { Doc } from "@jul-editor/core";
import { ArrowRight, ArrowUpRight, Code2, FileDiff, Layers3, LayoutTemplate, Palette, PlugZap } from "lucide-react";
import { Code } from "../components/code-block.js";
import { introDoc, mediaExampleBlocks } from "../lib/sample.js";
import { useSiteSettings } from "../app/site-settings.js";
import { UnifiedWorkspace } from "../components/workspace/unified-workspace.js";

const localInstall = "cd jul-editor\npnpm install\npnpm --filter web dev";

function koreanIntroDoc(): Doc {
  return { version: 1, blocks: [
    { id: "intro-title", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "출시 노트 초안" }] },
    { id: "intro-lead", type: "paragraph", props: {}, content: [
      { type: "text", text: "새 기능을 한 문장으로 정리해 보세요. " },
      { type: "text", text: "이 문장을 직접 수정하고", marks: [{ type: "bold" }] },
      { type: "text", text: " 위의 Markdown, HTML, 비교 탭을 눌러 결과를 확인하세요." },
    ] },
    { id: "intro-list", type: "bulletListItem", props: {}, content: [{ type: "text", text: "이 블록을 옮기거나 /를 입력해 새 블록을 추가해 보세요." }] },
    ...mediaExampleBlocks("intro", "ko"),
    { id: "intro-empty", type: "paragraph", props: {}, content: [] },
  ] };
}

function homeDocument(locale: "en" | "ko"): Doc {
  return locale === "ko" ? koreanIntroDoc() : introDoc();
}

function homeBaseline(locale: "en" | "ko"): Doc {
  const doc = homeDocument(locale);
  return { ...doc, blocks: doc.blocks.filter((block) => block.id !== "intro-list") };
}

export default function Home() {
  const { t, locale } = useSiteSettings();
  return <main>
    <section className="home-hero wrap">
      <div className="home-hero-copy">
        <span className="hero-badge"><span className="status-dot" /> {t("OPEN SOURCE · REACT · MODULAR", "오픈소스 · REACT · 모듈형")}</span>
        <h1>{t("An editor that fits", "제품에 맞는 에디터를")}<br /><span>{t("your product.", "직접 만드세요.")}</span></h1>
        <p>{t("Named after jul (줄), the Korean word for a line of text, JulEditor lets writing grow one line at a time. Its document core, React controls, and optional plugins let you edit, inspect source, and compare changes in one workspace.", "JulEditor는 ‘한 줄, 두 줄’ 할 때의 줄에서 이름을 땄습니다. 글을 한 줄씩 쌓고 다듬을 수 있도록 문서 코어, React UI, 선택형 플러그인을 한 작업 공간에 담았습니다.")}</p>
        <div className="hero-actions"><a className="button button-primary" href="/playground">{t("Try the editor", "에디터 사용해 보기")} <ArrowRight size={17} /></a><a className="button button-outline" href="/docs/getting-started">{t("Get started", "시작하기")} <ArrowUpRight size={16} /></a></div>
        <div className="install-box" aria-label={t("Run the site locally", "사이트 로컬 실행 명령")}>
          <div className="install-box-head"><span><span className="install-prompt">$</span> {t("Run this repository locally", "저장소 로컬 실행")}</span><span className="install-status">{t("npm packages not published yet", "npm 패키지 배포 전")}</span></div>
          <div className="install-box-code"><Code title="bash" locale={locale}>{localInstall}</Code></div>
        </div>
      </div>
    </section>

    <section className="home-live wrap" aria-labelledby="home-live-title">
      <div className="home-live-heading"><div><span className="eyebrow">{t("LIVE EDITOR", "실제 에디터")}</span><h2 id="home-live-title">{t("Edit here. Inspect the result.", "직접 편집하고 결과를 확인하세요.")}</h2></div><a className="text-link" href="/playground">{t("Open playground", "플레이그라운드 열기")} <ArrowUpRight size={16} /></a></div>
      <UnifiedWorkspace createDocument={homeDocument} createBaseline={homeBaseline} variant="home" fileName="release-notes.md" />
    </section>

    <section className="home-capabilities wrap" aria-labelledby="capabilities-title"><div className="section-heading"><div><span className="eyebrow">{t("CORE + OPTIONAL PLUGINS", "코어와 선택형 플러그인")}</span><h2 id="capabilities-title">{t("Start small. Add what you need.", "작게 시작하고 필요한 것을 더하세요.")}</h2></div><p>{t("Use the core for the document, React for the editing UI, and plugins for specialized blocks. The examples below show where each part fits.", "문서에는 코어를, 편집 화면에는 React를, 차트 같은 블록에는 플러그인을 사용합니다. 아래에서 각 부분의 역할을 확인하세요.")}</p></div>
      <div className="feature-grid home-feature-grid">
        <article className="feature-card"><span className="feature-icon"><Layers3 size={20} /></span><h3>{t("Document core", "문서 코어")}</h3><p>{t("Blocks, selections, history, and serialization live in the core. Your app decides how the editor looks.", "블록, 선택 영역, 실행 취소 기록, 직렬화는 코어가 처리합니다. 에디터 화면은 앱에서 구성하세요.")}</p><div className="feature-mini-flow" aria-hidden="true"><span>Doc</span><i /><span>Block</span><i /><span>Text</span></div><a href="/docs/core/document-model">{t("Explore the core", "코어 살펴보기")} <ArrowRight size={15} /></a></article>
        <article className="feature-card"><span className="feature-icon"><LayoutTemplate size={20} /></span><h3>{t("React editing UI", "React 편집 UI")}</h3><p>{t("Compose the content area, toolbar, block handle, and menus from the pieces your product uses.", "본문, 툴바, 블록 핸들, 메뉴를 제품에 필요한 만큼 조합하세요.")}</p><div className="feature-mini-code" aria-hidden="true"><span>&lt;Editor.Toolbar /&gt;</span><span>&lt;Editor.Content /&gt;</span></div><a href="/docs/core/composition">{t("See how to compose it", "조합 방법 보기")} <ArrowRight size={15} /></a></article>
        <article className="feature-card"><span className="feature-icon"><PlugZap size={20} /></span><h3>{t("Optional plugins", "선택형 플러그인")}</h3><p>{t("Add charts, diagrams, data tables, and code highlighting when a document calls for them.", "문서에 필요할 때 차트, 다이어그램, 데이터 표, 구문 강조를 추가하세요.")}</p><div className="feature-mini-plugins" aria-hidden="true"><span>Chart</span><span>Diagram</span><span>Table</span></div><a href="/docs/plugins/charts">{t("Browse plugins", "플러그인 보기")} <ArrowRight size={15} /></a></article>
        <article className="feature-card feature-card-visual"><span className="feature-icon"><Code2 size={20} /></span><h3>{t("Markdown and HTML", "Markdown과 HTML")}</h3><p>{t("Inspect generated source, edit it, and import it back into the same document.", "변환한 소스를 확인하고 수정한 뒤 같은 문서에 다시 적용하세요.")}</p><div className="feature-mini-code" aria-hidden="true"><span>{t("# Release notes", "# 출시 노트")}</span><span>{t("- Drag this block", "- 블록 이동")}</span><span>{t("- Add a chart", "- 차트 추가")}</span></div><a href="/docs/core/formats">{t("Read about formats", "문서 형식 알아보기")} <ArrowRight size={15} /></a></article>
        <article className="feature-card feature-card-visual"><span className="feature-icon"><FileDiff size={20} /></span><h3>{t("Version diff", "버전 비교")}</h3><p>{t("Save the current document as the comparison baseline, then review added, removed, moved, and edited blocks.", "현재 문서를 비교 기준으로 저장한 뒤 추가·삭제·이동·수정한 블록을 확인하세요.")}</p><div className="feature-mini-diff" aria-hidden="true"><span>− {t("Draft", "초안")}</span><span>+ {t("Ready to review", "검토 준비 완료")}</span></div><a href="/docs/plugins/diff">{t("See version comparison", "버전 비교 알아보기")} <ArrowRight size={15} /></a></article>
        <article className="feature-card feature-card-visual"><span className="feature-icon"><Palette size={20} /></span><h3>{t("Editor themes", "에디터 테마")}</h3><p>{t("Start from a ready-made preset, then make it yours with your own colors and type.", "완성된 프리셋에서 시작해 색상과 글꼴을 직접 고쳐 보세요.")}</p><div className="feature-mini-themes" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><a href="/showcase">{t("Explore the showcase", "쇼케이스 보기")} <ArrowRight size={15} /></a></article>
      </div>
    </section>
  </main>;
}
