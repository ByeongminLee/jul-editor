import type { ReactNode } from "react";
import { ENGINE_COLORS, ENGINE_NAMES, type EngineId } from "../../lib/about-engines.js";
import { useSiteSettings } from "../../app/site-settings.js";
import { Label, LegendHead, Svg, Txt, labelHeight, measure, pick, up4, type Locale, type Pair } from "./about-diagram-kit.js";
import "../../styles/about-diagram.css";

type Lines = readonly string[];
interface Text2 { en: Lines; ko: Lines }
const lines = (t: Text2, locale: Locale): Lines => (locale === "ko" ? t.ko : t.en);

const TITLE: Pair = ["Similar, borrowed, different", "비슷한 점, 가져온 점, 다른 점"];
const DESC: Pair = [
  "High-level diagram with JulEditor in the center. ProseMirror contributes transactions and immutable states, Lexical contributes model-first handling of input and shares reconciling only changed blocks, and Quill shares a plain JSON saved document. These are ideas only; no code from these projects is used. A separate group box lists what is different: a flat record map keyed by block id, persistent block wrappers with text patched in place, a skipped IME composing block, a React-free core, and Editor.View rendering a saved Doc with no editing engine.",
  "가운데에 JulEditor를 둔 개요 도식. ProseMirror에서는 트랜잭션과 불변 상태를, Lexical에서는 처리하는 입력을 모델 우선으로 다루는 방식을 가져왔고 바뀐 블록만 반영하는 점이 비슷하며, Quill과는 평범한 JSON 저장 문서가 비슷합니다. 아이디어만 참고했으며 이 프로젝트들의 코드는 쓰지 않았습니다. 별도의 묶음 상자에 다른 점을 적었습니다. id로 찾는 평평한 레코드 맵, 유지되는 블록 래퍼와 제자리 텍스트 수정, 건너뛰는 IME 조합 블록, React가 없는 코어, 편집 엔진 없이 저장된 Doc을 그리는 Editor.View입니다.",
];

const NOTE: Text2 = {
  en: ["Ideas only. No code from", "these projects is used."],
  ko: ["아이디어만 참고했으며 이 프로젝트들의", "코드는 쓰지 않았습니다."],
};
const NOTE_WIDE: Text2 = {
  en: ["Ideas only. No code from these projects is used."],
  ko: ["아이디어만 참고했으며 이 프로젝트들의 코드는 쓰지 않았습니다."],
};

const DIFFERENT: Pair = ["Different", "다른 점"];
const ITEMS: readonly Text2[] = [
  { en: ["Flat record map keyed by", "block id, not a nested tree"], ko: ["중첩 트리가 아니라 id로 찾는", "평평한 블록 레코드 맵입니다"] },
  { en: ["Block wrappers persist and", "text is patched in place"], ko: ["블록 래퍼를 유지하고 텍스트를", "제자리에서 고칩니다"] },
  { en: ["IME composing block is skipped"], ko: ["IME 조합 블록은 건너뜁니다"] },
  { en: ["React-free core"], ko: ["코어에 React가 없습니다"] },
  { en: ["Editor.View renders a saved Doc", "with no editing engine"], ko: ["Editor.View는 편집 엔진 없이", "저장된 Doc을 그립니다"] },
];

const JUL_SUBS = ["flat Store", "Op + states", "JSON Doc"];

interface Edge { from: EngineId; kind: "borrowed" | "similar"; label: { wide: Text2; tall: Text2 }; attach: number; side: "above" | "below" }
const EDGES: readonly Edge[] = [
  { from: "prosemirror", kind: "borrowed", attach: 0, side: "above", label: {
    wide: { en: ["transactions, immutable"], ko: ["트랜잭션, 불변 상태"] },
    tall: { en: ["transactions", "immutable", "states"], ko: ["트랜잭션,", "불변 상태"] } } },
  { from: "lexical", kind: "borrowed", attach: 0, side: "above", label: {
    wide: { en: ["model first, then DOM"], ko: ["모델 먼저, 그다음 DOM"] },
    tall: { en: ["model first,", "then DOM"], ko: ["모델 먼저,", "그다음 DOM"] } } },
  { from: "lexical", kind: "similar", attach: 1, side: "below", label: {
    wide: { en: ["reconcile changed blocks"], ko: ["바뀐 블록만 반영"] },
    tall: { en: ["reconcile", "changed", "blocks"], ko: ["바뀐 블록만", "반영"] } } },
  { from: "quill", kind: "similar", attach: 0, side: "above", label: {
    wide: { en: ["plain JSON document"], ko: ["평범한 JSON 문서"] },
    tall: { en: ["plain JSON", "document"], ko: ["평범한 JSON", "문서"] } } },
];

