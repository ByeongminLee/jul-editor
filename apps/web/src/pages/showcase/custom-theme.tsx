import { Code2 } from "lucide-react";

export type CustomPalette = "slate" | "rose" | "amber" | "blue" | "mint" | "violet";
export type CustomFlair = "none" | "ruled" | "grid";
export type CustomColorKey = "bg" | "panel" | "ink" | "muted" | "border" | "accent" | "active";
export type ThemePresetId = "default" | "notebook" | "editorial" | "midnight" | "terminal" | "studio" | "blueprint" | "canvas";
export type CustomLook = "soft" | "sharp" | "brutal" | "editorial" | "mono";
export type FontKey = "system" | "sans" | "inter" | "plex" | "grotesk" | "display" | "serif" | "newsreader" | "lora" | "playfair" | "mono" | "plexmono" | "jetbrains";
export type CustomThemeConfig = {
  palette: CustomPalette;
  surface?: "paper" | "linen" | "midnight" | "forest";
  appearance: "light" | "dark";
  /** Density: only spacing and line height. The look decides everything else. */
  style: "balanced" | "airy" | "compact";
  look: CustomLook;
  bodyFont: FontKey;
  headingFont: FontKey;
  radius: number;
  chart: "theme" | "spectrum" | "mono" | "ocean" | "harvest";
  /** Page background detail drawn on the editor surface. */
  flair?: CustomFlair;
  /** Free color overrides edited with the color pickers; they win over surface and accent palette values. */
  colors?: Partial<Record<CustomColorKey, string>>;
  /** Preset the config was started from (highlights the picker; every value stays editable). */
  preset?: ThemePresetId;
  /** Sample document id. Presets that had their own document carry it; edits are kept per sample. */
  sample?: string;
};

const palettes = [
  { id: "slate", en: "Slate", ko: "슬레이트", light: "#475569", dark: "#cbd5e1", lightActive: "#e2e8f0", darkActive: "#334155" },
  { id: "rose", en: "Rose", ko: "로즈", light: "#be123c", dark: "#fda4af", lightActive: "#ffe4e6", darkActive: "#4c1d2b" },
  { id: "amber", en: "Amber", ko: "앰버", light: "#92400e", dark: "#fcd34d", lightActive: "#fef3c7", darkActive: "#45340f" },
  { id: "blue", en: "Cobalt", ko: "코발트", light: "#1d4ed8", dark: "#93c5fd", lightActive: "#dbeafe", darkActive: "#1e3a5f" },
  { id: "mint", en: "Mint", ko: "민트", light: "#047857", dark: "#6ee7b7", lightActive: "#d1fae5", darkActive: "#064e3b" },
  { id: "violet", en: "Violet", ko: "바이올렛", light: "#6d28d9", dark: "#c4b5fd", lightActive: "#ede9fe", darkActive: "#3b2b63" },
] as const;

const surfaces = [
  { id: "paper", en: "Paper", ko: "페이퍼", appearance: "light", bg: "#ffffff", panel: "#fafafa", ink: "#18181b", muted: "#62626d", border: "#e4e4e7" },
  { id: "linen", en: "Linen", ko: "리넨", appearance: "light", bg: "#fcf8ef", panel: "#f3ecdf", ink: "#332f29", muted: "#756b5b", border: "#ddd3c2" },
  { id: "midnight", en: "Nocturne", ko: "녹턴", appearance: "dark", bg: "#18181b", panel: "#202126", ink: "#f4f4f5", muted: "#a1a1aa", border: "#3f3f46" },
  { id: "forest", en: "Forest", ko: "포레스트", appearance: "dark", bg: "#101c18", panel: "#172a22", ink: "#e4f1e8", muted: "#9db3a5", border: "#355044" },
] as const;

