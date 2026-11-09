// Cell-editable tables (table > tableRow > tableCell), exercised on the
// "/react" demo (e2e/fixtures/src/react/react-demo.tsx) via its SlashMenu
// and the new table toolbar atoms (Editor.InsertTable/AddRowAfter/...). See
// packages/core/src/store/table.test.ts + packages/core/src/view/
// builtins-keymap.test.ts + packages/react/src/table/table.test.tsx for the
// pure-logic/jsdom unit coverage (each command's ops+inverse, keymap
// handlers, toolbar atom disabled-state) -- these are the real-browser
// behaviors that need it: actual mouse drag-select, actual clipboard events,
// actual Korean IME composition, actual undo.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { copySelection, pasteJulEditorJson, pasteText } from "./helpers/clipboard.js";
import { typeComposed } from "./helpers/ime.js";

interface DocInline {
  type: string;
  text?: string;
}
interface DocBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: DocInline[];
  children?: DocBlock[];
}
interface DocLike {
  blocks: DocBlock[];
}

declare global {
  interface Window {
    __julEditorReact?: {
      getDoc: () => DocLike;
      renderCounts: { toolbar: number };
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: unknown) => void;
    };
  }
}

function findBlock(doc: DocLike, id: string): DocBlock {
  const block = doc.blocks.find((b) => b.id === id);
  if (!block) throw new Error(`block "${id}" not found`);
  return block;
}

function textOf(block: DocBlock): string {
  return (block.content ?? []).map((i) => i.text ?? "").join("");
}

function findTable(doc: DocLike): DocBlock {
  const table = doc.blocks.find((b) => b.type === "table");
  if (!table) throw new Error("no table block in doc");
  return table;
}

function cellAt(table: DocBlock, row: number, col: number): DocBlock {
  const rowBlock = table.children?.[row];
  const cell = rowBlock?.children?.[col];
  if (!cell) throw new Error(`no cell at (${row},${col})`);
  return cell;
}

/** Finds a cell by id anywhere in `table`'s own rows -- unlike `findBlock`
 * (which only looks at DOC-ROOT blocks, so it can never find a nested
 * tableCell), and unlike `cellAt` (which reads a raw row/col INDEX -- wrong
 * once a merge has shifted a row's own childIds, per this file's own "Tab
 * from a merged cell" test comment). Used when a test needs to look up one
 * of its OWN pre-merge cell ids again by identity after the table's shape
 * has since changed. */
function findCell(table: DocBlock, id: string): DocBlock {
  for (const row of table.children ?? []) {
    const cell = row.children?.find((c) => c.id === id);
    if (cell) return cell;
  }
  throw new Error(`cell "${id}" not found in table "${table.id}"`);
}

async function getDoc(page: Page): Promise<DocLike> {
  return page.evaluate(() => window.__julEditorReact!.getDoc());
}

/** Inserts a fresh 3x3 table via the slash menu (the "insert via slash menu"
 * scenario itself, reused as setup for every other test -- real UI-driven,
 * not a script-level shortcut). Caret starts in the empty trailing paragraph
 * "r-p2" (ReactDemo's sampleDoc). */
async function insertTable(page: Page): Promise<string> {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("/table");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Table", { exact: true }).click();
  await expect(menu).toBeHidden();
  return findTable(await getDoc(page)).id;
}

/** The empty paragraph slash-inserting a table leaves right after it (the
 * '/table' line itself, r-p2, is replaced by the table). */
async function paragraphAfter(page: Page, blockId: string): Promise<string> {
  const doc = await getDoc(page);
  return doc.blocks[doc.blocks.findIndex((b) => b.id === blockId) + 1]!.id;
}

function cellLocator(page: Page, cellId: string) {
  return page.locator(`[data-jul-editor-block][data-id="${cellId}"] > [data-jul-editor-content]`);
}

async function clickCell(page: Page, cellId: string): Promise<void> {
  await cellLocator(page, cellId).click();
}

/** Drags a real text selection from inside `fromId`'s cell to inside `toId`'s
 * (near each cell's own left edge, where its first character actually sits --
 * a table renders as plain nested divs with no CSS grid in core, so a cell's
 * content div is full-width and a click at its horizontal center can land far
 * past any short text it holds). A single `mouse.move({steps})` wasn't enough
 * to make Chromium recognize this as a real drag-select in headless mode
 * (it kept collapsing to wherever the pointer released, like a plain click) --
 * many small steps with a short pause between each reliably does. */
