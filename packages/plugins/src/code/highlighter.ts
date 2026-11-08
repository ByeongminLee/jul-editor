// P2: @jul-editor/core's `Highlighter` contract (view/highlight.ts), backed by
// lowlight (highlight.js's hast-tree wrapper). `lowlight` is imported
// LAZILY (dynamic `import()`, only on the first real `.highlight()` call) so
// a page that never registers this highlighter never pays for
// highlight.js's ~35 bundled grammars at all -- matches @jul-editor/plugins'
// existing chart/RechartsChart.tsx convention (heavy lib behind a dynamic
// import, not just tsup's `external`).

import type { Highlighter, HighlightRange } from "@jul-editor/core";
import type { Element as HastElement, RootContent } from "hast";

/** A highlight.js grammar function. Declared locally so the published types do
 * not require `highlight.js` to be installed (lowlight is an optional peer). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LanguageFn = (hljs?: any) => any;

export interface CreateLowlightHighlighterOptions {
  /** Overrides lowlight's `common` preset grammar set (e.g. to add/remove a
   * language) -- `createLowlight`'s own first argument, passed through as-is. */
  languages?: Readonly<Record<string, LanguageFn>>;
}

type LowlightInstance = {
  highlight(language: string, code: string): { children: RootContent[] };
  registered(name: string): boolean;
};

// Maps a highlight.js "scope" (the part of an `hljs-<scope>` class after the
// prefix) onto jul-editor's fixed, documented token vocabulary
// (@jul-editor/core view/highlight.ts's `HIGHLIGHT_TOKENS`). Not exhaustive --
// only the scopes highlight.js's own bundled grammars commonly emit; an
// unmapped scope is simply left unhighlighted rather than inventing a 14th
// token name jul-editor's CSS layer doesn't know about.
const SCOPE_TO_TOKEN: Record<string, string> = {
  keyword: "keyword",
  operator: "keyword",
  string: "string",
  regexp: "string",
  addition: "string",
  code: "string",
  comment: "comment",
  quote: "comment",
  doctag: "comment",
  number: "number",
  title: "title",
  section: "title",
  name: "title",
  "selector-tag": "type",
  "selector-class": "type",
  "selector-id": "type",
  class: "type",
  type: "type",
  built_in: "built_in",
  literal: "literal",
  symbol: "literal",
  bullet: "literal",
  attr: "attr",
  attribute: "attr",
  "selector-attr": "attr",
  "selector-pseudo": "attr",
  params: "variable",
  variable: "variable",
  "template-variable": "variable",
  meta: "meta",
  link: "meta",
  emphasis: "meta",
  strong: "meta",
  formula: "meta",
  tag: "punctuation",
  subst: "punctuation",
  deletion: "string",
};

/** lowlight's compound scopes (e.g. "title.function_") come back as MULTIPLE
 * classes (`["hljs-title", "function_"]`, verified empirically against
 * lowlight 3.3.0 -- the part after the dot is NOT itself `hljs-`-prefixed) --
 * these two are common enough (a function/class name) to map onto jul-editor's
 * more specific "function"/"type" tokens instead of the generic "title". */
function tokenFromClassNames(classNames: readonly string[]): string | undefined {
  if (classNames.includes("hljs-title")) {
    if (classNames.includes("function_")) return "function";
    if (classNames.includes("class_")) return "type";
    return "title";
  }
  for (const raw of classNames) {
    if (!raw.startsWith("hljs-")) continue;
    const mapped = SCOPE_TO_TOKEN[raw.slice(5)];
    if (mapped) return mapped;
  }
  return undefined;
}

/** Walks a lowlight hast tree, accumulating a flat `HighlightRange[]` keyed
 * by running plain-text offset (matching `plainTextOf`'s own concatenation
 * order on the core side). A parent Element's range covers its ENTIRE
 * subtree's text -- a nested Element inside it (e.g. an interpolated
 * expression inside a highlighted template string) gets its own, separately
 * pushed, overlapping range; the CSS Custom Highlight API renders both
 * layered highlights independently, so no special "cut a hole" logic is
 * needed here. */
function walk(nodes: readonly RootContent[], ranges: HighlightRange[], pos: { value: number }): void {
  for (const node of nodes) {
    if (node.type === "text") {
      pos.value += node.value.length;
      continue;
    }
    if (node.type !== "element") continue;
    const el = node as HastElement;
    const start = pos.value;
    walk(el.children, ranges, pos);
    const end = pos.value;
    if (end <= start) continue;
    const classNames = (el.properties?.className as string[] | undefined) ?? [];
    const token = tokenFromClassNames(classNames);
    if (token) ranges.push({ from: start, to: end, token });
  }
}

export function createLowlightHighlighter(opts: CreateLowlightHighlighterOptions = {}): Highlighter {
  // One shared load promise: concurrent first calls do not import twice, and
  // a missing optional `lowlight` peer resolves to null (plain text) instead
  // of an unhandled rejection.
  let loading: Promise<LowlightInstance | null> | null = null;

  function getInstance(): Promise<LowlightInstance | null> {
    loading ??= import("lowlight").then(
      ({ common, createLowlight }) => createLowlight((opts.languages ?? common) as never) as unknown as LowlightInstance,
      () => null,
    );
    return loading;
  }

  return {
    async highlight(code, language) {
      if (!code || !language || language === "plaintext") return [];
      const lowlight = await getInstance();
      if (!lowlight || !lowlight.registered(language)) return [];
      let root: { children: RootContent[] };
      try {
        root = lowlight.highlight(language, code);
      } catch {
        return []; // a malformed/edge-case input must never break editing
      }
      const ranges: HighlightRange[] = [];
      walk(root.children, ranges, { value: 0 });
      return ranges;
    },
  };
}
