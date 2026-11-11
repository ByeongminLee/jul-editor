// Regressions from the editor audit (round 1, batch 3): selections made with the mouse.
//  - a triple click selected into the next block (the native range ends at its offset 0), so typing
//    over it merged that block into this one and it lost its type;
//  - a drag from text onto a void (image) stopped before the void and never included it;
//  - a block selection (Mod-a twice, a drag onto a void) left the old native text highlight painted;
//  - a click on the empty last paragraph could not leave a block selection.
// Uses the "/editor" page (createEditor).

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getDoc, getSelection, textOf } from "./helpers/editor-doc.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

async function charPoint(page: Page, blockId: string, offset: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ blockId, offset }) => {
      const text = document.querySelector(`[data-id="${blockId}"] [data-jul-editor-content]`)!.firstChild as Text;
      const r = document.createRange();
      r.setStart(text, offset);
      r.setEnd(text, offset + 1);
      const b = r.getClientRects()[0]!;
      return { x: b.left + 1, y: b.top + b.height / 2 };
    },
    { blockId, offset },
  );
}

test("triple click selects only the paragraph's own text; typing over it keeps the next block", async ({ page }) => {
  const p = await charPoint(page, "p1", 3);
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  await expect.poll(() => getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 11 } });
  await page.keyboard.type("N");
  const doc = await getDoc(page);
  expect(textOf(doc, "p1")).toBe("N");
  expect(doc.blocks.find((b) => b.id === "h1")?.type).toBe("heading");
  expect(textOf(doc, "h1")).toBe("Title");
});

test("a drag from text onto an image becomes a block selection that includes it, without a stale native highlight", async ({ page }) => {
  const from = await charPoint(page, "o2", 1);
  const image = (await page.locator('[data-jul-editor-block][data-id="v1"]').boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(image.x + image.width / 2, image.y + Math.min(20, image.height / 2), { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => getSelection(page)).toEqual({ type: "block", ids: ["o2", "o3", "v1"] });
  expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(true);
  await page.keyboard.press("Backspace");
  const ids = (await getDoc(page)).blocks.map((b) => b.id);
  expect(ids).not.toContain("v1");
  expect(ids).not.toContain("o3");
});

// Round 2: a drag released PAST a void (in the text after it) stopped at the void or kept a text range
// that hid the void it would delete; it now spans whole blocks like a drag released on the void.
test("a drag released in the text past an image selects every block from the press to the release", async ({ page }) => {
  const from = await charPoint(page, "o2", 1);
  const end = (await page.locator('[data-jul-editor-block][data-id="pEnd"]').boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(end.x + 10, end.y + end.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => getSelection(page)).toEqual({ type: "block", ids: ["o2", "o3", "v1", "pEnd"] });
  await page.keyboard.press("Backspace");
  const ids = (await getDoc(page)).blocks.map((b) => b.id);
  for (const id of ["o2", "o3", "v1"]) expect(ids).not.toContain(id);
  expect(ids).toContain("o1");
});

test("a drag between two text blocks with no void between them stays a text range", async ({ page }) => {
  const a = await charPoint(page, "p1", 2);
  const z = await charPoint(page, "q1", 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => ((await getSelection(page)) as { type: string }).type).toBe("text");
});

test("Mod-a twice clears the partial native text highlight", async ({ page }) => {
  const a = await charPoint(page, "p1", 2);
  const z = await charPoint(page, "q1", 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(async () => ((await getSelection(page)) as { type: string }).type).toBe("block");
  expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(true);
});

test("a click on the empty last paragraph leaves a block selection", async ({ page }) => {
  const p = await charPoint(page, "p1", 2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(async () => ((await getSelection(page)) as { type: string }).type).toBe("block");
  await page.locator('[data-jul-editor-block][data-id="pEnd"]').click();
  await expect.poll(() => getSelection(page)).toEqual({ type: "text", anchor: { blockId: "pEnd", offset: 0 }, focus: { blockId: "pEnd", offset: 0 } });
  await page.keyboard.type("z");
  const doc = await getDoc(page);
  expect(textOf(doc, "pEnd")).toBe("z");
  expect(textOf(doc, "p1")).toBe("Hello world");
});
