import type { ReactNode } from "react";
import { Code } from "../code-block.js";
import { useSiteSettings } from "../../app/site-settings.js";
import { Label, LegendHead, MONO, SERIF, Svg, Txt, measure, pick, up4, type Locale, type Pair } from "./about-diagram-kit.js";
import "../../styles/about-diagram.css";

const W = 976;
const same = (text: string): Pair => [text, text];

interface Actor { key: string; cx: number; name: Pair; sub: Pair; kind: "external" | "plain" | "focal" }
const ACTORS: readonly Actor[] = [
  { key: "browser", cx: 104, name: ["Browser", "브라우저"], sub: same("contenteditable"), kind: "external" },
  { key: "interaction", cx: 296, name: ["Interaction", "입력 처리"], sub: same("beforeinput"), kind: "plain" },
  { key: "store", cx: 488, name: same("Store"), sub: same("transaction/commitPatch"), kind: "plain" },
  { key: "renderer", cx: 680, name: ["Renderer", "렌더러"], sub: same("view → DOM"), kind: "focal" },
  { key: "history", cx: 872, name: ["History", "히스토리"], sub: ["before/after state", "이전/이후 상태"], kind: "plain" },
];
const [BROWSER, INTERACTION, STORE, RENDERER, HISTORY] = ACTORS.map((a) => a.cx) as [number, number, number, number, number];
const BAR = 4;

const TITLE: Pair = ["Typing the letter a in JulEditor", "JulEditor에서 글자 a를 입력할 때"];
const DESC: Pair = [
  "Sequence diagram with five lifelines: Browser, Interaction, Store, Renderer and History. beforeinput insertText is cancelled, a replaceContent Op is applied, commitPatch makes new records and changedIds b2, History pushes the before and after states, the Renderer visits only b2 and changes Text.data from Dat to Data while b1 and b3 stay untouched, and the caret moves to offset 4. An optional fragment shows IME composition: the browser is not cancelled, the composing block is read back into the model, and the Renderer skips it.",
  "생명선 다섯 개의 시퀀스 도식: Browser, Interaction, Store, Renderer, History. beforeinput의 insertText를 취소하고 replaceContent Op를 적용하며, commitPatch가 새 레코드와 changedIds b2를 만들고, History가 이전/이후 상태를 쌓고, Renderer는 b2만 방문해 Text.data를 Dat에서 Data로 바꿉니다. b1과 b3는 건드리지 않고 캐럿은 offset 4로 옮겨 갑니다. 선택 구간은 IME 조합을 보여 줍니다. 브라우저의 입력을 취소하지 않고, 조합 중인 블록을 모델로 읽어 들이며, Renderer는 그 블록을 건너뜁니다.",
];

const TEXT = {
  m1: same("beforeinput · insertText"),
  m2: ["preventDefault() · cancel", "preventDefault() · 취소"] as Pair,
  m3: same("replaceContent op"),
  m5: ["push before/after", "이전/이후 상태 저장"] as Pair,
  m6: same("renderChanged b2"),
  m8: same("caret b2:4"),
  o1: ["input event, not cancelled", "input 이벤트, 취소 안 함"] as Pair,
  o2: ["read block into model", "조합 블록을 모델에 반영"] as Pair,
  o3: ["skip composing block", "조합 블록은 건너뜀"] as Pair,
  guard: ["[IME composing]", "[IME 조합 중]"] as Pair,
  untouched: [" untouched", "는 그대로"] as Pair,
};

function Msg({ id, x1, x2, y, dashed, accent }: { id: string; x1: number; x2: number; y: number; dashed?: boolean; accent?: boolean }) {
  return <line className="ln" x1={x1} y1={y} x2={x2} y2={y} stroke={accent ? "var(--dg-accent)" : "var(--dg-muted)"} strokeWidth="1.2" strokeDasharray={dashed ? "5,4" : undefined} markerEnd={`url(#${id}-arrow${accent ? "-accent" : ""})`} />;
}

function Loop({ id, cx, y1, y2, accent }: { id: string; cx: number; y1: number; y2: number; accent?: boolean }) {
  const e = cx + BAR, r = cx + 40;
  return <path className="ln" d={`M ${e} ${y1} H ${r - 8} Q ${r} ${y1} ${r} ${y1 + 8} V ${y2 - 8} Q ${r} ${y2} ${r - 8} ${y2} H ${e}`} fill="none" stroke={accent ? "var(--dg-accent)" : "var(--dg-muted)"} strokeWidth="1.2" markerEnd={`url(#${id}-arrow${accent ? "-accent" : ""})`} />;
}

