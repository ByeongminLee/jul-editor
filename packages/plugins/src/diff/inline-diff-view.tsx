"use client";

// <InlineDiffView before after /> renders the single-document "compare" view computed by
// computeInlineDiff: inserted text/blocks green, deleted red strikethrough, modified blocks and
// moved blocks flagged, optional per-change attribution. Headless like DiffView (data attributes,
// styled by ./diff-styles.ts). When `decisions` is given, resolved changes render as their final
// state (accepted insert = plain text, rejected insert = hidden, ...) and `renderChange` can mount
// per-change controls; <SuggestionView> (./suggestion-view.tsx) is built on exactly that.

import type { Block, Doc, Registry } from "@jul-editor/core";
import { coreRegistry, isVoidBlockSpec } from "@jul-editor/core";
import { renderPlainContent } from "@jul-editor/react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Fragment, useMemo } from "react";
import { getDecision, type ChangeDecision, type DecisionMap } from "./apply-decisions.js";
import type { DiffBlockRendererProps } from "./diff-view.js";
import { computeInlineDiff, type ChangeAttribution, type InlineChange, type InlineDiff, type InlineDiffBlock, type InlineDiffSegment } from "./inline-diff.js";

export interface RenderChangeContext {
  decision: ChangeDecision | undefined;
}

export interface InlineDiffViewProps {
  before: Doc;
  after: Doc;
  registry?: Registry;
  renderers?: Record<string, ComponentType<DiffBlockRendererProps>>;
  /** Maps a change to its author; shown as `data-diff-author*`, a `title` and `--jul-editor-diff-author`. */
  attribute?: (change: InlineChange) => ChangeAttribution | undefined;
  /** Text hunk granularity, see ComputeInlineDiffOptions. Default "word". */
  granularity?: "char" | "word";
  /** Precomputed model (e.g. from useInlineDiff); `before`/`after` must match it. */
  diff?: InlineDiff;
  /** Per-change decisions; resolved changes render in their final state. */
  decisions?: DecisionMap;
  /** Mounted after each change (after the text hunk, in the block header for block level changes). */
  renderChange?: (change: InlineChange, ctx: RenderChangeContext) => ReactNode;
  className?: string;
}

/** Memoized computeInlineDiff. Keep `attribute` referentially stable (module level or useCallback). */
export function useInlineDiff(
  before: Doc,
  after: Doc,
  registry: Registry = coreRegistry,
  attribute?: InlineDiffViewProps["attribute"],
  granularity?: "char" | "word",
): InlineDiff {
  return useMemo(() => computeInlineDiff(before, after, { registry, attribute, granularity }), [before, after, registry, attribute, granularity]);
}

interface Ctx {
  diff: InlineDiff;
  registry: Registry;
  renderers: InlineDiffViewProps["renderers"];
  decisions: DecisionMap | undefined;
  renderChange: InlineDiffViewProps["renderChange"];
}

function authorAttrs(change: InlineChange | undefined): Record<string, unknown> {
  const a = change?.attribution;
  if (!a) return {};
  const style = a.color ? ({ "--jul-editor-diff-author": a.color } as CSSProperties) : undefined;
  return { "data-diff-author": a.id ?? a.name ?? "", "data-diff-author-name": a.name, title: a.name, style };
}

function VoidContent({ block, ctx }: { block: Block; ctx: Ctx }): ReactNode {
  const Renderer = ctx.renderers?.[block.type];
  if (Renderer) return <Renderer block={{ id: block.id, type: block.type, props: block.props }} readOnly />;
  return <figure data-type={block.type} />;
}

function Controls({ change, ctx }: { change: InlineChange | undefined; ctx: Ctx }): ReactNode {
  if (!change || !ctx.renderChange) return null;
  const decision = ctx.decisions ? getDecision(ctx.decisions, change.id) : undefined;
  return <Fragment key={`ctl-${change.id}`}>{ctx.renderChange(change, { decision })}</Fragment>;
}

function SegmentNode({ seg, ctx }: { seg: InlineDiffSegment; ctx: Ctx }): ReactNode {
  if (seg.kind === "same") return <>{renderPlainContent(seg.content, ctx.registry)}</>;
  const change = ctx.diff.changeById.get(seg.changeId!);
  const decision = ctx.decisions ? getDecision(ctx.decisions, seg.changeId!) : undefined;
  const attrs = authorAttrs(change);
  if (decision) {
    // Resolved: show only the surviving side, unhighlighted.
    const keep = seg.kind === "fmt" ? (decision === "accept" ? seg.content : (seg.oldContent ?? seg.content)) : seg.kind === "ins" ? (decision === "accept" ? seg.content : null) : decision === "reject" ? seg.content : null;
    if (!keep) return null;
    return (
      <span data-diff-decision={decision} data-change-id={seg.changeId}>
        {renderPlainContent(keep, ctx.registry)}
      </span>
    );
  }
  if (seg.kind === "ins") {
    return (
      <ins data-diff-inline="insert" data-change-id={seg.changeId} {...attrs}>
        {renderPlainContent(seg.content, ctx.registry)}
      </ins>
    );
  }
  if (seg.kind === "del") {
    return (
      <del data-diff-inline="delete" data-change-id={seg.changeId} {...attrs}>
        {renderPlainContent(seg.content, ctx.registry)}
      </del>
    );
  }
  return (
    <span data-diff-inline="format" data-change-id={seg.changeId} {...attrs}>
      {renderPlainContent(seg.content, ctx.registry)}
    </span>
  );
}

