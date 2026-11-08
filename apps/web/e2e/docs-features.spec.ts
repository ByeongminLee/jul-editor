import { expect, test } from "@playwright/test";

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