const ENGINE_SUB: Record<"prosemirror" | "lexical" | "quill", string> = {
  prosemirror: "Transaction",
  lexical: "editor.update()",
  quill: "Delta",
};

interface Geo {
  w: number; engineX: number; engineW: number; julX: number; julW: number; julY: number; julH: number;
  rows: Record<"prosemirror" | "lexical" | "quill", number>; attachOffsets: Record<"prosemirror" | "lexical" | "quill", readonly number[]>;
  boxX: number; boxY: number; boxW: number; boxH: number; textX: number; bulletX: number; itemGap: number; firstBaseline: number;
  noteY: number; legendY: number; vertical: boolean; labelKey: "wide" | "tall";
}

const WIDE: Geo = {
  w: 928, engineX: 24, engineW: 176, julX: 376, julW: 176, julY: 48, julH: 296,
  rows: { prosemirror: 56, lexical: 168, quill: 272 },
  attachOffsets: { prosemirror: [32], lexical: [16, 48], quill: [32] },
  boxX: 608, boxY: 48, boxW: 296, boxH: 296, textX: 640, bulletX: 626, itemGap: 40, firstBaseline: 108,
  noteY: 376, legendY: 400, vertical: false, labelKey: "wide",
};
const TALL: Geo = {
  w: 312, engineX: 8, engineW: 116, julX: 212, julW: 92, julY: 48, julH: 272,
  rows: { prosemirror: 48, lexical: 136, quill: 256 },
  attachOffsets: { prosemirror: [32], lexical: [20, 44], quill: [32] },
  boxX: 8, boxY: 360, boxW: 296, boxH: 240, textX: 36, bulletX: 24, itemGap: 28, firstBaseline: 420,
  noteY: 628, legendY: 668, vertical: true, labelKey: "tall",
};

