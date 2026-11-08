// Mock AI agent for the Agent editor showcase. NO network: every "model" answer is a deterministic
// text transformation, so the demo (and its e2e test) behaves the same on every run.
//
// The seam is `AgentAdapter`. A real integration implements the same interface and returns the
// document the model wants, nothing else; the editor never trusts the agent to edit in place:
//
//   const realAgent: AgentAdapter = {
//     async propose(req, { signal, onProgress }) {
//       // 1. send req.instruction + the scoped blocks (see req.scope) to your model endpoint
//       //    (stream tokens, call onProgress("Drafting") as chunks arrive)
//       // 2. parse the answer back into a Doc, KEEPING the ids of blocks that still exist so the
//       //    diff can match them; give new blocks fresh ids (newId())
//       return proposedDoc;
//     },
//   };
//
// The returned Doc is only a PROPOSAL: the page feeds it to useEditorSuggestions, which draws it
// as tracked suggestions inside the editor and applies each decision as one undoable transaction.

import type { Block, Doc, Inline, Mark, Selection } from "@jul-editor/core";
import { newId } from "@jul-editor/core";

export type AgentLocale = "en" | "ko";

export const PRESET_IDS = ["fix", "shorter", "longer", "translate", "checklist", "table", "summarize"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Which text the agent may touch: a character range per block (`whole` = no selection, whole doc). */
export interface AgentScope {
  whole: boolean;
  ranges: { blockId: string; from: number; to: number }[];
}

export interface AgentRequest {
  /** Free text from the prompt box, or the preset label. */
  instruction: string;
  /** Set when the user clicked a preset chip (skips keyword routing). */
  preset?: PresetId;
  /** The editor document at request time. */
  doc: Doc;
  scope: AgentScope;
  locale: AgentLocale;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  /** Called with a short status ("Reading", "Drafting", "Comparing") while the agent works. */
  onProgress?: (stage: string) => void;
}

/** Where a real model plugs in. See the header comment. */
export interface AgentAdapter {
  propose(req: AgentRequest, opts?: AgentRunOptions): Promise<Doc>;
}

// ---- scope ----------------------------------------------------------------------------------------

function flat(blocks: Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.children) flat(b.children, out);
  }
  return out;
}

const inlineLen = (content: Inline[] | undefined): number => (content ?? []).reduce((n, i) => n + (i.type === "text" ? (i as { text: string }).text.length : 1), 0);

/** Pre-order list of block ids. */
export function blockIds(doc: Doc): string[] {
  return flat(doc.blocks).map((b) => b.id);
}

/** Scope from an editor selection. A caret (or no selection) means the whole document. */
export function scopeFromSelection(doc: Doc, selection: Selection | null | undefined): AgentScope {
  const all = flat(doc.blocks);
  const whole = (): AgentScope => ({ whole: true, ranges: all.filter((b) => b.content !== undefined).map((b) => ({ blockId: b.id, from: 0, to: inlineLen(b.content) })) });
  if (!selection) return whole();
  const index = new Map(all.map((b, i) => [b.id, i] as const));
  const lenOf = (id: string): number => inlineLen(all[index.get(id) ?? -1]?.content);
  if (selection.type === "block") {
    const ranges = selection.ids.filter((id) => all[index.get(id) ?? -1]?.content !== undefined).map((id) => ({ blockId: id, from: 0, to: lenOf(id) }));
    return ranges.length ? { whole: false, ranges } : whole();
  }
  if (selection.type === "cells") return whole();
  const a = selection.anchor;
  const f = selection.focus;
  const ai = index.get(a.blockId);
  const fi = index.get(f.blockId);
  if (ai === undefined || fi === undefined) return whole();
  if (ai === fi && a.offset === f.offset) return whole();
  const [start, end] = ai < fi || (ai === fi && a.offset <= f.offset) ? [a, f] : [f, a];
  const si = index.get(start.blockId)!;
  const ei = index.get(end.blockId)!;
  const ranges: AgentScope["ranges"] = [];
  for (let i = si; i <= ei; i++) {
    const b = all[i]!;
    if (b.content === undefined) continue;
    ranges.push({ blockId: b.id, from: i === si ? start.offset : 0, to: i === ei ? end.offset : inlineLen(b.content) });
  }
  return ranges.length ? { whole: false, ranges } : whole();
}

