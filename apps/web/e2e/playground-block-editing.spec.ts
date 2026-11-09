// Regressions from the editor audit (round 1, batch 4: core block editing). A block selection that
// held the playground's table ignored Backspace/typing, a key typed right after Enter could land in
// the block after the new paragraph, Tab in the code workspace jumped to the site header, and a
// checked to-do neither showed its state nor handed it on correctly.
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/playground");
  await expect(page.locator("[data-id=demo-p1] [data-jul-editor-content]")).toBeVisible();
});

async function caretAtEnd(page: Page, blockId: string): Promise<void> {
  const content = page.locator(`[data-jul-editor-block][data-id="${blockId}"] > [data-jul-editor-content]`);
  await content.scrollIntoViewIfNeeded();
  const box = (await content.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + Math.min(10, box.height / 2));
  await page.keyboard.press("End");
}

const rootBlockCount = (page: Page) => page.locator("[data-jul-editor-root] > [data-jul-editor-block]").count();

test("Select All over a document holding a table, then Backspace, deletes every block", async ({ page }) => {
  await expect(page.locator("[data-jul-editor-root] [data-type=table]").first()).toBeAttached();
  await caretAtEnd(page, "demo-p1");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  expect(await page.locator("[data-jul-editor-root] > [data-jul-editor-selected]").count()).toBeGreaterThan(5);
  await page.keyboard.press("Backspace");
  await expect.poll(() => rootBlockCount(page)).toBe(1);
  await expect(page.locator("[data-jul-editor-root] [data-type=table]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-jul-editor-root] [data-type=table]").first()).toBeAttached();
});

test("keys typed with no delay right after Enter go into the new paragraph", async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    if (i) await page.getByRole("button", { name: "Restore sample" }).click();
    await caretAtEnd(page, "demo-p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("abc");
    await expect(page.locator("[data-id=demo-list-1] > [data-jul-editor-content]")).toHaveText("Drag the handle on the left to move this item.");
    await expect(page.locator("[data-id=demo-p1] + [data-jul-editor-block] > [data-jul-editor-content]")).toHaveText("abc");
  }
});

test("Tab in the code workspace editor indents the code and keeps focus there", async ({ page }) => {
  const workspace = page.locator("[data-jul-editor-block][data-type=codeWorkspace]");
  await workspace.scrollIntoViewIfNeeded();
  const box = (await workspace.boundingBox())!;
  await page.mouse.click(box.x + 600, box.y + 200);
  const code = workspace.getByRole("textbox", { name: "Code" });
  await code.click();
  await code.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  const before = await code.inputValue();
  await page.keyboard.press("Tab");
  await expect(code).toBeFocused();
  await expect.poll(() => code.inputValue()).toBe(`  ${before}`);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => code.inputValue()).toBe(before);
});

test("a checked to-do shows its state, hands an UNchecked item to Enter, and its marker toggles", async ({ page }) => {
  await caretAtEnd(page, "demo-p1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[x] done task", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("new task", { delay: 20 });
  const todos = page.locator("[data-jul-editor-root] [data-type=todoListItem]");
  await expect(todos).toHaveCount(2);
  await expect(todos.nth(0)).toHaveAttribute("data-jul-editor-checked", "true");
  await expect(todos.nth(1)).not.toHaveAttribute("data-jul-editor-checked", /.*/);
  const box = (await todos.nth(1).boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + 10);
  await expect(todos.nth(1)).toHaveAttribute("data-jul-editor-checked", "true");
  await expect(todos.nth(1).locator(":scope > [data-jul-editor-content]")).toHaveText("new task");
});
