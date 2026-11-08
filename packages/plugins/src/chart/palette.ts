// Chart palette helpers. Pure (no React, no Recharts) so both the lazy chart
// and the editor can share them.

/** Fallback hexes used when a host does not define --chart-1..--chart-8. */
export const DEFAULT_PALETTE_HEX: readonly string[] = [
  "#e8833a", "#4a90c2", "#5aa469", "#c9566b", "#8e6fc4", "#d4a82f", "#2fa7a0", "#8a93a6",
];

export const DEFAULT_COLORS: readonly string[] = DEFAULT_PALETTE_HEX.map((hex, i) => `var(--chart-${i + 1}, ${hex})`);

export const PALETTE_SIZE = DEFAULT_PALETTE_HEX.length;

export interface PalettePreset { id: string; en: string; ko: string; colors: readonly string[] }

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  { id: "default", en: "Default", ko: "기본", colors: DEFAULT_PALETTE_HEX },
  { id: "ocean", en: "Ocean", ko: "바다", colors: ["#3c94b7", "#2f6fb0", "#5cc0c9", "#7aa7e0", "#1f8a8a", "#a3d5e8", "#4b5fa8", "#6fb7a0"] },
  { id: "sunset", en: "Sunset", ko: "노을", colors: ["#f2784b", "#e0505f", "#f5a742", "#b5457f", "#f7d070", "#8a4a9e", "#d9694a", "#f09d8c"] },
  { id: "forest", en: "Forest", ko: "숲", colors: ["#4f9d69", "#8bb369", "#2f7d6b", "#c2b04a", "#6b8f5a", "#a7c97e", "#3f6f4f", "#d1a05a"] },
  { id: "pastel", en: "Pastel", ko: "파스텔", colors: ["#f4a6a0", "#a7c7e7", "#b5e0b0", "#f7d9a0", "#cdb4e6", "#9fdcd5", "#f5b8d4", "#c9c9c9"] },
];

/** Reads a stored `palette` prop: keeps non-empty strings, null when unset or unusable. */
export function readPalette(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const colors = value.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim());
  return colors.length ? colors : null;
}

/** Colors for rendering: the per-chart override, else the themeable defaults. */
export function resolvePalette(palette?: readonly string[] | null): readonly string[] {
  return palette && palette.length ? palette : DEFAULT_COLORS;
}

export type ColorBy = "series" | "category";

export function readColorBy(value: unknown): ColorBy | undefined {
  return value === "series" || value === "category" ? value : undefined;
}