// ---- inline helpers -------------------------------------------------------------------------------

const textOf = (content: Inline[]): string => content.map((i) => (i.type === "text" ? (i as { text: string }).text : "￼")).join("");

/** Replaces [from, to) of `content` with `text`, taking the marks of the first replaced character. */
function replaceRange(content: Inline[], from: number, to: number, text: string): Inline[] {
  const before: Inline[] = [];
  const after: Inline[] = [];
  let marks: Mark[] | undefined;
  let marksTaken = false;
  let pos = 0;
  for (const inl of content) {
    const len = inl.type === "text" ? (inl as { text: string }).text.length : 1;
    const a = pos;
    const b = pos + len;
    pos = b;
    if (inl.type !== "text") {
      if (b <= from) before.push(inl);
      else if (a >= to) after.push(inl); // a mention inside the replaced range is dropped
      continue;
    }
    const t = inl as { text: string; marks?: Mark[] };
    const piece = (s: string): Inline => (t.marks?.length ? { type: "text", text: s, marks: t.marks } : { type: "text", text: s });
    if (a < from) before.push(piece(t.text.slice(0, Math.min(len, from - a))));
    if (!marksTaken && b > from) {
      marks = t.marks;
      marksTaken = true;
    }
    if (b > to) after.push(piece(t.text.slice(Math.max(0, to - a))));
  }
  const mid: Inline[] = text ? [marks?.length ? { type: "text", text, marks } : { type: "text", text }] : [];
  const merged: Inline[] = [];
  for (const i of [...before, ...mid, ...after]) {
    const last = merged[merged.length - 1];
    if (last && last.type === "text" && i.type === "text" && JSON.stringify((last as { marks?: Mark[] }).marks ?? null) === JSON.stringify((i as { marks?: Mark[] }).marks ?? null)) {
      merged[merged.length - 1] = { ...last, text: (last as { text: string }).text + (i as { text: string }).text } as Inline;
    } else merged.push(i);
  }
  return merged;
}

function mapBlocks(blocks: Block[], fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    const next = fn(b);
    return b.children ? { ...next, children: mapBlocks(b.children, fn) } : next;
  });
}

const PROSE = new Set(["paragraph", "bulletListItem", "orderedListItem", "todoListItem", "quote", "callout"]);

/** Applies `fn` to the in-scope text of every block `accept` allows. Untouched blocks keep identity. */
function mapScopedText(doc: Doc, scope: AgentScope, fn: (text: string, b: Block) => string, accept: (b: Block) => boolean = () => true): Doc {
  const byId = new Map(scope.ranges.map((r) => [r.blockId, r] as const));
  return {
    ...doc,
    blocks: mapBlocks(doc.blocks, (b) => {
      const r = byId.get(b.id);
      if (!r || b.content === undefined || !accept(b)) return b;
      const content = b.content;
      const cur = textOf(content).slice(r.from, r.to);
      const next = fn(cur, b);
      if (next === cur) return b;
      return { ...b, content: replaceRange(content, r.from, r.to, next) };
    }),
  };
}

// ---- text transformations -------------------------------------------------------------------------

const hasHangul = (s: string): boolean => /[ㄱ-ㆎ가-힣]/.test(s);

const EN_FIXES: [RegExp, string][] = [
  [/\bteh\b/gi, "the"],
  [/\brecieve(s|d)?\b/gi, "receive$1"],
  [/\bdefinately\b/gi, "definitely"],
  [/\bseperate\b/gi, "separate"],
  [/\boccured\b/gi, "occurred"],
  [/\bdont\b/gi, "don't"],
  [/\bcant\b/gi, "can't"],
  [/\bits a\b/gi, "it's a"],
  [/\bi\b/g, "I"],
  [/\bI'm an AI Toolkit demo doc\b/g, "I'm an AI Toolkit demo doc"],
  [/\bthere is many\b/gi, "there are many"],
  [/\bless changes\b/gi, "fewer changes"],
];
const KO_FIXES: [RegExp, string][] = [
  [/되요/g, "돼요"],
  [/안되/g, "안 돼"],
  [/할수/g, "할 수"],
  [/몇일/g, "며칠"],
  [/금새/g, "금세"],
  [/왠만하면/g, "웬만하면"],
  [/않되/g, "안 돼"],
  [/문제가 되었다/g, "문제가 됐다"],
];

function fixGrammar(text: string): string {
  let out = text;
  for (const [re, to] of hasHangul(out) ? KO_FIXES : EN_FIXES) out = out.replace(re, to);
  out = out.replace(/ {2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:])(?=\S)/g, "$1 ");
  if (!hasHangul(out)) out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return out;
}