function Overview({ locale, g }: { locale: Locale; g: Geo }) {
  const id = g.vertical ? "ad-over-t" : "ad-over-w";
  const nodeH = 64;
  const engines = (["prosemirror", "lexical", "quill"] as const);
  const note = lines(g.vertical ? NOTE : NOTE_WIDE, locale);
  const legendItems: { text: string; w: number; draw: (x: number, y: number) => ReactNode }[] = [
    { text: locale === "ko" ? "가져온 아이디어" : "Borrowed idea", w: 28, draw: (x, y) => <line x1={x} y1={y - 4} x2={x + 28} y2={y - 4} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} /> },
    { text: locale === "ko" ? "비슷한 동작" : "Similar behavior", w: 28, draw: (x, y) => <line x1={x} y1={y - 4} x2={x + 28} y2={y - 4} stroke="var(--dg-muted)" strokeWidth="1.2" strokeDasharray="5,4" markerEnd={`url(#${id}-arrow)`} /> },
    { text: locale === "ko" ? "JulEditor만의 특징" : "JulEditor only", w: 18, draw: (x, y) => <rect x={x} y={y - 10} width={18} height={13} rx={3} fill="var(--dg-focal-band)" stroke="var(--dg-accent-weak)" strokeWidth="1" strokeDasharray="4,3" /> },
  ];
  let lx = g.vertical ? 0 : 24;
  const legendBottom = g.vertical ? g.legendY + 44 + 2 * 24 : g.legendY + 44;
  const H = up4(legendBottom + 24);

  // First baseline of an item block, stepping 16px per line plus the gap between items.
  let baseline = g.firstBaseline;
  const itemBaselines = ITEMS.map((item) => {
    const start = baseline;
    baseline += (lines(item, locale).length - 1) * 16 + g.itemGap;
    return start;
  });
  const julCx = g.julX + g.julW / 2;
  const julMid = g.julY + g.julH / 2;

  return <Svg id={id} w={g.w} h={H} title={pick(TITLE, locale)} desc={pick(DESC, locale)} className={g.vertical ? "ad-tall" : "ad-wide"}>
    {/* connectors first, nodes after */}
    {EDGES.map((edge, i) => {
      const y = g.rows[edge.from as "prosemirror"] + g.attachOffsets[edge.from as "prosemirror"][edge.attach]!;
      return <line key={i} className="ln" x1={g.engineX + g.engineW} y1={y} x2={g.julX} y2={y} stroke="var(--dg-muted)" strokeWidth="1.2" strokeDasharray={edge.kind === "similar" ? "5,4" : undefined} markerEnd={`url(#${id}-arrow)`} />;
    })}
    {g.vertical
      ? <line className="ln" x1={julCx} y1={g.julY + g.julH} x2={julCx} y2={g.boxY} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} />
      : <line className="ln" x1={g.julX + g.julW} y1={julMid} x2={g.boxX} y2={julMid} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} />}

    {/* the Different group box and its list */}
    <rect className="bx" x={g.boxX} y={g.boxY} width={g.boxW} height={g.boxH} rx={8} fill="var(--dg-focal-band)" stroke="var(--dg-accent-weak)" strokeWidth="1" strokeDasharray="4,4" />
    <Txt kind="head" x={g.boxX + 16} y={g.boxY + 28}>{pick(DIFFERENT, locale)}</Txt>
    {ITEMS.map((item, i) => <g key={i}>
      <circle cx={g.bulletX} cy={itemBaselines[i]! - 4} r={2} fill="var(--dg-muted)" />
      {lines(item, locale).map((line, k) => <Txt key={k} kind="body" x={g.textX} y={itemBaselines[i]! + k * 16}>{line}</Txt>)}
    </g>)}

    {/* engines */}
    {engines.map((key) => {
      const y = g.rows[key];
      return <g key={key}>
        <rect className="bx" x={g.engineX} y={y} width={g.engineW} height={nodeH} rx={6} fill="var(--dg-node)" stroke="var(--dg-ink)" strokeWidth="1" />
        <circle cx={g.engineX + 14} cy={y + 22} r={4} fill={ENGINE_COLORS[key]} />
        <Txt kind="name" x={g.engineX + 26} y={y + 26}>{ENGINE_NAMES[key]}</Txt>
        <Txt kind="sub" x={g.engineX + 14} y={y + 48}>{ENGINE_SUB[key]}</Txt>
      </g>;
    })}

    {/* JulEditor, the one focal node */}
    <rect className="bx" x={g.julX} y={g.julY} width={g.julW} height={g.julH} rx={8} fill="var(--dg-focal-node)" stroke="var(--dg-accent)" strokeWidth="1.2" />
    <Txt kind="name" x={julCx} y={julMid - 14} anchor="middle">{ENGINE_NAMES.jul}</Txt>
    {JUL_SUBS.map((sub, i) => <Txt key={sub} kind="sub" x={julCx} y={julMid + 8 + i * 18} anchor="middle">{sub}</Txt>)}

    {/* connector labels */}
    {EDGES.map((edge, i) => {
      const attachY = g.rows[edge.from as "prosemirror"] + g.attachOffsets[edge.from as "prosemirror"][edge.attach]!;
      const text = lines(edge.label[g.labelKey], locale);
      const first = edge.side === "above" ? attachY - 7 - labelHeight(text) + 13 : attachY + 7 + 13;
      return <Label key={i} lines={text} x={(g.engineX + g.engineW + g.julX) / 2} y={first} />;
    })}

    {/* annotation callout */}
    {note.map((line, i) => <Txt key={i} kind="note" x={g.vertical ? 8 : 24} y={g.noteY + i * 20}>{line}</Txt>)}

    <LegendHead x={g.vertical ? 8 : 24} y={g.legendY} w={g.w - (g.vertical ? 16 : 48)} locale={locale} />
    {legendItems.map((item, i) => {
      const x = g.vertical ? 8 : lx;
      const y = g.vertical ? g.legendY + 44 + i * 24 : g.legendY + 44;
      lx += item.w + 8 + up4(measure("body", item.text)) + 32;
      return <g key={item.text}>{item.draw(x, y)}<Txt kind="body" x={x + item.w + 8} y={y} fill="var(--dg-muted)">{item.text}</Txt></g>;
    })}
  </Svg>;
}

export function OverviewSvg({ locale, variant }: { locale: Locale; variant: "wide" | "tall" }) {
  return <Overview locale={locale} g={variant === "wide" ? WIDE : TALL} />;
}

/** Children are the figure caption, supplied by the MDX page. */
export function AboutSummary({ children }: { children?: ReactNode }) {
  const { locale } = useSiteSettings();
  return <figure className="ad-figure" data-testid="about-overview">
    <div className="ad-panel"><OverviewSvg locale={locale} variant="wide" /><OverviewSvg locale={locale} variant="tall" /></div>
    {children ? <figcaption>{children}</figcaption> : null}
  </figure>;
}
