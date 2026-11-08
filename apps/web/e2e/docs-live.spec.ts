import { expect, test } from "@playwright/test";

test("docs show working conversion and use the header language control", async ({ page }) => {
  await page.goto("/docs/core/formats");
  const section = page.locator(".docs-live-formats");
  await expect(section.locator("[data-jul-editor-root]")).toBeVisible();
  await section.locator("[data-jul-editor-content]").first().click();
  await page.keyboard.type("Live ");
  await expect(section.getByTestId("docs-live-output")).toContainText("Live");
  await section.getByRole("button", { name: "HTML" }).click();
  await expect(section.getByTestId("docs-live-output")).toContainText(/<h2\b/);
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(section.getByTestId("docs-live-output")).toContainText("Live");
  await expect(page.locator(".docs-language")).toHaveCount(0);
});

test("chart and diff guides render their live examples on separate pages", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const section = page.locator(".docs-live-charts");
  await expect(section.locator('[data-jul-editor-chart-kind="bar"]')).toBeVisible();
  await page.locator(".docs-chart-grid button").filter({ hasText: "area" }).click();
  await expect(section.locator('[data-jul-editor-chart-kind="area"]')).toBeVisible();
  await page.locator(".docs-chart-grid button").filter({ hasText: "pie" }).click();
  await expect(section.locator('[data-jul-editor-chart-kind="pie"]')).toBeVisible();
  await page.goto("/docs/plugins/diff");
  await expect(page.locator('.docs-live-diff [data-diff="modify"]')).toHaveCount(1);
  await expect(page.locator('.docs-live-diff [data-diff="insert"]')).toHaveCount(1);
});