async function dragSelect(page: Page, fromId: string, toId: string): Promise<void> {
  const fromBox = (await cellLocator(page, fromId).boundingBox())!;
  const toBox = (await cellLocator(page, toId).boundingBox())!;
  const fx = fromBox.x + 5;
  const fy = fromBox.y + fromBox.height / 2;
  const tx = toBox.x + 5;
  const ty = toBox.y + toBox.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fx + ((tx - fx) * i) / steps, fy + ((ty - fy) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(50);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/react");
  await expect(page.getByTestId("page-react")).toBeVisible();
});

test("table: insert via slash menu creates a 3x3 grid with header row on and caret in the first cell", async ({ page }) => {
  const tableId = await insertTable(page);
  const doc = await getDoc(page);
  const table = findBlock(doc, tableId);
  expect(table.children).toHaveLength(3);
  for (const row of table.children ?? []) {
    expect(row.type).toBe("tableRow");
    expect(row.children).toHaveLength(3);
    for (const cell of row.children ?? []) expect(cell.type).toBe("tableCell");
  }
  // caret lands in the first cell -- typing immediately edits it, not r-p2.
  await page.keyboard.type("hi");
  const after = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(after, 0, 0))).toBe("hi");
});

test("table: typing in different cells edits each one's own content independently", async ({ page }) => {
  const tableId = await insertTable(page);
  let doc = await getDoc(page);
  let table = findBlock(doc, tableId);
  await clickCell(page, cellAt(table, 0, 0).id);
  await page.keyboard.type("Name");
  await clickCell(page, cellAt(table, 0, 1).id);
  await page.keyboard.type("Age");

  doc = await getDoc(page);
  table = findBlock(doc, tableId);
  expect(textOf(cellAt(table, 0, 0))).toBe("Name");
  expect(textOf(cellAt(table, 0, 1))).toBe("Age");
  expect(textOf(cellAt(table, 0, 2))).toBe(""); // untouched
});

test("table: Tab/Shift-Tab move between cells; Tab in the last cell of the last row appends a new row", async ({ page }) => {
  const tableId = await insertTable(page);
  let doc = await getDoc(page);
  let table = findBlock(doc, tableId);
  await clickCell(page, cellAt(table, 0, 0).id);
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("A"); // Shift-Tab lands at the END of the previous cell's content, not its start

  doc = await getDoc(page);
  table = findBlock(doc, tableId);
  expect(textOf(cellAt(table, 0, 0))).toBe("aA");
  expect(textOf(cellAt(table, 0, 1))).toBe("b");

  // Last cell of the last row: Tab appends a brand-new row.
  await clickCell(page, cellAt(table, 2, 2).id);
  await page.keyboard.press("Tab");
  await page.keyboard.type("new-row");

  doc = await getDoc(page);
  table = findBlock(doc, tableId);
  expect(table.children).toHaveLength(4);
  expect(textOf(cellAt(table, 3, 0))).toBe("new-row");
});

test("table: ArrowUp/ArrowDown move within the same column across rows", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  await clickCell(page, cellAt(table, 1, 1).id);
  await page.keyboard.type("mid");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("top");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("bottom");

  const after = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(after, 0, 1))).toBe("top");
  expect(textOf(cellAt(after, 1, 1))).toBe("mid");
  expect(textOf(cellAt(after, 2, 1))).toBe("bottom");
  expect(textOf(cellAt(after, 0, 0))).toBe(""); // a neighboring column, never touched
});

test("table: drag-selecting a 2x2 rectangle marks it (data-jul-editor-cell-selected) and Delete clears contents only", async ({ page }) => {
  const tableId = await insertTable(page);
  let table = findBlock(await getDoc(page), tableId);
  const ids = { a: cellAt(table, 0, 0).id, b: cellAt(table, 0, 1).id, c: cellAt(table, 1, 0).id, d: cellAt(table, 1, 1).id, e: cellAt(table, 2, 2).id };
  for (const [id, text] of [
    [ids.a, "A"],
    [ids.b, "B"],
    [ids.c, "C"],
    [ids.d, "D"],
    [ids.e, "E"],
  ] as const) {
    await clickCell(page, id);
    await page.keyboard.type(text);
  }

  await dragSelect(page, ids.a, ids.d);

  for (const id of [ids.a, ids.b, ids.c, ids.d]) {
    await expect(page.locator(`[data-jul-editor-block][data-id="${id}"]`)).toHaveAttribute("data-jul-editor-cell-selected", "");
  }

  await page.keyboard.press("Delete");

  table = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(table, 0, 0))).toBe("");
  expect(textOf(cellAt(table, 0, 1))).toBe("");
  expect(textOf(cellAt(table, 1, 0))).toBe("");
  expect(textOf(cellAt(table, 1, 1))).toBe("");
  expect(textOf(cellAt(table, 2, 2))).toBe("E"); // outside the rectangle, untouched
  expect(table.children).toHaveLength(3); // structure intact -- only content cleared
});

