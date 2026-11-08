import { expect, test } from "@playwright/test";

test("custom chart controls change the rendered type and palette", async ({ page }) => {
  await page.goto("/docs/plugins/chart-customization");
  const demo = page.locator(".docs-chart-customization");
  const chart = demo.locator("[data-jul-editor-plugin=chart]");

  await expect(chart.locator(".recharts-line-curve")).toBeVisible();
  await chart.click();
  await demo.getByRole("combobox", { name: "Chart type" }).selectOption("pie");
  await expect(chart).toHaveAttribute("data-jul-editor-chart-kind", "pie");
  const firstSlice = chart.locator(".recharts-pie-sector path").first();
  await expect(firstSlice).toBeVisible();

  await demo.getByRole("button", { name: "Ocean palette" }).click();
  await expect(firstSlice).toHaveCSS("fill", "rgb(60, 148, 183)");
  await expect.poll(() => chart.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--chart-1"))).toBe("#3c94b7");
});
