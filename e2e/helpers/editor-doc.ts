// Shared read helpers for e2e specs driving the "/editor" page's
// window.__julEditor (T5ab: createEditor-based playground route). Modeled after
// ime-spike.spec.ts's own inline getDoc/textOf, pulled out here so
// render.spec.ts and editing.spec.ts don't duplicate them.

import type { Page } from "@playwright/test";
import type { Doc } from "../../packages/core/src/model/types.js";

declare global {
  interface Window {
    __julEditor?: {
      editor: { getState: () => { selection: unknown } };
      getDoc: () => Doc;
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: unknown) => void;
    };
  }
}

export async function getDoc(page: Page): Promise<Doc> {
  return page.evaluate(() => window.__julEditor!.getDoc());
}

export async function getSelection(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__julEditor!.editor.getState().selection);
}

export function textOf(doc: Doc, blockId: string): string {
  const block = doc.blocks.find((b) => b.id === blockId) ?? findNested(doc.blocks, blockId);
  return (block?.content ?? []).map((inl) => (inl.type === "text" ? inl.text : inl.type === "mention" ? inl.attrs.label : "")).join("");
}

function findNested(blocks: Doc["blocks"], blockId: string): Doc["blocks"][number] | undefined {
  for (const b of blocks) {
    if (b.id === blockId) return b;
    const found = b.children && findNested(b.children, blockId);
    if (found) return found;
  }
  return undefined;
}

export function blockExists(doc: Doc, blockId: string): boolean {
  return findNested(doc.blocks, blockId) !== undefined;
}

export function blockType(doc: Doc, blockId: string): string | undefined {
  return findNested(doc.blocks, blockId)?.type;
}

export function blockProps(doc: Doc, blockId: string): Record<string, unknown> | undefined {
  return findNested(doc.blocks, blockId)?.props;
}

/** Ids of `parentId`'s children in doc order (root when `parentId` is null). */
export function childIds(doc: Doc, parentId: string | null): string[] {
  const children = parentId === null ? doc.blocks : (findNested(doc.blocks, parentId)?.children ?? []);
  return children.map((b) => b.id);
}