const FILLERS_EN = /\b(very|really|just|basically|actually|simply|quite|in fact)\s+/gi;

function sentences(text: string): string[] {
  return text.match(/[^.!?。]+[.!?。]*\s*/g)?.map((s) => s) ?? [text];
}

function shorten(text: string): string {
  const parts = sentences(text);
  let out = parts.length > 1 ? parts[0]!.trim() : text;
  out = out.replace(FILLERS_EN, "").replace(/\bin order to\b/gi, "to").replace(/\bthat lets you\b/gi, "to");
  out = out.replace(/\s+([,.;:!?])/g, "$1").replace(/ {2,}/g, " ");
  return out.length < text.length ? out : text;
}

const EXTEND_EN = " This also makes the result easier to review, compare, and share with the rest of the team.";
const EXTEND_KO = " 이렇게 하면 결과를 검토하고 비교하고 팀과 공유하기가 한결 쉬워집니다.";

function lengthen(text: string): string {
  if (!text.trim()) return text;
  return text + (hasHangul(text) ? EXTEND_KO : EXTEND_EN);
}

const formalize = (text: string): string => hasHangul(text) ? text.replace(/해요([.!?]?)$/g, "합니다$1").replace(/에요([.!?]?)$/g, "입니다$1") : text.replace(/\b(\w+)n't\b/gi, "$1 not").replace(/\bdon't\b/gi, "do not").replace(/\bcan't\b/gi, "cannot").replace(/\bI'm\b/g, "I am").replace(/\bit's\b/gi, "it is");

// A tiny phrase table for blocks without a sample translation; anything else gets a language marker.
const EN_TO_KO: [RegExp, string][] = [[/\bdocument\b/gi, "문서"], [/\bsuggestion(s)?\b/gi, "제안"], [/\bsummary\b/gi, "요약"], [/\bchecklist\b/gi, "체크리스트"], [/\btable\b/gi, "표"], [/\bAI\b/g, "AI"]];
const KO_TO_EN: [RegExp, string][] = [[/문서/g, "document"], [/제안/g, "suggestion"], [/요약/g, "summary"], [/체크리스트/g, "checklist"], [/표/g, "table"]];

function translateFallback(text: string, to: AgentLocale): string {
  if (!text.trim()) return text;
  if (to === "ko" && hasHangul(text)) return text;
  if (to === "en" && !hasHangul(text)) return text;
  let out = text;
  for (const [re, w] of to === "ko" ? EN_TO_KO : KO_TO_EN) out = out.replace(re, w);
  return to === "ko" ? `${out} (번역 예시)` : `${out} (sample translation)`;
}

// ---- block builders -------------------------------------------------------------------------------

const para = (text: string, type = "paragraph", props: Record<string, never> | Record<string, string | number | boolean> = {}): Block => ({ id: newId(), type, props, content: [{ type: "text", text }] });
const cell = (text: string): Block => ({ id: newId(), type: "tableCell", props: {}, content: text ? [{ type: "text", text }] : [] });

function checklistBlocks(ko: boolean): Block[] {
  const items = ko ? ["초안을 한 번 더 읽어 본다", "수치와 이름을 확인한다", "팀원에게 검토를 요청한다", "수정 사항을 반영해 확정한다"] : ["Re-read the draft once more", "Check names and figures", "Ask a teammate to review", "Apply the feedback and finalize"];
  return [para(ko ? "확인할 일" : "Checklist", "heading", { level: 3 }), ...items.map((t) => para(t, "todoListItem", { checked: false }))];
}

function comparisonTable(ko: boolean): Block {
  const rows = ko
    ? [["", "직접 편집", "AI 제안"], ["속도", "느림", "빠름"], ["통제", "완전함", "수락 또는 거절"], ["추적", "수동", "변경마다 기록"]]
    : [["", "Edit by hand", "AI suggestion"], ["Speed", "Slow", "Fast"], ["Control", "Full", "Accept or reject"], ["Tracking", "Manual", "Every change listed"]];
  return { id: newId(), type: "table", props: { headerRow: true }, children: rows.map((r) => ({ id: newId(), type: "tableRow", props: {}, children: r.map(cell) })) };
}

function chartBlock(ko: boolean): Block {
  return { id: newId(), type: "chart", props: { kind: "bar", source: { type: "inline", csv: ko ? "분기,제안 수락률\n1분기,42\n2분기,58\n3분기,71\n4분기,83" : "Quarter,Acceptance rate\nQ1,42\nQ2,58\nQ3,71\nQ4,83" } } };
}

/** Inserts `blocks` after the last in-scope block's top-level ancestor, or at the end of the document. */
function insertAfterScope(doc: Doc, scope: AgentScope, blocks: Block[]): Doc {
  const last = scope.whole ? undefined : scope.ranges[scope.ranges.length - 1]?.blockId;
  if (!last) return { ...doc, blocks: [...doc.blocks, ...blocks] };
  const holds = (b: Block): boolean => b.id === last || !!b.children?.some(holds);
  const at = doc.blocks.findIndex(holds);
  if (at < 0) return { ...doc, blocks: [...doc.blocks, ...blocks] };
  return { ...doc, blocks: [...doc.blocks.slice(0, at + 1), ...blocks, ...doc.blocks.slice(at + 1)] };
}

// ---- routing --------------------------------------------------------------------------------------

type Intent = PresetId | "formal" | "chart" | "bullets" | "paragraph" | "fallback";

/** Free text to an intent by keyword (English and Korean). First match wins. */
export function routeInstruction(text: string): Intent {
  const t = text.toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => t.includes(x));
  if (has("translate", "번역", "korean", "english", "한국어", "영어")) return "translate";
  if (has("grammar", "typo", "proofread", "fix", "correct", "문법", "맞춤법", "교정", "오타")) return "fix";
  if (has("shorter", "shorten", "concise", "trim", "short", "줄여", "짧게", "간결")) return "shorter";
  if (has("longer", "expand", "elaborate", "detail", "늘려", "길게", "자세")) return "longer";
  if (has("summar", "tl;dr", "요약")) return "summarize";
  if (has("checklist", "to-do", "todo", "체크", "할 일")) return "checklist";
  if (has("table", "compar", "표", "비교")) return "table";
  if (has("chart", "graph", "차트", "그래프")) return "chart";
  if (has("bullet", "list", "목록", "리스트")) return "bullets";
  if (has("formal", "polite", "professional", "격식", "공손", "정중")) return "formal";
  if (has("paragraph", "add", "write", "문단", "추가", "작성")) return "paragraph";
  return "fallback";
}

