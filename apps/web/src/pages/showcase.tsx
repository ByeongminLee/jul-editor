import type { Doc } from "@jul-editor/core";
import { ArrowRight, Code2, Copy, Eye } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { ShowcaseEditor } from "./showcase/showcase-editor.js";
import { CustomThemeControls, DEFAULT_CUSTOM_CONFIG, SAMPLE_IDS, customThemeExtra, customThemeFontImport, customThemeTokens, fontsHref, type CustomThemeConfig } from "./showcase/custom-theme.js";
import { AgentEditor } from "./showcase/agent-editor.js";
import { DocxEditor } from "./showcase/docx-editor.js";
import { NotionEditor } from "./showcase/notion-editor.js";
import agentSource from "./showcase/agent-editor.tsx?raw";
import docxSource from "./showcase/docx-editor.tsx?raw";
import notionSource from "./showcase/notion-editor.tsx?raw";
import agentCss from "./showcase/agent-editor.css?raw";
import docxCss from "./showcase/docx-editor.css?raw";
import notionCss from "./showcase/notion-editor.css?raw";
import componentSource from "./showcase/showcase-editor.tsx?raw";
import { useSiteSettings } from "../app/site-settings.js";
import { Code } from "../components/code-block.js";
import { showcaseDoc } from "./showcase/showcase-samples.js";
import "../styles/custom-theme.css";

type Mode = "block" | "rich" | "full";
type Theme = {
  id: string;
  name: string;
  concept: string;
  description: string;
  mode: Mode;
  tokens: Record<string, string>;
  extra?: string;
};

const themes: Theme[] = [
  {
    id: "shadcn", name: "Shadcn", concept: "Blocks · shadcn/ui", mode: "block",
    description: "Uses your shadcn/ui colors and borders for a familiar editing surface.",
    tokens: {
      "--jul-editor-bg": "var(--background, #09090b)", "--jul-editor-ink": "var(--foreground, #fafafa)",
      "--jul-editor-muted": "var(--muted-foreground, #a1a1aa)", "--jul-editor-border": "var(--border, #27272a)",
      "--jul-editor-panel": "var(--card, #09090b)", "--jul-editor-accent": "var(--primary, #fafafa)",
      "--jul-editor-active": "var(--shadcn-accent, var(--accent, #27272a))", "--jul-editor-radius": "8px",
      "--jul-editor-font": "Inter, ui-sans-serif, system-ui, sans-serif", "--jul-editor-heading": "Inter, ui-sans-serif, system-ui, sans-serif",
    },
  },
  {
    id: "custom", name: "Custom", concept: "Full editor · Your design", mode: "full",
    description: "Choose a palette, typography, spacing, and corners while you edit.",
    tokens: customThemeTokens(DEFAULT_CUSTOM_CONFIG), extra: customThemeExtra(DEFAULT_CUSTOM_CONFIG),
  },
];

const koCopy: Record<string, { concept: string; description: string }> = {
  shadcn: { concept: "블록 · shadcn/ui", description: "shadcn/ui의 색상과 테두리 토큰을 편집 화면에도 적용합니다." },
  custom: { concept: "전체 에디터 · 내 디자인", description: "프리셋에서 시작해 색상·글꼴·간격·모서리를 조정하며 직접 편집해 보세요." },
};

/**
 * Case tabs, in display order. These three are self-contained editors, each in its own files under ./showcase/
 * (component, sample doc slot, CSS); the Code tab shows their component and CSS source. The remaining tabs are the theme
 * presets in `themes`. To add a case, create its files and add one entry here.
 */
