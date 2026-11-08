// Columns: a `columns` container whose children are `column` blocks, each a free-nesting container
// of ordinary blocks (paragraphs, lists, images, a nested toggle ...). It reuses the exact model
// seam the table uses (`children: ["column"]`, `parent: ["columns"]`, `isolating`), so no core
// change is needed: schema admission keeps non-column blocks out of `columns`, and isolating stops
// Backspace/Enter/indent from merging or splitting across a column boundary.
//
// Layout is host CSS (see COLUMNS_CSS): the children container of `columns` becomes a flex row.
// Equal widths only for now; per-column width needs a resize handle plus a `width` prop (see report).
//
// Serde: HTML is lossless (`<div data-jul-editor-type="columns">` of `column` divs). Markdown has no
// column syntax, so it flattens column after column and reports the lossy reason `columns-flattened`.
import { defineBlock, newId } from "@jul-editor/core";
import type { Block, Editor } from "@jul-editor/core";
import { blocksFromHTML } from "../notion-shared/html-parse.js";
import type { SlashItem } from "../slash.js";

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 5;

const emptyParagraph = (): Block => ({ id: newId(), type: "paragraph", props: {}, content: [] });
const newColumn = (children: Block[] = [emptyParagraph()]): Block => ({ id: newId(), type: "column", props: {}, children });

/** A fresh `columns` block with `count` (2-5) columns, each holding one empty paragraph. */
export function createColumnsBlock(count = 2): Block {
  const n = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(count)));
  return { id: newId(), type: "columns", props: {}, children: Array.from({ length: n }, () => newColumn()) };
}

export const columnBlock = defineBlock({
  type: "column",
  content: "none",
  children: "any",
  parent: ["columns"],
  isolating: true,
  indentable: false,
  props: {},
  toMarkdown: (_block, ctx) => ctx.children(),
  toHTML: (_block, ctx) => `<div data-jul-editor-type="column">${ctx.children()}</div>`,
  toText: (_block, ctx) => ctx.children(),
});

export const columnsBlock = defineBlock({
  type: "columns",
  content: "none",
  children: ["column"],
  isolating: true,
  indentable: false,
  props: {},
  toMarkdown(_block, ctx) {
    ctx.lossy("columns-flattened");
    return ctx.children();
  },
  toHTML: (_block, ctx) => `<div data-jul-editor-type="columns">${ctx.children()}</div>`,
  toText: (_block, ctx) => ctx.children(),
  fromHTML: {
    selector: 'div[data-jul-editor-type="columns"]',
    parse(el, ctx): Block | null {
      const cols = Array.from(el.children).filter((c) => c.getAttribute("data-jul-editor-type") === "column");
      if (cols.length === 0) return null; // not ours (or empty): fall back to generic unwrapping
      const children = cols.slice(0, MAX_COLUMNS).map((c) => {
        const blocks = blocksFromHTML(c, ctx);
        return newColumn(blocks.length ? blocks : [emptyParagraph()]);
      });
      return { id: newId(), type: "columns", props: {}, children };
    },
  },
});

export const columnsBlocks = [columnsBlock, columnBlock];

function isBlankParagraph(r: { type: string; content?: unknown[]; childIds: string[] } | undefined): boolean {
  return r?.type === "paragraph" && !r.content?.length && !r.childIds.length;
}

/** Adds an empty column at the end (no-op at MAX_COLUMNS). Returns the new column id. */
export function addColumn(editor: Editor, columnsId: string, index?: number): string | null {
  const rec = editor.getState().store.records.get(columnsId);
  if (!rec || rec.type !== "columns" || rec.childIds.length >= MAX_COLUMNS) return null;
  const col = newColumn();
  const at = Math.min(Math.max(index ?? rec.childIds.length, 0), rec.childIds.length);
  editor.update((tx) => tx.insertBlock(columnsId, at, col));
  return col.id;
}

/** Replaces `columns` by its columns' blocks, in order, at the columns' own position (one undo step). */
export function unwrapColumns(editor: Editor, columnsId: string): void {
  const store = editor.getState().store;
  const rec = store.records.get(columnsId);
  if (!rec || rec.type !== "columns") return;
  const parent = rec.parentId === null ? null : rec.parentId;
  const siblings = parent === null ? store.rootIds : (store.records.get(parent)?.childIds ?? []);
  let at = siblings.indexOf(columnsId);
  const moved: string[] = [];
  for (const colId of rec.childIds) for (const id of store.records.get(colId)?.childIds ?? []) moved.push(id);
  // a column that only holds its blank starter paragraph contributes nothing (unless everything is blank)
  const isBlank = (id: string) => isBlankParagraph(store.records.get(id));
  const kept = moved.filter((id) => !isBlank(id));
  const keep = new Set(kept.length ? kept : moved.slice(0, 1));
  editor.update((tx) => {
    let t = tx;
    for (const id of moved) if (keep.has(id)) t = t.moveBlock(id, parent, at++);
    return t.removeBlock(columnsId);
  });
}

/** Removes a column, moving its blocks into the previous (or next) column; with a single column left
 * the whole container unwraps. */
export function removeColumn(editor: Editor, columnId: string): void {
  const store = editor.getState().store;
  const col = store.records.get(columnId);
  const parent = col?.parentId ? store.records.get(col.parentId) : undefined;
  if (!col || col.type !== "column" || !parent) return;
  const siblings = parent.childIds;
  if (siblings.length <= MIN_COLUMNS) {
    // two columns -> unwrap everything (keeps the content, drops the layout)
    unwrapColumns(editor, parent.id);
    return;
  }
  const i = siblings.indexOf(columnId);
  const target = siblings[i - 1] ?? siblings[i + 1]!;
  const targetEnd = store.records.get(target)?.childIds.length ?? 0;
  editor.update((tx) => {
    let t = tx;
    col.childIds.filter((id) => !isBlankParagraph(store.records.get(id))).forEach((id, k) => {
      t = t.moveBlock(id, target, i > 0 ? targetEnd + k : k);
    });
    return t.removeBlock(columnId);
  });
}

function slashFor(count: number): SlashItem & { id: string } {
  return {
    id: `columns-${count}`,
    type: "columns",
    title: `${count} columns`,
    keywords: ["columns", "column", "layout", `${count}col`, "컬럼", "열", "단", count === 2 ? "2단" : "3단"],
    create: () => createColumnsBlock(count),
  };
}

/** `/columns` (2) and a 3-column entry. */
export const columnsSlashItems: Array<SlashItem & { id: string }> = [slashFor(2), slashFor(3)];
