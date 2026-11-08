import type { ReactNode } from "react";
import { ENGINE_COLORS, ENGINE_NAMES, type EngineId } from "../../lib/about-engines.js";
import { useSiteSettings } from "../../app/site-settings.js";
import { LegendHead, Svg, Txt, measure, pick, up4, type Locale, type Pair } from "./about-diagram-kit.js";
import "../../styles/about-diagram.css";

type TagKind = "lexical" | "prosemirror" | "diff";
interface Cell { name: Pair; sub: Pair; tags?: readonly TagKind[] }

const STEPS: readonly Pair[] = [
  ["1 Input event", "1 입력 이벤트"],
  ["2 Change description", "2 변경 기술"],
  ["3 New state", "3 새 상태"],
  ["4 Render to DOM", "4 DOM 반영"],
  ["5 Saved format", "5 저장 형식"],
];

const same = (text: string): Pair => [text, text];

const LANES: readonly { id: EngineId; cells: readonly Cell[] }[] = [
  { id: "quill", cells: [
    { name: ["Browser first", "브라우저 먼저"], sub: same("MutationObserver") },
    { name: same("Delta"), sub: same("retain/insert/delete") },
    { name: ["Delta in sync", "Delta를 맞춤"], sub: ["Delta document", "Delta 문서"] },
    { name: ["Already on screen", "이미 화면에 있음"], sub: same("Parchment blots") },
    { name: same("Delta JSON"), sub: ["insert + attributes", "insert와 속성"] },
  ] },
  { id: "prosemirror", cells: [
    { name: ["DOM change read", "DOM 변화를 읽음"], sub: ["plugins can step in", "플러그인이 개입 가능"] },
    { name: ["Transaction", "트랜잭션"], sub: ["made of Steps", "Step으로 구성"] },
    { name: ["Immutable state", "새 불변 상태"], sub: same("state.apply(tr)") },
    { name: ["View patches diff", "뷰가 차이만 갱신"], sub: same("view.updateState") },
    { name: ["Node/mark tree", "노드·마크 트리"], sub: same("doc.toJSON()") },
  ] },
  { id: "lexical", cells: [
    { name: ["Browser or command", "브라우저 또는 명령"], sub: ["plain text: browser", "일반 글자는 브라우저"] },
    { name: ["Pending copy", "대기 사본"], sub: same("editor.update()") },
    { name: ["Pending is active", "대기가 현재 상태로"], sub: same("commit: EditorState") },
    { name: ["Dirty nodes only", "dirty 노드만 반영"], sub: same("batched reconciler") },
    { name: ["Node tree JSON", "노드 트리 JSON"], sub: same("editorState.toJSON()") },
  ] },
  { id: "jul", cells: [
    { name: ["Input cancelled", "입력을 취소"], sub: same("beforeinput"), tags: ["lexical"] },
    { name: ["Ops transaction", "Op 트랜잭션"], sub: same("replaceContent"), tags: ["prosemirror"] },
    { name: ["New flat Store", "새 평평한 Store"], sub: ["changed + ancestors", "바뀐 블록과 상위 블록"], tags: ["prosemirror", "diff"] },
    { name: ["Patch changed ids", "바뀐 id만 반영"], sub: same("changedIds"), tags: ["lexical", "diff"] },
    { name: ["Block JSON Doc", "블록 JSON Doc"], sub: same("{ version, blocks }"), tags: ["diff"] },
  ] },
];

const TAG_LABEL: Record<TagKind, Pair> = {
  lexical: ["Like Lexical", "Lexical과 비슷"],
  prosemirror: ["Like ProseMirror", "ProseMirror와 비슷"],
  diff: ["Different", "차이점"],
};
const TAG_DOT: Record<TagKind, string> = { lexical: ENGINE_COLORS.lexical, prosemirror: ENGINE_COLORS.prosemirror, diff: ENGINE_COLORS.jul };

const TITLE: Pair = ["One keystroke in four editors", "네 에디터가 처리하는 키 입력 하나"];
const DESC: Pair = [
  "Swimlane diagram. Four lanes (Quill, ProseMirror, Lexical, JulEditor) each follow one keystroke through five steps: input event, change description, new state, render to DOM, saved format. JulEditor cancels beforeinput and applies a transaction of Ops, like Lexical's handled-input path and ProseMirror's transactions, then patches only the changed block ids and saves block JSON.",
  "스윔레인 도식. Quill, ProseMirror, Lexical, JulEditor 네 줄이 키 입력 하나를 입력 이벤트, 변경 기술, 새 상태, DOM 반영, 저장 형식의 다섯 단계로 처리합니다. JulEditor는 beforeinput을 취소하고 Op 트랜잭션을 적용한 뒤 바뀐 블록 id만 반영하고 블록 JSON으로 저장합니다.",
];

