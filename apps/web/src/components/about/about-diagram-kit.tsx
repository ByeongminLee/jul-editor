import { useEffect, type ReactNode } from "react";

/**
 * Shared primitives for the About page SVG diagrams.
 *
 * The drawing rules (tokens, type ramp, 4px grid, marker ids, class vocabulary bx/ln/msk/zone/lf/act)
 * follow the html-design system. Colors are CSS custom properties (`--dg-*`) defined in
 * styles/about-diagram.css for both site themes, so a mask can use exactly the ground color it sits on.
 */

export type Locale = "en" | "ko";
export type Pair = readonly [en: string, ko: string];

export const pick = (pair: Pair, locale: Locale): string => (locale === "ko" ? pair[1] : pair[0]);

export const SANS = "'Geist', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
export const MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace";
export const SERIF = "'Instrument Serif', 'Noto Serif KR', 'Apple SD Gothic Neo', serif";

export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@400&display=swap";

/** Loads Geist, Geist Mono, Instrument Serif and Noto Sans KR for the About page only. */
export function useDiagramFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    link.dataset.aboutDiagramFonts = "";
    document.head.appendChild(link);
    return () => link.remove();
  }, []);
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const WIDE = /[ᄀ-ᇿ　-〿㄰-㆏가-힯一-鿿＀-￯]/;
export const isKo = (text: string) => HANGUL.test(text);

/** Text width in px: wide glyphs cost 1em, Latin costs the face advance (0.6em mono, 0.6em sans, conservative). */
export function textW(text: string, size: number, mono = false, tracking = 0): number {
  let width = 0;
  for (const ch of text) width += (WIDE.test(ch) ? size : size * 0.6) + (mono ? tracking : 0);
  return width;
}
export const up4 = (n: number) => Math.ceil(n / 4) * 4;

export type TextKind = "name" | "sub" | "lbl" | "tag" | "eyebrow" | "head" | "body" | "note";

interface TextStyle { cls: string; family: string; size: number; weight: number; fill: string; tracking?: number; upper?: boolean; italic?: boolean }

/** Type ramp. Korean in a mono slot switches register to 12px sans (no tracking, no uppercase). */
export function textStyle(kind: TextKind, text: string, fill?: string): TextStyle {
  const ko = isKo(text);
  switch (kind) {
    case "name": return { cls: "t1", family: SANS, size: 12, weight: 600, fill: fill ?? "var(--dg-ink)" };
    case "head": return { cls: "zn", family: SANS, size: 14, weight: 600, fill: fill ?? "var(--dg-ink)" };
    case "body": return { cls: "t2", family: SANS, size: 12, weight: 400, fill: fill ?? "var(--dg-ink)" };
    case "note": return { cls: "zn", family: SERIF, size: 14, weight: 400, fill: fill ?? "var(--dg-ink)", italic: true };
    case "sub": return ko
      ? { cls: "t2", family: SANS, size: 12, weight: 400, fill: fill ?? "var(--dg-muted)" }
      : { cls: "tm", family: MONO, size: 10, weight: 400, fill: fill ?? "var(--dg-muted)" };
    case "lbl": return ko
      ? { cls: "lbl", family: SANS, size: 12, weight: 500, fill: fill ?? "var(--dg-muted)" }
      : { cls: "lbl", family: MONO, size: 10, weight: 400, fill: fill ?? "var(--dg-muted)" };
    case "tag": return ko
      ? { cls: "lbl", family: SANS, size: 12, weight: 500, fill: fill ?? "var(--dg-ink)" }
      : { cls: "lbl", family: MONO, size: 10, weight: 500, fill: fill ?? "var(--dg-ink)", tracking: 0.4, upper: true };
    case "eyebrow": return ko
      ? { cls: "zn", family: SANS, size: 12, weight: 600, fill: fill ?? "var(--dg-muted)" }
      : { cls: "zn", family: MONO, size: 10, weight: 500, fill: fill ?? "var(--dg-muted)", tracking: 1.0, upper: true };
  }
}

