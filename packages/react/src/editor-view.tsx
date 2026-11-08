"use client";

import { coreBlocks, coreInlines, coreMarks, coreRegistry, createRegistry, embedIframeSrc, getProp, isVoidBlockSpec, sanitizeUrl } from "@jul-editor/core";
import type { Block, BlockSpec, Doc, Json, Registry } from "@jul-editor/core";
import type { ComponentType, ReactNode } from "react";
import { renderPlainContent } from "./inline-content.js";
import type { Locale } from "./labels.js";

export interface ViewRendererProps {
  block: Block;
  readOnly: true;
  locale: Locale;
  selected: false;
  updateProps: (patch: Record<string, Json | undefined>) => void;
  children?: ReactNode;
}

export interface EditorViewProps {
  doc: Doc;
  blocks?: BlockSpec[];
  renderers?: Record<string, ComponentType<ViewRendererProps>>;
  locale?: Locale;
  className?: string;
}

const noUpdate = () => {};
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

function viewVoid(block: Block, locale: Locale): ReactNode {
  const props = block.props;
  if (block.type === "image") {
    const src = typeof props.src === "string" ? sanitizeUrl(props.src, "image") : null;
    const alt = typeof props.alt === "string" ? props.alt : "";
    const caption = typeof props.caption === "string" ? props.caption : "";
    const align = props.align === "left" || props.align === "right" ? props.align : "center";
    const width = typeof props.width === "number" && Number.isFinite(props.width) && props.width > 0 ? props.width :
      typeof props.width === "string" && /^\d{1,3}%$/.test(props.width) ? props.width : undefined;
    return <figure data-jul-editor-image data-align={align}>
      <img src={src || undefined} alt={alt} width={width} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>;
  }
  if (block.type === "embed") {
    const provider = typeof props.provider === "string" ? props.provider : "link";
    const id = typeof props.id === "string" ? props.id : "";
    const url = typeof props.url === "string" ? sanitizeUrl(props.url, "link") : null;
    const title = typeof props.title === "string" ? props.title : "";
    const iframeSrc = embedIframeSrc(provider as Parameters<typeof embedIframeSrc>[0], id);
    return <figure data-jul-editor-embed data-provider={provider}>
      {iframeSrc ? <iframe src={iframeSrc} title={title || provider} sandbox={EMBED_SANDBOX} referrerPolicy="strict-origin-when-cross-origin" loading="lazy" allowFullScreen /> :
        url ? <a href={url} target="_blank" rel="noopener noreferrer">{title || url}</a> : <span>{title}</span>}
    </figure>;
  }
  if (block.type === "attachment") {
    const src = typeof props.src === "string" ? sanitizeUrl(props.src, "image") : null;
    const name = typeof props.name === "string" ? props.name : locale === "ko" ? "첨부파일" : "Attachment";
    return <figure data-jul-editor-attachment>{src ? <a href={src} target="_blank" rel="noopener noreferrer" download>{name}</a> : <span>{name}</span>}</figure>;
  }
  if (block.type === "divider") return <hr />;
  return <figure data-type={block.type} />;
}

function span(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 1 ? Math.min(value, 100) : undefined;
}

function renderBlocks(blocks: Block[], depth: number, registry: Registry, renderers: EditorViewProps["renderers"], locale: Locale, headerCells = false): ReactNode {
  let ordered = 0;
  return blocks.map((block) => {
    ordered = block.type === "orderedListItem" ? ordered + 1 : 0;
    const spec = registry.blocks.get(block.type);
    const isVoid = isVoidBlockSpec(spec) || (!spec && block.content === undefined && !block.children?.length);
    const Renderer = renderers?.[block.type];
    const hasContent = spec?.content === "inline" || spec?.content === "code" || (!spec && block.content !== undefined);
    const hasChildren = (spec && spec.children !== "none") || !!block.children?.length;
    const level = block.type === "heading" ? Math.min(6, Math.max(1, Math.floor(Number(getProp<number>(block, "level", registry)) || 1))) : undefined;
    const HeadingTag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const content = hasContent && (block.type === "heading"
      ? <HeadingTag data-jul-editor-content>{renderPlainContent(block.content, registry)}</HeadingTag>
      : <div data-jul-editor-content>{block.type === "codeBlock"
        ? <pre><code>{renderPlainContent(block.content, registry)}</code></pre>
        : renderPlainContent(block.content, registry)}</div>);
    let children: ReactNode;
    if (block.type === "table") {
      const rows = block.children ?? [];
      const firstIsHeader = getProp<boolean>(block, "headerRow", registry) !== false;
      children = <table data-jul-editor-children>
        {firstIsHeader && rows[0] && <thead>{renderBlocks([rows[0]], depth + 1, registry, renderers, locale, true)}</thead>}
        <tbody>{renderBlocks(firstIsHeader ? rows.slice(1) : rows, depth + 1, registry, renderers, locale)}</tbody>
      </table>;
    } else if (block.type === "tableRow") {
      children = renderBlocks(block.children ?? [], depth + 1, registry, renderers, locale, headerCells);
    } else if (hasChildren) {
      children = <div data-jul-editor-children>{renderBlocks(block.children ?? [], depth + 1, registry, renderers, locale)}</div>;
    }
    const body = content || children ? <>{content}{children}</> : undefined;
    const rendered = Renderer
      ? <Renderer block={block} readOnly locale={locale} selected={false} updateProps={noUpdate}>{body}</Renderer>
      : isVoid ? viewVoid(block, locale) : body;
    const colspan = block.type === "tableCell" ? span(getProp(block, "colspan", registry)) : undefined;
    const rowspan = block.type === "tableCell" ? span(getProp(block, "rowspan", registry)) : undefined;
    const attrs = {
      "data-jul-editor-block": "", "data-id": block.id, "data-type": block.type,
      "data-jul-editor-depth": depth, "data-jul-editor-level": level,
      "data-jul-editor-index": block.type === "orderedListItem" ? ordered : undefined,
      "data-jul-editor-colspan": colspan, "data-jul-editor-rowspan": rowspan,
      "data-jul-editor-empty": hasContent && !block.content?.length ? "" : undefined,
    };
    if (block.type === "tableRow") return <tr key={block.id} {...attrs} data-jul-editor-children="">{rendered}</tr>;
    if (block.type === "tableCell") {
      const CellTag = headerCells ? "th" : "td";
      return <CellTag key={block.id} {...attrs} colSpan={colspan} rowSpan={rowspan} scope={headerCells ? "col" : undefined}>{rendered}</CellTag>;
    }
    return <div key={block.id} {...attrs}>
      {isVoid ? <div data-jul-editor-void="">{rendered}</div> : rendered}
    </div>;
  });
}

/** Read-only saved-document renderer; no editor instance or browser DOM APIs. */
export function EditorView({ doc, blocks, renderers, locale = "en", className }: EditorViewProps): ReactNode {
  const registry = blocks?.length ? createRegistry({ blocks: [...coreBlocks, ...blocks], inlines: coreInlines, marks: coreMarks }) : coreRegistry;
  return <div data-jul-editor-view="" className={className}>{renderBlocks(doc.blocks, 0, registry, renderers, locale)}</div>;
}
