import type { Block, Doc } from "@jul-editor/core";
import { UnifiedWorkspace } from "../components/workspace/unified-workspace.js";
import { useSiteSettings } from "../app/site-settings.js";
import { demoDoc, mediaExampleBlocks } from "../lib/sample.js";

type Locale = "en" | "ko";

function localizedSample(locale: Locale): Doc {
  const sample = demoDoc();
  if (locale === "en") return sample;
  const media = new Map(mediaExampleBlocks("demo", "ko").map((block) => [block.id, block]));
  const text: Record<string, string> = {
    "demo-title": "제품 업데이트 초안",
    "demo-heading": "변경 사항 정리",
    "demo-p1": "이 문단을 선택해 서식을 바꾸거나 블록을 옮겨 순서를 조정하세요. 다른 탭도 같은 문서를 보여 줍니다.",
    "demo-list-1": "왼쪽 핸들을 드래그해 이 항목을 옮겨 보세요.",
    "demo-list-2": "새 문단에서 /를 입력해 블록을 추가해 보세요.",
    "demo-list-3": "상단 탭에서 Markdown, HTML, JSON을 확인하세요.",
    "demo-quote": "문서가 바뀌면 비교 탭에서 수정된 블록을 확인할 수 있습니다.",
    "demo-chart-heading": "월별 고객 피드백",
    "demo-end": "차트를 눌러 데이터와 표시 방식을 바꿔 보세요. 차트는 선택형 플러그인으로 추가한 블록입니다.",
  };
  return { ...sample, blocks: sample.blocks.map((block): Block => {
    if (media.has(block.id)) return media.get(block.id)!;
    if (block.id === "demo-subtitle") return { ...block, content: [
      { type: "text", text: "이 예제는 " },
      { type: "text", text: "JulEditor", marks: [{ type: "bold" }] },
      { type: "text", text: "로 만들었습니다. 내용을 수정한 뒤 상단 탭에서 소스와 변경 사항을 확인해 보세요." },
    ] };
    if (block.id === "demo-tags") return { ...block, content: [
      { type: "text", text: "이 문서에 " },
      { type: "mention", attrs: { kind: "tag", id: "idea", label: "아이디어" } },
      { type: "text", text: " 태그를 달고 " },
      { type: "mention", attrs: { kind: "user", id: "mina", label: "Mina" } },
      { type: "text", text: "를 멘션해 보세요. # 또는 @를 입력하면 목록이 열립니다." },
    ] };
    if (block.id === "demo-chart") return { ...block, props: { kind: "bar", source: { type: "inline", csv: "월,피드백\n1월,12\n2월,18\n3월,15\n4월,26\n5월,31" }, x: "월", y: "피드백" } };
    return text[block.id] ? { ...block, content: [{ type: "text", text: text[block.id]! }] } : block;
  }) };
}

// A real previous version with stable block IDs, so the first comparison is useful.
function sampleBaseline(locale: Locale): Doc {
  const sample = localizedSample(locale);
  return { ...sample, blocks: sample.blocks.filter((block) => block.id !== "demo-chart").map((block) =>
    block.id === "demo-p1" ? { ...block, content: [{ type: "text", text: locale === "ko" ? "이 문단을 선택해 서식을 바꿔 보세요." : "Select this paragraph and change its formatting." }] } : block,
  ) };
}

export default function Playground() {
  const { t } = useSiteSettings();
  return <main className="interior-page playground-page">
    <header className="playground-title wrap"><h1>Playground</h1></header>
    <section className="playground-workspace wrap" aria-label={t("Editor workspace", "에디터 작업 공간")}>
      <UnifiedWorkspace createDocument={localizedSample} createBaseline={sampleBaseline} variant="playground" fileName="document.md" />
    </section>
  </main>;
}