type EditorCase = {
  id: string;
  name: string;
  concept: [string, string];
  description: [string, string];
  Component: ComponentType<{ locale: "en" | "ko"; drafts?: Partial<Record<"en" | "ko", Doc>>; onDraftChange?: (locale: "en" | "ko", doc: Doc) => void; onImportDraft?: (locale: "en" | "ko", doc: Doc, expected: Doc | undefined) => boolean; pendingFiles?: Partial<Record<"en" | "ko", Map<string, File>>> }>;
  source: string;
  css: string;
};
const editorCases: EditorCase[] = [
  { id: "agent", name: "Agent editor", concept: ["AI agent · Review and apply", "AI 에이전트 · 검토와 적용"], description: ["Let an agent propose edits, then review and apply them inline.", "에이전트가 제안한 수정을 문서 안에서 검토하고 적용합니다."], Component: AgentEditor, source: agentSource, css: agentCss },
  { id: "docx", name: "DOCX editor", concept: ["Documents · Import and export", "문서 · 가져오기와 내보내기"], description: ["Import a Word file, edit it on paged sheets, and export it back to .docx.", "Word 파일을 가져와 페이지 화면에서 편집하고 .docx로 내보냅니다."], Component: DocxEditor, source: docxSource, css: docxCss },
  { id: "notion", name: "Notion-like editor", concept: ["Workspace · Blocks and pages", "워크스페이스 · 블록과 페이지"], description: ["Callouts, toggles, columns, a table of contents and link cards in one workspace-style editor.", "콜아웃, 토글, 컬럼, 목차, 링크 카드를 갖춘 워크스페이스형 에디터입니다."], Component: NotionEditor, source: notionSource, css: notionCss },
];