test("table: copying a 2x2 rectangle and pasting at another anchor grows the table", async ({ page }) => {
  const tableId = await insertTable(page);
  let table = findBlock(await getDoc(page), tableId);
  const a00 = cellAt(table, 0, 0).id;
  const a01 = cellAt(table, 0, 1).id;
  const a10 = cellAt(table, 1, 0).id;
  const a11 = cellAt(table, 1, 1).id;
  for (const [id, text] of [
    [a00, "A"],
    [a01, "B"],
    [a10, "C"],
    [a11, "D"],
  ] as const) {
    await clickCell(page, id);
    await page.keyboard.type(text);
  }

  await page.evaluate((tid) => window.__julEditorReact!.setSelection({ type: "cells", tableId: tid, anchor: [0, 0], focus: [1, 1] }), tableId);
  const { json } = await copySelection(page);
  expect(json).toContain('"type":"table"');

  // Paste anchored at (2,1) -- bottom-middle cell -- grows the table to 4
  // rows (row 2 + 2 source rows) while columns stay at 3 (already wide enough).
  const bottomMiddle = cellAt(table, 2, 1).id;
  await clickCell(page, bottomMiddle);
  await pasteJulEditorJson(page, json);

  table = findBlock(await getDoc(page), tableId);
  expect(table.children).toHaveLength(4);
  expect(textOf(cellAt(table, 2, 1))).toBe("A");
  expect(textOf(cellAt(table, 2, 2))).toBe("B");
  expect(textOf(cellAt(table, 3, 1))).toBe("C");
  expect(textOf(cellAt(table, 3, 2))).toBe("D");
});

test("table: add/delete row and column via toolbar atoms", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  await clickCell(page, cellAt(table, 1, 1).id);

  await page.getByTestId("table-add-row-after").click();
  expect(findBlock(await getDoc(page), tableId).children).toHaveLength(4);
  await page.getByTestId("table-delete-row").click();
  expect(findBlock(await getDoc(page), tableId).children).toHaveLength(3);

  await page.getByTestId("table-add-col-after").click();
  expect(findBlock(await getDoc(page), tableId).children![0]!.children).toHaveLength(4);
  await page.getByTestId("table-delete-col").click();
  expect(findBlock(await getDoc(page), tableId).children![0]!.children).toHaveLength(3);
});

test("table: ToggleHeaderRow flips the table's headerRow prop", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  await clickCell(page, cellAt(table, 0, 0).id);

  const toggle = page.getByTestId("table-toggle-header");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  expect(findBlock(await getDoc(page), tableId).props?.headerRow).toBe(false);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  expect(findBlock(await getDoc(page), tableId).props?.headerRow ?? true).toBe(true);
});

test("table: Mod+Enter exits the table to a new paragraph right after it", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  await clickCell(page, cellAt(table, 2, 2).id);
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.type("after table");

  const doc = await getDoc(page);
  const tableIndex = doc.blocks.findIndex((b) => b.id === tableId);
  const next = doc.blocks[tableIndex + 1]!;
  expect(next.type).toBe("paragraph");
  expect(textOf(next)).toBe("after table");
});

test("table: Backspace at the very start of the first cell never merges (structure untouched)", async ({ page }) => {
  const tableId = await insertTable(page);
  const before = await getDoc(page);
  const table = findBlock(before, tableId);
  const firstCellId = cellAt(table, 0, 0).id;
  await clickCell(page, firstCellId);
  await page.keyboard.press("Backspace");

  const after = await getDoc(page);
  expect(after).toEqual(before);
});