function ContentNode({ node, ctx }: { node: InlineDiffBlock; ctx: Ctx }): ReactNode {
  const { block } = node;
  if (isVoidBlockSpec(ctx.registry.blocks.get(block.type))) return <VoidContent block={block} ctx={ctx} />;
  if (block.content === undefined) return null;

  if (node.segments) {
    const out: ReactNode[] = [];
    node.segments.forEach((seg, i) => {
      out.push(<SegmentNode key={`s${i}`} seg={seg} ctx={ctx} />);
      const next = node.segments![i + 1];
      if (seg.changeId && next?.changeId !== seg.changeId) out.push(<Controls key={`c${i}`} change={ctx.diff.changeById.get(seg.changeId)} ctx={ctx} />);
    });
    return <>{out}</>;
  }
  const rendered = renderPlainContent(block.content, ctx.registry);
  const coverChange = node.coverId ? ctx.diff.changeById.get(node.coverId) : undefined;
  if (node.status === "insert" || node.status === "delete") {
    const tag = node.status === "insert" ? "ins" : "del";
    const decision = node.coverId && ctx.decisions ? getDecision(ctx.decisions, node.coverId) : undefined;
    if (decision) return <span data-diff-decision={decision}>{rendered}</span>;
    const Tag = tag;
    return (
      <Tag data-diff-inline={node.status} {...authorAttrs(coverChange)}>
        {rendered}
      </Tag>
    );
  }
  return <>{rendered}</>;
}

function BlockNode({ node, ctx }: { node: InlineDiffBlock; ctx: Ctx }): ReactNode {
  const coverDecision = node.coverId && ctx.decisions ? getDecision(ctx.decisions, node.coverId) : undefined;
  // Resolved insert (rejected) / delete (accepted): the block is gone from the final document.
  if ((node.status === "insert" && coverDecision === "reject") || (node.status === "delete" && coverDecision === "accept")) return null;

  const moveChange = node.status === "move" ? ctx.diff.changeById.get(`move:${node.id}`) : undefined;
  const moveDecision = moveChange && ctx.decisions ? getDecision(ctx.decisions, moveChange.id) : undefined;
  const propsChange = ctx.diff.changeById.get(`props:${node.id}`);
  const propsDecision = propsChange && ctx.decisions ? getDecision(ctx.decisions, propsChange.id) : undefined;

  const resolvedPlain = coverDecision !== undefined && (node.status === "insert" || node.status === "delete");
  const shownStatus = resolvedPlain ? "same" : node.status === "move" && moveDecision ? "same" : node.status;
  const ownerChange = node.coverId && node.changeIds.includes(node.coverId) ? ctx.diff.changeById.get(node.coverId) : (moveChange ?? propsChange);
  const hasContent = isVoidBlockSpec(ctx.registry.blocks.get(node.block.type)) || node.block.content !== undefined;
  const blockLevel = node.changeIds.map((id) => ctx.diff.changeById.get(id)).filter((c): c is InlineChange => !!c && c.kind !== "text" && c.kind !== "format");

  return (
    <div
      data-jul-editor-diff-block
      data-diff={shownStatus}
      data-type={node.block.type}
      data-id={node.id}
      data-diff-from={node.from ? JSON.stringify(node.from) : undefined}
      data-change-id={node.changeIds[0]}
      data-diff-decision={coverDecision ?? moveDecision}
      {...authorAttrs(ownerChange)}
    >
      {node.status === "move" && !moveDecision && <span data-diff-move-label>moved</span>}
      {hasContent && (
        <div data-jul-editor-diff-content>
          <ContentNode node={node} ctx={ctx} />
        </div>
      )}
      {node.props && node.props.length > 0 && !propsDecision && (
        <dl data-diff-props>
          {node.props.map((p) => (
            <Fragment key={p.key}>
              <dt data-diff-props-key>{p.key}</dt>
              <dd data-diff-props-before>{JSON.stringify(p.before)}</dd>
              <dd data-diff-props-after>{JSON.stringify(p.after)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {blockLevel.length > 0 && ctx.renderChange && (
        <div data-diff-block-actions>
          {blockLevel.map((c) => (
            <Controls key={c.id} change={c} ctx={ctx} />
          ))}
        </div>
      )}
      {node.children.length > 0 && (
        <div data-jul-editor-diff-children>
          {node.children.map((c) => (
            <BlockNode key={c.id} node={c} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InlineDiffView({ before, after, registry = coreRegistry, renderers, attribute, granularity, diff: given, decisions, renderChange, className }: InlineDiffViewProps): ReactNode {
  const computed = useInlineDiff(before, after, registry, attribute, granularity);
  const diff = given ?? computed;
  const ctx: Ctx = { diff, registry, renderers, decisions, renderChange };
  return (
    <div data-jul-editor-diff-inline className={className}>
      {diff.blocks.map((n) => (
        <BlockNode key={n.id} node={n} ctx={ctx} />
      ))}
    </div>
  );
}
