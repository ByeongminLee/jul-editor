"use client";

// Table of contents block renderer (void block, full-block container). Editing: `editor` is given and
// the list is live; read-only: wrap the page in <TocDocProvider value={doc}> so the view can read the
// headings (EditorView renderers do not receive the document).
import type { ReactNode } from "react";
import type { Editor } from "@jul-editor/core";
import type { PluginViewProps } from "../view-props.js";
import { readToc } from "./block.js";
import { navigateToHeading, scrollToHeading } from "./navigate.js";
import type { OutlineEntry } from "./outline.js";
import { useOutline } from "./use-outline.js";

export interface TocClassNames {
  container?: string;
  item?: string;
  empty?: string;
}

export interface TocViewProps extends PluginViewProps {
  className?: string | TocClassNames;
  /** Override navigation (router hash, analytics...). Default: select + scroll, expanding toggles. */
  onNavigate?: (entry: OutlineEntry, editor: Editor | undefined) => void;
  emptyText?: string;
}

export function TocView({ block, editor, readOnly, className, onNavigate, emptyText, locale }: TocViewProps): ReactNode {
  const { minLevel, maxLevel } = readToc(block.props);
  const outline = useOutline(editor, { minLevel, maxLevel });
  const classes = typeof className === "string" ? { container: className } : (className ?? {});
  const ko = locale === "ko";

  const go = (entry: OutlineEntry) => {
    if (onNavigate) onNavigate(entry, editor);
    else if (editor && !readOnly) navigateToHeading(editor, entry.id);
    else if (typeof document !== "undefined") scrollToHeading(document, entry.id);
  };

  return (
    <nav data-jul-toc="" aria-label={ko ? "목차" : "Table of contents"} className={classes.container}>
      {outline.length === 0 ? (
        <p data-toc-empty="" className={classes.empty}>
          {emptyText ?? (ko ? "제목을 추가하면 목차가 표시됩니다" : "Add headings to build the table of contents")}
        </p>
      ) : (
        <ul data-toc-list="">
          {outline.map((entry) => (
            <li key={entry.id} data-level={entry.level} data-depth={entry.depth}>
              <a
                href={`#${entry.id}`}
                className={classes.item}
                data-toc-link=""
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  go(entry);
                }}
              >
                {entry.text || (ko ? "제목 없음" : "Untitled")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