function summarize(doc: Doc, scope: AgentScope, ko: boolean): Doc {
  const byId = new Map(scope.ranges.map((r) => [r.blockId, r] as const));
  const firsts: string[] = [];
  for (const b of flat(doc.blocks)) {
    const r = byId.get(b.id);
    if (!r || b.type !== "paragraph" || !b.content) continue;
    const s = sentences(textOf(b.content).slice(r.from, r.to))[0]?.trim();
    if (s) firsts.push(s);
  }
  const body = firsts.slice(0, 3).join(" ") || (ko ? "요약할 문단이 없습니다." : "Nothing to summarize.");
  const callout: Block = { id: newId(), type: "callout", props: { color: "info" }, content: [{ type: "text", text: `${ko ? "요약: " : "Summary: "}${body}` }] };
  // placed right after the first in-scope heading or block, so it reads like a lead
  const firstId = scope.ranges[0]?.blockId;
  const holds = (b: Block): boolean => b.id === firstId || !!b.children?.some(holds);
  const at = scope.whole ? doc.blocks.findIndex((b) => b.type === "heading") : doc.blocks.findIndex(holds) - 1;
  const idx = Math.max(0, at) + 1;
  return { ...doc, blocks: [...doc.blocks.slice(0, idx), callout, ...doc.blocks.slice(idx)] };
}

