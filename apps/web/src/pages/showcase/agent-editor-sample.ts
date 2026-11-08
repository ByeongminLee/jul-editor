import type { Block, Doc, Inline } from "@jul-editor/core";
import type { AgentLocale } from "./agent-editor-mock.js";

// Sample document for the Agent editor showcase. Block ids are identical in both locales, which is
// what lets the mock agent's "Translate" preset swap a block for its sibling-language text.
// The "Draft notes" paragraph carries deliberate typos so "Fix grammar" has something to fix.

type Pair = [en: string, ko: string];

const T = (text: string, bold = false): Inline => bold ? { type: "text", text, marks: [{ type: "bold" }] } : { type: "text", text };
const pick = (pair: Pair, ko: boolean): string => pair[ko ? 1 : 0];

export function agentSampleDoc(locale: AgentLocale): Doc {
  const ko = locale === "ko";
  const p = (id: string, pair: Pair): Block => ({ id, type: "paragraph", props: {}, content: [T(pick(pair, ko))] });
  const h = (id: string, level: number, pair: Pair): Block => ({ id, type: "heading", props: { level }, content: [T(pick(pair, ko))] });
  const li = (id: string, pair: Pair): Block => ({ id, type: "bulletListItem", props: {}, content: [T(pick(pair, ko))] });
  const cell = (id: string, pair: Pair): Block => ({ id, type: "tableCell", props: {}, content: [T(pick(pair, ko))] });
  const row = (id: string, cells: Pair[]): Block => ({ id, type: "tableRow", props: {}, children: cells.map((c, i) => cell(`${id}-c${i}`, c)) });
  return {
    version: 1,
    blocks: [
      h("ag-title", 1, ["I'm an AI Toolkit demo doc", "저는 AI 툴킷 데모 문서입니다"]),
      { id: "ag-intro", type: "paragraph", props: {}, content: ko
        ? [T("안녕하세요! 이 문서에서는 AI 에이전트가 여러분과 함께 문서를 고치는 모습을 체험할 수 있습니다. 에이전트의 모든 수정은 "), T("제안", true), T("으로 표시되고, 하나씩 수락하거나 거절할 수 있습니다.")]
        : [T("Hi! This document shows how an AI agent can edit alongside you. Every change the agent makes shows up as a "), T("suggestion", true), T(" that you can accept or reject one by one.")] },
      h("ag-try", 2, ["What to try", "이렇게 해 보세요"]),
      li("ag-try-1", ["Select a preset in the AI panel, such as Fix grammar or Make shorter.", "AI 패널에서 맞춤법 교정이나 짧게 줄이기 같은 프리셋을 선택해 보세요."]),
      li("ag-try-2", ["Highlight some text, then type an instruction like \"translate to Korean\".", "텍스트를 선택한 뒤 \"영어로 번역\"처럼 지시를 입력해 보세요."]),
      li("ag-try-3", ["Ask the AI to add content, for example a paragraph, a checklist, or a comparison table.", "문단, 체크리스트, 비교 표 같은 내용을 AI에게 추가해 달라고 요청해 보세요."]),
      { id: "ag-note", type: "callout", props: { color: "info" }, content: [T(pick(["Nothing here calls a real model. The agent is a deterministic mock, so you can try everything offline.", "여기서는 실제 모델을 호출하지 않습니다. 에이전트는 결과가 항상 같은 모의 구현이라 오프라인에서도 모두 체험할 수 있습니다.", ], ko))] },
      h("ag-notes", 2, ["Draft notes", "초안 메모"]),
      p("ag-draft", ["teh agent can recieve your instruction and propose edits. i think its a very good way to review changes ,because you dont lose control.", "에이전트가 요청을 받으면 수정안을 제안해요. 몇일 동안 써 보면 검토가 금새 익숙해 질 거에요 . 그리고 마음에 안들면 거절해도 되요."]),
      h("ag-why", 2, ["Why suggestions?", "왜 제안 방식인가요?"]),
      p("ag-why-1", ["An agent that edits the document directly is hard to trust. Suggestions keep the original text in place, so you can see exactly what would change. In order to stay in control, you decide on every single change. Nothing is applied until you say so, and everything can be undone.", "문서를 직접 고치는 에이전트는 믿기 어렵습니다. 제안 방식은 원문을 그대로 두므로 무엇이 바뀔지 정확히 볼 수 있습니다. 통제권을 지키기 위해 변경 하나하나를 직접 결정합니다. 승인하기 전에는 아무것도 적용되지 않으며 언제든 되돌릴 수 있습니다."]),
      h("ag-data", 2, ["Review activity", "검토 현황"]),
      row0(),
      { id: "ag-chart", type: "chart", props: { kind: "bar", source: { type: "inline", csv: ko ? "주,수락한 제안\n1주,12\n2주,19\n3주,27\n4주,34" : "Week,Accepted suggestions\nWk 1,12\nWk 2,19\nWk 3,27\nWk 4,34" } } },
    ],
  };
  function row0(): Block {
    return { id: "ag-table", type: "table", props: { headerRow: true }, children: [
      row("ag-r0", [["Step", "단계"], ["Owner", "담당"], ["Status", "상태"]]),
      row("ag-r1", [["Draft", "초안"], ["Agent", "에이전트"], ["Done", "완료"]]),
      row("ag-r2", [["Review", "검토"], ["You", "나"], ["Pending", "대기"]]),
    ] };
  }
}

const plain = (b: Block): string => (b.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "")).join("");

/** Block id to plain text, per locale: what the mock "Translate" preset reads from. */
export function agentTranslations(): Record<AgentLocale, Map<string, string>> {
  const walk = (blocks: Block[], into: Map<string, string>): void => {
    for (const b of blocks) {
      if (b.content?.length) into.set(b.id, plain(b));
      if (b.children) walk(b.children, into);
    }
  };
  const out: Record<AgentLocale, Map<string, string>> = { en: new Map(), ko: new Map() };
  walk(agentSampleDoc("en").blocks, out.en);
  walk(agentSampleDoc("ko").blocks, out.ko);
  return out;
}