test("table: Korean IME composition inside a cell", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const cellId = cellAt(table, 1, 1).id;
  await page.evaluate((id) => window.__julEditorReact!.setCaret(id, 0), cellId);
  await typeComposed(page, ["ㅎ", "하", "한"], "한글");

  const after = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(after, 1, 1))).toBe("한글");
});

test("table: markdown export of an edited table round-trips as valid GFM (fromMarkdown(toMarkdown) preserves structure/content)", async ({ page }) => {
  const tableId = await insertTable(page);
  let table = findBlock(await getDoc(page), tableId);
  for (const [r, c, text] of [
    [0, 0, "Name"],
    [0, 1, "Age"],
    [1, 0, "Ada"],
    [1, 1, "36"],
  ] as const) {
    await clickCell(page, cellAt(table, r, c).id);
    await page.keyboard.type(text);
  }
  table = findBlock(await getDoc(page), tableId);

  await page.evaluate((tid) => window.__julEditorReact!.setSelection({ type: "block", ids: [tid] }), tableId);
  const { text: markdown } = await copySelection(page);
  expect(markdown).toContain("| --- |"); // a real GFM header-separator row

  const pasteAt = await paragraphAfter(page, tableId);
  await page.evaluate((id) => window.__julEditorReact!.setCaret(id, 0), pasteAt); // a fresh, unrelated caret spot to paste the copied markdown into
  await pasteText(page, markdown);

  const doc = await getDoc(page);
  const tables = doc.blocks.filter((b) => b.type === "table");
  expect(tables).toHaveLength(2);
  const roundTripped = tables[1]!;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      expect(textOf(cellAt(roundTripped, r, c))).toBe(textOf(cellAt(table, r, c)));
    }
  }
});

test("table: undo of an add-column is a single undo step", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  await clickCell(page, cellAt(table, 0, 0).id);
  const before = findBlock(await getDoc(page), tableId).children![0]!.children!.length;

  await page.getByTestId("table-add-col-after").click();
  expect(findBlock(await getDoc(page), tableId).children![0]!.children).toHaveLength(before + 1);

  await page.keyboard.press("Meta+z");
  expect(findBlock(await getDoc(page), tableId).children![0]!.children).toHaveLength(before);
});

// ---- merge/split/move, grid picker, hover handles -----------------------------

test("table: drag-select a 2x2 rectangle then MergeCells makes one visible cell with colspan=2 rowspan=2", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const ids = { a: cellAt(table, 0, 0).id, d: cellAt(table, 1, 1).id };
  await clickCell(page, ids.a);
  await page.keyboard.type("A");

  await dragSelect(page, ids.a, ids.d);
  await page.getByTestId("table-merge-cells").click();

  const merged = findBlock(await getDoc(page), tableId);
  expect(merged.children![0]!.children).toHaveLength(2); // merged anchor + untouched (0,2)
  const anchor = cellAt(merged, 0, 0);
  expect(anchor.props?.colspan).toBe(2);
  expect(anchor.props?.rowspan).toBe(2);
  expect(anchor.content?.[0]?.text).toBe("A");

  // Visible in the DOM as ONE cell wrapper carrying both span attributes --
  // the 3 covered positions render no wrapper of their own at all.
  const anchorEl = page.locator(`[data-jul-editor-block][data-id="${anchor.id}"]`);
  await expect(anchorEl).toHaveAttribute("data-jul-editor-colspan", "2");
  await expect(anchorEl).toHaveAttribute("data-jul-editor-rowspan", "2");
  for (const covered of [cellAt(table, 0, 1).id, cellAt(table, 1, 0).id, cellAt(table, 1, 1).id]) {
    await expect(page.locator(`[data-jul-editor-block][data-id="${covered}"]`)).toHaveCount(0);
  }
});

test("table: Tab from a merged cell skips its own covered positions", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const ids = { a: cellAt(table, 0, 0).id, d: cellAt(table, 1, 1).id };
  await dragSelect(page, ids.a, ids.d);
  await page.getByTestId("table-merge-cells").click();

  const merged = findBlock(await getDoc(page), tableId);
  const anchor = cellAt(merged, 0, 0);
  await clickCell(page, anchor.id);
  await page.keyboard.press("Tab");
  await page.keyboard.type("next");

  const after = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(after, 0, 1))).toBe("next"); // the untouched (0,2)-turned-(0,1) survivor, not a covered slot
});

