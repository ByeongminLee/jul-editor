import { toggleBlock, toggleHeadingSlashItems, toggleInputRules, toggleSlashItem, toggleTurnIntoItems } from "./block.js";
import { ToggleView } from "./toggle-view.js";

export { toggleBlock, toggleSlashItem, toggleTurnIntoItems, toggleHeadingSlashItems, toggleInputRules, readToggle, setToggleOpen, collapsedToggleAncestors } from "./block.js";
export type { ToggleProps } from "./block.js";
export { ToggleView, TOGGLE_CSS, createMemoryOpenStore } from "./toggle-view.js";
export type { ToggleViewProps, ToggleClassNames, ToggleOpenStore } from "./toggle-view.js";
export { fromMarkdownExt } from "../notion-shared/markdown-ext.js";
export type { MarkdownExtOptions } from "../notion-shared/markdown-ext.js";

/** Spread into `<Editor.Plugin {...togglePlugin} />`. */
export const togglePlugin = {
  blocks: [toggleBlock],
  renderers: { toggle: ToggleView },
  slashItems: [toggleSlashItem, ...toggleHeadingSlashItems],
  inputRules: toggleInputRules,
  turnIntoItems: toggleTurnIntoItems,
};
