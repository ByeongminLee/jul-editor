// Regressions from the editor audit (round 1, batch 7): the playground's Mod+K link popover sat in the
// toolbar, so opening it (autoFocus) jumped the page up to the toolbar and applying scrolled to the top;
// Escape did not close it, there was no way to remove a link, and "example.com" was stored as a
// relative URL.
import { expect, test, type Page } from "@playwright/test";

const END = "[data-jul-editor-block][data-id=demo-end] [data-jul-editor-content]";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/playground");
  await expect(page.locator(END)).toBeVisible();
});

async function selectStartOfLastParagraph(page: Page): Promise<void> {
  const para = page.locator(END);
  await para.scrollIntoViewIfNeeded();
  const box = (await para.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(3);
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("Mod+K opens the link popover next to the selection without moving the page, and applying keeps the scroll", async ({ page }) => {
  await selectStartOfLastParagraph(page);
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(300);
  // read before Mod+K: once the URL input has focus the DOM selection lives there
  const sel = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });

  await page.keyboard.press("ControlOrMeta+k");
  const popover = page.locator(".link-popover");
  await expect(popover).toBeVisible();
  await expect(page.locator("#jul-editor-link-url")).toBeFocused();
  expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(2);

  // placed next to the selection, inside the viewport
  const box = (await popover.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  expect(Math.min(Math.abs(box.y - sel.bottom), Math.abs(box.y + box.height - sel.top))).toBeLessThan(40);

  await page.keyboard.type("https://a.dev");
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(page.locator(`${END} a[href="https://a.dev"]`)).toHaveCount(1);
  expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(2);
  // focus is back in the editor, so typing continues there
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-jul-editor-root]"))).toBe(true);
});

test("a bare domain is saved with https://", async ({ page }) => {
  await selectStartOfLastParagraph(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("example.com");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${END} a`).first()).toHaveAttribute("href", "https://example.com");
});

test("Escape closes the link popover and returns focus to the editor; Remove unlinks", async ({ page }) => {
  await selectStartOfLastParagraph(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("https://a.dev");
  await page.keyboard.press("Enter");
  const link = page.locator(`${END} a[href="https://a.dev"]`);
  await expect(link).toHaveCount(1);

  const before = await scrollY(page);
  const box = (await link.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("ControlOrMeta+k");
  const popover = page.locator(".link-popover");
  await expect(popover).toBeVisible();
  await expect(page.locator("#jul-editor-link-url")).toHaveValue("https://a.dev");

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-jul-editor-root]"))).toBe(true);
  expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(2);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Remove link" }).click();
  await expect(popover).toHaveCount(0);
  await expect(link).toHaveCount(0);
  expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(2);
});

// Round 2: the site router caught every same-origin link click, so clicking an internal link inside the
// editor left the playground and dropped unsaved edits instead of placing the caret.
test("clicking an internal link inside the editor places the caret and stays on the page", async ({ page }) => {
  await selectStartOfLastParagraph(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("/docs");
  await page.keyboard.press("Enter");
  const link = page.locator(`${END} a`).first();
  await expect(link).toHaveCount(1);
  const box = (await link.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/playground$/);
  await expect(page.locator(END)).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.getSelection()?.anchorNode?.parentElement?.closest("[data-jul-editor-root]"))).toBe(true);
});

test("link URL input retains normal navigation keys", async ({ page }) => {
  await selectStartOfLastParagraph(page);
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator("#jul-editor-link-url");
  await input.fill("https://example.com/foo");
  await input.press("Home");
  await expect(input).toBeFocused();
  await input.press("ArrowLeft");
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(22);
  await input.press("End");
  await expect(input).toBeFocused();
  await input.press("ArrowRight");
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(23);
});
