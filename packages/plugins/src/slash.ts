// Data-only slash menu item definitions for the slash menu to consume (this
// package doesn't build the menu itself -- the react package owns the trigger/UI). `create()`
// returns a full `Block` (own fresh id via @jul-editor/core's `newId`), matching
// `Editor`/`Transaction.insertBlock(block: Block)`'s signature.
import type { Block } from "@jul-editor/core";
import { chartSlashItem } from "./chart";
import { diagramSlashItem } from "./diagram";
import { dataTableSlashItem } from "./table";
import { pageBreakSlashItem } from "./pages/page-break.js";
import { linkSlashItems } from "./links";
import { calloutSlashItem } from "./callout/block.js";
import { toggleSlashItem } from "./toggle/block.js";
import { tocSlashItem } from "./toc/block.js";
import { columnsSlashItems } from "./columns/block.js";

export interface SlashItem {
  /** The block type this item inserts -- must match a key of `pluginRenderers`. */
  type: string;
  title: string;
  /** Includes Korean synonyms so a Korean IME query still matches. */
  keywords: string[];
  create: () => Block;
}

export const pluginSlashItems: SlashItem[] = [
  chartSlashItem,
  diagramSlashItem,
  dataTableSlashItem,
  pageBreakSlashItem,
  ...linkSlashItems,
  calloutSlashItem,
  toggleSlashItem,
  tocSlashItem,
  ...columnsSlashItems,
];
