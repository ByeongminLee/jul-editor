import { expect, test, type Locator } from "@playwright/test";

test("custom menus insert a structured tag", async ({ page }) => {
  await page.goto("/docs/core/menus");
  const demo = page.getByTestId("docs-feature-menus");
  const line = demo.locator('[data-id="feature-menu-line"] [data-jul-editor-content]');
  await expect(line).toBeVisible();
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" #res");
  await demo.getByRole("option", { name: "#research" }).click();
  await expect(line).toContainText("#research");
});

test("table controls edit the document grid", async ({ page }) => {
  await page.goto("/docs/core/tables-media");
  const demo = page.getByTestId("docs-feature-tables");
  await expect(demo).toBeVisible();
  const cell = demo.locator('[data-type="tableCell"] [data-jul-editor-content]').first();
  await expect(cell).toBeVisible();
  await cell.click();
  await demo.getByRole("button", { name: "Add row below" }).click();
  await expect(demo.locator('[data-type="tableRow"]')).toHaveCount(3);
});

test("image controls and embed validation are live", async ({ page }) => {
  await page.goto("/docs/core/tables-media");
  const demo = page.getByTestId("docs-feature-media");
  await expect(demo.locator("[data-jul-editor-image] img")).toBeVisible();
  await expect.poll(() => demo.locator("[data-jul-editor-image] img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await demo.locator("[data-jul-editor-image] img").click();
  await demo.getByRole("textbox", { name: "Caption" }).fill("A saved caption");
  await expect(demo.getByRole("textbox", { name: "Caption" })).toHaveValue("A saved caption");
  const embed = demo.getByRole("textbox", { name: "Embed URL" });
  await embed.fill("not a URL");
  await embed.press("Enter");
  await expect(demo.getByRole("alert")).toBeVisible();
  await embed.fill("https://example.com/guide");
  await embed.press("Enter");
  await expect(demo.locator('[data-jul-editor-embed][data-state="ready"] a')).toHaveAttribute("href", "https://example.com/guide");
});

test("autosave restores an edited draft after reload", async ({ page }) => {
  await page.goto("/docs/core/document-model");
  const demo = page.getByTestId("docs-feature-state");
  await expect(demo).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("docs:feature-state"));
  const line = demo.locator('[data-id="feature-state-line"] [data-jul-editor-content]');
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" persisted");
  await expect(demo.getByTestId("docs-feature-save-status")).toContainText("Saved", { timeout: 5000 });
  await page.reload();
  await expect(page.getByTestId("docs-feature-state").locator('[data-id="feature-state-line"]')).toContainText("persisted");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByTestId("docs-feature-state").getByRole("button", { name: "강조" })).toBeVisible();
  await expect(page.getByTestId("docs-feature-state").locator('[data-id="feature-state-line"]')).toContainText("persisted");
});

test("extension commands duplicate a schema block and expose its JSON", async ({ page }) => {
  await page.goto("/docs/core/custom-blocks");
  const demo = page.getByTestId("docs-feature-extension-api");
  await expect(demo.getByTestId("docs-metric")).toHaveCount(1);
  await demo.getByRole("button", { name: "Duplicate block" }).click();
  await expect(demo.getByTestId("docs-metric")).toHaveCount(2);
  await demo.getByText("View document JSON").click();
  await expect(demo.getByTestId("docs-feature-json")).toContainText('"type": "metric"');
});

test("customization slash menu follows keyboard highlight", async ({ page }) => {
  await page.goto("/docs/core/toolbar-typography");
  const demo = page.getByTestId("docs-typography");
  const line = demo.locator('[data-id="custom-empty"] [data-jul-editor-content]');
  await line.click();
  await page.keyboard.type("/");
  const options = demo.getByRole("listbox").getByRole("option");
  await expect(options.first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("data-active", "true");
});

test("documentation demo edits survive a language roundtrip", async ({ page }) => {
  await page.goto("/docs/core/toolbar-typography");
  const line = page.getByTestId("docs-typography").locator('[data-id="custom-body"] [data-jul-editor-content]');
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" preserved edit");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByTestId("docs-typography").getByRole("combobox", { name: "글꼴" })).toBeVisible();
  await expect(page.getByTestId("docs-typography").locator('[data-id="custom-body"]')).toContainText("preserved edit");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByTestId("docs-typography").getByRole("combobox", { name: "Font family" })).toBeVisible();
  await expect(page.getByTestId("docs-typography").locator('[data-id="custom-body"]')).toContainText("preserved edit");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByTestId("docs-typography").getByRole("button", { name: "실행 취소" })).toBeVisible();
  await page.getByTestId("docs-typography").getByRole("button", { name: "실행 취소" }).click();
  await expect(page.getByTestId("docs-typography").locator('[data-id="custom-body"]')).not.toContainText("preserved edit");
  await page.goto("/docs/core/toolbar-typography");
  await expect(page.getByTestId("docs-typography").locator('[data-id="custom-body"]')).not.toContainText("preserved edit");
});

test("media example does not advertise an unavailable slash menu", async ({ page }) => {
  await page.goto("/docs/core/tables-media");
  const placeholder = page.getByTestId("docs-feature-media").locator('[data-id="feature-media-end"] [data-placeholder]');
  await expect(placeholder).not.toHaveAttribute("data-placeholder", /\//);
});

for (const [path, id] of [["/docs/core/menus", "feature-menu-empty"], ["/docs/core/toolbar-typography", "custom-empty"], ["/docs/core/custom-blocks", "custom-empty"]] as const) {
  test(`slash menu fits a short viewport on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 430 });
    await page.goto(path);
    const line = page.locator(`[data-id="${id}"] [data-jul-editor-content]`).first();
    await line.click();
    await line.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - 220, behavior: "instant" }));
    await page.keyboard.type("/");
    const menu = page.locator(".slash-menu:visible").first();
    await expect(menu.getByRole("option").first()).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(430);
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
    const active = menu.locator('[aria-selected="true"]');
    await expect(active).toBeInViewport();
  });
}

test("curated and showcase slash menus open above a caret near the bottom of the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const openLow = async (line: Locator, menu: Locator) => {
    await line.click();
    await line.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().bottom - (window.innerHeight - 60), behavior: "instant" }));
    await page.keyboard.type("/");
    await expect(menu.getByRole("option").first()).toBeVisible();
    await expect.poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual((await line.boundingBox())!.y);
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  };
  await page.goto("/docs/core/menus");
  await openLow(page.locator('[data-id="custom-menu-intro"] [data-jul-editor-content]').first(), page.locator(".docs-curated-menu"));
  await page.goto("/showcase");
  await page.locator(".jul-editor-theme [data-type=paragraph] [data-jul-editor-content]").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await openLow(page.locator(".jul-editor-theme [data-jul-editor-focused] [data-jul-editor-content]").first(), page.locator(".slash-menu:visible"));
});