const KR_SANS = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic"';
const KR_SERIF = '"Noto Serif KR", "Apple Myungjo", serif';
// Web fonts load only on the showcase (see fontsHref). System stacks need no download.
const fonts: Record<FontKey, { stack: string; family?: string; group: "sans" | "serif" | "mono"; en: string; ko: string }> = {
  system: { stack: `ui-sans-serif, system-ui, ${KR_SANS}, sans-serif`, group: "sans", en: "System sans", ko: "시스템 산세리프" },
  sans: { stack: `"DM Sans", ui-sans-serif, system-ui, ${KR_SANS}, sans-serif`, family: "DM+Sans:wght@400;500;600;700", group: "sans", en: "DM Sans", ko: "DM Sans" },
  inter: { stack: `Inter, ui-sans-serif, system-ui, ${KR_SANS}, sans-serif`, family: "Inter:wght@400;500;600;700", group: "sans", en: "Inter", ko: "Inter" },
  plex: { stack: `"IBM Plex Sans", ui-sans-serif, system-ui, ${KR_SANS}, sans-serif`, family: "IBM+Plex+Sans:wght@400;500;600;700", group: "sans", en: "IBM Plex Sans", ko: "IBM Plex Sans" },
  grotesk: { stack: `"Space Grotesk", ui-sans-serif, system-ui, ${KR_SANS}, sans-serif`, family: "Space+Grotesk:wght@400;500;700", group: "sans", en: "Space Grotesk", ko: "Space Grotesk" },
  display: { stack: `"Fraunces", Georgia, ${KR_SERIF}`, family: "Fraunces:wght@400;500;600;700;800", group: "serif", en: "Fraunces", ko: "Fraunces" },
  serif: { stack: `Georgia, "Times New Roman", ${KR_SERIF}`, group: "serif", en: "Georgia (system)", ko: "Georgia (시스템)" },
  newsreader: { stack: `"Newsreader", Georgia, ${KR_SERIF}`, family: "Newsreader:wght@400;500;600;700", group: "serif", en: "Newsreader", ko: "Newsreader" },
  lora: { stack: `"Lora", Georgia, ${KR_SERIF}`, family: "Lora:wght@400;500;600;700", group: "serif", en: "Lora", ko: "Lora" },
  playfair: { stack: `"Playfair Display", Georgia, ${KR_SERIF}`, family: "Playfair+Display:wght@500;600;700;800;900", group: "serif", en: "Playfair Display", ko: "Playfair Display" },
  mono: { stack: "ui-monospace, SFMono-Regular, Consolas, monospace", group: "mono", en: "System mono", ko: "시스템 고정폭" },
  plexmono: { stack: `"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace`, family: "IBM+Plex+Mono:wght@400;500;600;700", group: "mono", en: "IBM Plex Mono", ko: "IBM Plex Mono" },
  jetbrains: { stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace`, family: "JetBrains+Mono:wght@400;500;700", group: "mono", en: "JetBrains Mono", ko: "JetBrains Mono" },
};
const fontKeys = Object.keys(fonts) as FontKey[];

const pairings: { id: string; en: string; ko: string; body: FontKey; heading: FontKey }[] = [
  { id: "modern", en: "Modern", ko: "모던", body: "sans", heading: "display" },
  { id: "neutral", en: "Neutral", ko: "뉴트럴", body: "inter", heading: "inter" },
  { id: "press", en: "Press", ko: "프레스", body: "newsreader", heading: "playfair" },
  { id: "technical", en: "Technical", ko: "테크니컬", body: "plex", heading: "plexmono" },
  { id: "geometric", en: "Geometric", ko: "지오메트릭", body: "grotesk", heading: "grotesk" },
  { id: "warm", en: "Warm", ko: "따뜻하게", body: "lora", heading: "grotesk" },
  { id: "code", en: "Code", ko: "코드", body: "jetbrains", heading: "jetbrains" },
];

type LookSpec = {
  en: string; ko: string; descEn: string; descKo: string;
  radius: number; density: CustomThemeConfig["style"]; body: FontKey; heading: FontKey;
  tokens: Record<string, string>;
};

const looks: Record<CustomLook, LookSpec> = {
  soft: {
    en: "Soft", ko: "소프트", descEn: "Rounded, airy, gentle shadow", descKo: "둥글고 여유로운 느낌, 은은한 그림자",
    radius: 12, density: "airy", body: "sans", heading: "sans",
    tokens: { "--jul-editor-border-width": "1px", "--jul-editor-shadow": "0 22px 44px -22px rgb(0 0 0 / .32)", "--jul-editor-leading": "1.9", "--jul-editor-gap": "14px", "--jul-editor-pad": "42px", "--jul-editor-heading-weight": "650", "--jul-editor-heading-tracking": "-.03em", "--jul-editor-heading-case": "none" },
  },
  sharp: {
    en: "Sharp", ko: "샤프", descEn: "Square corners, hairlines, tight", descKo: "직각 모서리, 가는 선, 촘촘한 간격",
    radius: 0, density: "compact", body: "inter", heading: "inter",
    tokens: { "--jul-editor-border-width": "1px", "--jul-editor-shadow": "none", "--jul-editor-leading": "1.55", "--jul-editor-gap": "6px", "--jul-editor-pad": "22px", "--jul-editor-heading-weight": "600", "--jul-editor-heading-tracking": "-.01em", "--jul-editor-heading-case": "none" },
  },
  brutal: {
    en: "Brutal", ko: "브루탈", descEn: "Thick borders, hard offset shadows", descKo: "굵은 테두리와 딱딱한 그림자",
    radius: 0, density: "balanced", body: "grotesk", heading: "grotesk",
    tokens: { "--jul-editor-border-width": "3px", "--jul-editor-shadow": "7px 7px 0 var(--jul-editor-ink)", "--jul-editor-leading": "1.6", "--jul-editor-gap": "12px", "--jul-editor-pad": "30px", "--jul-editor-heading-weight": "900", "--jul-editor-heading-tracking": "-.02em", "--jul-editor-heading-case": "uppercase" },
  },
  editorial: {
    en: "Editorial", ko: "에디토리얼", descEn: "Serif headings, long measure, rules", descKo: "세리프 제목, 넉넉한 행 길이, 구분선",
    radius: 0, density: "airy", body: "newsreader", heading: "playfair",
    tokens: { "--jul-editor-border-width": "1px", "--jul-editor-shadow": "none", "--jul-editor-leading": "1.85", "--jul-editor-gap": "16px", "--jul-editor-pad": "50px", "--jul-editor-heading-weight": "600", "--jul-editor-heading-tracking": "-.02em", "--jul-editor-heading-case": "none" },
  },
  mono: {
    en: "Mono", ko: "모노", descEn: "Monospace, dense, dashed lines", descKo: "고정폭 글꼴, 촘촘함, 점선",
    radius: 0, density: "compact", body: "plexmono", heading: "plexmono",
    tokens: { "--jul-editor-border-width": "1px", "--jul-editor-shadow": "none", "--jul-editor-leading": "1.5", "--jul-editor-gap": "5px", "--jul-editor-pad": "18px", "--jul-editor-heading-weight": "700", "--jul-editor-heading-tracking": "0", "--jul-editor-heading-case": "none" },
  },
};
const lookKeys = Object.keys(looks) as CustomLook[];

const presetOptions: Record<CustomPalette, Omit<CustomThemeConfig, "palette">> = {
  slate: { appearance: "light", style: "balanced", look: "soft", bodyFont: "sans", headingFont: "sans", radius: 8, chart: "theme" },
  rose: { appearance: "light", style: "airy", look: "editorial", bodyFont: "serif", headingFont: "display", radius: 12, chart: "theme" },
  amber: { appearance: "light", style: "compact", look: "sharp", bodyFont: "sans", headingFont: "serif", radius: 4, chart: "theme" },
  blue: { appearance: "light", style: "balanced", look: "soft", bodyFont: "sans", headingFont: "display", radius: 8, chart: "theme" },
  mint: { appearance: "dark", style: "compact", look: "mono", bodyFont: "mono", headingFont: "mono", radius: 4, chart: "theme" },
  violet: { appearance: "dark", style: "airy", look: "soft", bodyFont: "sans", headingFont: "display", radius: 14, chart: "theme" },
};

export function customThemePreset(palette: CustomPalette): CustomThemeConfig {
  return { palette, ...presetOptions[palette] };
}

/** Starts with the neutral Slate layout but the colored Cobalt accent, so "Match theme" charts are not grey. */
export const DEFAULT_CUSTOM_CONFIG: CustomThemeConfig = { ...customThemePreset("slate"), palette: "blue", preset: "default", sample: "custom" };

type ThemePreset = { id: ThemePresetId; en: string; ko: string; descEn: string; descKo: string; config: CustomThemeConfig };
const colorSet = (bg: string, panel: string, ink: string, muted: string, border: string, accent: string, active: string): Record<CustomColorKey, string> => ({ bg, panel, ink, muted, border, accent, active });

/**
 * The former standalone showcase themes, now starting points inside Custom. Each keeps its exact colors, fonts, radius,
 * and (where it had one) page background and sample document. Picking one fills every control, and every value stays editable.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "default", en: "Default", ko: "기본", descEn: "Cobalt accent on paper", descKo: "페이퍼 위의 코발트 강조색", config: DEFAULT_CUSTOM_CONFIG },
  {
    id: "notebook", en: "Notebook", ko: "노트북", descEn: "Ruled paper for quick notes", descKo: "줄 노트 위의 빠른 메모",
    config: { palette: "amber", appearance: "light", style: "balanced", look: "soft", bodyFont: "serif", headingFont: "serif", radius: 3, chart: "theme", flair: "ruled", preset: "notebook", sample: "notebook", colors: colorSet("#f8f5ee", "#f8f5ee", "#282723", "#827e76", "#ded8cc", "#a76640", "#efe7d8") },
  },
  {
    id: "editorial", en: "Editorial", ko: "에디토리얼", descEn: "Serif type for articles", descKo: "기사용 세리프 글꼴",
    config: { palette: "rose", appearance: "light", style: "airy", look: "editorial", bodyFont: "serif", headingFont: "serif", radius: 0, chart: "theme", flair: "none", preset: "editorial", sample: "editorial", colors: colorSet("#fffdf8", "#f6f1e8", "#201b18", "#7d7770", "#ded8d0", "#925338", "#eee3d4") },
  },
  {
    id: "midnight", en: "Midnight", ko: "미드나이트", descEn: "Dark, soft journal", descKo: "어둡고 차분한 일지",
    config: { palette: "violet", appearance: "dark", style: "balanced", look: "soft", bodyFont: "system", headingFont: "serif", radius: 14, chart: "theme", flair: "none", preset: "midnight", sample: "midnight", colors: colorSet("#171923", "#1e202b", "#f0edf5", "#a19cae", "#36313f", "#cfb5ef", "#343044") },
  },
  {
    id: "terminal", en: "Terminal", ko: "터미널", descEn: "Monospace changelog", descKo: "고정폭 변경 기록",
    config: { palette: "mint", appearance: "dark", style: "compact", look: "mono", bodyFont: "mono", headingFont: "mono", radius: 0, chart: "theme", flair: "none", preset: "terminal", sample: "terminal", colors: colorSet("#101614", "#121c17", "#d7f0de", "#89a995", "#2a4032", "#74e2a0", "#1e3627") },
  },
  {
    id: "studio", en: "Studio", ko: "스튜디오", descEn: "Bright, rounded brief", descKo: "밝고 둥근 기획서",
    config: { palette: "violet", appearance: "light", style: "balanced", look: "soft", bodyFont: "system", headingFont: "system", radius: 18, chart: "theme", flair: "none", preset: "studio", sample: "studio", colors: colorSet("#f7f4ff", "#f0eafb", "#27213a", "#736d88", "#d9d0ed", "#6944b8", "#e5dcf6") },
  },
  {
    id: "blueprint", en: "Blueprint", ko: "블루프린트", descEn: "Blue grid for specs", descKo: "설계 문서용 파란 격자",
    config: { palette: "blue", appearance: "light", style: "balanced", look: "sharp", bodyFont: "system", headingFont: "system", radius: 4, chart: "theme", flair: "grid", preset: "blueprint", sample: "blueprint", colors: colorSet("#ffffff", "#eff6ff", "#14243a", "#536780", "#b8cde6", "#1d4ed8", "#dbeafe") },
  },
  {
    id: "canvas", en: "Canvas", ko: "캔버스", descEn: "Bold type, graphic quotes", descKo: "굵은 제목과 그래픽 인용",
    config: { palette: "amber", appearance: "light", style: "balanced", look: "brutal", bodyFont: "system", headingFont: "system", radius: 0, chart: "theme", flair: "none", preset: "canvas", sample: "canvas", colors: colorSet("#fffbed", "#f6df77", "#282414", "#6c6040", "#433b25", "#795000", "#f4dda1") },
  },
];

export const SAMPLE_IDS = ["custom", ...THEME_PRESETS.filter((preset) => preset.id !== "default").map((preset) => preset.id)] as readonly string[];

/** Picking a style applies radius, density, and a font pair together; surface, accent, and chart colors stay. */
export function applyCustomLook(config: CustomThemeConfig, look: CustomLook): CustomThemeConfig {
  const spec = looks[look];
  return { ...config, look, radius: spec.radius, style: spec.density, bodyFont: spec.body, headingFont: spec.heading };
}

/** Google Fonts stylesheet for the fonts in use, or "" when only system fonts are selected. */
export function fontsHref(config: CustomThemeConfig, locale: "en" | "ko" = "en"): string {
  const used = [...new Set([config.bodyFont, config.headingFont])].map((key) => fonts[key]);
  const families = used.flatMap((font) => font.family ? [font.family] : []);
  if (locale === "ko") {
    if (used.some((font) => font.group === "sans")) families.push("Noto+Sans+KR:wght@400;500;700");
    if (used.some((font) => font.group === "serif")) families.push("Noto+Serif+KR:wght@400;600;700");
  }
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&")}&display=swap` : "";
}

export function customThemeFontImport(config: CustomThemeConfig): string {
  const href = fontsHref(config);
  return href ? `@import url("${href}");` : "";
}

function chartColors(config: CustomThemeConfig): string[] {
  const dark = config.appearance === "dark";
  const accent = palettes.find((palette) => palette.id === config.palette)!;
  const color = config.colors?.accent ?? (dark ? accent.dark : accent.light);
  const ink = config.colors?.ink ?? (dark ? "#f4f4f5" : "#18181b");
  const soft = config.colors?.bg ?? (dark ? "#18181b" : "#ffffff");
  const mix = (base: string, part: number, other: string) => `color-mix(in srgb, ${base} ${part}%, ${other})`;
  if (config.chart === "ocean") return ["#0369a1", "#0891b2", "#0d9488", "#2563eb", "#6366f1", "#0284c7", "#14b8a6", "#1e40af"];
  if (config.chart === "harvest") return ["#b45309", "#c2410c", "#a16207", "#4d7c0f", "#be123c", "#7e22ce", "#854d0e", "#9a3412"];
  if (config.chart === "spectrum") return dark
    ? ["#f97316", "#38bdf8", "#a3e635", "#f472b6", "#c4b5fd", "#facc15", "#2dd4bf", "#fb7185"]
    : ["#c2410c", "#0369a1", "#4d7c0f", "#be185d", "#7c3aed", "#a16207", "#0f766e", "#b91c1c"];
  if (config.chart === "mono") return [color, ...[88, 76, 64, 52, 42, 32, 24].map((part) => mix(color, part, ink))];
  // Match theme: the accent leads, then tints, shades, and gentle hue shifts toward the other palettes.
  const others = palettes.filter((palette) => palette.id !== config.palette).map((palette) => dark ? palette.dark : palette.light);
  return [color, mix(color, 72, ink), mix(color, 56, soft), mix(color, 68, others[0]!), mix(color, 52, ink), mix(color, 62, others[1]!), mix(color, 40, soft), mix(color, 58, others[2]!)];
}

/** Black or white, whichever reads better on the given hex color (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#18181b" : "#ffffff";
}

/** The seven editable colors the tokens resolve to, after surface, palette, and free overrides. */
export function resolvedColors(config: CustomThemeConfig): Record<CustomColorKey, string> {
  const dark = config.appearance === "dark";
  const palette = palettes.find((item) => item.id === config.palette)!;
  const surface = surfaces.find((item) => item.id === config.surface);
  return {
    bg: config.colors?.bg ?? surface?.bg ?? (dark ? "#18181b" : "#ffffff"),
    panel: config.colors?.panel ?? surface?.panel ?? (dark ? "#202126" : "#fafafa"),
    ink: config.colors?.ink ?? surface?.ink ?? (dark ? "#f4f4f5" : "#18181b"),
    muted: config.colors?.muted ?? surface?.muted ?? (dark ? "#a1a1aa" : "#62626d"),
    border: config.colors?.border ?? surface?.border ?? (dark ? "#3f3f46" : "#e4e4e7"),
    accent: config.colors?.accent ?? (dark ? palette.dark : palette.light),
    active: config.colors?.active ?? (dark ? palette.darkActive : palette.lightActive),
  };
}

export function customThemeTokens(config: CustomThemeConfig): Record<string, string> {
  const dark = config.appearance === "dark";
  const { bg, panel, ink, muted, border, accent, active } = resolvedColors(config);
  const chart = chartColors(config);
  return {
    "--jul-editor-bg": bg,
    "--jul-editor-ink": ink,
    "--jul-editor-muted": muted,
    "--jul-editor-border": border,
    "--jul-editor-panel": panel,
    "--jul-editor-accent": accent,
    "--jul-editor-accent-ink": config.colors?.accent ? readableOn(accent) : dark ? "#18181b" : "#ffffff",
    "--jul-editor-active": active,
    "--jul-editor-radius": `${Math.max(0, Math.min(20, config.radius))}px`,
    "--jul-editor-font": fonts[config.bodyFont].stack,
    "--jul-editor-heading": fonts[config.headingFont].stack,
    ...looks[config.look].tokens,
    ...Object.fromEntries(chart.map((color, index) => [`--chart-${index + 1}`, color])),
    "--chart-surface": bg,
    "--chart-border": border,
    "--chart-grid": border,
    "--chart-hover": `color-mix(in srgb, ${chart[0]} 15%, transparent)`,
    "--chart-muted": muted,
    "--chart-cursor": muted,
    "--chart-tooltip-bg": panel,
    "--chart-tooltip-border": border,
    "--chart-tooltip-fg": ink,
    "--chart-tooltip-muted": muted,
  };
}

const S = ".jul-editor-theme--custom";
const C = `${S} .editor-content`;
const H = (level: number) => `${C} [data-type=heading][data-jul-editor-level='${level}']`;
const TH = `${C} [data-type=tableRow]:first-child > [data-jul-editor-children] > [data-type=tableCell]`;
const A = "var(--jul-editor-accent)";
const INK = "var(--jul-editor-ink)";
const tint = (part: number, base = "transparent") => `color-mix(in srgb, ${A} ${part}%, ${base})`;

// Shared skin consumes tokens; accent rules below make the accent visible everywhere, then one look block restyles the whole surface.
const baseCss = `${S} .editor-instance { border: var(--jul-editor-border-width, 1px) solid var(--jul-editor-border); border-radius: var(--jul-editor-radius); box-shadow: var(--jul-editor-shadow, none); overflow: hidden; }
${C} { padding-block: var(--jul-editor-pad, 30px); line-height: var(--jul-editor-leading, 1.8); }
${C} [data-type=paragraph] { margin-bottom: var(--jul-editor-gap, 10px); }
${C} [data-type=heading] { font-weight: var(--jul-editor-heading-weight, 700); letter-spacing: var(--jul-editor-heading-tracking, -.04em); text-transform: var(--jul-editor-heading-case, none); }
${S} .tool-button, ${S} .bubble-tools { border-radius: var(--jul-editor-radius); }
${C} [data-type=quote], ${C} [data-type=codeBlock], ${C} [data-jul-editor-image] img { border-radius: var(--jul-editor-radius); }`;

const accentCss = `${S} ::selection { background: ${tint(32)}; }
${S} .editor-instance:focus-within { border-color: ${A}; box-shadow: var(--jul-editor-shadow, none), 0 0 0 3px ${tint(32)}; }
${S} .editor-toolbar { background: ${tint(7, "var(--jul-editor-panel)")}; }
${S} .tool-button:hover, ${S} .drag-handle:hover, ${S} .block-add:hover { background: ${tint(16)}; color: ${A}; border-color: ${tint(45)}; }
${S} .tool-button[aria-pressed=true] { background: ${A}; color: var(--jul-editor-accent-ink); border-color: ${A}; }
${S} .tool-button:focus-visible, ${S} .bubble-tools button:focus-visible { outline: 2px solid ${A}; outline-offset: 2px; }
${S} .bubble-tools button:hover, ${S} .bubble-tools button[data-active] { background: ${A}; color: var(--jul-editor-accent-ink); }
${S} .slash-option:hover, ${S} .slash-option[data-active] { background: ${A}; color: var(--jul-editor-accent-ink); }
${C} a { color: ${A}; font-weight: 600; text-decoration-thickness: 2px; text-decoration-color: ${tint(50)}; }
${C} a:hover { background: ${tint(14)}; text-decoration-color: ${A}; }
${H(1)} { position: relative; }
${H(1)}::after { content: ''; display: block; width: 56px; height: 4px; margin-top: .3em; border-radius: var(--jul-editor-radius); background: ${A}; }
${H(2)} { color: color-mix(in srgb, ${A} 82%, ${INK}); }
${C} [data-type=bulletListItem]::before { font-weight: 900; }
${C} [data-type=orderedListItem]::before { font-weight: 800; }
${C} [data-type=todoListItem]::before { content: ''; top: .5em; width: .95em; height: .95em; border: 2px solid ${A}; border-radius: min(var(--jul-editor-radius), 5px); background: ${tint(16)}; cursor: pointer; }
${C} [data-type=todoListItem][data-jul-editor-checked="true"]::before { background: ${A}; box-shadow: inset 0 0 0 2px #fff; }
${C} [data-type=quote] { padding: 12px 18px; border-left: 4px solid ${A}; background: ${tint(9)}; border-radius: 0 var(--jul-editor-radius) var(--jul-editor-radius) 0; }
${C} :is([data-type=paragraph], [data-type=bulletListItem], [data-type=orderedListItem], [data-type=todoListItem], [data-type=quote]) code { padding: 1px 5px; border: 1px solid ${tint(28)}; background: ${tint(13)}; color: ${A}; }
${TH} { border-bottom: 2px solid ${A}; background: ${tint(16, "var(--jul-editor-bg)")}; color: ${A}; font-weight: 700; }
${C} [data-mention] { padding: 1px 8px; border: 1px solid ${tint(34)}; border-radius: 999px; background: ${tint(16)}; color: ${A}; font-weight: 600; }
${C} [data-jul-editor-selected] { outline: 2px solid ${A}; }
${C} [data-type=divider] hr { border-top-color: ${A}; }`;

const lookCss: Record<CustomLook, string> = {
  soft: `${S} .editor-toolbar { padding: 11px 18px; }
${S} .tool-button { border-radius: calc(var(--jul-editor-radius) * 3); }
${C} { background-image: linear-gradient(180deg, ${tint(8)}, transparent 260px); }
${C} [data-type=table] { border-radius: var(--jul-editor-radius); overflow: hidden; }
${H(1)} { font-size: 2.3em; }`,
  sharp: `${S} .editor-toolbar { min-height: 38px; padding: 6px 10px; gap: 4px; }
${S} .tool-button { border-radius: 0; border-color: var(--jul-editor-border); }
${H(1)} { padding-bottom: 6px; border-bottom: 2px solid ${INK}; }
${H(1)}::after { display: none; }
${H(2)}, ${H(3)} { font-size: .98em; letter-spacing: .1em; text-transform: uppercase; }
${H(2)} { padding-bottom: 3px; border-bottom: 1px solid var(--jul-editor-border); }
${C} [data-type=codeBlock] { border-color: ${INK}; }
${C} [data-type=tableCell] { padding: 3px 8px; border-color: ${INK}; }
${C} [data-type=divider] hr { border-top-style: dotted; }`,
  brutal: `${S} .editor-instance { border-color: ${INK}; }
${S} .editor-toolbar { gap: 7px; border-bottom: 3px solid ${INK}; background: var(--jul-editor-panel); }
${S} .tool-button { border: 2px solid ${INK}; border-radius: 0; background: var(--jul-editor-bg); color: ${INK}; box-shadow: 2px 2px 0 ${INK}; font-weight: 800; }
${S} .tool-button:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 ${INK}; background: ${tint(20, "var(--jul-editor-bg)")}; border-color: ${INK}; color: ${INK}; }
${S} .tool-button[aria-pressed=true] { transform: translate(2px, 2px); box-shadow: none; border-color: ${INK}; background: ${A}; color: var(--jul-editor-accent-ink); }
${C} { font-weight: 500; background-image: radial-gradient(color-mix(in srgb, ${INK} 16%, transparent) 1px, transparent 1.3px); background-size: 14px 14px; }
${H(1)} { font-size: 2.5em; line-height: 1.05; }
${H(1)}::after { width: 100%; height: 7px; margin-top: .22em; border-radius: 0; background: ${A}; outline: 2px solid ${INK}; }
${C} [data-type=quote] { padding: 14px 20px; border: 3px solid ${INK}; border-left: 12px solid ${A}; border-radius: 0; background: var(--jul-editor-panel); box-shadow: 5px 5px 0 ${INK}; color: ${INK}; font-style: normal; font-weight: 700; }
${C} [data-type=codeBlock] { border: 3px solid ${INK}; box-shadow: 5px 5px 0 ${INK}; }
${C} [data-jul-editor-image] img { border: 3px solid ${INK}; box-shadow: 6px 6px 0 ${INK}; }
${C} [data-type=tableCell] { border: 2px solid ${INK}; }
${TH} { background: ${A}; color: var(--jul-editor-accent-ink); }
${C} [data-mention] { border: 2px solid ${INK}; border-radius: 0; box-shadow: 2px 2px 0 ${INK}; color: ${INK}; background: ${tint(26, "var(--jul-editor-bg)")}; }
${C} a { text-decoration-thickness: 3px; }`,
  editorial: `${S} .editor-toolbar { justify-content: center; border-bottom: 3px double var(--jul-editor-border); background: transparent; }
${S} .tool-button { border-color: transparent; border-radius: 0; font-family: var(--jul-editor-heading); }
${S} .tool-button[aria-pressed=true] { background: transparent; color: ${A}; border-bottom-color: ${A}; }
${C} { padding-inline: max(82px, calc((100% - 66ch) / 2)) max(6%, calc((100% - 66ch) / 2)); font-size: 16px; }
${H(1)} { font-size: 2.7em; line-height: 1.08; }
${H(1)}::after { width: 100%; height: 6px; margin-top: .4em; border-block: 1px solid ${A}; border-radius: 0; background: transparent; }
${H(2)} { margin-top: 1.6em; padding-top: .6em; border-top: 1px solid var(--jul-editor-border); font-size: 1.6em; }
${H(1)} + [data-type=paragraph] > [data-jul-editor-content]::first-letter { float: left; padding: .05em .1em 0 0; color: ${A}; font: 700 3.4em/.85 var(--jul-editor-heading); }
${C} [data-type=quote] { padding: 20px 8%; border-left: 0; border-block: 1px solid ${A}; border-radius: 0; background: transparent; color: ${INK}; font-size: 1.3em; text-align: center; }
${C} [data-type=tableCell] { border-width: 0 0 1px; }
${TH} { font-size: .85em; letter-spacing: .08em; text-transform: uppercase; background: transparent; }`,
  mono: `${S} .editor-toolbar { min-height: 36px; padding: 6px 10px; gap: 4px; background: transparent; border-bottom: 1px dashed var(--jul-editor-border); }
${S} .tool-button { border: 1px dashed var(--jul-editor-border); border-radius: 0; font-family: var(--jul-editor-font); }
${C} { font-size: 13px; background-image: repeating-linear-gradient(0deg, transparent 0 2px, color-mix(in srgb, ${INK} 4%, transparent) 2px 3px); }
${C} [data-type=heading]:not([data-jul-editor-empty]) > [data-jul-editor-content]::before { content: '#'; margin-right: .5ch; color: ${A}; }
${H(2)}:not([data-jul-editor-empty]) > [data-jul-editor-content]::before { content: '##'; }
${H(3)}:not([data-jul-editor-empty]) > [data-jul-editor-content]::before { content: '###'; }
${H(1)} { font-size: 1.6em; }
${H(1)}::after { width: 100%; height: 0; border-top: 1px dashed ${A}; background: transparent; }
${H(2)} { font-size: 1.2em; }
${C} [data-type=bulletListItem]::before { content: '>'; }
${C} [data-type=todoListItem]::before { content: '[ ]'; top: 0; width: auto; height: auto; border: 0; background: transparent; color: ${A}; font-weight: 700; }
${C} [data-type=todoListItem][data-jul-editor-checked="true"]::before { content: '[x]'; box-shadow: none; }
${C} [data-type=todoListItem] { padding-left: 32px; }
${C} [data-type=quote] { border-left: 2px solid ${A}; background: transparent; font: normal 1em/1.5 var(--jul-editor-font); }
${C} [data-type=tableCell] { border-style: dashed; padding: 3px 8px; }
${TH} { text-transform: uppercase; letter-spacing: .06em; font-size: .9em; }`,
};

// Page background details carried over from the former Notebook and Blueprint cases.
const flairCss: Record<CustomFlair, string> = {
  none: "",
  ruled: `${C} { background-image: linear-gradient(color-mix(in srgb, ${INK} 14%, transparent) 1px, transparent 1px); background-size: 100% 31px; }`,
  grid: `${C} { background-image: linear-gradient(${tint(8)} 1px, transparent 1px), linear-gradient(90deg, ${tint(8)} 1px, transparent 1px); background-size: 24px 24px; }`,
};

export function customThemeExtra(config: CustomThemeConfig): string {
  const density = config.style === "airy"
    ? `${C} { padding-block: 42px; line-height: 1.95; }\n${H(1)} { font-size: 2.3em; }`
    : config.style === "compact"
      ? `${C} { padding-block: 20px; line-height: 1.55; }\n${C} [data-type=heading] { margin-block: 11px 5px; }\n${S} .editor-toolbar { min-height: 42px; }`
      : "";
  return [baseCss, accentCss, lookCss[config.look], density, flairCss[config.flair ?? "none"]].filter(Boolean).join("\n");
}

type ControlsProps = {
  value: CustomThemeConfig;
  onChange: (value: CustomThemeConfig) => void;
  locale: "en" | "ko";
  onGetCode?: () => void;
};

const surfaceKeys: CustomColorKey[] = ["bg", "panel", "ink", "muted", "border"];
const accentKeys: CustomColorKey[] = ["accent", "active"];
const colorLabels: Record<CustomColorKey, [string, string]> = { bg: ["Background", "배경"], panel: ["Panel", "패널"], ink: ["Text", "본문"], muted: ["Muted text", "보조 글자"], border: ["Border", "테두리"], accent: ["Accent", "강조색"], active: ["Accent tint", "강조 배경"] };
function omitColors(colors: CustomThemeConfig["colors"], keys: CustomColorKey[]): CustomThemeConfig["colors"] {
  if (!colors) return undefined;
  const rest = Object.fromEntries(Object.entries(colors).filter(([key]) => !keys.includes(key as CustomColorKey)));
  return Object.keys(rest).length ? rest : undefined;
}

const groupLabels = { sans: ["Sans", "산세리프"], serif: ["Serif", "세리프"], mono: ["Mono", "고정폭"] } as const;

function FontOptions() {
  return <>{(["sans", "serif", "mono"] as const).map((group) => <optgroup key={group} label={groupLabels[group][0]}>
    {fontKeys.filter((key) => fonts[key].group === group).map((key) => <option key={key} value={key}>{fonts[key].en}</option>)}
  </optgroup>)}</>;
}

export function CustomThemeControls({ value, onChange, locale, onGetCode }: ControlsProps) {
  const t = (en: string, ko: string) => locale === "ko" ? ko : en;
  const set = <K extends keyof CustomThemeConfig>(key: K, next: CustomThemeConfig[K]) => onChange({ ...value, [key]: next });
  const hasSurfaceColors = surfaceKeys.some((key) => value.colors?.[key]);
  const hasAccentColors = accentKeys.some((key) => value.colors?.[key]);
  const colors = resolvedColors(value);
  return <section className="custom-theme-controls" aria-label={t("Customize theme", "테마 사용자 지정")}>
    <div className="custom-theme-top">
      <div><span className="custom-theme-kicker">{t("EDITOR WORKBENCH", "에디터 워크벤치")}</span><h3>{t("Compose your workspace", "내 작업 공간 만들기")}</h3><p>{t("Pick a style, then adjust the surface, accent, fonts, and chart colors. Your draft stays in place.", "스타일을 고른 뒤 배경, 강조색, 글꼴, 차트 색상을 조정하세요. 작성 중인 내용은 그대로 유지됩니다.")}</p></div>
      {onGetCode && <button className="custom-theme-code" type="button" onClick={onGetCode}><Code2 size={15} aria-hidden="true" /> {t("Get code", "코드 보기")}</button>}
    </div>
    <div className="custom-theme-grid">
      <fieldset className="custom-theme-group custom-theme-group--wide custom-theme-group--presets">
        <legend><span className="custom-theme-section-number">01</span> {t("Preset", "프리셋")}</legend>
        <p>{t("Start from a ready-made look. It fills every control below, and each value stays editable.", "완성된 스타일에서 시작하세요. 아래 모든 값이 채워지고 계속 수정할 수 있습니다.")}</p>
        <div className="custom-theme-preset-list">
          {THEME_PRESETS.map((preset) => {
            const c = resolvedColors(preset.config);
            return <button key={preset.id} type="button" aria-pressed={value.preset === preset.id} onClick={() => onChange(preset.config)}>
              <span className="custom-theme-preset-swatch" style={{ background: c.bg, color: c.ink, borderColor: c.border, fontFamily: fonts[preset.config.headingFont].stack, borderRadius: Math.min(preset.config.radius, 8) }} aria-hidden="true"><i style={{ background: c.accent }} /><b>Aa</b><u style={{ background: c.muted }} /></span>
              <span><strong>{locale === "ko" ? preset.ko : preset.en}</strong><small>{locale === "ko" ? preset.descKo : preset.descEn}</small></span>
            </button>;
          })}
        </div>
        <label className="custom-theme-sample">{t("Sample document", "샘플 문서")}<select value={value.sample ?? "custom"} onChange={(event) => set("sample", event.target.value)}>
          {SAMPLE_IDS.map((id) => <option key={id} value={id}>{id === "custom" ? t("Default", "기본") : t(THEME_PRESETS.find((preset) => preset.id === id)!.en, THEME_PRESETS.find((preset) => preset.id === id)!.ko)}</option>)}
        </select></label>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend><span className="custom-theme-section-number">02</span> {t("Style", "스타일")}</legend>
        <div className="custom-theme-looks">
          {lookKeys.map((key) => <button key={key} type="button" aria-pressed={value.look === key} onClick={() => onChange(applyCustomLook(value, key))}>
            <span className="custom-theme-look-preview" data-look={key} aria-hidden="true"><b>Aa</b><i /><i /></span>
            <span><strong>{locale === "ko" ? looks[key].ko : looks[key].en}</strong><small>{locale === "ko" ? looks[key].descKo : looks[key].descEn}</small></span>
          </button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend><span className="custom-theme-section-number">03</span> {t("Surface theme", "배경 테마")}</legend>
        <div className="custom-theme-surfaces">
          {surfaces.map((surface) => <button key={surface.id} type="button" aria-pressed={!hasSurfaceColors && (value.surface ?? (value.appearance === "dark" ? "midnight" : "paper")) === surface.id} onClick={() => onChange({ ...value, surface: surface.id, appearance: surface.appearance, colors: omitColors(value.colors, surfaceKeys) })}>
            <span className="custom-theme-surface-preview" style={{ background: surface.bg, color: surface.ink, borderColor: surface.border }} aria-hidden="true"><i style={{ background: surface.panel, borderColor: surface.border }} /><span>Aa<span style={{ color: surface.muted }}>Document</span></span></span>
            <span>{locale === "ko" ? surface.ko : surface.en}</span>
          </button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend><span className="custom-theme-section-number">04</span> {t("Accent palette", "강조색 팔레트")}</legend>
        <div className="custom-theme-accents">
          {palettes.map((palette) => <button key={palette.id} type="button" aria-pressed={!hasAccentColors && value.palette === palette.id} onClick={() => onChange({ ...value, palette: palette.id, colors: omitColors(value.colors, accentKeys) })}><span className="custom-theme-accent-dots" aria-hidden="true">{[palette.light, palette.dark, palette.lightActive].map((color) => <i key={color} style={{ background: color }} />)}</span><span>{locale === "ko" ? palette.ko : palette.en}</span></button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend><span className="custom-theme-section-number">05</span> {t("Font pairing", "글꼴 조합")}</legend>
        <div className="custom-theme-pairs">
          {pairings.map((pair) => <button key={pair.id} type="button" aria-pressed={value.bodyFont === pair.body && value.headingFont === pair.heading} onClick={() => onChange({ ...value, bodyFont: pair.body, headingFont: pair.heading })}><b style={{ fontFamily: fonts[pair.heading].stack }}>Aa</b><span>{locale === "ko" ? pair.ko : pair.en}</span></button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend>{t("Fine-tune colors", "색상 세부 조정")}</legend>
        <div className="custom-theme-colors">
          {(Object.keys(colorLabels) as CustomColorKey[]).map((key) => <label key={key}><input type="color" value={colors[key]} aria-label={t(colorLabels[key][0], colorLabels[key][1])} onChange={(event) => onChange({ ...value, colors: { ...value.colors, [key]: event.target.value } })} /><span>{t(colorLabels[key][0], colorLabels[key][1])}<small>{colors[key]}</small></span></label>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group">
        <legend>{t("Page background", "페이지 배경")}</legend>
        <div className="custom-theme-options">
          {(["none", "ruled", "grid"] as const).map((flair) => <button key={flair} type="button" aria-pressed={(value.flair ?? "none") === flair} onClick={() => set("flair", flair)}>{flair === "none" ? t("Plain", "없음") : flair === "ruled" ? t("Ruled lines", "줄 노트") : t("Blueprint grid", "격자")}</button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend>{t("Typography", "글꼴")}</legend>
        <div className="custom-theme-fonts">
          <label>{t("Body", "본문")}<select value={value.bodyFont} onChange={(event) => set("bodyFont", event.target.value as FontKey)}><FontOptions /></select></label>
          <label>{t("Headings", "제목")}<select value={value.headingFont} onChange={(event) => set("headingFont", event.target.value as FontKey)}><FontOptions /></select></label>
        </div>
      </fieldset>
      <fieldset className="custom-theme-group">
        <legend>{t("Density", "밀도")}</legend>
        <div className="custom-theme-options">
          {(["balanced", "airy", "compact"] as const).map((style) => <button key={style} type="button" aria-pressed={value.style === style} onClick={() => set("style", style)}>{style === "balanced" ? t("Balanced", "기본") : style === "airy" ? t("Airy", "여유롭게") : t("Compact", "간결하게")}</button>)}
        </div>
      </fieldset>
      <fieldset className="custom-theme-group">
        <legend>{t("Corner shape", "모서리 모양")}</legend>
        <div className="custom-theme-options custom-theme-corners">{[{ radius: 0, en: "Square", ko: "직각" }, { radius: 4, en: "Subtle", ko: "살짝 둥글게" }, { radius: 8, en: "Rounded", ko: "둥글게" }, { radius: 12, en: "Smooth", ko: "부드럽게" }, { radius: 16, en: "Pill", ko: "아주 둥글게" }].map((shape) => <button key={shape.radius} type="button" aria-pressed={value.radius === shape.radius} onClick={() => set("radius", shape.radius)}><i style={{ borderRadius: shape.radius }} aria-hidden="true" />{t(shape.en, shape.ko)}</button>)}</div>
      </fieldset>
      <fieldset className="custom-theme-group custom-theme-group--wide">
        <legend>{t("Chart colors", "차트 색상")}</legend>
        <div className="custom-theme-chart-options">
          {(["theme", "spectrum", "ocean", "harvest", "mono"] as const).map((chart) => <button key={chart} type="button" aria-pressed={value.chart === chart} onClick={() => set("chart", chart)}><span>{chart === "theme" ? t("Match theme", "테마와 맞춤") : chart === "spectrum" ? t("Spectrum", "스펙트럼") : chart === "ocean" ? t("Ocean", "오션") : chart === "harvest" ? t("Harvest", "하베스트") : t("Monochrome", "단색")}</span><span className="custom-theme-chart-bars" aria-hidden="true">{chartColors({ ...value, chart }).map((color, index) => <i key={index} style={{ background: color }} />)}</span></button>)}
        </div>
      </fieldset>
    </div>
  </section>;
}