export function SequenceSvg({ locale }: { locale: Locale }) {
  const id = "ad-seq";
  const H = 672;
  const fy = 448, fx = 72, fw = 628, fh = 132;
  const lifeEnd = fy + fh + 8;
  const bars: { cx: number; y: number; h: number }[] = [
    { cx: INTERACTION, y: 100, h: 76 },
    { cx: STORE, y: 168, h: 152 },
    { cx: RENDERER, y: 312, h: 116 },
    { cx: HISTORY, y: 270, h: 24 },
  ];
  const lbl = (pair: Pair) => [pick(pair, locale)];
  const legendY = 604;
  const legend: { text: string; w: number; draw: (x: number, y: number) => ReactNode }[] = [
    { text: locale === "ko" ? "호출" : "Call", w: 28, draw: (x, y) => <line x1={x} y1={y - 4} x2={x + 28} y2={y - 4} stroke="var(--dg-muted)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} /> },
    { text: locale === "ko" ? "반환" : "Return", w: 28, draw: (x, y) => <line x1={x} y1={y - 4} x2={x + 28} y2={y - 4} stroke="var(--dg-muted)" strokeWidth="1.2" strokeDasharray="5,4" markerEnd={`url(#${id}-arrow)`} /> },
    { text: locale === "ko" ? "핵심 단계" : "Headline step", w: 28, draw: (x, y) => <line x1={x} y1={y - 4} x2={x + 28} y2={y - 4} stroke="var(--dg-accent)" strokeWidth="1.2" markerEnd={`url(#${id}-arrow-accent)`} /> },
    { text: locale === "ko" ? "활성 구간" : "Activation", w: 8, draw: (x, y) => <rect x={x} y={y - 12} width={8} height={16} fill="var(--dg-act)" stroke="var(--dg-muted)" strokeWidth="0.8" /> },
    { text: locale === "ko" ? "선택 구간 (opt)" : "Optional (opt)", w: 18, draw: (x, y) => <rect x={x} y={y - 10} width={18} height={13} rx={2} fill="var(--dg-band)" stroke="var(--dg-rule)" strokeWidth="1" /> },
  ];
  let lx = 72;
  return <Svg id={id} w={W} h={H} title={pick(TITLE, locale)} desc={pick(DESC, locale)} className="ad-seq">
    <rect className="zone" x={fx} y={fy} width={fw} height={fh} rx={4} fill="var(--dg-band)" stroke="var(--dg-rule)" strokeWidth="1" />
    {ACTORS.map((a) => <line key={a.key} className="lf" x1={a.cx} y1={72} x2={a.cx} y2={lifeEnd} stroke="var(--dg-rule)" strokeWidth="1" strokeDasharray="3,3" />)}
    {bars.map((b) => <rect key={`${b.cx}-${b.y}`} className="act" x={b.cx - BAR} y={b.y} width={BAR * 2} height={b.h} fill="var(--dg-act)" stroke="var(--dg-muted)" strokeWidth="0.8" />)}
    <rect x={fx} y={fy} width={44} height={16} rx={2} fill="var(--dg-paper)" stroke="var(--dg-rule)" strokeWidth="1" />

    <Msg id={id} x1={BROWSER} x2={INTERACTION - BAR} y={104} />
    <Msg id={id} x1={INTERACTION - BAR} x2={BROWSER} y={136} dashed />
    <Msg id={id} x1={INTERACTION + BAR} x2={STORE - BAR} y={172} />
    <Loop id={id} cx={STORE} y1={204} y2={244} />
    <Msg id={id} x1={STORE + BAR} x2={HISTORY - BAR} y={280} />
    <Msg id={id} x1={STORE + BAR} x2={RENDERER - BAR} y={316} />
    <Loop id={id} cx={RENDERER} y1={344} y2={384} accent />
    <Msg id={id} x1={RENDERER - BAR} x2={BROWSER} y={420} dashed />
    <Msg id={id} x1={BROWSER} x2={INTERACTION} y={496} />
    <Msg id={id} x1={INTERACTION} x2={STORE} y={528} />
    <Msg id={id} x1={STORE} x2={RENDERER} y={560} />

    <Label lines={lbl(TEXT.m1)} x={(BROWSER + INTERACTION) / 2} y={92} />
    <Label lines={lbl(TEXT.m2)} x={(BROWSER + INTERACTION) / 2} y={124} />
    <Label lines={lbl(TEXT.m3)} x={(INTERACTION + STORE) / 2} y={160} />
    <Label lines={["commitPatch", "new records", "changedIds {b2}"]} x={STORE + 52} y={212} anchor="start" />
    <Label lines={lbl(TEXT.m5)} x={(STORE + RENDERER) / 2} y={268} />
    <Label lines={lbl(TEXT.m6)} x={(STORE + RENDERER) / 2} y={304} />
    <Label lines={["Text.data", "\"Dat\" → \"Data\""]} x={RENDERER + 52} y={352} anchor="start" />
    <text className="zn" x={RENDERER + 52} y={394} fill="var(--dg-ink)" fontSize={14} fontFamily={SERIF} fontStyle="italic">
      <tspan fontFamily={MONO} fontStyle="normal" fontSize={12}>b1, b3</tspan>{pick(TEXT.untouched, locale)}
    </text>
    <Label lines={lbl(TEXT.m8)} x={(BROWSER + INTERACTION) / 2} y={408} />
    <Label lines={lbl(TEXT.o1)} x={(BROWSER + INTERACTION) / 2} y={484} ground="var(--dg-band)" />
    <Label lines={lbl(TEXT.o2)} x={(INTERACTION + STORE) / 2} y={516} ground="var(--dg-band)" />
    <Label lines={lbl(TEXT.o3)} x={(STORE + RENDERER) / 2} y={548} ground="var(--dg-band)" />
    <Txt kind="tag" x={fx + 22} y={fy + 12} anchor="middle">OPT</Txt>
    <Txt kind="lbl" x={fx + 52} y={fy + 13}>{pick(TEXT.guard, locale)}</Txt>

    {ACTORS.map((a) => {
      const x = a.cx - 80;
      const fill = a.kind === "external" ? "var(--dg-band)" : a.kind === "focal" ? "var(--dg-focal-node)" : "var(--dg-node)";
      const stroke = a.kind === "external" ? "var(--dg-soft)" : a.kind === "focal" ? "var(--dg-accent)" : "var(--dg-ink)";
      return <g key={a.key}>
        <rect className="bx" x={x} y={16} width={160} height={56} rx={6} fill={fill} stroke={stroke} strokeWidth="1" />
        <Txt kind="name" x={a.cx} y={40} anchor="middle">{pick(a.name, locale)}</Txt>
        <Txt kind="sub" x={a.cx} y={58} anchor="middle">{pick(a.sub, locale)}</Txt>
      </g>;
    })}

    <LegendHead x={72} y={legendY} w={W - 144} locale={locale} />
    {legend.map((item) => {
      const x = lx;
      lx += item.w + 8 + up4(measure("body", item.text)) + 32;
      return <g key={item.text}>{item.draw(x, legendY + 44)}<Txt kind="body" x={x + item.w + 8} y={legendY + 44} fill="var(--dg-muted)">{item.text}</Txt></g>;
    })}
  </Svg>;
}

const OP_JSON = `{
  "type": "replaceContent",
  "id": "b2",
  "from": 3,
  "to": 3,
  "inlines": [{ "type": "text", "text": "a" }]
}`;

const INVERSE_JSON = `{
  "type": "replaceContent",
  "id": "b2",
  "from": 3,
  "to": 4,
  "inlines": []
}`;

const DOC_JSON = `{
  "version": 1,
  "blocks": [
    { "id": "b1", "type": "heading", "props": { "level": 1 },
      "content": [{ "type": "text", "text": "Notes" }] },
    { "id": "b2", "type": "paragraph", "props": {},
      "content": [{ "type": "text", "text": "Data" }] },
    { "id": "b3", "type": "paragraph", "props": {},
      "content": [{ "type": "text", "text": "Todo" }] }
  ]
}`;

/** `setup` (scenario) and `caption` (how to read the diagram) are prose supplied by the MDX page. */
export function AboutWalkthrough({ setup, caption }: { setup?: string; caption?: string }) {
  const { locale, t } = useSiteSettings();
  return <div className="ad-walk" data-testid="about-walkthrough">
    {setup ? <p className="ad-setup">{setup}</p> : null}
    <figure className="ad-figure">
      <div className="ad-panel ad-scroll"><SequenceSvg locale={locale} /></div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
    <div className="ad-snippets">
      <figure><figcaption>{t("The Op (step 3)", "Op (3번 메시지)")}</figcaption><Code title="json" locale={locale}>{OP_JSON}</Code></figure>
      <figure><figcaption>{t("Its inverse, used to merge typing", "연속 입력을 합칠 때 쓰는 반대 Op")}</figcaption><Code title="json" locale={locale}>{INVERSE_JSON}</Code></figure>
      <figure><figcaption>{t("The saved Doc afterwards", "편집 뒤 저장되는 Doc")}</figcaption><Code title="json" locale={locale}>{DOC_JSON}</Code></figure>
    </div>
  </div>;
}
