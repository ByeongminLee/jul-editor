"use client";

// <DiffStyles /> injects DIFF_CSS; <DiffCompare /> is DiffView with a block/inline layout toggle.

import type { ReactNode } from "react";
import { useState } from "react";
import { DIFF_CSS } from "./diff-styles.js";
import { DiffView, type DiffViewProps } from "./diff-view.js";

/** Renders the default stylesheet (CSS vars, light + dark). Mount once near the views. */
export function DiffStyles(): ReactNode {
  return <style data-jul-editor-diff-styles>{DIFF_CSS}</style>;
}

export interface DiffCompareProps extends Omit<DiffViewProps, "layout"> {
  defaultLayout?: "block" | "inline";
  labels?: { block: string; inline: string };
}

/** One component, toggle between the block diff ("block", the classic DiffView) and the single
 * document inline compare ("inline"). */
export function DiffCompare({ defaultLayout = "block", labels = { block: "Split", inline: "Inline" }, ...rest }: DiffCompareProps): ReactNode {
  const [layout, setLayout] = useState(defaultLayout);
  return (
    <div data-jul-editor-diff-compare>
      <div data-jul-editor-diff-toggle role="group">
        <button type="button" data-layout="block" aria-pressed={layout === "block"} onClick={() => setLayout("block")}>
          {labels.block}
        </button>
        <button type="button" data-layout="inline" aria-pressed={layout === "inline"} onClick={() => setLayout("inline")}>
          {labels.inline}
        </button>
      </div>
      <DiffView {...rest} layout={layout} />
    </div>
  );
}
