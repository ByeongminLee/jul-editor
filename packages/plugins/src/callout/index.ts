import { calloutBlock, calloutInputRules, calloutSlashItem, calloutTurnIntoItems, calloutVariantSlashItems } from "./block.js";
import { CalloutView } from "./callout-view.js";

export { calloutBlock, calloutInputRules, calloutSlashItem, calloutTurnIntoItems, calloutVariantSlashItems, quoteToCallout, readCallout, isCalloutColor, CALLOUT_COLORS, CALLOUT_DEFAULT_ICONS, CALLOUT_MARKERS } from "./block.js";
export type { CalloutColor, CalloutProps } from "./block.js";
export { CalloutView, CALLOUT_CSS, DEFAULT_CALLOUT_EMOJIS } from "./callout-view.js";
export type { CalloutViewProps, CalloutClassNames } from "./callout-view.js";
export { fromMarkdownExt } from "../notion-shared/markdown-ext.js";
export type { MarkdownExtOptions } from "../notion-shared/markdown-ext.js";

/** Spread into `<Editor.Plugin {...calloutPlugin} />`: block spec, renderer, slash items, input rule. */
export const calloutPlugin = {
  blocks: [calloutBlock],
  renderers: { callout: CalloutView },
  slashItems: [calloutSlashItem, ...calloutVariantSlashItems],
  inputRules: calloutInputRules,
  turnIntoItems: calloutTurnIntoItems,
};