function Chip({ x, y, kind, locale }: { x: number; y: number; kind: TagKind; locale: Locale }) {
  const text = pick(TAG_LABEL[kind], locale);
  const w = up4(18 + measure("tag", text) + 8);
  return <g>
    <rect x={x} y={y} width={w} height={16} rx={4} fill="none" stroke="var(--dg-rule)" strokeWidth="0.8" />
    <circle cx={x + 9} cy={y + 8} r={3} fill={TAG_DOT[kind]} />
    <Txt kind="tag" x={x + 18} y={y + 12}>{text}</Txt>
  </g>;
}

function Legend({ x, y, w, locale, id, vertical }: { x: number; y: number; w: number; locale: Locale; id: string; vertical: boolean }) {
  const items: { key: string; width: number; draw: (ix: number, iy: number) => ReactNode; text: string }[] = [
    { key: "step", text: locale === "ko" ? "단계" : "Step", width: 14, draw: (ix, iy) => <rect x={ix} y={iy - 9} width={14} height={11} rx={2} fill="var(--dg-node)" stroke="var(--dg-ink)" strokeWidth="1" /> },
    { key: "focal", text: locale === "ko" ? "JulEditor 줄" : "JulEditor lane", width: 14, draw: (ix, iy) => <rect x={ix} y={iy - 9} width={14} height={11} rx={2} fill="var(--dg-focal-band)" stroke="var(--dg-accent)" strokeWidth="1.2" /> },
    { key: "next", text: locale === "ko" ? "다음 단계" : "Next step", width: 28, draw: (ix, iy) => <line x1={ix} y1={iy - 4} x2={ix + 28} y2={iy - 4} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} /> },
    { key: "tag", text: locale === "ko" ? "태그: 같은 점과 다른 점" : "Tag: where it matches or differs", width: 14, draw: (ix, iy) => <g><rect x={ix} y={iy - 11} width={14} height={15} rx={4} fill="none" stroke="var(--dg-rule)" strokeWidth="0.8" /><circle cx={ix + 7} cy={iy - 3.5} r={3} fill="var(--dg-accent)" /></g> },
  ];
  let cx = x;
  return <>
    <LegendHead x={x} y={y} w={w} locale={locale} />
    {items.map((item, i) => {
      const ix = vertical ? x : cx;
      const iy = vertical ? y + 44 + i * 24 : y + 44;
      const node = <g key={item.key}>{item.draw(ix, iy)}<Txt kind="body" x={ix + item.width + 8} y={iy} fill="var(--dg-muted)">{item.text}</Txt></g>;
      cx += item.width + 8 + up4(measure("body", item.text)) + 28;
      return node;
    })}
  </>;
}

function Dot({ id, cx, cy }: { id: EngineId; cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={4} fill={ENGINE_COLORS[id]} />;
}

function Wide({ locale }: { locale: Locale }) {
  const W = 968, bandX = 16, bandW = 936, firstX = 140, cellW = 144, pitch = 164, nodeH = 52;
  let top = 36;
  const lanes = LANES.map((lane) => {
    const h = lane.id === "jul" ? 120 : 76;
    const y = top;
    top += h + 8;
    return { lane, y, h };
  });
  const legendY = top + 8;
  const H = up4(legendY + 72);
  const id = "ad-swim-w";
  return <Svg id={id} w={W} h={H} title={pick(TITLE, locale)} desc={pick(DESC, locale)} className="ad-wide">
    {STEPS.map((step, i) => <Txt key={i} kind="eyebrow" x={firstX + i * pitch} y={24}>{pick(step, locale)}</Txt>)}
    {lanes.map(({ lane, y, h }) => {
      const focal = lane.id === "jul";
      return <rect key={lane.id} className="zone" x={bandX} y={y} width={bandW} height={h} rx={8} fill={focal ? "var(--dg-focal-band)" : "var(--dg-band)"} stroke={focal ? "var(--dg-accent)" : "var(--dg-hair)"} strokeWidth={focal ? 1.2 : 0.8} />;
    })}
    {lanes.map(({ lane, y }) => <g key={`l-${lane.id}`}>
      <Dot id={lane.id} cx={32} cy={y + 38} />
      <Txt kind="name" x={44} y={y + 42}>{ENGINE_NAMES[lane.id]}</Txt>
    </g>)}
    {lanes.map(({ lane, y }) => lane.cells.slice(0, -1).map((_, i) => <line key={`a-${lane.id}-${i}`} className="ln" x1={firstX + i * pitch + cellW} y1={y + 12 + nodeH / 2} x2={firstX + (i + 1) * pitch} y2={y + 12 + nodeH / 2} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} />))}
    {lanes.map(({ lane, y }) => lane.cells.map((cell, i) => {
      const x = firstX + i * pitch;
      return <g key={`n-${lane.id}-${i}`}>
        <rect className="bx" x={x} y={y + 12} width={cellW} height={nodeH} rx={6} fill="var(--dg-node)" stroke="var(--dg-ink)" strokeWidth="1" />
        <Txt kind="name" x={x + cellW / 2} y={y + 33} anchor="middle">{pick(cell.name, locale)}</Txt>
        <Txt kind="sub" x={x + cellW / 2} y={y + 51} anchor="middle">{pick(cell.sub, locale)}</Txt>
        {cell.tags?.map((tag, k) => <Chip key={tag} x={x} y={y + 12 + nodeH + 8 + k * 20} kind={tag} locale={locale} />)}
      </g>;
    }))}
    <Legend x={bandX} y={legendY} w={bandW} locale={locale} id={id} vertical={false} />
  </Svg>;
}

