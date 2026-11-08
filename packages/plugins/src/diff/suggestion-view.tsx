"use client";

// Suggestion / tracked-changes review: a base doc plus a proposed doc (e.g. from a mock AI agent),
// shown inline with per-change Accept / Reject and Accept all / Reject all, producing the
// resulting Doc via applyDecisions.
//
// This is the standalone, read-only review surface (InlineDiffView + controls); it can show blocks
// that are not in any editor, such as a deleted block. To review suggestions INSIDE the live editor
// (highlighted text, struck-through deletions, per-change Accept / Reject applied by transactions)
// use `useEditorSuggestions` / `createEditorSuggestions` (editor-suggestions.ts), which are built on
// core's `editor.setDecorations`. Both share the same change ids and `applyDecisions`.

import type { Doc, Registry } from "@jul-editor/core";
import { coreRegistry } from "@jul-editor/core";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyDecisions, decideAll, type ChangeDecision } from "./apply-decisions.js";
import { InlineDiffView, useInlineDiff, type InlineDiffViewProps } from "./inline-diff-view.js";
import type { InlineChange, InlineDiff } from "./inline-diff.js";

export interface SuggestionLabels {
  accept: string;
  reject: string;
  undo: string;
  acceptAll: string;
  rejectAll: string;
  pending: (n: number) => string;
  noChanges: string;
}

export const DEFAULT_SUGGESTION_LABELS: SuggestionLabels = {
  accept: "Accept",
  reject: "Reject",
  undo: "Undo",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  pending: (n) => `${n} pending`,
  noChanges: "No suggested changes",
};

export interface UseSuggestionsOptions {
  base: Doc;
  proposed: Doc;
  registry?: Registry;
  attribute?: InlineDiffViewProps["attribute"];
  /** Text hunk granularity: "word" (default, one change per edited word) or "char". */
  granularity?: "char" | "word";
  /** Controlled decisions. Omit for internal state. */
  decisions?: Record<string, ChangeDecision>;
  onDecisionsChange?: (next: Record<string, ChangeDecision>) => void;
  /** Fired (not on mount) with the resulting Doc whenever decisions change. Pending counts as reject. */
  onResult?: (doc: Doc) => void;
}

export interface UseSuggestionsResult {
  diff: InlineDiff;
  decisions: Record<string, ChangeDecision>;
  pending: InlineChange[];
  /** Resolution so far: accepted changes applied, rejected and pending kept as base. */
  result: Doc;
  decide(id: string, decision: ChangeDecision): void;
  /** Back to pending. */
  undo(id: string): void;
  acceptAll(): void;
  rejectAll(): void;
  reset(): void;
}

export function useSuggestions(opts: UseSuggestionsOptions): UseSuggestionsResult {
  const { base, proposed, registry = coreRegistry, attribute, granularity, onDecisionsChange, onResult } = opts;
  const diff = useInlineDiff(base, proposed, registry, attribute, granularity);
  const [inner, setInner] = useState<Record<string, ChangeDecision>>({});
  const decisions = opts.decisions ?? inner;
  const ref = useRef(decisions);
  ref.current = decisions;

  const set = useCallback(
    (next: Record<string, ChangeDecision>) => {
      ref.current = next;
      if (opts.decisions === undefined) setInner(next);
      onDecisionsChange?.(next);
    },
    [opts.decisions, onDecisionsChange],
  );
  const decide = useCallback((id: string, d: ChangeDecision) => set({ ...ref.current, [id]: d }), [set]);
  const undo = useCallback(
    (id: string) => {
      const next = { ...ref.current };
      delete next[id];
      set(next);
    },
    [set],
  );
  const acceptAll = useCallback(() => set(decideAll(diff, "accept")), [set, diff]);
  const rejectAll = useCallback(() => set(decideAll(diff, "reject")), [set, diff]);
  const reset = useCallback(() => set({}), [set]);

  const result = useMemo(() => applyDecisions(base, proposed, decisions, { registry, diff, granularity }), [base, proposed, decisions, registry, diff, granularity]);
  const pending = useMemo(() => diff.changes.filter((c) => decisions[c.id] === undefined), [diff, decisions]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onResult?.(result);
    // onResult intentionally omitted: fire only when the resolution actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return { diff, decisions, pending, result, decide, undo, acceptAll, rejectAll, reset };
}

export interface SuggestionViewProps extends Omit<UseSuggestionsOptions, "base" | "proposed"> {
  base: Doc;
  proposed: Doc;
  renderers?: InlineDiffViewProps["renderers"];
  labels?: Partial<SuggestionLabels>;
  /** Hide the Accept all / Reject all bar. */
  hideToolbar?: boolean;
  className?: string;
}

/** Inline review UI. Each change gets Accept / Reject buttons (Undo once decided); decided changes
 * render in their final state. */
export function SuggestionView(props: SuggestionViewProps): ReactNode {
  const { base, proposed, registry = coreRegistry, renderers, hideToolbar, className } = props;
  const labels = { ...DEFAULT_SUGGESTION_LABELS, ...props.labels };
  const s = useSuggestions(props);

  const renderChange = useCallback(
    (change: InlineChange, ctx: { decision: ChangeDecision | undefined }): ReactNode => (
      <span data-jul-editor-diff-actions data-for={change.id} contentEditable={false}>
        {ctx.decision ? (
          <button type="button" data-action="undo" onClick={() => s.undo(change.id)}>
            {labels.undo}
          </button>
        ) : (
          <>
            <button type="button" data-action="accept" aria-label={`${labels.accept}: ${change.summary}`} onClick={() => s.decide(change.id, "accept")}>
              {labels.accept}
            </button>
            <button type="button" data-action="reject" aria-label={`${labels.reject}: ${change.summary}`} onClick={() => s.decide(change.id, "reject")}>
              {labels.reject}
            </button>
          </>
        )}
      </span>
    ),
    // labels is rebuilt per render; its string fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.undo, s.decide, labels.undo, labels.accept, labels.reject],
  );

  return (
    <div data-jul-editor-suggestion className={className}>
      {!hideToolbar && (
        <div data-jul-editor-suggestion-toolbar role="toolbar">
          <span data-suggestion-pending>{s.diff.changes.length === 0 ? labels.noChanges : labels.pending(s.pending.length)}</span>
          <span data-spacer />
          <button type="button" data-action="accept-all" disabled={s.diff.changes.length === 0} onClick={s.acceptAll}>
            {labels.acceptAll}
          </button>
          <button type="button" data-action="reject-all" disabled={s.diff.changes.length === 0} onClick={s.rejectAll}>
            {labels.rejectAll}
          </button>
        </div>
      )}
      <InlineDiffView before={base} after={proposed} registry={registry} renderers={renderers} diff={s.diff} decisions={s.decisions} renderChange={renderChange} />
    </div>
  );
}
