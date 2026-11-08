import type { CSSProperties } from "react";

/** One fixed color per engine, shared by the About pipeline diagram, legend and charts. */
export const ENGINE_COLORS = {
  jul: "#f47721",
  lexical: "#3b82f6",
  quill: "#1fa971",
  prosemirror: "#a855f7",
} as const;

export type EngineId = keyof typeof ENGINE_COLORS;

export const ENGINE_NAMES: Record<EngineId, string> = {
  jul: "JulEditor",
  lexical: "Lexical",
  quill: "Quill",
  prosemirror: "ProseMirror",
};

export const engineColorByName = (name: string): string =>
  (Object.keys(ENGINE_NAMES) as EngineId[]).map((id) => ENGINE_NAMES[id] === name ? ENGINE_COLORS[id] : null).find(Boolean) ?? "#888888";

/** `--eng-<id>` custom properties, set inline on the About page root so every consumer
 * (diagram, legend, walkthrough) reads the same ENGINE_COLORS values. */
export const ENGINE_CSS_VARS = Object.fromEntries(
  (Object.keys(ENGINE_COLORS) as EngineId[]).map((id) => [`--eng-${id}`, ENGINE_COLORS[id]]),
) as CSSProperties;
