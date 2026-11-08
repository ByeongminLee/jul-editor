// Thin compatibility wrapper. Alerts (`> [!NOTE]`), `<details>` and `[TOC]` are now parsed by the
// blocks themselves through core's BlockSpec.fromMarkdownBlock hook, so plain core `fromMarkdown`
// (and clipboard paste, which reuses it with the editor registry) understands them whenever
// callout/toggle/toc are registered. `fromMarkdownExt` only builds a default registry holding those
// three blocks for callers that do not have an editor registry at hand.
//
// @deprecated Use core `fromMarkdown(md, { registry })` with a registry that includes the blocks.
import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import type { Registry } from "@jul-editor/core";
import { fromMarkdown } from "@jul-editor/core/serde";
import type { FromMarkdownResult } from "@jul-editor/core/serde";
import { calloutBlock } from "../callout/block.js";
import { toggleBlock } from "../toggle/block.js";
import { tocBlock } from "../toc/block.js";

export interface MarkdownExtOptions {
  /** Defaults to core blocks + callout + toggle + toc (minus the ones switched off below). */
  registry?: Registry;
  /** Only used when `registry` is omitted: set false to leave that block out of the default registry. */
  callout?: boolean;
  toggle?: boolean;
  toc?: boolean;
}

let fullRegistry: Registry | undefined;

/** @deprecated Drop-in for core's `fromMarkdown` that defaults to a registry with callout/toggle/toc. */
export function fromMarkdownExt(md: string, opts: MarkdownExtOptions = {}): FromMarkdownResult {
  let registry = opts.registry;
  if (!registry) {
    const all = opts.callout !== false && opts.toggle !== false && opts.toc !== false;
    const blocks = [...coreBlocks, ...(opts.callout !== false ? [calloutBlock] : []), ...(opts.toggle !== false ? [toggleBlock] : []), ...(opts.toc !== false ? [tocBlock] : [])];
    const make = () => createRegistry({ blocks, inlines: coreInlines, marks: coreMarks });
    registry = all ? (fullRegistry ??= make()) : make();
  }
  return fromMarkdown(md, { registry });
}
