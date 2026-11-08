import { expect, test } from "@playwright/test";

test("styling guide maps class slots to a working toolbar and slash menu", async ({ page }) => {
  await page.goto("/docs/core/styling-i18n-performance");
  const demo = page.getByTestId("docs-style-slots");
  await expect(demo.getByRole("toolbar")).toHaveClass(/slot-demo-toolbar/);
  await expect(demo.getByRole("button", { name: "Bold" })).toHaveClass(/slot-demo-button/);
  await expect(demo.locator(".slot-demo-label")).toHaveCount(3);
  await demo.locator("[data-id=style-empty] [data-jul-editor-content]").click();
  await page.keyboard.type("/");
  await expect(demo.locator(".slot-demo-menu")).toBeVisible();
  await expect(demo.locator(".slot-demo-item").first()).toBeVisible();
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  await expect(page.getByRole("img", { name: "Chart class slots diagram" })).toBeVisible();
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await expect(page.getByRole("img", { name: "Diagram class slots diagram" })).toBeVisible();
  await page.getByRole("button", { name: "Data table", exact: true }).click();
  await expect(page.getByRole("img", { name: "Data table class slots diagram" })).toBeVisible();
});