// Split-out files of each case are picked up by prefix, so a new agent-editor-*.ts file shows in the Code tab with no edit here.
const caseRaw = import.meta.glob<string>("./showcase/{agent,docx,notion}-editor*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true });
const MAIN_FILES = new Set(["agent-editor.tsx", "docx-editor.tsx", "notion-editor.tsx", "agent-editor.css", "docx-editor.css", "notion-editor.css"]);
function caseFiles(caseId: string): { name: string; source: string }[] {
  return Object.entries(caseRaw)
    .map(([path, source]) => ({ name: path.split("/").pop()!, source }))
    .filter((file) => file.name.startsWith(`${caseId}-editor`) && !MAIN_FILES.has(file.name) && !/\.test\./.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sampleDoc(sampleId: string, locale: "en" | "ko"): Doc {
  return showcaseDoc(sampleId, locale);
}

// One shared skin plus per-theme tokens keeps the copied CSS identical to the live preview.
const sharedCss = `.jul-editor-theme, .jul-editor-theme * { box-sizing: border-box; }
.jul-editor-theme .editor-instance { position: relative; background: var(--jul-editor-bg); color: var(--jul-editor-ink); }
.jul-editor-theme .editor-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 49px; padding: 8px 14px; border-bottom: 1px solid var(--jul-editor-border); border-radius: var(--jul-editor-radius) var(--jul-editor-radius) 0 0; background: var(--jul-editor-panel); }
.jul-editor-theme .toolbar-group { display: flex; gap: 2px; align-items: center; }
.jul-editor-theme .toolbar-divider { display: block; width: 1px; height: 18px; background: var(--jul-editor-border); }
.jul-editor-theme .toolbar-spacer { flex: 1; }
.jul-editor-theme .tool-button { min-width: 29px; min-height: 29px; display: inline-grid; place-items: center; padding: 0 6px; border: 1px solid transparent; border-radius: min(var(--jul-editor-radius), 8px); background: transparent; color: var(--jul-editor-muted); font: 600 11px var(--jul-editor-font); cursor: pointer; }
.jul-editor-theme .tool-button:hover, .jul-editor-theme .tool-button[aria-pressed=true] { background: var(--jul-editor-active); color: var(--jul-editor-accent); border-color: var(--jul-editor-border); }
.jul-editor-theme .tool-button:disabled { opacity: .4; cursor: not-allowed; }
.jul-editor-theme .editor-content { min-height: 420px; padding: 30px min(7%, 60px); outline: none; background: var(--jul-editor-bg); color: var(--jul-editor-ink); font: 14px/1.8 var(--jul-editor-font); }
.jul-editor-theme--blocks .editor-content { padding-left: max(82px, 7%); }
.jul-editor-theme .editor-content [data-jul-editor-block] { position: relative; min-height: 1.3em; }
.jul-editor-theme .editor-content [data-type=heading] { margin: 18px 0 8px; color: var(--jul-editor-ink); font-family: var(--jul-editor-heading); font-weight: 700; letter-spacing: -.04em; line-height: 1.2; }
.jul-editor-theme .editor-content [data-type=heading]:first-child { margin-top: 0; }
.jul-editor-theme .editor-content [data-type=heading][data-jul-editor-level='1'] { font-size: 2em; }
.jul-editor-theme .editor-content [data-type=heading][data-jul-editor-level='2'] { font-size: 1.5em; }
.jul-editor-theme .editor-content [data-type=heading][data-jul-editor-level='3'] { font-size: 1.2em; }
.jul-editor-theme .editor-content [data-type=paragraph] { margin: 0 0 10px; }
.jul-editor-theme .editor-content [data-type=bulletListItem], .jul-editor-theme .editor-content [data-type=orderedListItem], .jul-editor-theme .editor-content [data-type=todoListItem] { padding-left: 22px; margin: 3px 0; }
.jul-editor-theme .editor-content [data-type=bulletListItem]::before { content: '•'; position: absolute; left: 0; color: var(--jul-editor-accent); }
.jul-editor-theme .editor-content [data-type=orderedListItem]::before { content: attr(data-jul-editor-index) '.'; position: absolute; left: 0; color: var(--jul-editor-accent); }
.jul-editor-theme .editor-content [data-type=todoListItem]::before { content: '☐'; position: absolute; left: 0; color: var(--jul-editor-accent); }
.jul-editor-theme .editor-content [data-jul-editor-children] { margin-left: 24px; }
.jul-editor-theme .editor-content [data-type=quote] { margin: 19px 0; padding: 4px 0 4px 15px; border-left: 3px solid var(--jul-editor-accent); color: var(--jul-editor-muted); font: italic 1.2em/1.5 var(--jul-editor-heading); }
.jul-editor-theme .editor-content [data-type=codeBlock] { margin: 14px 0; padding: 14px; overflow-x: auto; border: 1px solid var(--jul-editor-border); border-radius: var(--jul-editor-radius); background: var(--jul-editor-panel); color: var(--jul-editor-ink); font: 12px/1.6 ui-monospace, monospace; }
.jul-editor-theme .editor-content [data-type=codeBlock][data-jul-editor-block] { display: flex; flex-direction: column-reverse; }
.jul-editor-theme .editor-content [data-jul-editor-code-chrome] { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid var(--jul-editor-border); font: 10px var(--jul-editor-font); }
.jul-editor-theme .editor-content [data-jul-editor-code-chrome] select, .jul-editor-theme .editor-content [data-jul-editor-code-chrome] button { padding: 3px 6px; border: 1px solid var(--jul-editor-border); border-radius: min(var(--jul-editor-radius), 8px); background: var(--jul-editor-bg); color: var(--jul-editor-ink); font-size: 10px; }
.jul-editor-theme .editor-content [data-jul-editor-image] { max-width: 100%; width: fit-content; margin: 18px auto; text-align: center; }
.jul-editor-theme .editor-content [data-jul-editor-image][data-align=left] { margin-left: 0; }
.jul-editor-theme .editor-content [data-jul-editor-image][data-align=right] { margin-right: 0; }
.jul-editor-theme .editor-content [data-jul-editor-image] img { display: block; max-width: 100%; height: auto; border: 1px solid var(--jul-editor-border); border-radius: min(var(--jul-editor-radius), 8px); }
.jul-editor-theme .editor-content [data-jul-editor-image] figcaption { margin-top: 8px; color: var(--jul-editor-muted); font: 11px/1.5 var(--jul-editor-font); }
.jul-editor-theme .editor-content [data-jul-editor-image] input { max-width: 100%; padding: 6px 8px; border: 1px solid var(--jul-editor-border); border-radius: 4px; background: var(--jul-editor-bg); color: var(--jul-editor-ink); font-size: 11px; }
.jul-editor-theme .editor-content [data-jul-editor-image] [data-jul-editor-alt-input] { display: block; width: 100%; margin-top: 7px; }
.jul-editor-theme .editor-content [data-jul-editor-image] [data-jul-editor-align-group] { display: flex; justify-content: center; gap: 5px; margin-top: 7px; }
.jul-editor-theme .editor-content [data-jul-editor-image] [data-jul-editor-align-option] { min-width: 22px; min-height: 22px; border: 1px solid var(--jul-editor-border); border-radius: 4px; background: var(--jul-editor-bg); color: var(--jul-editor-ink); cursor: pointer; }
.jul-editor-theme .editor-content [data-jul-editor-image] [data-jul-editor-align-option]::before { content: attr(data-jul-editor-align-option); font-size: 9px; }
.jul-editor-theme .editor-content [data-jul-editor-image] [data-jul-editor-resize-handle] { display: none; }
.jul-editor-theme .editor-content [data-type=table] { display: table; width: 100%; margin: 16px 0; border-collapse: collapse; }
.jul-editor-theme .editor-content [data-type=table] > [data-jul-editor-children], .jul-editor-theme .editor-content [data-type=tableRow] > [data-jul-editor-children] { display: contents; }
.jul-editor-theme .editor-content [data-type=tableRow] { display: table-row; }
.jul-editor-theme .editor-content [data-type=tableCell] { display: table-cell; padding: 6px 9px; border: 1px solid var(--jul-editor-border); font-size: 12px; }
.jul-editor-theme .editor-content [data-type=divider] hr { margin: 18px 0; border: 0; border-top: 1px solid var(--jul-editor-border); }
.jul-editor-theme .editor-content [data-jul-editor-selected] { outline: 2px solid var(--jul-editor-accent); border-radius: min(var(--jul-editor-radius), 8px); }
.jul-editor-theme .editor-content a { color: var(--jul-editor-accent); text-decoration: underline; text-underline-offset: 2px; }
.jul-editor-theme .editor-content code { padding: 1px 4px; border-radius: 4px; background: var(--jul-editor-active); font: .9em ui-monospace, monospace; }
.jul-editor-theme .editor-content [data-mention] { padding: 1px 3px; border-radius: 3px; background: var(--jul-editor-active); color: var(--jul-editor-accent); }
.jul-editor-theme .editor-content [data-jul-editor-content][data-placeholder] { position: relative; }
.jul-editor-theme .editor-content [data-jul-editor-content][data-placeholder]:empty::before,
.jul-editor-theme .editor-content [data-jul-editor-empty][data-jul-editor-focused] > [data-jul-editor-content]::before { content: attr(data-placeholder); position: absolute; inset: 0 auto auto 0; color: var(--jul-editor-muted); pointer-events: none; white-space: nowrap; }
.jul-editor-theme .slash-menu { position: fixed; z-index: 30; width: 250px; max-height: 290px; overflow-y: auto; padding: 7px; border: 1px solid var(--jul-editor-border); border-radius: var(--jul-editor-radius); background: var(--jul-editor-panel); color: var(--jul-editor-ink); box-shadow: 0 16px 40px #0004; }
.jul-editor-theme .slash-menu-label { padding: 8px; color: var(--jul-editor-muted); font: 700 9px var(--jul-editor-font); letter-spacing: .1em; }
.jul-editor-theme .slash-option { display: flex; align-items: center; padding: 8px; border-radius: min(var(--jul-editor-radius), 8px); color: var(--jul-editor-ink); font: 12px var(--jul-editor-font); cursor: pointer; }
.jul-editor-theme .slash-option:hover, .jul-editor-theme .slash-option[data-active] { color: var(--jul-editor-accent); background: var(--jul-editor-active); }
.jul-editor-theme .slash-empty { padding: 10px; color: var(--jul-editor-muted); font-size: 11px; }
.jul-editor-theme .bubble-tools { position: fixed; z-index: 31; display: flex; gap: 2px; padding: 5px; border: 1px solid var(--jul-editor-border); border-radius: var(--jul-editor-radius); background: var(--jul-editor-panel); box-shadow: 0 12px 28px #0004; }
.jul-editor-theme .bubble-tools button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: min(var(--jul-editor-radius), 8px); background: transparent; color: var(--jul-editor-ink); font-weight: 700; cursor: pointer; }
.jul-editor-theme .bubble-tools button:hover, .jul-editor-theme .bubble-tools button[data-active] { background: var(--jul-editor-active); color: var(--jul-editor-accent); }
.jul-editor-theme .drag-handle, .jul-editor-theme .block-add { position: fixed; z-index: 10; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: min(var(--jul-editor-radius), 8px); background: var(--jul-editor-bg); color: var(--jul-editor-muted); cursor: pointer; }
.jul-editor-theme .drag-handle { cursor: grab; touch-action: none; }
.jul-editor-theme .drag-handle svg { display: block; }
.jul-editor-theme .drag-handle[data-dragging] { cursor: grabbing; color: var(--jul-editor-accent); }
.jul-editor-theme .drag-handle:hover, .jul-editor-theme .block-add:hover { border-color: var(--jul-editor-border); color: var(--jul-editor-accent); }
.jul-editor-theme .drop-indicator { position: fixed; z-index: 12; border-radius: 3px; background: var(--jul-editor-accent); pointer-events: none; }
.jul-editor-theme ::highlight(jul-editor-keyword), .jul-editor-theme ::highlight(jul-editor-meta) { color: #ba5ad6; }
.jul-editor-theme ::highlight(jul-editor-string), .jul-editor-theme ::highlight(jul-editor-literal) { color: #348f5c; }
.jul-editor-theme ::highlight(jul-editor-comment) { color: #83909c; }
.jul-editor-theme ::highlight(jul-editor-number), .jul-editor-theme ::highlight(jul-editor-attr) { color: #d67834; }
.jul-editor-theme ::highlight(jul-editor-title), .jul-editor-theme ::highlight(jul-editor-function) { color: #368cb0; }
.jul-editor-theme ::highlight(jul-editor-type), .jul-editor-theme ::highlight(jul-editor-built_in) { color: #aa842f; }
.jul-editor-theme ::highlight(jul-editor-variable), .jul-editor-theme ::highlight(jul-editor-punctuation) { color: var(--jul-editor-ink); }
.jul-editor-theme .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }`;

function cssFor(theme: Theme) {
  const tokens = Object.entries(theme.tokens).map(([key, value]) => `  ${key}: ${value};`).join("\n");
  return `.jul-editor-theme--${theme.id} {\n${tokens}\n}\n${theme.extra ?? ""}`;
}

function reactFor(theme: Theme, sampleId: string) {
  return `${componentSource.replace('"use client";', '"use client";\nimport "./theme.css";\nimport { useEffect, useState, type ComponentType, type CSSProperties } from "react";')}\nconst initialDoc: Doc = ${JSON.stringify(sampleDoc(sampleId, "en"), null, 2)};\n\nexport function ThemeExample() {\n  const [doc, setDoc] = useState<Doc>(initialDoc);\n  return <ShowcaseEditor value={doc} onChange={setDoc} theme="${theme.id}" mode="${theme.mode}" />;\n}`;
}

export default function Showcase() {
  const { locale, t } = useSiteSettings();
  const [selected, setSelected] = useState("custom");
  const docxPendingFiles = useRef<Partial<Record<"en" | "ko", Map<string, File>>>>({});
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(DEFAULT_CUSTOM_CONFIG);
  // One document per sample id and locale, so edits survive switching presets, samples, and cases.
  const [docs, setDocs] = useState<Record<string, Doc>>(() => Object.fromEntries(["shadcn", ...SAMPLE_IDS].flatMap((id) => [
    [`en:${id}`, sampleDoc(id, "en")], [`ko:${id}`, sampleDoc(id, "ko")],
  ])));
  const [panel, setPanel] = useState<string>("preview");
  // The editor cases unmount when another card is picked; their documents live here so edits survive.
  const [caseDrafts, setCaseDrafts] = useState<Record<string, Partial<Record<"en" | "ko", Doc>>>>({});
  const caseDraftsRef = useRef(caseDrafts);
  function saveCaseDraft(id: string, lang: "en" | "ko", doc: Doc) {
    const next = { ...caseDraftsRef.current, [id]: { ...caseDraftsRef.current[id], [lang]: doc } };
    caseDraftsRef.current = next;
    setCaseDrafts(next);
  }
  const [copied, setCopied] = useState("");
  const customTheme = { ...themes[themes.length - 1]!, tokens: customThemeTokens(customConfig), extra: customThemeExtra(customConfig) };
  const activeCase = editorCases.find((item) => item.id === selected);
  const theme = selected === "custom" ? customTheme : themes.find((item) => item.id === selected) ?? themes[0]!;
  const sampleId = theme.id === "custom" ? customConfig.sample ?? "custom" : theme.id;
  const docKey = `${locale}:${sampleId}`;
  const modeLabel = theme.mode === "full" ? t("Toolbar + blocks", "툴바 + 블록") : theme.mode === "block" ? t("Block editing", "블록 편집") : t("Rich text", "리치 텍스트");
  const fontImport = theme.id === "custom" ? customThemeFontImport(customConfig) : "";
  const css = `${fontImport ? `${fontImport}\n\n` : ""}${sharedCss}\n\n${cssFor(theme)}`;
  const react = reactFor(theme, sampleId);
  const fontsLink = selected === "custom" ? fontsHref(customConfig, locale) : "";
  // Web fonts load only on this page, and only the families the Custom theme uses.
  useEffect(() => {
    if (!fontsLink) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontsLink;
    link.dataset.showcaseFonts = "";
    document.head.append(link);
    return () => link.remove();
  }, [fontsLink]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(t(`${label} copied.`, `${label}를 복사했습니다.`));
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied(t("Clipboard access failed. Copy the code from the Code tab.", "클립보드에 접근할 수 없습니다. 코드 탭에서 직접 복사하세요."));
    }
  }
  return <main className="interior-page showcase-page">
    <style>{sharedCss + "\n" + themes.map((item) => cssFor(item.id === "custom" ? customTheme : item)).join("\n")}</style>
    <section className="showcase-intro wrap"><h1>{t("Showcase", "쇼케이스")}</h1><p>{t("Choose a ready-made style or build your own. Every preview uses the same editor core, and its React code and CSS are ready to copy.", "완성된 스타일을 고르거나 직접 만들어 보세요. 모든 미리보기는 같은 에디터 코어를 쓰며, React 코드와 CSS를 복사할 수 있습니다.")}</p><a className="text-link" href="/docs/core/styling-i18n-performance">{t("Read the styling guide", "스타일 설정 알아보기")} <ArrowRight size={16} /></a></section>
    <section className="showcase-picker wrap" aria-label={t("Editor cases", "에디터 케이스")}>{[...editorCases.map((item) => ({ ...item, isCase: true as const })), ...themes.map((item) => ({ id: item.id, name: item.name, concept: [item.concept, koCopy[item.id]!.concept] as [string, string], mode: item.mode, isCase: false as const }))].map((item) => item.isCase
      ? <button className="showcase-picker-card" key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setPanel("preview"); }}><span className={`showcase-swatch showcase-swatch--case showcase-swatch--${item.id}`} aria-hidden="true"><span className="showcase-swatch-bar" /><span className="showcase-swatch-title">{item.name}</span><span className="showcase-swatch-line" /><span className="showcase-swatch-line short" /></span><span className="showcase-picker-info"><strong>{item.name}</strong><small>{item.concept[locale === "ko" ? 1 : 0]}</small></span></button>
      : <button className="showcase-picker-card" key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setPanel("preview"); }}><span className={`showcase-swatch jul-editor-theme--${item.id}`}><span className="showcase-swatch-bar" /><span className="showcase-swatch-title">{item.name}</span><span className="showcase-swatch-line" /><span className="showcase-swatch-line short" /></span><span className="showcase-picker-info"><strong>{item.name}</strong><small>{item.mode === "full" ? t("Toolbar + blocks", "툴바 + 블록") : item.mode === "block" ? t("Block editing", "블록 편집") : t("Rich text", "리치 텍스트")}</small></span></button>)}</section>
    {activeCase ? <section className="showcase-active wrap" aria-label={t(`${activeCase.name} live editor`, `${activeCase.name} 실제 에디터`)} data-theme={activeCase.id} data-mode="case">
      <div className="showcase-active-heading"><div><span className="showcase-concept">{activeCase.concept[locale === "ko" ? 1 : 0]}</span><h2>{activeCase.name}</h2><p>{activeCase.description[locale === "ko" ? 1 : 0]}</p></div></div>
      <div className="showcase-switches" role="group" aria-label={t(`${activeCase.name} view`, `${activeCase.name} 보기`)}><button type="button" aria-pressed={panel === "preview"} onClick={() => setPanel("preview")}><Eye size={14} /> {t("Preview", "미리보기")}</button><button type="button" aria-pressed={panel !== "preview"} onClick={() => setPanel("react")}><Code2 size={14} /> {t("Code", "코드")}</button></div>
      {panel === "preview" ? <activeCase.Component locale={locale} pendingFiles={activeCase.id === "docx" ? docxPendingFiles.current : undefined} drafts={caseDrafts[activeCase.id]} onDraftChange={(lang, doc) => saveCaseDraft(activeCase.id, lang, doc)} onImportDraft={(lang, doc, expected) => {
        if (caseDraftsRef.current[activeCase.id]?.[lang] !== expected) return false;
        saveCaseDraft(activeCase.id, lang, doc);
        return true;
      }} /> : <div className="showcase-code-pane"><div className="showcase-code-tabs" role="group" aria-label={t(`${activeCase.name} code`, `${activeCase.name} 코드`)}><button type="button" aria-pressed={panel === "react"} onClick={() => setPanel("react")}>React</button><button type="button" onClick={() => setPanel("css")} aria-pressed={panel === "css"}>CSS</button>{caseFiles(activeCase.id).map((file) => <button type="button" key={file.name} onClick={() => setPanel(`file:${file.name}`)} aria-pressed={panel === `file:${file.name}`}>{file.name}</button>)}</div><Code key={`${activeCase.id}-${panel}`} title={panel === "css" || panel.endsWith(".css") ? "css" : "tsx"} locale={locale}>{panel === "css" ? activeCase.css : panel.startsWith("file:") ? caseFiles(activeCase.id).find((file) => `file:${file.name}` === panel)?.source ?? "" : activeCase.source}</Code></div>}
    </section> : <section className="showcase-active wrap" aria-label={t(`${theme.name} live editor`, `${theme.name} 실제 에디터`)} data-theme={theme.id} data-mode={theme.mode}>
      <div className="showcase-active-heading"><div><span className="showcase-concept">{locale === "ko" ? koCopy[theme.id]!.concept : theme.concept}</span><h2>{theme.name}</h2><p>{locale === "ko" ? koCopy[theme.id]!.description : theme.description}</p></div><a href="/docs/core/styling-i18n-performance">{t("Styling guide", "스타일 설정") } <ArrowRight size={15} /></a></div>
      <div className="showcase-switches" role="group" aria-label={t(`${theme.name} view`, `${theme.name} 보기`)}><button type="button" aria-pressed={panel === "preview"} onClick={() => setPanel("preview")}><Eye size={14} /> {t("Preview", "미리보기")}</button><button type="button" aria-pressed={panel !== "preview"} onClick={() => setPanel("react")}><Code2 size={14} /> {t("Code", "코드")}</button><span>{modeLabel}</span></div>
      {panel === "preview" ? selected === "custom" ? <div className="showcase-custom-layout" style={{ "--accent": customTheme.tokens["--jul-editor-accent"], "--accent-soft": `color-mix(in srgb, ${customTheme.tokens["--jul-editor-accent"]} 16%, transparent)`, "--accent-ink": customTheme.tokens["--jul-editor-accent-ink"] } as CSSProperties}><CustomThemeControls value={customConfig} onChange={setCustomConfig} locale={locale} onGetCode={() => setPanel("css")} /><div className="showcase-custom-preview jul-editor-theme--custom"><ShowcaseEditor key={docKey} value={docs[docKey]!} onChange={(doc) => setDocs((previous) => ({ ...previous, [docKey]: doc }))} theme={theme.id} mode={theme.mode} locale={locale} /><div className="showcase-custom-chart" aria-label={t("Chart palette preview", "차트 팔레트 미리보기")}><div><strong>{t("Chart palette", "차트 팔레트")}</strong><span>{t("The eight colors exported in your CSS", "CSS에 포함되는 색상 여덟 가지")}</span></div><div className="showcase-custom-bars" aria-hidden="true">{[42, 72, 55, 88, 64, 78, 50, 66].map((height, index) => <i key={index} style={{ height: `${height}%`, background: `var(--chart-${index + 1})` }} />)}</div></div></div></div> : <ShowcaseEditor key={docKey} value={docs[docKey]!} onChange={(doc) => setDocs((previous) => ({ ...previous, [docKey]: doc }))} theme={theme.id} mode={theme.mode} locale={locale} /> : <div className="showcase-code-pane"><div className="showcase-code-tabs" role="group" aria-label={t(`${theme.name} code`, `${theme.name} 코드`)}><button type="button" aria-pressed={panel === "react"} onClick={() => setPanel("react")}>React</button><button type="button" onClick={() => setPanel("css")} aria-pressed={panel === "css"}>CSS</button></div><Code key={`${theme.id}-${panel}`} title={panel === "css" ? "css" : "tsx"} locale={locale}>{panel === "css" ? css : react}</Code></div>}
      <div className="showcase-card-foot"><span>{t("Live document", "실제 문서")} · {t(`${docs[docKey]?.blocks.length ?? 0} blocks`, `블록 ${docs[docKey]?.blocks.length ?? 0}개`)}</span><div><button type="button" onClick={() => copy(css, t("Theme CSS", "테마 CSS"))}><Copy size={14} /> {t("Copy theme CSS", "테마 CSS 복사")}</button><button type="button" onClick={() => copy(react, t("React component", "React 컴포넌트"))}><Copy size={14} /> {t("Copy React component", "React 컴포넌트 복사")}</button></div><span className="visually-hidden" role="status">{copied}</span></div>
    </section>}
  </main>;
}
