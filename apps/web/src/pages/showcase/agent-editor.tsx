"use client";

// Agent editor showcase: a paper document, a formatting toolbar, and an AI panel whose answers
// arrive as tracked suggestions INSIDE the editor (useEditorSuggestions), reviewable per change or
// all at once, or in a read-only diff view (SuggestionView / DiffCompare). The agent is a mock
// (agent-editor-mock.ts); swap in a real model by implementing AgentAdapter.

import type { Doc, Selection } from "@jul-editor/core";
import { CALLOUT_CSS, calloutPlugin } from "@jul-editor/plugins/callout";
import { ChartView } from "@jul-editor/plugins/chart";
import { computeInlineDiff, DiffCompare, DiffStyles, SUGGESTION_CSS, SuggestionView, useEditorSuggestions } from "@jul-editor/plugins/diff";
import { defaultRenderers, Editor, useEditor } from "@jul-editor/react";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createMockAgent, PRESET_IDS, scopeFromSelection, type AgentAdapter, type AgentLocale, type PresetId } from "./agent-editor-mock.js";
import { agentSampleDoc, agentTranslations } from "./agent-editor-sample.js";
import { AgentToolbar } from "./agent-editor-toolbar.js";
import "./agent-editor.css";

export interface AgentEditorProps {
  locale?: AgentLocale;
}

type ViewMode = "editor" | "review" | "compare";

// One conversation turn. The newest "proposal" turn is live (Accept all / Reject all / view switch);
// once it is decided, replaced by a newer run or applied from Review, it keeps only its outcome.
interface Turn {
  id: number;
  label: string;
  scope: string;
  status: "thinking" | "proposal" | "empty" | "failed" | "cancelled";
  total: number;
  outcome?: { accepted: number; rejected: number };
}

const PRESET_LABELS: Record<PresetId, [string, string]> = {
  fix: ["Fix grammar", "맞춤법 교정"],
  shorter: ["Make shorter", "짧게 줄이기"],
  longer: ["Make longer", "길게 늘리기"],
  translate: ["Translate to Korean", "영어로 번역"],
  checklist: ["Add a checklist", "체크리스트 추가"],
  table: ["Add comparison table", "비교 표 추가"],
  summarize: ["Summarize", "요약하기"],
};

// One shared mock agent. Swap this for your own AgentAdapter to talk to a real model.
const agent: AgentAdapter = createMockAgent({ translations: agentTranslations() });

