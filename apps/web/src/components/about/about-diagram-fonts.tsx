import { useDiagramFonts } from "./about-diagram-kit.js";

/** Mounts the diagram web fonts (Geist, Geist Mono, Instrument Serif, Noto Sans KR) for the About page only. */
export function AboutDiagramFonts() {
  useDiagramFonts();
  return null;
}