export function measure(kind: TextKind, text: string): number {
  const s = textStyle(kind, text);
  return textW(text, s.size, s.family === MONO, s.tracking ?? 0);
}

export function Txt({ kind, x, y, anchor = "start", fill, children }: { kind: TextKind; x: number; y: number; anchor?: "start" | "middle" | "end"; fill?: string; children: string }) {
  const s = textStyle(kind, children, fill);
  return <text className={s.cls} x={x} y={y} fill={s.fill} fontSize={s.size} fontWeight={s.weight} fontFamily={s.family} textAnchor={anchor}
    letterSpacing={s.tracking ? `${s.tracking}` : undefined} fontStyle={s.italic ? "italic" : undefined} style={s.upper ? { textTransform: "uppercase" } : undefined}>{children}</text>;
}

/** Opaque label backing. `ground` must be the exact fill of whatever it sits on. */
export function Mask({ x, y, w, h, ground = "var(--dg-paper)" }: { x: number; y: number; w: number; h: number; ground?: string }) {
  return <rect className="msk" x={x} y={y} width={w} height={h} rx={2} fill={ground} />;
}

/** Connector label: opaque mask plus text. `y` is the first text baseline; multi-line labels stack by `lineHeight`. */
export function Label({ lines, x, y, anchor = "middle", ground, fill, lineHeight }: { lines: readonly string[]; x: number; y: number; anchor?: "start" | "middle" | "end"; ground?: string; fill?: string; lineHeight?: number }) {
  const ko = lines.some(isKo);
  const lh = lineHeight ?? (ko ? 15 : 14);
  const widest = Math.max(...lines.map((line) => measure("lbl", line)));
  const w = up4(widest + 8);
  const mx = anchor === "middle" ? x - w / 2 : anchor === "start" ? x - 4 : x - w + 4;
  const top = y - 13;
  const h = (lines.length - 1) * lh + 18;
  return <g>
    <Mask x={mx} y={top} w={w} h={h} ground={ground} />
    {lines.map((line, i) => <Txt key={i} kind="lbl" x={x} y={y + i * lh} anchor={anchor} fill={fill}>{line}</Txt>)}
  </g>;
}

export const labelHeight = (lines: readonly string[]) => (lines.length - 1) * (lines.some(isKo) ? 15 : 14) + 18;

/** Page-unique marker/pattern ids, prefixed per diagram variant so two figures on one page cannot collide. */
export function Defs({ id }: { id: string }) {
  return <defs>
    <pattern id={`${id}-dots`} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="var(--dg-dot)" /></pattern>
    <marker id={`${id}-arrow`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--dg-muted)" /></marker>
    <marker id={`${id}-arrow-accent`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--dg-accent)" /></marker>
  </defs>;
}

export function Backdrop({ id, w, h }: { id: string; w: number; h: number }) {
  return <>
    <rect width={w} height={h} fill="var(--dg-paper)" />
    <rect width={w} height={h} fill={`url(#${id}-dots)`} opacity="0.55" />
  </>;
}

export function Svg({ id, w, h, title, desc, className, children }: { id: string; w: number; h: number; title: string; desc: string; className?: string; children: ReactNode }) {
  return <svg className={`ad-svg ${className ?? ""}`} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>{title}</title>
    <desc id={`${id}-desc`}>{desc}</desc>
    <Defs id={id} />
    <Backdrop id={id} w={w} h={h} />
    {children}
  </svg>;
}

/** Hairline plus LEGEND eyebrow. Items are laid out by the caller. */
export function LegendHead({ x, y, w, locale }: { x: number; y: number; w: number; locale: Locale }) {
  return <>
    <line className="div" x1={x} y1={y} x2={x + w} y2={y} stroke="var(--dg-hair)" strokeWidth="0.8" />
    <Txt kind="eyebrow" x={x} y={y + 20}>{locale === "ko" ? "범례" : "Legend"}</Txt>
  </>;
}
