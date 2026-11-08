// Plugin-injectable entries for the two block-level menus that used to be hardcoded:
// the "Turn into" list (turn-into.tsx) and the block (drag handle) context menu
// (drag-handle/use-block-actions.ts). A plugin passes them on `<Editor.Plugin turnIntoItems
// blockMenuItems>`; Editor collects them into the editor context, the hooks append them after the
// built-ins. Framework-agnostic data only (no JSX), so a plugin package needs no React import.
import type { Block, Editor as CoreEditor, Json, Registry } from "@jul-editor/core";
import type { Locale } from "./labels.js";

/** A plain string, or one string per locale (falls back to `en`, then to the first one given). */
export type LocalizedLabel = string | Partial<Record<Locale, string>>;

export function resolveLabel(label: LocalizedLabel, locale: Locale): string {
  if (typeof label === "string") return label;
  return label[locale] ?? label.en ?? Object.values(label)[0] ?? "";
}

/** One extra "Turn into" entry. `props` are the non-default props to set AND the active test
 * (the item is active when the touched block has this type and these effective prop values),
 * so list several variants of one type (toggle level 0..3, callout colors) with distinct ids. */
export interface TurnIntoPluginItem {
  id: string;
  type: string;
  props?: Record<string, Json>;
  label: LocalizedLabel;
  keywords?: string[];
}

/** One extra entry in the block (drag handle) menu. Return false from `isVisible` to hide it for
 * a block (for example a "Copy link" action that only applies to some types). */
export interface BlockMenuPluginItem {
  id: string;
  label: LocalizedLabel;
  icon?: string;
  isVisible?(block: Block, registry: Registry): boolean;
  run(editor: CoreEditor, blockId: string): void;
}