test("table: SplitCell restores a merged cell's own 1x1 cells", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const ids = { a: cellAt(table, 0, 0).id, d: cellAt(table, 1, 1).id };
  await clickCell(page, ids.a);
  await page.keyboard.type("A");
  await dragSelect(page, ids.a, ids.d);
  await page.getByTestId("table-merge-cells").click();

  await page.getByTestId("table-split-cell").click();

  const after = findBlock(await getDoc(page), tableId);
  expect(after.children![0]!.children).toHaveLength(3);
  expect(after.children![1]!.children).toHaveLength(3);
  expect(textOf(cellAt(after, 0, 0))).toBe("A"); // anchor kept its content
  expect(textOf(cellAt(after, 0, 1))).toBe(""); // the rest start empty
  expect(textOf(cellAt(after, 1, 0))).toBe("");
  expect(textOf(cellAt(after, 1, 1))).toBe("");
});

test("table: ArrowUp/ArrowDown and Shift-Arrow navigation are grid-aware across a 2x2 merged cell", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const ids = {
    anchor: cellAt(table, 0, 0).id,
    mergeEnd: cellAt(table, 1, 1).id,
    c: cellAt(table, 0, 2).id,
    d: cellAt(table, 1, 2).id,
    e: cellAt(table, 2, 0).id,
    f: cellAt(table, 2, 1).id,
  };

  await dragSelect(page, ids.anchor, ids.mergeEnd);
  await page.getByTestId("table-merge-cells").click();

  // ArrowDown from the (still empty) merged cell must skip past grid row 1
  // (still covered by the SAME cell's own rowspan) and land in grid row 2 --
  // the earlier childIds-index code would have used the merged cell's own
  // row-block index + 1 and landed on row 1, which has no cell of its own at
  // that column anymore.
  await clickCell(page, ids.anchor);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("E");
  let table2 = findBlock(await getDoc(page), tableId);
  expect(textOf(findCell(table2, ids.e))).toBe("E");
  expect(textOf(findCell(table2, ids.anchor))).toBe(""); // the merged cell itself, untouched

  // ArrowUp from grid row 2 lands back in the merged cell.
  await clickCell(page, ids.f);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("up");
  table2 = findBlock(await getDoc(page), tableId);
  expect(textOf(findCell(table2, ids.anchor))).toBe("up");

  // Shift-ArrowRight from the (now non-empty) merged cell, caret at its own
  // end, selects it + the next DISTINCT cell -- grid column 2 (c), past its
  // own colspan (2) -- not a covered position still inside the same merge.
  await clickCell(page, ids.anchor);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(`[data-jul-editor-block][data-id="${ids.anchor}"]`)).toHaveAttribute("data-jul-editor-cell-selected", "");
  await expect(page.locator(`[data-jul-editor-block][data-id="${ids.c}"]`)).toHaveAttribute("data-jul-editor-cell-selected", "");
  await expect(page.locator(`[data-jul-editor-block][data-id="${ids.d}"]`)).not.toHaveAttribute("data-jul-editor-cell-selected", "");

  // A further Shift-ArrowDown (whole-table keymap, `cells` selection now
  // active) extends the rectangle into grid row 1 -- newly covering `d`
  // (row1, col2), still without reaching row 2 (e/f).
  await page.keyboard.press("Shift+ArrowDown");
  for (const id of [ids.anchor, ids.c, ids.d]) {
    await expect(page.locator(`[data-jul-editor-block][data-id="${id}"]`)).toHaveAttribute("data-jul-editor-cell-selected", "");
  }
  for (const id of [ids.e, ids.f]) {
    await expect(page.locator(`[data-jul-editor-block][data-id="${id}"]`)).not.toHaveAttribute("data-jul-editor-cell-selected", "");
  }
});

test("table: MoveRowDown/MoveColumnRight update row/column order", async ({ page }) => {
  const tableId = await insertTable(page);
  let table = findBlock(await getDoc(page), tableId);
  const firstRowId = table.children![0]!.id;
  const firstCellId = cellAt(table, 0, 0).id;
  await clickCell(page, firstCellId);
  await page.keyboard.type("A");

  await page.getByTestId("table-move-row-down").click();
  table = findBlock(await getDoc(page), tableId);
  expect(table.children![1]!.id).toBe(firstRowId);
  expect(textOf(cellAt(table, 1, 0))).toBe("A");

  await clickCell(page, firstCellId);
  await page.getByTestId("table-move-col-right").click();
  table = findBlock(await getDoc(page), tableId);
  expect(cellAt(table, 1, 1).id).toBe(firstCellId);
});