function AgentWorkspace({ locale, doc, zoom, onZoom, onApply }: { locale: AgentLocale; doc: Doc; zoom: number; onZoom: (z: number) => void; onApply: (doc: Doc) => void }): ReactNode {
  const t = (en: string, ko: string): string => (locale === "ko" ? ko : en);
  const editor = useEditor();
  const [proposed, setProposed] = useState<Doc | null>(null);
  const [view, setView] = useState<ViewMode>("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);
  const baseRef = useRef<Doc | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastSelection = useRef<Selection | null>(null);
  const [scopeLabel, setScopeLabel] = useState<{ whole: boolean; blocks: number }>({ whole: true, blocks: 0 });
  const reviewResult = useRef<Doc | null>(null);

  // Remember the last real selection: clicking the panel moves focus away from the editor.
  useEffect(() => {
    if (!editor) return;
    const update = (): void => {
      const sel = editor.getState().selection;
      if (sel) lastSelection.current = sel;
      const scope = scopeFromSelection(editor.getDoc(), lastSelection.current);
      setScopeLabel({ whole: scope.whole, blocks: scope.ranges.length });
    };
    update();
    return editor.on("selection", update);
  }, [editor]);

  const s = useEditorSuggestions(editor, view === "editor" ? proposed : null, {
    labels: { accept: t("Accept", "수락"), reject: t("Reject", "거절"), toolbar: t("Suggested change", "제안된 변경") },
  });
  // Review / Diff compare against what is still undecided: decisions made in the editor (accepted
  // changes are in `doc` already, rejected ones were dropped from the proposal) must carry over.
  const remaining = s.remainingProposal;
  const switchView = (next: ViewMode): void => {
    if (view === "editor" && next !== "editor" && remaining) setProposed(remaining);
    setView(next);
  };
  const diff = useMemo(() => (proposed ? computeInlineDiff(doc, proposed) : null), [doc, proposed]);
  const pending = view === "editor" ? s.changes.length : (diff?.changes.length ?? 0);

  // Close the live proposal turn: accepted = changes now present in `result` relative to the doc the run
  // started from, rejected = the rest. (The suggestion controller has no per-decision callback.)
  const settle = (result: Doc): void => {
    const base = baseRef.current;
    if (!base) return;
    setTurns((all) => {
      const last = all[all.length - 1];
      if (!last || last.status !== "proposal" || last.outcome) return all;
      const accepted = Math.min(last.total, computeInlineDiff(base, result).changes.length);
      return [...all.slice(0, -1), { ...last, outcome: { accepted, rejected: last.total - accepted } }];
    });
  };
  const patchLast = (patch: Partial<Turn>): void => setTurns((all) => (all.length ? [...all.slice(0, -1), { ...all[all.length - 1]!, ...patch }] : all));

  // Newest message at the bottom: keep the thread scrolled there as turns, progress or the live card change.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, proposed, view]);

  // Everything decided in the editor: leave suggestion mode.
  // The count restarts from 0 whenever the view or the proposal changes (the controller is rebuilt then).
  const prev = useRef(0);
  useEffect(() => { prev.current = 0; }, [view, proposed]);
  useEffect(() => {
    if (view === "editor" && prev.current > 0 && s.changes.length === 0) {
      if (editor) settle(editor.getDoc());
      setProposed(null);
    }
    prev.current = s.changes.length;
  }, [s.changes.length, view]);

  async function run(instruction: string, preset?: PresetId): Promise<void> {
    if (!editor || busy || !instruction.trim()) return;
    if (proposed) settle(editor.getDoc());
    const base = editor.getDoc();
    baseRef.current = base;
    const scope = scopeFromSelection(base, lastSelection.current);
    const ctl = new AbortController();
    abort.current = ctl;
    setProposed(null);
    setView("editor");
    setBusy(t("Thinking…", "생각하는 중…"));
    setTurns((all) => [...all, { id: ++turnId.current, label: instruction.trim(), scope: scopeText, status: "thinking", total: 0 }]);
    try {
      const result = await agent.propose({ instruction, preset, doc: base, scope, locale }, { signal: ctl.signal, onProgress: setBusy });
      const changes = computeInlineDiff(base, result).changes.length;
      if (changes === 0) patchLast({ status: "empty" });
      else { patchLast({ status: "proposal", total: changes }); setProposed(result); }
      setText("");
    } catch (error) {
      patchLast({ status: (error as { name?: string }).name === "AbortError" ? "cancelled" : "failed" });
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void run(text);
  };
  const keep = { "data-jul-editor-keep-selection": "" } as const;
  const scopeText = scopeLabel.whole ? t("Whole document", "문서 전체") : t(`Selection · ${scopeLabel.blocks} block${scopeLabel.blocks === 1 ? "" : "s"}`, `선택 영역 · 블록 ${scopeLabel.blocks}개`);

  return (
    <>
      <style>{`${SUGGESTION_CSS}\n${CALLOUT_CSS}`}</style>
      <DiffStyles />
      <AgentToolbar locale={locale} zoom={zoom} onZoom={onZoom} />
      <div className="agent-body" data-view={view}>
        <div className="agent-canvas">
          <div className="agent-paper-wrap" hidden={view !== "editor"}>
            <div className="agent-paper" style={{ zoom: zoom / 100 }}>
              <Editor.Content className="editor-content" />
            </div>
          </div>
          {view !== "editor" && proposed && (
            <div className="agent-review" data-testid="agent-review">
              {view === "review"
                ? <>
                    <SuggestionView base={doc} proposed={proposed} onResult={(d) => { reviewResult.current = d; }} labels={{ accept: t("Accept", "수락"), reject: t("Reject", "거절"), undo: t("Undo", "되돌리기"), acceptAll: t("Accept all", "모두 수락"), rejectAll: t("Reject all", "모두 거절"), pending: (n) => t(`${n} pending`, `대기 ${n}건`), noChanges: t("No suggested changes", "제안된 변경이 없습니다") }} />
                    <div className="agent-review-foot">
                      <button type="button" className="agent-btn agent-btn--primary" data-testid="agent-apply" onClick={() => { const applied = reviewResult.current ?? doc; settle(applied); onApply(applied); reviewResult.current = null; setProposed(null); setView("editor"); }}>{t("Apply result to document", "결과를 문서에 적용")}</button>
                    </div>
                  </>
                : <DiffCompare before={doc} after={proposed} defaultLayout="inline" labels={{ block: t("Block", "블록"), inline: t("Inline", "인라인") }} />}
            </div>
          )}
        </div>

        <aside className="agent-panel" aria-label={t("AI assistant", "AI 어시스턴트")}>
          <div className="agent-panel-inner">
            <header className="agent-panel-head">
              <Sparkles size={16} aria-hidden="true" />
              <strong>{t("AI Toolkit", "AI 툴킷")}</strong>
              <span className="agent-badge" title={t("No network: answers are deterministic", "네트워크 없음: 결과는 항상 같습니다")}>{t("Mock agent", "모의 에이전트")}</span>
            </header>

            <div className="agent-thread" ref={thread} data-testid="agent-thread" role="log" aria-live="polite" aria-label={t("Conversation", "대화")}>
              {turns.length === 0
                ? <div className="agent-empty" data-testid="agent-empty">
                    <Sparkles size={22} aria-hidden="true" />
                    <p><strong>{t("Ask the AI to edit this document", "AI에게 문서 편집을 맡겨 보세요")}</strong></p>
                    <p>{t("Pick a preset or type an instruction below. Select text first to limit the scope.", "아래에서 프리셋을 고르거나 지시를 입력하세요. 먼저 텍스트를 선택하면 범위가 좁혀집니다.")}</p>
                    <p className="agent-foot">{t("Changes are proposals. Nothing is applied until you accept it, and every decision can be undone.", "모든 변경은 제안일 뿐입니다. 수락하기 전에는 적용되지 않고, 결정은 되돌릴 수 있습니다.")}</p>
                  </div>
                : turns.map((turn, i) => {
                    const live = i === turns.length - 1 && turn.status === "proposal" && !turn.outcome && !!proposed;
                    return (
                      <div className="agent-turn" key={turn.id} data-testid="agent-turn">
                        <div className="agent-msg agent-msg--user" data-testid="agent-msg-user">
                          <p>{turn.label}</p>
                          <small>{turn.scope}</small>
                        </div>
                        <div className="agent-msg agent-msg--ai" data-testid="agent-msg-ai" data-status={turn.status}>
                          {turn.status === "thinking" && (
                            <div className="agent-thinking" role="status" data-testid="agent-thinking">
                              <Loader2 size={14} className="agent-spin" aria-hidden="true" />
                              <span>{busy ?? t("Thinking…", "생각하는 중…")}</span>
                              <button type="button" className="agent-link" onClick={() => abort.current?.abort()}>{t("Cancel", "취소")}</button>
                            </div>
                          )}
                          {turn.status === "empty" && <p className="agent-notice" role="status">{t("The agent found nothing to change here.", "이 범위에서 바꿀 내용이 없습니다.")}</p>}
                          {turn.status === "failed" && <p className="agent-notice" role="status">{t("The agent failed. Try again.", "에이전트 요청에 실패했습니다. 다시 시도하세요.")}</p>}
                          {turn.status === "cancelled" && <p className="agent-notice" role="status">{t("Cancelled.", "취소되었습니다.")}</p>}
                          {turn.status === "proposal" && turn.outcome && (
                            <p className="agent-outcome" data-testid="agent-outcome">
                              {t(`Accepted ${turn.outcome.accepted}, rejected ${turn.outcome.rejected}`, `수락 ${turn.outcome.accepted}건, 거절 ${turn.outcome.rejected}건`)}
                            </p>
                          )}
                          {live && (
                            <section className="agent-result" aria-label={t("Suggestions", "제안")}>
                              <p className="agent-count" data-testid="agent-count">{t(`${pending} change${pending === 1 ? "" : "s"} suggested`, `변경 ${pending}건 제안됨`)}</p>
                              {view === "editor" && (
                                <div className="agent-actions">
                                  <button type="button" className="agent-btn agent-btn--primary" data-testid="agent-accept-all" disabled={!pending} onClick={s.acceptAll}><Check size={14} /> {t("Accept all", "모두 수락")}</button>
                                  <button type="button" className="agent-btn" data-testid="agent-reject-all" disabled={!pending} onClick={s.rejectAll}><X size={14} /> {t("Reject all", "모두 거절")}</button>
                                </div>
                              )}
                              <div className="agent-views" role="group" aria-label={t("Review view", "검토 보기")}>
                                {([["editor", "In editor", "문서 안"], ["review", "Review", "검토"], ["compare", "Diff", "비교"]] as const).map(([id, en, ko]) => (
                                  <button key={id} type="button" data-view={id} aria-pressed={view === id} onClick={() => switchView(id)}>{t(en, ko)}</button>
                                ))}
                              </div>
                            </section>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>

            <div className="agent-composer" data-testid="agent-composer">
              <div className="agent-presets" role="group" aria-label={t("Presets", "프리셋")}>
                {PRESET_IDS.map((id) => (
                  <button key={id} type="button" className="agent-chip" data-preset={id} {...keep} disabled={!!busy} onClick={() => void run(PRESET_LABELS[id][locale === "ko" ? 1 : 0], id)}>
                    {PRESET_LABELS[id][locale === "ko" ? 1 : 0]}
                  </button>
                ))}
              </div>
              <form className="agent-prompt" onSubmit={submit}>
                <p className="agent-scope" data-testid="agent-scope" data-whole={scopeLabel.whole || undefined}>{scopeText}</p>
                <div className="agent-field">
                  <textarea className="agent-input" rows={2} value={text} placeholder={t("Select text, then tell the AI what to do…", "텍스트를 선택하고 AI에게 지시를 입력하세요…")} aria-label={t("Instruction", "지시")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void run(text); } }} />
                  <button type="submit" className="agent-send" disabled={!!busy || !text.trim()} aria-label={t("Send", "보내기")}><Send size={15} /></button>
                </div>
              </form>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function AgentEditor({ locale = "en" }: AgentEditorProps) {
  // One document per locale so edits survive switching the site language back and forth.
  const [docs, setDocs] = useState<Record<AgentLocale, Doc>>(() => ({ en: agentSampleDoc("en"), ko: agentSampleDoc("ko") }));
  const [zoom, setZoom] = useState(100);
  const doc = docs[locale];
  const setDoc = (next: Doc): void => setDocs((d) => ({ ...d, [locale]: next }));
  return (
    <div className="showcase-agent">
      <Editor key={locale} value={doc} onChange={setDoc} locale={locale} renderers={{ ...defaultRenderers, chart: ChartView }} className="editor-instance">
        <Editor.Plugin {...calloutPlugin} />
        <AgentWorkspace locale={locale} doc={doc} zoom={zoom} onZoom={setZoom} onApply={setDoc} />
      </Editor>
    </div>
  );
}
