"use client";

// Headless <DiffView before after registry? renderers? mode? className? />
// (no separate <Editor.Diff>). Read-only, no
// editor instance -- takes two Docs and renders the diff DiffTree.

import type { Block, Doc, Json, Registry } from "@jul-editor/core";
import { coreRegistry, isVoidBlockSpec } from "@jul-editor/core";
import { diffDocs, type DiffNode, type DiffStats as DiffStatsShape, type DiffTree } from "./diff.js";
import type { ComponentType, ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import { renderPlainContent } from "@jul-editor/react";
import { computeInlineSegments, renderInlineSegments } from "./inline.js";
import { InlineDiffView } from "./inline-diff-view.js";
import type { ChangeAttribution, InlineChange } from "./inline-diff.js";

/** Props handed to a `renderers[blockType]` component for a void block
 * (image/chart/diagram/dataTable/divider) inside a DiffView -- always
 * read-only (there is no editor instance to mutate). */
export interface DiffBlockRendererProps {
  block: { id: string; type: string; props: Record<string, Json> };
  readOnly: true;
}

export interface DiffViewProps {
  before: Doc;
  after: Doc;
  registry?: Registry;
  renderers?: Record<string, ComponentType<DiffBlockRendererProps>>;
  /** "changes" (default): only changed nodes plus one context sibling render
   * eagerly; runs of untouched siblings collapse into a click-to-expand
   * button (keeps a 5000-block initial render cheap). "full": every node
   * renders, nothing collapses into a button (a Merkle-matched subtree still
   * renders its own content, just not behind a button -- see BlockNode). */
  mode?: "changes" | "full";
  /** "block" (default): the block list diff below. "inline": single document compare view
   * (<InlineDiffView>, see ./inline-diff-view.tsx); `mode` is ignored there (it always shows
   * the whole document). */
  layout?: "block" | "inline";
  /** Inline layout only: per-change author attribution. */
  attribute?: (change: InlineChange) => ChangeAttribution | undefined;
  className?: string;
}

function indexBlocks(doc: Doc): Map<string, Block> {
  const map = new Map<string, Block>();
  function walk(blocks: Block[]): void {
    for (const b of blocks) {
      map.set(b.id, b);
      if (b.children) walk(b.children);
    }
  }
  walk(doc.blocks);
  return map;
}

/** Computes the DiffTree once per (before, after, registry) triple. */
export function useDiff(before: Doc, after: Doc, registry: Registry = coreRegistry): { tree: DiffTree; stats: DiffStatsShape } {
  return useMemo(() => {
    const tree = diffDocs(before, after, registry);
    return { tree, stats: tree.stats };
  }, [before, after, registry]);
}

export interface DiffStatsProps {
  stats: DiffStatsShape;
  className?: string;
}

/** Headless summary: inserted/deleted/modified/moved(/unchanged) counts as
 * data attributes -- no text/styling opinions beyond the counts themselves. */
export function DiffStats({ stats, className }: DiffStatsProps): ReactNode {
  return (
    <dl data-jul-editor-diff-stats className={className}>
      <dt>inserted</dt>
      <dd data-diff-stat="inserted">{stats.inserted}</dd>
      <dt>deleted</dt>
      <dd data-diff-stat="deleted">{stats.deleted}</dd>
      <dt>modified</dt>
      <dd data-diff-stat="modified">{stats.modified}</dd>
      <dt>moved</dt>
      <dd data-diff-stat="moved">{stats.moved}</dd>
      <dt>unchanged</dt>
      <dd data-diff-stat="unchanged">{stats.unchanged}</dd>
    </dl>
  );
}

function isVoidType(type: string, registry: Registry): boolean {
  return isVoidBlockSpec(registry.blocks.get(type));
}

interface Maps {
  beforeMap: Map<string, Block>;
  afterMap: Map<string, Block>;
  registry: Registry;
  renderers: Record<string, ComponentType<DiffBlockRendererProps>> | undefined;
  mode: "changes" | "full";
}

function VoidContent({ block, registry, renderers }: { block: Block } & Pick<Maps, "registry" | "renderers">): ReactNode {
  const Renderer = renderers?.[block.type];
  if (Renderer) return <Renderer block={{ id: block.id, type: block.type, props: block.props }} readOnly />;
  return <figure data-type={block.type} />;
}

function BlockContent({
  node,
  oldBlock,
  newBlock,
  displayBlock,
  registry,
  renderers,
}: { node: DiffNode; oldBlock: Block | undefined; newBlock: Block | undefined; displayBlock: Block } & Pick<Maps, "registry" | "renderers">): ReactNode {
  if (isVoidType(displayBlock.type, registry)) return <VoidContent block={displayBlock} registry={registry} renderers={renderers} />;
  if (displayBlock.content === undefined) return null;

  if (node.inline) {
    const segs = computeInlineSegments(oldBlock?.content, newBlock?.content, node.inline, node.formatRanges, registry);
    return <>{renderInlineSegments(segs)}</>;
  }
  if (node.status === "insert") {
    return (
      <ins data-diff-inline="insert">{renderPlainContent(displayBlock.content, registry)}</ins>
    );
  }
  if (node.status === "delete") {
    return (
      <del data-diff-inline="delete">{renderPlainContent(displayBlock.content, registry)}</del>
    );
  }
  return <>{renderPlainContent(displayBlock.content, registry)}</>;
}

function PropsDl({ props }: { props: DiffNode["props"] }): ReactNode {
  if (!props || props.length === 0) return null;
  return (
    <dl data-diff-props>
      {props.map((p) => (
        <Fragment key={p.key}>
          <dt data-diff-prop-key>{p.key}</dt>
          <dd data-diff-prop-before>{JSON.stringify(p.before)}</dd>
          <dd data-diff-prop-after>{JSON.stringify(p.after)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Renders a block that lives inside an already-Merkle-matched ("collapsed")
 * subtree straight from the doc -- there is no DiffNode for it (the diff
 * engine deliberately didn't descend), so it's always `data-diff="same"`
 * with no ins/del/props detail. */
function PlainBlockNode({ block, registry, renderers }: { block: Block } & Pick<Maps, "registry" | "renderers">): ReactNode {
  const isVoid = isVoidType(block.type, registry);
  const children = block.children ?? [];
  return (
    <div data-jul-editor-diff-block data-diff="same" data-type={block.type} data-id={block.id}>
      {isVoid ? (
        <div data-jul-editor-diff-content>
          <VoidContent block={block} registry={registry} renderers={renderers} />
        </div>
      ) : block.content !== undefined ? (
        <div data-jul-editor-diff-content>{renderPlainContent(block.content, registry)}</div>
      ) : null}
      {children.length > 0 && (
        <div data-jul-editor-diff-children>
          {children.map((c) => (
            <PlainBlockNode key={c.id} block={c} registry={registry} renderers={renderers} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockNode({ node, maps }: { node: DiffNode; maps: Maps }): ReactNode {
  const { beforeMap, afterMap, registry, renderers } = maps;
  const oldBlock = beforeMap.get(node.id);
  const newBlock = afterMap.get(node.id);
  const displayBlock = node.status === "delete" ? oldBlock : newBlock;
  if (!displayBlock) return null;

  const hasContentSlot = isVoidType(displayBlock.type, registry) || displayBlock.content !== undefined;

  return (
    <div
      data-jul-editor-diff-block
      data-diff={node.status}
      data-type={displayBlock.type}
      data-id={node.id}
      data-diff-from={node.from ? JSON.stringify(node.from) : undefined}
    >
      {node.status === "move" && <span data-diff-move-label>moved</span>}
      {hasContentSlot && (
        <div data-jul-editor-diff-content>
          <BlockContent node={node} oldBlock={oldBlock} newBlock={newBlock} displayBlock={displayBlock} registry={registry} renderers={renderers} />
        </div>
      )}
      <PropsDl props={node.props} />
      {node.collapsed
        ? (displayBlock.children ?? []).length > 0 && (
            <div data-jul-editor-diff-children>
              {(displayBlock.children ?? []).map((c) => (
                <PlainBlockNode key={c.id} block={c} registry={registry} renderers={renderers} />
              ))}
            </div>
          )
        : node.children.length > 0 && (
            <div data-jul-editor-diff-children>
              <SiblingList nodes={node.children} maps={maps} />
            </div>
          )}
    </div>
  );
}

/** A node needs no expansion at all: unchanged self, and either the diff
 * engine already skipped its subtree (Merkle match) or it genuinely has no
 * children -- safe to fold into a "changes" mode collapsed run. */
function isBoring(n: DiffNode): boolean {
  return n.status === "same" && (n.collapsed === true || n.children.length === 0);
}

function CollapsedRun({ nodes, maps }: { nodes: DiffNode[]; maps: Maps }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (expanded) {
    return (
      <>
        {nodes.map((n) => (
          <BlockNode key={n.id} node={n} maps={maps} />
        ))}
      </>
    );
  }
  return (
    <button type="button" data-diff-collapsed onClick={() => setExpanded(true)}>
      {nodes.length} unchanged blocks
    </button>
  );
}

/** Renders one sibling list. In "changes" mode, a boring node (see
 * `isBoring`) renders in full only if it's within 1 position of a non-boring
 * sibling (context); consecutive remaining boring runs collapse into one
 * `CollapsedRun` button each. "full" mode renders every sibling directly. */
function SiblingList({ nodes, maps }: { nodes: DiffNode[]; maps: Maps }): ReactNode {
  if (maps.mode === "full") {
    return (
      <>
        {nodes.map((n) => (
          <BlockNode key={n.id} node={n} maps={maps} />
        ))}
      </>
    );
  }

  const context = new Set<number>();
  nodes.forEach((n, i) => {
    if (!isBoring(n)) {
      if (i > 0) context.add(i - 1);
      if (i < nodes.length - 1) context.add(i + 1);
    }
  });

  const items: ReactNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i]!;
    if (isBoring(n) && !context.has(i)) {
      const run: DiffNode[] = [];
      while (i < nodes.length && isBoring(nodes[i]!) && !context.has(i)) {
        run.push(nodes[i]!);
        i++;
      }
      items.push(<CollapsedRun key={`run-${run[0]!.id}`} nodes={run} maps={maps} />);
    } else {
      items.push(<BlockNode key={n.id} node={n} maps={maps} />);
      i++;
    }
  }
  return <>{items}</>;
}

export function DiffView({ layout = "block", attribute, ...rest }: DiffViewProps): ReactNode {
  if (layout === "inline") {
    return <InlineDiffView before={rest.before} after={rest.after} registry={rest.registry} renderers={rest.renderers} attribute={attribute} className={rest.className} />;
  }
  return <BlockDiffView {...rest} />;
}

function BlockDiffView({ before, after, registry = coreRegistry, renderers, mode = "changes", className }: DiffViewProps): ReactNode {
  const { tree } = useDiff(before, after, registry);
  const beforeMap = useMemo(() => indexBlocks(before), [before]);
  const afterMap = useMemo(() => indexBlocks(after), [after]);
  const maps: Maps = { beforeMap, afterMap, registry, renderers, mode };
  return (
    <div data-jul-editor-diff-view className={className}>
      <SiblingList nodes={tree.root} maps={maps} />
    </div>
  );
}
