// Plain React rendering of inline content (marks, mentions, generic inlines) used by the
// read-only EditorView and re-exported for @jul-editor/plugins' DiffView. Writes plain React
// elements: @jul-editor/core's view/ DOM builders are imperative DOM, not usable here.

import type { Inline, Mark, MentionInline, Registry } from "@jul-editor/core";
import { isText, normalizeInline } from "@jul-editor/core";
import { createElement, Fragment, type ReactNode } from "react";

const MARK_TAG: Record<string, string> = {
  bold: "strong", italic: "em", strike: "s", code: "code", link: "a",
  underline: "u", subscript: "sub", superscript: "sup", highlight: "mark", textColor: "span",
};

export interface InlineChar {
  marks: Mark[];
  text?: string;
  mention?: MentionInline;
  generic?: Inline;
  format?: boolean;
}

/** Expands Inline[] to one entry per UTF-16 code unit (text) or one entry per
 * atomic inline (mention/generic) -- matches the U+FFFC-per-atomic-inline
 * convention DiffNode.inline's ops are computed against, so slicing by
 * op[1].length lines up exactly. */
export function toInlineChars(content: Inline[] | undefined, registry: Registry): InlineChar[] {
  const list = normalizeInline(content ?? [], registry);
  const out: InlineChar[] = [];
  for (const inl of list) {
    if (isText(inl)) {
      const marks = inl.marks ?? [];
      for (let i = 0; i < inl.text.length; i++) out.push({ marks, text: inl.text[i]! });
    } else if (inl.type === "mention") {
      // GenericInline.type is a plain `string` (any future defineInline), so
      // TS can't rule it out from this `=== "mention"` check by discriminant
      // narrowing alone -- an explicit cast here matches how the rest of the
      // codebase (e.g. view/render.ts) already narrows a mention run.
      out.push({ marks: [], mention: inl as MentionInline });
    } else {
      out.push({ marks: [], generic: inl });
    }
  }
  return out;
}

interface Run {
  key: string;
  marks: Mark[];
  format?: boolean;
  text?: string;
  mention?: MentionInline;
  generic?: Inline;
}

function runKeyOf(c: InlineChar): string {
  if (c.mention) return `m:${c.mention.attrs.kind}:${c.mention.attrs.id}:${c.format ? 1 : 0}`;
  if (c.generic) return `g:${c.generic.type}:${c.format ? 1 : 0}`;
  return `t:${c.marks.map((m) => `${m.type}:${JSON.stringify(m.attrs ?? {})}`).join(",")}:${c.format ? 1 : 0}`;
}

/** Groups consecutive chars sharing the same marks/format/atomic-inline
 * identity into one run, so a long unchanged text stretch is one DOM node
 * (and one React element) instead of one per character. */
function groupRuns(chars: InlineChar[]): Run[] {
  const runs: Run[] = [];
  for (const c of chars) {
    const key = runKeyOf(c);
    const last = runs[runs.length - 1];
    if (last && last.key === key && last.text !== undefined && c.text !== undefined) {
      last.text += c.text;
    } else {
      runs.push({ key, marks: c.marks, format: c.format, text: c.text, mention: c.mention, generic: c.generic });
    }
  }
  return runs;
}

/** Nests mark tags in registration/array order (marks[0] outermost, like
 * @jul-editor/core's own view/inline-dom.ts textNodeFor), just as plain React
 * elements instead of DOM nodes. */
function renderMarkedText(text: string, marks: Mark[], keyPrefix: string): ReactNode {
  let node: ReactNode = text;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;
    const tag = MARK_TAG[mark.type] ?? "span";
    const props: Record<string, unknown> = { key: `${keyPrefix}-${i}`, children: node };
    if (mark.type === "link") props.href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
    if (mark.type === "highlight" && mark.attrs?.color !== "default" && mark.attrs?.color !== undefined) props["data-jul-editor-highlight"] = String(mark.attrs.color);
    if (mark.type === "textColor") props["data-jul-editor-color"] = String(mark.attrs?.color ?? "default");
    if (tag === "span" && mark.type !== "textColor") props["data-mark"] = mark.type;
    node = createElement(tag, props);
  }
  return node;
}

function renderRun(r: Run, key: string): ReactNode {
  let inner: ReactNode;
  if (r.mention) {
    inner = (
      <span data-mention="" data-mention-kind={r.mention.attrs.kind} data-mention-id={r.mention.attrs.id}>
        {r.mention.attrs.kind === "tag" ? `#${r.mention.attrs.label}` : r.mention.attrs.label}
      </span>
    );
  } else if (r.generic) {
    inner = <span data-inline={r.generic.type} />;
  } else {
    inner = renderMarkedText(r.text ?? "", r.marks, key);
  }
  if (r.format) {
    return (
      <span key={key} data-diff-format="">
        {inner}
      </span>
    );
  }
  return <Fragment key={key}>{inner}</Fragment>;
}

/** Renders per-character entries as grouped runs with real mark nesting. */
export function renderInlineChars(chars: InlineChar[], key: string): ReactNode {
  return groupRuns(chars).map((r, i) => renderRun(r, `${key}-${i}`));
}

/** Renders inline content with marks, mentions and generic inlines as plain React elements. */
export function renderPlainContent(content: Inline[] | undefined, registry: Registry): ReactNode {
  return <Fragment key="plain">{renderInlineChars(toInlineChars(content, registry), "plain")}</Fragment>;
}
