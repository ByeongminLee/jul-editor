"use client";

import type { Doc } from "@jul-editor/core";
import { PageBreakView, PagedEditor, PageSettingsPanel, clampZoom, normalizeSettings, pageBreak, pageGeometryPx } from "@jul-editor/plugins/pages";
import type { DocumentSettings } from "@jul-editor/plugins/pages";
import { defaultRenderers, Editor } from "@jul-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DocxToolbar } from "./docx-editor-toolbar.js";
import { LOGO_SRC, buildDocx, downloadBlob, readDocx } from "./docx-editor-io.js";
import { docxSampleDoc } from "./docx-editor-sample.js";
import "./docx-editor.css";

export interface DocxEditorProps {
  locale?: "en" | "ko";
}

// DOCX editor showcase: a Word-like document editor built from
//   - @jul-editor/plugins/pages: PagedEditor (paper sheets, header/footer with {page}/{total}),
//     ZoomControl, PageSettingsPanel, the pageBreak block, exportDocx / importDocx
//   - core marks fontFamily / fontSize and the block prop textAlign (docx-editor-commands.ts)
//   - `docx` and `mammoth`, injected into the plugin lazily (docx-editor-io.ts)
const blocks = [pageBreak];
const renderers = { ...defaultRenderers, pageBreak: PageBreakView };

const headerText = (locale: "en" | "ko") => (locale === "ko" ? "비밀유지계약서" : "Non-disclosure agreement");
const initialSettings = (locale: "en" | "ko"): DocumentSettings => normalizeSettings({
  header: { enabled: true, text: headerText(locale), align: "left", logoSrc: LOGO_SRC, logoHeight: 7 },
  footer: { enabled: true, text: "{page} / {total}", align: "center" },
});

export function DocxEditor({ locale = "en" }: DocxEditorProps) {
  const t = (en: string, ko: string) => (locale === "ko" ? ko : en);
  const [doc, setDoc] = useState<Doc>(() => docxSampleDoc(locale));
  const docRef = useRef(doc);
  const [settings, setSettings] = useState<DocumentSettings>(() => initialSettings(locale));
  const [userZoom, setUserZoom] = useState<number | null>(null);
  const [fitZoom, setFitZoom] = useState(100);
  const [lineSpacing, setLineSpacing] = useState(1.15);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Switching the site language swaps the sample and the default header text (an edited header is kept).
  const lastLocale = useRef(locale);
  useEffect(() => {
    const prev = lastLocale.current;
    if (prev === locale) return;
    lastLocale.current = locale;
    const next = docxSampleDoc(locale);
    docRef.current = next;
    setDoc(next);
    setSettings((s) => (s.header.text === headerText(prev) ? { ...s, header: { ...s.header, text: headerText(locale) } } : s));
  }, [locale]);

  // Phones: with no explicit zoom the sheet scales down to the canvas width (never above 100%).
  const pageWidth = useMemo(() => pageGeometryPx(settings).pageWidth, [settings]);
  useEffect(() => {
    const el = canvasRef.current?.querySelector<HTMLElement>(".jul-paged");
    if (!el) return;
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      setFitZoom(Math.min(100, Math.floor(((el.clientWidth - pad * 2) / pageWidth) * 100)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth, settingsOpen]);
  const zoom = userZoom ?? clampZoom(fitZoom);

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus((s) => (s === message ? "" : s)), 6000);
  };

  async function onExport() {
    setBusy(true);
    try {
      const out = await buildDocx(docRef.current, settings);
      downloadBlob(out.blob, locale === "ko" ? "비밀유지계약서.docx" : "non-disclosure-agreement.docx");
      flash(t(`Exported ${(out.bytes / 1024).toFixed(1)} KB (${out.validZip ? "valid .docx zip" : "zip check failed"}${out.lossy ? `, ${out.lossy} block(s) simplified` : ""}).`, `${(out.bytes / 1024).toFixed(1)} KB를 내보냈습니다 (${out.validZip ? ".docx 압축 구조 확인" : "압축 구조 확인 실패"}${out.lossy ? `, 블록 ${out.lossy}개 단순화` : ""}).`));
    } catch (error) {
      flash(t("Export failed: ", "내보내기 실패: ") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(file: File) {
    setBusy(true);
    try {
      const { doc: next, messages } = await readDocx(file);
      docRef.current = next;
      setDoc(next);
      setUserZoom(null);
      flash(t(`Imported ${file.name}${messages.length ? ` (${messages.length} converter notes)` : ""}. Page size and header are not read from .docx files.`, `${file.name}을 가져왔습니다${messages.length ? ` (변환 메모 ${messages.length}건)` : ""}. 용지 크기와 머리글은 .docx에서 읽지 않습니다.`));
    } catch (error) {
      flash(t("Import failed: ", "가져오기 실패: ") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  return <div className="showcase-docx" data-docx-theme={dark ? "dark" : "light"} style={{ "--docx-line-height": lineSpacing } as React.CSSProperties}>
    <Editor key={locale} value={doc} onChange={(next) => { docRef.current = next; setDoc(next); }} blocks={blocks} renderers={renderers} locale={locale} placeholder={t("Start writing…", "글을 써 보세요…")} className="editor-instance">
      <DocxToolbar
        locale={locale} zoom={zoom} onZoom={(z) => setUserZoom(clampZoom(z))}
        lineSpacing={lineSpacing} onLineSpacing={setLineSpacing}
        settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((v) => !v)}
        dark={dark} onToggleTheme={() => setDark((v) => !v)}
        onImport={() => fileRef.current?.click()} onExport={onExport} onPrint={() => window.print()} busy={busy}
      />
      <input ref={fileRef} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-testid="docx-import-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = ""; }} />
      <div className="docx-body">
        <div className="docx-canvas-wrap" ref={canvasRef}>
          <PagedEditor settings={settings} zoom={zoom} onPageCountChange={setPages} className="docx-canvas" classNames={{ sheet: "docx-sheet" }}>
            <Editor.Content className="editor-content" />
          </PagedEditor>
          <div className="docx-statusbar" role="status" aria-live="polite">
            <span data-testid="docx-pagecount">{t(`${pages} page${pages === 1 ? "" : "s"}`, `${pages}쪽`)}</span>
            {status && <span className="docx-status">{status}</span>}
          </div>
        </div>
        {settingsOpen && <aside className="docx-settings" aria-label={t("Page settings", "페이지 설정")}>
          <h3>{t("Page settings", "페이지 설정")}</h3>
          <PageSettingsPanel value={settings} onChange={setSettings} locale={locale} />
        </aside>}
      </div>
    </Editor>
  </div>;
}