function Tall({ locale }: { locale: Locale }) {
  const W = 312, bandX = 4, bandW = 304, nodeX = 12, nodeW = 288, gap = 16;
  const id = "ad-swim-t";
  let top = 8;
  const lanes = LANES.map((lane) => {
    const nodeH = lane.id === "jul" ? 84 : 64;
    const h = 32 + 5 * nodeH + 4 * gap + 12;
    const y = top;
    top += h + 12;
    return { lane, y, h, nodeH };
  });
  const legendY = top + 4;
  const H = up4(legendY + 44 + 4 * 24 + 8);
  return <Svg id={id} w={W} h={H} title={pick(TITLE, locale)} desc={pick(DESC, locale)} className="ad-tall">
    {lanes.map(({ lane, y, h }) => {
      const focal = lane.id === "jul";
      return <rect key={lane.id} className="zone" x={bandX} y={y} width={bandW} height={h} rx={8} fill={focal ? "var(--dg-focal-band)" : "var(--dg-band)"} stroke={focal ? "var(--dg-accent)" : "var(--dg-hair)"} strokeWidth={focal ? 1.2 : 0.8} />;
    })}
    {lanes.map(({ lane, y }) => <g key={`l-${lane.id}`}>
      <Dot id={lane.id} cx={20} cy={y + 17} />
      <Txt kind="name" x={32} y={y + 21}>{ENGINE_NAMES[lane.id]}</Txt>
    </g>)}
    {lanes.map(({ lane, y, nodeH }) => lane.cells.slice(0, -1).map((_, i) => {
      const bottom = y + 32 + i * (nodeH + gap) + nodeH;
      return <line key={`a-${lane.id}-${i}`} className="ln" x1={nodeX + nodeW / 2} y1={bottom} x2={nodeX + nodeW / 2} y2={bottom + gap} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} />;
    }))}
    {lanes.map(({ lane, y, nodeH }) => lane.cells.map((cell, i) => {
      const ny = y + 32 + i * (nodeH + gap);
      let chipX = nodeX + 12;
      return <g key={`n-${lane.id}-${i}`}>
        <rect className="bx" x={nodeX} y={ny} width={nodeW} height={nodeH} rx={6} fill="var(--dg-node)" stroke="var(--dg-ink)" strokeWidth="1" />
        <Txt kind="eyebrow" x={nodeX + 12} y={ny + 18}>{pick(STEPS[i]!, locale)}</Txt>
        <Txt kind="name" x={nodeX + 12} y={ny + 37}>{pick(cell.name, locale)}</Txt>
        <Txt kind="sub" x={nodeX + 12} y={ny + 55}>{pick(cell.sub, locale)}</Txt>
        {cell.tags?.map((tag) => {
          const w = up4(18 + measure("tag", pick(TAG_LABEL[tag], locale)) + 8);
          const node = <Chip key={tag} x={chipX} y={ny + 62} kind={tag} locale={locale} />;
          chipX += w + 6;
          return node;
        })}
      </g>;
    }))}
    <Legend x={bandX} y={legendY} w={bandW} locale={locale} id={id} vertical />
  </Svg>;
}

export function SwimlaneSvg({ locale, variant }: { locale: Locale; variant: "wide" | "tall" }) {
  return variant === "wide" ? <Wide locale={locale} /> : <Tall locale={locale} />;
}

/** Children are the figure caption, supplied by the MDX page. */
export function AboutSwimlane({ children }: { children?: ReactNode }) {
  const { locale } = useSiteSettings();
  return <figure className="ad-figure" data-testid="about-swimlane">
    <div className="ad-panel"><SwimlaneSvg locale={locale} variant="wide" /><SwimlaneSvg locale={locale} variant="tall" /></div>
    {children ? <figcaption>{children}</figcaption> : null}
  </figure>;
}