test("table: the grid picker inserts a 3x4 table sized by the hovered cell", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  const picker = page.getByTestId("table-grid-picker");
  await expect(picker).toBeVisible();
  const targetCell = page.getByTestId("grid-picker-cell-2-3"); // 0-based -> 3 rows x 4 cols
  await targetCell.hover();
  await expect(targetCell).toHaveAttribute("data-active", "");
  await expect(page.getByTestId("grid-picker-cell-0-0")).toHaveAttribute("data-active", ""); // whole rectangle up to the hover
  await expect(page.getByTestId("grid-picker-cell-4-4")).not.toHaveAttribute("data-active", "");
  await targetCell.click();

  const table = findTable(await getDoc(page));
  expect(table.children).toHaveLength(3);
  expect(table.children![0]!.children).toHaveLength(4);
});

test("table: hover handles report the hovered row/col", async ({ page }) => {
  const tableId = await insertTable(page);
  await clickCell(page, findBlock(await getDoc(page), tableId).children![0]!.children![0]!.id);

  const info = page.getByTestId("table-hover-info");
  await expect(info).toBeVisible();
  await expect(page.getByTestId("hover-row-value")).toHaveText("");

  await page.getByTestId("hover-row-1").hover();
  await expect(page.getByTestId("hover-row-value")).toHaveText("1");
  await expect(page.getByTestId("hover-row-rect")).toHaveText("rect");

  await page.getByTestId("hover-col-0").hover();
  await expect(page.getByTestId("hover-col-value")).toHaveText("0");
});

test("table: Korean IME composition inside a merged cell", async ({ page }) => {
  const tableId = await insertTable(page);
  const table = findBlock(await getDoc(page), tableId);
  const ids = { a: cellAt(table, 0, 0).id, d: cellAt(table, 1, 1).id };
  await dragSelect(page, ids.a, ids.d);
  await page.getByTestId("table-merge-cells").click();

  const merged = findBlock(await getDoc(page), tableId);
  const anchorId = cellAt(merged, 0, 0).id;
  await page.evaluate((id) => window.__julEditorReact!.setCaret(id, 0), anchorId);
  await typeComposed(page, ["ㅎ", "하", "한"], "한글");

  const after = findBlock(await getDoc(page), tableId);
  expect(textOf(cellAt(after, 0, 0))).toBe("한글");
  expect(cellAt(after, 0, 0).props?.colspan).toBe(2); // the merge itself survived the composition
});

test("table: copying a merged region and pasting into another table preserves its colspan/rowspan", async ({ page }) => {
  const sourceId = await insertTable(page);
  let source = findBlock(await getDoc(page), sourceId);
  const ids = { a: cellAt(source, 0, 0).id, d: cellAt(source, 1, 1).id };
  await clickCell(page, ids.a);
  await page.keyboard.type("M");
  await dragSelect(page, ids.a, ids.d);
  await page.getByTestId("table-merge-cells").click();

  source = findBlock(await getDoc(page), sourceId);
  // Select the merged cell's own FULL footprint (its own colspan=2 rowspan=2
  // rectangle) -- the same shape a real drag-select spanning it would leave.
  await page.evaluate((tid) => window.__julEditorReact!.setSelection({ type: "cells", tableId: tid, anchor: [0, 0], focus: [1, 1] }), sourceId);
  const { json } = await copySelection(page);

  // A second, independent table to paste into.
  const secondAt = await paragraphAfter(page, sourceId);
  await page.evaluate((id) => window.__julEditorReact!.setCaret(id, 0), secondAt);
  await page.keyboard.type("/table");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Table", { exact: true }).click();
  const doc = await getDoc(page);
  const destId = doc.blocks.filter((b) => b.type === "table").find((b) => b.id !== sourceId)!.id;
  const dest = findBlock(doc, destId);
  await clickCell(page, cellAt(dest, 0, 0).id);
  await pasteJulEditorJson(page, json);

  const after = findBlock(await getDoc(page), destId);
  const pastedAnchor = cellAt(after, 0, 0);
  expect(pastedAnchor.props?.colspan).toBe(2);
  expect(pastedAnchor.props?.rowspan).toBe(2);
  expect(textOf(pastedAnchor)).toBe("M");
});
