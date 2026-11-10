// Regressions from the editor audit (round 1, batch 6): slash/mention/tag menus on the playground.
// Slash-inserted blocks without a text slot were block-selected (the next key deleted them) and left
// the empty '/' line above them; the menus covered the caret near the viewport bottom, did not
// follow scroll or close on blur, did not scroll the active item into view, could open twice
// ('/@'), and plugin items stayed English under the Korean locale.
import { expect, test, type Page } from "@playwright/test";

const slashMenu = (page: Page) => page.getByRole("listbox", { name: /Block commands|블록 명령/ });

async function clickLastEmptyParagraph(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const content = page.locator("[data-jul-editor-block][data-type=paragraph] >> nth=-1 >> [data-jul-editor-content]");
  await content.scrollIntoViewIfNeeded();
  const box = (await content.boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  return box;
}

const topTypes = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".editor-content > [data-jul-editor-block]")].map((el) => `${el.getAttribute("data-type")}:${(el.querySelector(":scope > [data-jul-editor-content]")?.textContent ?? "").slice(0, 12)}`));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("slash-inserting a chart replaces the empty line and the caret lands below it", async ({ page }) => {
  await page.goto("/playground");
  await clickLastEmptyParagraph(page);
  const before = await topTypes(page);
  await page.keyboard.type("/chart");
  await expect(slashMenu(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(slashMenu(page)).toBeHidden();
  await page.keyboard.type("Next line");
  const after = await topTypes(page);
  // [.., paragraph('/')] became [.., chart, paragraph('Next line')]: one block more, no empty line left above.
  expect(after.length).toBe(before.length + 1);
  expect(after.at(-2)).toMatch(/^chart:/);
  expect(after.at(-1)).toBe("paragraph:Next line");
  expect(after.at(-3)).toBe(before.at(-2));
});

test("the slash menu flips above the caret near the viewport bottom", async ({ page }) => {
  await page.goto("/playground");
  const line = await clickLastEmptyParagraph(page);
  // Shrink the viewport so the empty line sits 40px above its bottom edge.
  await page.setViewportSize({ width: 1280, height: Math.round(line.y + line.height + 40) });
  const box = (await page.locator("[data-jul-editor-block][data-type=paragraph] >> nth=-1 >> [data-jul-editor-content]").boundingBox())!;
  await page.keyboard.type("/");
  await expect(slashMenu(page)).toBeVisible();
  await expect(slashMenu(page).locator("[role=option]").first()).toBeVisible();
  const menu = (await slashMenu(page).boundingBox())!;
  expect(menu.y + menu.height).toBeLessThanOrEqual(box.y + 1);
});

test("arrow keys keep the active slash item scrolled into view", async ({ page }) => {
  await page.goto("/playground");
  await clickLastEmptyParagraph(page);
  await page.keyboard.type("/");
  await expect(slashMenu(page)).toBeVisible();
  for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowDown");
  const active = slashMenu(page).locator("[aria-selected=true]");
  await expect(active).toBeVisible();
  const menu = (await slashMenu(page).boundingBox())!;
  const item = (await active.boundingBox())!;
  expect(item.y).toBeGreaterThanOrEqual(menu.y - 1);
  expect(item.y + item.height).toBeLessThanOrEqual(menu.y + menu.height + 1);
});

test("'/@' opens only the slash menu, and a click outside the editor closes it", async ({ page }) => {
  await page.goto("/playground");
  await clickLastEmptyParagraph(page);
  await page.keyboard.type("/@");
  await expect(slashMenu(page)).toBeVisible();
  await expect(page.locator(".slash-menu")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await page.getByRole("tab", { name: /Markdown/ }).first().click();
  await expect(page.locator(".slash-menu")).toHaveCount(0);
});

test("Korean locale localizes plugin slash items too", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("jul-editor-locale", "ko"); } catch { /* ignore */ } });
  await page.goto("/playground");
  await clickLastEmptyParagraph(page);
  await page.keyboard.type("/");
  await expect(slashMenu(page).locator("[role=option]").first()).toBeVisible();
  const titles = await slashMenu(page).locator("[role=option]").allInnerTexts();
  const text = titles.join("|");
  for (const title of ["차트", "다이어그램", "데이터 표", "코드 워크스페이스"]) expect(text).toContain(title);
  for (const english of ["Chart", "Diagram", "Data table", "Code Workspace"]) expect(text).not.toContain(english);
});

test("slash no-results exposes combobox and live status", async ({ page }) => {
  await page.goto("/playground");
  const line = page.locator('[data-id="demo-end"] [data-jul-editor-content]');
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/no-matching-block-999");
  const editor = page.locator("[data-jul-editor-root]");
  await expect(editor).toHaveAttribute("role", "combobox");
  const list = page.getByRole("listbox", { name: "Block commands" });
  await expect(list).toBeAttached();
  await expect(page.getByRole("status").filter({ hasText: "No matching blocks" })).toHaveText("No matching blocks");
  await expect(list.getByRole("status")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveAttribute("role", "textbox");
});

test("an empty tag or mention search is announced from a status region outside the listbox", async ({ page }) => {
  await page.goto("/playground");
  const line = page.locator(".playground-workspace [data-type=paragraph] [data-jul-editor-content]").first();
  for (const [trigger, message] of [["#", "No matching tags"], ["@", "No matching mentions"]] as const) {
    await line.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${trigger}zzzz`);
    const status = page.locator(".slash-menu:visible [role=status]");
    await expect(status).toHaveText(message);
    await expect(status.locator("xpath=ancestor::*[@role='listbox']")).toHaveCount(0);
    await expect(status.locator("xpath=ancestor::*[@data-jul-editor-keep-selection]")).toHaveCount(1);
    await page.keyboard.press("Escape");
  }
});
