// Notion-style block drag handle -- @jul-editor/react's Editor.DragHandle is
// headless (tracks hover/computes drop targets/runs the pointer+keyboard
// drag state machine, see packages/react/src/drag-handle/); this exercises
// it through the playground's own handle/indicator/actions markup on the
// "/react" demo (e2e/fixtures/src/react/react-demo.tsx). See
// packages/react/src/drag-handle/drop-target.test.ts (pure drop-target math)
// and packages/core/src/view/editor.test.ts's "drag handle core API"
// describe block (moveBlockTo validity rules) for the jsdom-level coverage --
// these are the real-browser behaviors that need it: actual pointer capture,
// actual layout/geometry, actual keyboard focus.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

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
      getSelection: () => { type: string } | null;
    };
  }
}

function textOf(block: DocBlock): string {
  return (block.content ?? []).map((i) => i.text ?? "").join("");
}

function findByText(doc: DocLike, text: string): DocBlock {
  const found = doc.blocks.find((b) => textOf(b) === text);
  if (!found) throw new Error(`no block with text "${text}" (have: ${doc.blocks.map((b) => `${b.type}:${JSON.stringify(textOf(b))}`).join(", ")})`);
  return found;
}

async function getDoc(page: Page): Promise<DocLike> {
  return page.evaluate(() => window.__julEditorReact!.getDoc());
}

function blockLocator(page: Page, blockId: string) {
  return page.locator(`[data-jul-editor-block][data-id="${blockId}"]`);
}

/** Real pointermove over a block's own wrapper -- the hover state useDragHandle
 * tracks. A short settle wait covers the hook's rAF throttle. */
async function hoverBlock(page: Page, blockId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = (await blockLocator(page, blockId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(10, box.height / 2), { steps: 3 });
  await page.waitForTimeout(50);
  return box;
}

/** Sets up three fresh, independently-typed paragraphs (by content, not
 * pre-existing sampleDoc ids) so reordering assertions read naturally --
 * typed into the trailing empty "r-p2" paragraph, then two more via Enter. */
async function setupThreeParagraphs(page: Page): Promise<{ alpha: string; beta: string; gamma: string }> {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("Alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Beta");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Gamma");
  const doc = await getDoc(page);
  return { alpha: findByText(doc, "Alpha").id, beta: findByText(doc, "Beta").id, gamma: findByText(doc, "Gamma").id };
}

/** Picks up `fromBlockId`'s handle (hovering it first) and drags it to a
 * point relative to `toBlockId`'s own rect -- `yFraction` 0..1 picks the
 * before/after half, `xOffset` past the target's left edge triggers 'child'
 * nesting once it exceeds dropTarget.ts's CHILD_OFFSET_PX (40). */
async function dragHandleTo(page: Page, fromBlockId: string, toBlockId: string, opts: { xOffset?: number; yFraction?: number } = {}): Promise<void> {
  await hoverBlock(page, fromBlockId);
  const handle = page.getByTestId("drag-handle");
  await expect(handle).toBeVisible();
  const handleBox = (await handle.boundingBox())!;
  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();

  const targetBox = (await blockLocator(page, toBlockId).boundingBox())!;
  const tx = targetBox.x + (opts.xOffset ?? 5);
  const ty = targetBox.y + targetBox.height * (opts.yFraction ?? 0.5);
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(hx + ((tx - hx) * i) / steps, hy + ((ty - hy) * i) / steps);
    await page.waitForTimeout(15);
  }
  await page.waitForTimeout(30);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/react");
  await expect(page.getByTestId("page-react")).toBeVisible();
});

test("drag handle: starts on the first block and follows hover", async ({ page }) => {
  await expect(page.getByTestId("drag-handle")).toHaveAttribute("data-block-id", "r-p1");

  await hoverBlock(page, "r-p1");
  const handle = page.getByTestId("drag-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("data-block-id", "r-p1");

  await hoverBlock(page, "r-h1");
  await expect(page.getByTestId("drag-handle")).toHaveAttribute("data-block-id", "r-h1");
});

test("drag handle: dragging a paragraph above an earlier one reorders the model, one undo restores", async ({ page }) => {
  const { alpha, beta, gamma } = await setupThreeParagraphs(page);
  const before = (await getDoc(page)).blocks.map((b) => b.id);

  await dragHandleTo(page, gamma, alpha, { yFraction: 0.1 }); // top half -> before Alpha

  const after = await getDoc(page);
  const ids = after.blocks.map((b) => b.id);
  expect(ids.indexOf(gamma)).toBeLessThan(ids.indexOf(alpha));
  expect(ids.indexOf(alpha)).toBeLessThan(ids.indexOf(beta));

  // Undo (Cmd/Ctrl+Z) is handled by core's own beforeinput listener on the
  // CONTENTEDITABLE root -- the drag handle is a plain (non-editable) button
  // that just had focus, so refocus the root first, same as a real user
  // clicking back into the document before undoing.
  await blockLocator(page, gamma).click();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await getDoc(page)).blocks.map((b) => b.id)).toEqual(before);
});

test("drag handle: the editor canvas padding remains a valid drop area", async ({ page }) => {
  const { alpha, gamma } = await setupThreeParagraphs(page);
  await dragHandleTo(page, gamma, alpha, { xOffset: -10, yFraction: 0.1 });
  const ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids.indexOf(gamma)).toBeLessThan(ids.indexOf(alpha));
});