function runIntent(intent: Intent, req: AgentRequest, translations: Record<AgentLocale, Map<string, string>>): Doc {
  const { doc, scope, locale } = req;
  const ko = locale === "ko";
  switch (intent) {
    case "fix": return mapScopedText(doc, scope, fixGrammar);
    case "shorter": return mapScopedText(doc, scope, shorten, (b) => PROSE.has(b.type));
    case "longer": return mapScopedText(doc, scope, lengthen, (b) => b.type === "paragraph");
    case "formal": return mapScopedText(doc, scope, formalize);
    case "translate": {
      const lower = req.instruction.toLowerCase();
      const wantKo = /korean|한국어/.test(lower) || (!/english|영어/.test(lower) && !hasHangul(textOf(flat(doc.blocks).find((b) => b.content?.length)?.content ?? [])));
      const to: AgentLocale = req.preset === "translate" ? (ko ? "en" : "ko") : wantKo ? "ko" : "en";
      return mapScopedText(doc, scope, (text, b) => {
        const r = scope.ranges.find((x) => x.blockId === b.id)!;
        const full = r.from === 0 && r.to === textOf(b.content ?? []).length;
        const known = full ? translations[to].get(b.id) : undefined;
        return known ?? translateFallback(text, to);
      });
    }
    case "checklist": return insertAfterScope(doc, scope, checklistBlocks(ko));
    case "table": return insertAfterScope(doc, scope, [comparisonTable(ko)]);
    case "chart": return insertAfterScope(doc, scope, [chartBlock(ko)]);
    case "summarize": return summarize(doc, scope, ko);
    case "bullets": return insertAfterScope(doc, scope, (ko ? ["명확한 목표를 정한다", "범위를 좁혀 요청한다", "제안을 검토하고 적용한다"] : ["Set a clear goal", "Scope the request narrowly", "Review the suggestion, then apply it"]).map((t) => para(t, "bulletListItem")));
    case "paragraph": return insertAfterScope(doc, scope, [para(ko ? "에이전트는 요청을 읽고 문서에 들어갈 새 문단을 제안합니다. 마음에 들면 수락하고, 아니면 거절하세요." : "The agent reads your request and proposes a new paragraph for the document. Accept it if it fits, or reject it.")]);
    default: return insertAfterScope(doc, scope, [para(ko ? `모의 에이전트는 모델에 연결되어 있지 않아 “${req.instruction}” 요청을 키워드로만 해석합니다. 실제 모델은 AgentAdapter 자리에 연결하세요.` : `This mock agent has no model behind it, so it only matches keywords in “${req.instruction}”. Plug a real model into AgentAdapter.`)]);
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
  const id = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

export interface MockAgentOptions {
  /** Total simulated latency in ms (split across the progress stages). Default 900. */
  latencyMs?: number;
  /** Known per-block translations by block id and target locale (the sample doc supplies them). */
  translations?: Record<AgentLocale, Map<string, string>>;
}

/** Deterministic stand-in for a model: reads the scope, picks a transformation, returns a new Doc. */
export function createMockAgent(opts: MockAgentOptions = {}): AgentAdapter {
  const latency = opts.latencyMs ?? 900;
  const translations = opts.translations ?? { en: new Map(), ko: new Map() };
  return {
    async propose(req, run = {}) {
      const stages = req.locale === "ko" ? ["선택 영역 읽는 중", "초안 작성 중", "변경 사항 비교 중"] : ["Reading the selection", "Drafting changes", "Comparing with the original"];
      for (const s of stages) {
        run.onProgress?.(s);
        await sleep(latency / stages.length, run.signal);
      }
      const intent = req.preset ?? routeInstruction(req.instruction);
      return runIntent(intent, req, translations);
    },
  };
}
