import { fromJSON, type Doc } from "@jul-editor/core";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { diffDocs, DiffView } from "@jul-editor/plugins/diff";
import { ArrowRight, Check, CircleAlert, Copy, FileText, RotateCcw } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { FullEditorCanvas } from "./full-editor-canvas.js";
import { useSiteSettings } from "../../app/site-settings.js";
import { compareRows } from "../../lib/diff-rows.js";
import { workspaceRegistry } from "./workspace-registry.js";
import "../../styles/playground.css";
import "../../styles/unified-workspace.css";

type Locale = "en" | "ko";
type Format = "markdown" | "html" | "json";
type View = "editor" | Format | "diff";
type Drafts = Record<Locale, Partial<Record<Format, string>>>;

export interface UnifiedWorkspaceProps {
  createDocument: (locale: Locale) => Doc;
  createBaseline: (locale: Locale) => Doc;
  variant?: "home" | "playground";
  fileName?: string;
}

const views: View[] = ["editor", "markdown", "html", "json", "diff"];

function isFormat(view: View): view is Format {
  return view === "markdown" || view === "html" || view === "json";
}

function outputFor(doc: Doc, format: Format) {
  if (format === "html") return { text: toHTML(doc, { registry: workspaceRegistry }), notes: [] as string[] };
  if (format === "json") return { text: JSON.stringify(doc, null, 2), notes: [] as string[] };
  const result = toMarkdown(doc, { registry: workspaceRegistry });
  return { text: result.markdown, notes: result.lossy.map((entry) => entry.type + ": " + entry.reason) };
}

