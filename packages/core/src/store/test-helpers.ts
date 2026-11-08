// Shared test-only helpers for the store suite (not a *.test.ts file itself).

import { coreRegistry } from "../model/builtins.js";
import { normalizeDoc } from "../model/canonical.js";
import type { Block, Doc } from "../model/types.js";
import { fromDoc } from "./store.js";
import type { Store } from "./types.js";

export const r = coreRegistry;

export function doc(blocks: Doc["blocks"]): Doc {
  return normalizeDoc({ version: 1, blocks }, r);
}

export function storeFrom(blocks: Doc["blocks"]): Store {
  return fromDoc(doc(blocks), r);
}

export function para(id: string, text = "", children?: Block[]): Block {
  const b: Block = { id, type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] };
  if (children) b.children = children;
  return b;
}

export function bullet(id: string, text = "", children?: Block[]): Block {
  const b: Block = { id, type: "bulletListItem", props: {}, content: text ? [{ type: "text", text }] : [] };
  if (children) b.children = children;
  return b;
}
