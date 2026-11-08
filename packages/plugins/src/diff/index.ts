// "@jul-editor/plugins/diff": document diff algorithm (DOM-free) plus the headless React views.
export { diffDocs, diffStats, summarize } from "./diff.js";
export type { DiffNode, DiffTree, InlineOp, PropChange, DiffStats as DiffStatsData } from "./diff.js";
export { DiffStats, DiffView, useDiff } from "./diff-view.js";
export type { DiffBlockRendererProps, DiffStatsProps, DiffViewProps } from "./diff-view.js";
// Inline compare (single document view) + suggestion / tracked-changes review.
export { computeInlineDiff, inlineText, sliceInline } from "./inline-diff.js";
export type {
  ChangeAttribution,
  ChangeKind,
  ComputeInlineDiffOptions,
  InlineChange,
  InlineDiff,
  InlineDiffBlock,
  InlineDiffSegment,
} from "./inline-diff.js";
export { applyDecisions, decideAll, getDecision } from "./apply-decisions.js";
export type { ApplyDecisionsOptions, ChangeDecision, DecisionMap } from "./apply-decisions.js";
export { InlineDiffView, useInlineDiff } from "./inline-diff-view.js";
export type { InlineDiffViewProps, RenderChangeContext } from "./inline-diff-view.js";
export { DEFAULT_SUGGESTION_LABELS, SuggestionView, useSuggestions } from "./suggestion-view.js";
export type { SuggestionLabels, SuggestionViewProps, UseSuggestionsOptions, UseSuggestionsResult } from "./suggestion-view.js";
export { DIFF_CSS } from "./diff-styles.js";
export { DiffCompare, DiffStyles } from "./diff-compare.js";
export type { DiffCompareProps } from "./diff-compare.js";
// In-editor suggestion mode (core view decorations + transactions).
export { createEditorSuggestions, DEFAULT_EDITOR_SUGGESTION_LABELS, SUGGESTION_CLASSES, SUGGESTION_CSS } from "./editor-suggestions.js";
export type { EditorSuggestionLabels, EditorSuggestions, EditorSuggestionsOptions } from "./editor-suggestions.js";
export { useEditorSuggestions } from "./use-editor-suggestions.js";
export type { UseEditorSuggestionsResult } from "./use-editor-suggestions.js";
export { reconcileDoc } from "./reconcile-doc.js";
export { wordifyOps } from "./word-diff.js";