/** One document surface, with alternate views of the same live blocks. */
export function UnifiedWorkspace({ createDocument, createBaseline, variant = "playground", fileName }: UnifiedWorkspaceProps) {
  const { locale, t } = useSiteSettings();
  const id = useId();
  const [docs, setDocs] = useState<Record<Locale, Doc>>(() => ({ en: createDocument("en"), ko: createDocument("ko") }));
  const [baselines, setBaselines] = useState<Record<Locale, Doc>>(() => ({ en: createBaseline("en"), ko: createBaseline("ko") }));
  const [drafts, setDrafts] = useState<Drafts>({ en: {}, ko: {} });
  const [view, setView] = useState<View>("editor");
  const [diffMode, setDiffMode] = useState<"split" | "inline">("split");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const doc = docs[locale];
  const baseline = baselines[locale];
  const format = isFormat(view) ? view : null;
  const output = useMemo(() => format ? outputFor(doc, format) : null, [doc, format]);
  // Only changed source needs storage; clean views always read the live document.
  const savedDraft = format ? drafts[locale][format] : undefined;
  const draft = savedDraft ?? output?.text ?? "";
  const dirty = savedDraft !== undefined;
  const tree = useMemo(() => view === "diff" ? diffDocs(baseline, doc, workspaceRegistry) : null, [view, baseline, doc]);
  const stats = tree?.stats ?? { inserted: 0, deleted: 0, modified: 0, moved: 0 };
  const rows = useMemo(() => view === "diff" && diffMode === "split" ? compareRows(baseline, doc, workspaceRegistry) : [], [view, diffMode, baseline, doc]);
  const changed = stats.inserted + stats.deleted + stats.modified + stats.moved;
  const shownFileName = fileName ?? "document.md";

  function updateDoc(next: Doc) {
    setDocs((previous) => ({ ...previous, [locale]: next }));
  }

  function reset() {
    setDocs((previous) => ({ ...previous, [locale]: createDocument(locale) }));
    setBaselines((previous) => ({ ...previous, [locale]: createBaseline(locale) }));
    setDrafts((previous) => ({ ...previous, [locale]: {} }));
    setView("editor");
    setError("");
    setMessage(t("Sample restored.", "예제를 다시 불러왔습니다."));
  }

  function selectView(next: View) {
    setView(next);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = views.indexOf(view);
    const next = event.key === "ArrowRight" ? (current + 1) % views.length
      : event.key === "ArrowLeft" ? (current + views.length - 1) % views.length
      : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectView(views[next]!);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  function editSource(next: string) {
    if (!format) return;
    setDrafts((previous) => ({ ...previous, [locale]: { ...previous[locale], [format]: next } }));
    setMessage("");
    setError("");
  }

  function importSource() {
    if (!format) return;
    try {
      let next: Doc;
      let notes: string[] = [];
      if (format === "markdown") {
        const parsed = fromMarkdown(draft, { registry: workspaceRegistry });
        next = parsed.doc;
        notes = parsed.lossy.map((entry) => entry.type + ": " + entry.reason);
      } else if (format === "html") {
        const parsed = fromHTML(draft, { registry: workspaceRegistry });
        next = parsed.doc;
        notes = parsed.lossy.map((entry) => entry.type + ": " + entry.reason);
        if (parsed.pendingUploads.length) notes.push(t(`${parsed.pendingUploads.length} image upload(s) need an upload handler in your app`, `이미지 ${parsed.pendingUploads.length}개를 업로드하려면 앱에 업로드 처리 함수를 연결해야 합니다`));
      } else {
        const raw: unknown = JSON.parse(draft);
        if (!raw || typeof raw !== "object" || !Array.isArray((raw as { blocks?: unknown }).blocks)) throw new Error(t("JSON must contain a document object with a blocks array.", "JSON에 blocks 배열이 있는 문서 객체가 필요합니다."));
        const parsed = fromJSON(raw, workspaceRegistry);
        next = parsed.doc;
        notes = parsed.issues.map((issue) => issue.message);
      }
      updateDoc(next);
      setDrafts((previous) => ({ ...previous, [locale]: { ...previous[locale], [format]: undefined } }));
      setView("editor");
      setError("");
      setMessage(notes.length ? t(`Imported with ${notes.length} conversion note(s):`, `소스를 적용했습니다. 변환 참고 사항 ${notes.length}개:`) + " " + notes.join(" · ") : t("Source applied to the document.", "수정한 소스를 문서에 적용했습니다."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not read this source. Check its format and try again.", "소스를 읽을 수 없습니다. 형식을 확인한 뒤 다시 시도하세요."));
      setMessage("");
    }
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(draft);
      setMessage(t("Source copied.", "소스를 복사했습니다."));
      setError("");
    } catch {
      setError(t("Clipboard access failed. Select the source and copy it manually.", "클립보드에 접근할 수 없습니다. 소스를 선택해 직접 복사하세요."));
    }
  }

  return <section className="unified-workspace playground-panel" data-variant={variant} aria-label={t("Document workspace", "문서 작업 공간")}>
    <div className="window-top unified-window-top">
      <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
      <strong>{shownFileName}</strong>
      <span className="unified-window-actions"><span className="window-live"><i /> {dirty ? t("UNAPPLIED SOURCE", "적용 전 소스") : t("READY TO EDIT", "편집 가능")}</span><button className="workspace-action" type="button" onClick={reset}><RotateCcw size={15} /> {t("Restore sample", "예제 다시 불러오기")}</button></span>
    </div>
    <div className="unified-view-tabs" role="tablist" aria-label={t("Document view", "문서 보기")} onKeyDown={handleTabKeyDown}>
      {views.map((item) => <button key={item} id={`${id}-${item}-tab`} type="button" role="tab" aria-selected={view === item} aria-controls={`${id}-${item === "editor" ? "editor" : item === "diff" ? "diff" : "source"}-panel`} tabIndex={view === item ? 0 : -1} onClick={() => selectView(item)}>{item === "editor" ? t("Editor", "에디터") : item === "diff" ? t("Diff", "비교") : item === "markdown" ? "Markdown" : item.toUpperCase()}</button>)}
    </div>
    <div id={`${id}-editor-panel`} className="unified-editor-view" role="tabpanel" aria-labelledby={`${id}-editor-tab`} hidden={view !== "editor"}>
      <FullEditorCanvas value={doc} onChange={updateDoc} />
      <div className="panel-foot"><span>{t("Type / for blocks · Drag to reorder · Use @ and # to mention or tag", "/로 블록 추가 · 드래그로 순서 변경 · @와 #으로 멘션·태그 추가")}</span><span>{t(`${doc.blocks.length} blocks`, `블록 ${doc.blocks.length}개`)}</span></div>
    </div>
    {format && <div id={`${id}-source-panel`} className="unified-source-view playground-source-panel" role="tabpanel" aria-labelledby={`${id}-${format}-tab`}>
      <div className="unified-source-meta"><span className="panel-label">{format === "markdown" ? "MARKDOWN" : format.toUpperCase()} {t("SOURCE", "소스")}</span><span className="source-live"><i /> {dirty ? t("Not applied yet", "아직 적용 전") : t("Up to date", "현재 문서 반영")}</span></div>
      <label className="visually-hidden" htmlFor="playground-source">{t(`Edit ${format} source`, `${format} 소스 편집`)}</label>
      <textarea id="playground-source" spellCheck={false} value={draft} onChange={(event) => editSource(event.target.value)} />
      <div className="source-actions"><button type="button" className="button button-primary button-small" onClick={importSource}>{t("Apply source to document", "소스를 문서에 적용")} <ArrowRight size={15} /></button><button type="button" className="button button-outline button-small" onClick={copySource}>{message === t("Source copied.", "소스를 복사했습니다.") ? <Check size={15} /> : <Copy size={15} />} {t("Copy source", "소스 복사")}</button></div>
      <div className="conversion-message" role="status" aria-live="polite">{error ? <span className="error-message"><CircleAlert size={15} /> {error}</span> : message ? <span>{message}</span> : output?.notes.length ? <span><CircleAlert size={15} /> {t(`${output.notes.length} conversion note(s):`, `변환 참고 사항 ${output.notes.length}개:`)} {output.notes[0]}</span> : <span>{t("This source reflects the current document. Edit it, then apply to update the editor.", "현재 문서를 변환한 소스입니다. 수정한 뒤 적용하면 에디터에 반영됩니다.")}</span>}</div>
    </div>}
    {view === "diff" && <section id={`${id}-diff-panel`} className="playground-diff-panel" role="tabpanel" aria-labelledby={`${id}-diff-tab`}>
      <aside className="playground-diff-files"><span>{t("DOCUMENT", "문서")}</span><div><FileText size={14} /> {shownFileName}</div><small>{t("Saved version vs. current", "저장한 버전과 현재 문서")}</small></aside>
      <div className="playground-diff-main">
        <div className="playground-diff-actions"><div className="playground-diff-view-toggle" role="group" aria-label={t("Diff layout", "비교 보기 방식")}><button type="button" aria-pressed={diffMode === "split"} onClick={() => setDiffMode("split")}>{t("Side by side", "나란히")}</button><button type="button" aria-pressed={diffMode === "inline"} onClick={() => setDiffMode("inline")}>{t("Changed blocks", "변경 블록만")}</button></div><div className="playground-diff-baseline"><button type="button" onClick={() => setBaselines((previous) => ({ ...previous, [locale]: doc }))}>{t("Save current as baseline", "현재 문서를 기준으로 저장")}</button><button type="button" onClick={() => setBaselines((previous) => ({ ...previous, [locale]: createBaseline(locale) }))}>{t("Restore sample baseline", "예제 기준 다시 불러오기")}</button></div></div>
        <div className="playground-diff-stats" aria-label={t("Diff summary", "변경 요약")}><span data-kind="insert">+{stats.inserted} {t("inserted", "추가")}</span><span data-kind="delete">−{stats.deleted} {t("deleted", "삭제")}</span><span data-kind="modify">~{stats.modified} {t("modified", "수정")}</span><span data-kind="move">↕{stats.moved} {t("moved", "이동")}</span></div>
        {changed === 0 && <p className="playground-diff-empty">{t("No changes from the saved version. Edit a block, or restore the sample baseline to see the difference.", "저장한 버전과 차이가 없습니다. 블록을 수정하거나 예제 기준을 다시 불러와 비교해 보세요.")}</p>}
        {diffMode === "split" ? <div className="playground-diff-scroll"><div className="playground-diff-split"><div className="playground-diff-side-head">{t("Before", "이전")}</div><div className="playground-diff-side-head">{t("After", "이후")}</div>{rows.map((row, index) => <div className="playground-diff-pair" key={index}><div className="playground-diff-line" data-diff-side="before" data-diff-status={row.before === undefined ? "same" : row.status} data-diff-line-number={row.beforeNo}><span>{row.beforeNo ?? ""}</span><b>{row.before === undefined || row.status === "same" ? "" : "−"}</b><code>{row.before ?? " "}</code></div><div className="playground-diff-line" data-diff-side="after" data-diff-status={row.after === undefined ? "same" : row.status} data-diff-line-number={row.afterNo}><span>{row.afterNo ?? ""}</span><b>{row.after === undefined || row.status === "same" ? "" : "+"}</b><code>{row.after ?? " "}</code></div></div>)}</div></div> : <DiffView before={baseline} after={doc} registry={workspaceRegistry} mode="changes" className="playground-diff-view" />}
      </div>
    </section>}
    {!format && (message || error) && <div className="unified-feedback" role={error ? "alert" : "status"} aria-live="polite">{error ? <><CircleAlert size={15} /> {error}</> : message}</div>}
  </section>;
}

export default UnifiedWorkspace;
