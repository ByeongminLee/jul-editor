"use client";

// Notion-like right-edge mini outline: a column of short lines (one per heading, shorter for deeper
// levels, the current section highlighted) that expands on hover/focus into the heading titles,
// each clickable. Headless: `data-*` attributes + class slots, optional TOC_SIDEBAR_CSS.
// Usage (inside <Editor>): `const editor = useEditor(); <TocSidebar editor={editor} />`.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Doc, Editor } from "@jul-editor/core";
import { findBlockEl, navigateToHeading, scrollToHeading } from "./navigate.js";
import { pickActiveIndex } from "./outline.js";
import type { OutlineEntry, OutlineOptions } from "./outline.js";
import { useOutline } from "./use-outline.js";

export interface TocSidebarClassNames {
  container?: string;
  item?: string;
  line?: string;
  title?: string;
}

export interface TocSidebarProps extends OutlineOptions {
  /** Live editor (editing). Omit and pass `doc` for a read-only page. */
  editor?: Editor | null;
  doc?: Doc | null;
  /** Element (or window) whose scroll drives the active-section highlight. Default: window. */
  scrollContainer?: HTMLElement | Window | null;
  /** Root searched for heading elements in read-only mode. Default: document. */
  contentRoot?: ParentNode | null;
  /** Px below the viewport top at which a heading counts as "current". */
  activeOffset?: number;
  className?: string | TocSidebarClassNames;
  /** Controlled expansion (default: expands on hover/focus). */
  expanded?: boolean;
  onNavigate?: (entry: OutlineEntry, editor: Editor | null | undefined) => void;
  locale?: "en" | "ko";
  /** Hide the whole sidebar when the doc has fewer than this many headings. Default 2. */
  minHeadings?: number;
}

export function TocSidebar(props: TocSidebarProps): ReactNode {
  const { editor, doc, scrollContainer, contentRoot, activeOffset = 96, expanded, onNavigate, locale, minHeadings = 2, minLevel, maxLevel } = props;
  const classes = typeof props.className === "string" ? { container: props.className } : (props.className ?? {});
  const outline = useOutline(editor, { minLevel, maxLevel }, doc);
  const [hover, setHover] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const open = expanded ?? hover;
  const ko = locale === "ko";

  // Track the section in view. Re-measured on scroll (rAF-throttled) and when the outline changes.
  useEffect(() => {
    if (!outline.length) return;
    const target: HTMLElement | Window | null = scrollContainer ?? (typeof window === "undefined" ? null : window);
    const root: ParentNode | null = editor ? editor.getRoot() : (contentRoot ?? (typeof document === "undefined" ? null : document));
    if (!root) return;
    const measure = () => {
      const tops = outline.map((e) => findBlockEl(root, e.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY);
      const idx = pickActiveIndex(tops, activeOffset);
      setActiveId(idx >= 0 ? outline[idx]!.id : null);
    };
    let frame = 0;
    const onScroll = () => {
      if (typeof requestAnimationFrame !== "function") return measure();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    target?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target?.removeEventListener("scroll", onScroll);
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, [outline, editor, scrollContainer, contentRoot, activeOffset]);

  if (outline.length < minHeadings) return null;

  const go = (entry: OutlineEntry) => {
    setActiveId(entry.id);
    if (onNavigate) onNavigate(entry, editor);
    else if (editor) navigateToHeading(editor, entry.id);
    else scrollToHeading(contentRoot ?? document, entry.id);
  };

  return (
    <nav
      data-jul-toc-sidebar=""
      data-expanded={open ? "true" : "false"}
      aria-label={ko ? "문서 개요" : "Document outline"}
      className={classes.container}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false);
      }}
    >
      <ul data-toc-lines="">
        {outline.map((entry) => (
          <li key={entry.id} data-level={entry.level} data-depth={entry.depth} data-active={entry.id === activeId ? "true" : undefined}>
            <button type="button" className={classes.item} aria-current={entry.id === activeId ? "location" : undefined} onClick={() => go(entry)}>
              <span data-toc-line="" className={classes.line} aria-hidden="true" />
              <span data-toc-title="" className={classes.title}>
                {entry.text || (ko ? "제목 없음" : "Untitled")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Optional stylesheet for TocSidebar and the in-document TOC block. */
export const TOC_CSS = `
[data-jul-toc-sidebar]{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:20;max-height:70vh;overflow:hidden;padding:8px 6px;border-radius:10px;transition:background .15s,box-shadow .15s}
[data-jul-toc-sidebar][data-expanded="true"]{background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.14);overflow:auto;padding:8px 10px}
[data-jul-toc-sidebar] ul{list-style:none;margin:0;padding:0}
[data-jul-toc-sidebar] button{display:flex;align-items:center;justify-content:flex-end;gap:10px;width:100%;border:0;background:transparent;cursor:pointer;padding:3px 0;color:inherit;font:inherit}
[data-toc-line]{display:block;height:2px;border-radius:2px;background:rgba(0,0,0,.25);width:22px;flex:none}
[data-jul-toc-sidebar] li[data-depth="1"] [data-toc-line]{width:16px}
[data-jul-toc-sidebar] li[data-depth="2"] [data-toc-line]{width:10px}
[data-jul-toc-sidebar] li[data-active="true"] [data-toc-line]{background:rgba(0,0,0,.8)}
[data-jul-toc-sidebar] [data-toc-title]{display:none;font-size:13px;white-space:nowrap;order:-1;opacity:.7}
${[1,2,3,4,5].map((d)=>`[data-jul-toc-sidebar] li[data-depth="${d}"] [data-toc-title]{padding-left:${d*12}px}`).join("\n")}
[data-jul-toc-sidebar][data-expanded="true"] [data-toc-title]{display:block}
[data-jul-toc-sidebar] li[data-active="true"] [data-toc-title]{opacity:1;font-weight:600}
[data-jul-toc] ul{list-style:none;margin:0;padding:0}
${[1,2,3,4,5].map((d)=>`[data-jul-toc] li[data-depth="${d}"]{padding-left:${d*20}px}`).join("\n")}
[data-jul-toc] a{color:inherit;text-decoration:underline;text-decoration-color:rgba(0,0,0,.25)}
[data-jul-toc-empty]{opacity:.5;margin:0}
`;