test("drag handle: dropping far enough right of a target nests as its child (list item)", async ({ page }) => {
  // "- " converts the current empty paragraph to a bulletListItem (markdown
  // input rule) -- children:'any', a valid nesting target.
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("- List item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Loose paragraph");
  const doc = await getDoc(page);
  const listItemId = findByText(doc, "List item").id;
  const looseId = findByText(doc, "Loose paragraph").id;
  expect(doc.blocks.find((b) => b.id === listItemId)?.type).toBe("bulletListItem");

  await dragHandleTo(page, looseId, listItemId, { xOffset: 60, yFraction: 0.5 });

  const after = await getDoc(page);
  const listItem = after.blocks.find((b) => b.id === listItemId)!;
  expect(listItem.children?.map((c) => c.id)).toEqual([looseId]);
  expect(after.blocks.some((b) => b.id === looseId)).toBe(false); // no longer a top-level block
});

test("drag handle: cannot drop a block into its own descendant", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("- Parent item");
  const parentId = findByText(await getDoc(page), "Parent item").id;
  // Nest an existing block under it first (same 'child' drop mechanism already
  // proven above) -- r-h1 ("Title"), still around from the sample doc.
  const childId = "r-h1";
  await dragHandleTo(page, childId, parentId, { xOffset: 60, yFraction: 0.5 });
  let doc = await getDoc(page);
  expect(doc.blocks.find((b) => b.id === parentId)?.children?.map((c) => c.id)).toEqual([childId]);
  const before = doc;

  // Now try to drop the parent onto (before/after/child of) its own child -- must no-op.
  await dragHandleTo(page, parentId, childId, { yFraction: 0.1 });
  await dragHandleTo(page, parentId, childId, { xOffset: 60, yFraction: 0.5 });

  doc = await getDoc(page);
  expect(doc).toEqual(before);
});

test("drag handle: keyboard Space/ArrowDown/Space moves the block down one position", async ({ page }) => {
  const { alpha, beta } = await setupThreeParagraphs(page);
  await hoverBlock(page, alpha);
  const handle = page.getByTestId("drag-handle");
  await handle.focus();

  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("drag-announce")).toContainText(/picked up/i);

  await page.keyboard.press("ArrowDown");
  let ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids.indexOf(beta)).toBeLessThan(ids.indexOf(alpha)); // Alpha stepped past Beta

  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "false");

  ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids.indexOf(beta)).toBeLessThan(ids.indexOf(alpha)); // the step was kept, not undone
});

test("drag handle: dragging a multi-block selection moves every selected block in order, as ONE undo step", async ({ page }) => {
  const { alpha, beta, gamma } = await setupThreeParagraphs(page);
  const before = (await getDoc(page)).blocks.map((b) => b.id);
  await page.evaluate(
    ([a, b]) => window.__julEditorReact!.setSelection({ type: "block", ids: [a, b] }),
    [alpha, beta],
  );

  await dragHandleTo(page, alpha, gamma, { yFraction: 0.9 }); // bottom half -> after Gamma

  const ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids.indexOf(gamma)).toBeLessThan(ids.indexOf(alpha));
  expect(ids.indexOf(alpha)).toBeLessThan(ids.indexOf(beta)); // relative order of the moved set preserved

  // A SINGLE undo must restore both blocks' original position -- moving a
  // multi-block selection is one history entry, not one per block (see
  // packages/core/src/view/editor.ts's moveBlocksTo / editor.test.ts's
  // "moveBlocksTo ... as ONE undo step").
  await blockLocator(page, gamma).click();
  await page.keyboard.press("ControlOrMeta+z");
  expect((await getDoc(page)).blocks.map((b) => b.id)).toEqual(before);
});

test("drag handle: focusing the handle keeps a multi-block selection, and the keyboard moves the whole set", async ({ page }) => {
  const { alpha, beta, gamma } = await setupThreeParagraphs(page);
  await page.evaluate(
    ([a, b]) => window.__julEditorReact!.setSelection({ type: "block", ids: [a, b] }),
    [alpha, beta],
  );
  const handle = page.getByTestId("drag-handle");
  await handle.focus();
  await page.waitForTimeout(50); // let core's deferred focus-leave check run

  await page.keyboard.press("Space");
  await expect(page.getByTestId("drag-announce")).toContainText(/picked up 2 blocks/i);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");

  const ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids.indexOf(gamma)).toBeLessThan(ids.indexOf(alpha));
  expect(ids.indexOf(alpha)).toBeLessThan(ids.indexOf(beta));
});

test("drag handle: the block selection clears after leaving the handle (the handle unmounts)", async ({ page }) => {
  const { alpha } = await setupThreeParagraphs(page);
  await page.evaluate((a) => window.__julEditorReact!.setSelection({ type: "block", ids: [a] }), alpha);
  const handle = page.getByTestId("drag-handle");
  await handle.focus();
  await page.waitForTimeout(50);
  expect((await page.evaluate(() => window.__julEditorReact!.getSelection()))?.type).toBe("block");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await page.mouse.click(2, 2); // a click outside the editor and handle
  await expect.poll(() => page.evaluate(() => window.__julEditorReact!.getSelection())).toBeNull();
});

test("drag handle: duplicate via useBlockActions reissues ids and inserts right after the original", async ({ page }) => {
  await hoverBlock(page, "r-p1");
  await expect(page.getByTestId("drag-duplicate")).toBeVisible();

  const before = await getDoc(page);
  await page.getByTestId("drag-duplicate").click();

  const after = await getDoc(page);
  expect(after.blocks).toHaveLength(before.blocks.length + 1);
  const originalIndex = after.blocks.findIndex((b) => b.id === "r-p1");
  const copy = after.blocks[originalIndex + 1]!;
  expect(copy.id).not.toBe("r-p1");
  expect(textOf(copy)).toBe(textOf(before.blocks[0]!));
});
