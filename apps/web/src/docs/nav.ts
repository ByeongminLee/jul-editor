export type Locale = "en" | "ko";

export type DocPage = {
  path: string;
  id: string;
  en: string;
  ko: string;
};

export const groups: { en: string; ko: string; pages: DocPage[] }[] = [
  { en: "Start here", ko: "시작 안내", pages: [
    { path: "/docs/getting-started", id: "getting-started", en: "Getting started", ko: "시작하기" },
    { path: "/docs/installation", id: "installation", en: "Installation", ko: "설치" },
    { path: "/docs/packages", id: "packages", en: "Packages", ko: "패키지" },
    { path: "/docs/ai-skill", id: "ai-skill", en: "AI agent skill", ko: "AI 에이전트 스킬" },
  ] },
  { en: "Core", ko: "코어", pages: [
    { path: "/docs/core/composition", id: "composition", en: "React composition", ko: "React 조합" },
    { path: "/docs/core/document-model", id: "state", en: "Document model", ko: "문서 모델" },
    { path: "/docs/core/read-only-view", id: "read-only-view", en: "Read-only view", ko: "읽기 전용 보기" },
    { path: "/docs/core/formats", id: "formats", en: "Markdown and HTML", ko: "Markdown과 HTML" },
    { path: "/docs/core/toolbar-typography", id: "typography", en: "Toolbar and typography", ko: "툴바와 타이포그래피" },
    { path: "/docs/core/customize-controls", id: "controls", en: "Customize controls", ko: "컨트롤 맞춤 설정" },
    { path: "/docs/core/menus", id: "menus", en: "Menus", ko: "메뉴" },
    { path: "/docs/core/interactions", id: "interactions", en: "Drag and interactions", ko: "드래그와 편집 동작" },
    { path: "/docs/core/tables-media", id: "tables", en: "Tables and media", ko: "표와 미디어" },
    { path: "/docs/core/assets", id: "assets", en: "Assets and uploads", ko: "파일과 업로드" },
    { path: "/docs/core/custom-blocks", id: "custom-blocks", en: "Custom blocks and API", ko: "커스텀 블록과 API" },
    { path: "/docs/core/tags-mentions", id: "tags", en: "Tags and mentions", ko: "태그와 멘션" },
    { path: "/docs/core/styling-i18n-performance", id: "themes", en: "Styling, i18n and performance", ko: "스타일·다국어·성능" },
  ] },
  { en: "Plugins", ko: "플러그인", pages: [
    { path: "/docs/plugins/charts", id: "charts", en: "Charts", ko: "차트" },
    { path: "/docs/plugins/chart-customization", id: "chart-customization", en: "Chart customization", ko: "차트 맞춤 설정" },
    { path: "/docs/plugins/diagram", id: "diagram", en: "Diagrams", ko: "다이어그램" },
    { path: "/docs/plugins/data-table", id: "data-table", en: "Data tables and resolvers", ko: "데이터 표와 리졸버" },
    { path: "/docs/plugins/code-highlighting", id: "code-blocks", en: "Code highlighting", ko: "구문 강조" },
    { path: "/docs/plugins/code-workspace", id: "code-workspace", en: "Code workspace", ko: "코드 워크스페이스" },
    { path: "/docs/plugins/diff", id: "diff", en: "Diff", ko: "문서 비교" },
    { path: "/docs/plugins/inline-compare-suggestions", id: "inline-compare-suggestions", en: "Inline compare and suggestions", ko: "인라인 비교와 제안" },
    { path: "/docs/plugins/comments", id: "comments", en: "Comments", ko: "댓글" },
    { path: "/docs/plugins/collaboration", id: "collaboration", en: "Collaboration", ko: "공동 편집" },
    { path: "/docs/plugins/links-embeds", id: "links-embeds", en: "Links and embeds", ko: "링크와 임베드" },
    { path: "/docs/plugins/notion-blocks", id: "notion-blocks", en: "Notion blocks", ko: "Notion형 블록" },
    { path: "/docs/plugins/pages-docx", id: "pages-docx", en: "Pages and DOCX", ko: "페이지와 DOCX" },
  ] },
];

export const pages = groups.flatMap((group) => group.pages);

const oldHashes: Record<string, string> = {
  "getting-started": "/docs/getting-started", composition: "/docs/core/composition",
  plugins: "/docs/packages", formats: "/docs/core/formats", charts: "/docs/plugins/charts",
  tags: "/docs/core/tags-mentions", diff: "/docs/plugins/diff", interactions: "/docs/core/interactions",
  themes: "/docs/core/styling-i18n-performance", performance: "/docs/core/styling-i18n-performance",
  typography: "/docs/core/toolbar-typography", toolbar: "/docs/core/toolbar-typography",
  "custom-blocks": "/docs/core/custom-blocks", menus: "/docs/core/menus",
  "chart-customization": "/docs/plugins/chart-customization", diagram: "/docs/plugins/diagram",
  "data-table": "/docs/plugins/data-table", tables: "/docs/core/tables-media",
  "code-blocks": "/docs/plugins/code-highlighting", media: "/docs/core/tables-media",
  state: "/docs/core/document-model", "extension-api": "/docs/core/custom-blocks",
};

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** The docs page for a route path (no base, no trailing slash). `/docs` opens Getting started,
 * or the page an old `/docs#hash` bookmark pointed at; an unknown path returns undefined. */
export function resolveDocsPath(pathname: string, hash: string): DocPage | undefined {
  const trimmed = pathname.replace(/\/+$/, "");
  const path = trimmed === "/docs"
    ? oldHashes[safeDecode(hash.slice(1))] ?? "/docs/getting-started"
    : trimmed;
  return pages.find((page) => page.path === path);
}
