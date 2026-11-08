import { expect, test } from "@playwright/test";

test("chart tooltips show category and labeled values in the editor theme", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const chart = page.locator(".docs-live-charts [data-jul-editor-plugin=chart]");
  const firstBar = chart.locator(".recharts-bar-rectangle").first();
  await expect(firstBar).toBeVisible();
  await firstBar.hover();

  const tooltip = chart.locator("[data-chart-tooltip]");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Jan");
  await expect(tooltip).toContainText("Visitors");
  await expect(tooltip).toContainText("120");
  expect(await tooltip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");
});

test("all six chart families render in the live documentation example", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const chart = page.locator(".docs-live-charts [data-jul-editor-plugin=chart]");
  const shape = [
    ".recharts-bar-rectangle", ".recharts-line-curve", ".recharts-area-area",
    ".recharts-pie-sector", ".recharts-radar-polygon", ".recharts-radial-bar-sector",
  ];
  for (const [index, family] of ["bar", "line", "area", "pie", "radar", "radial"].entries()) {
    await page.locator(".docs-chart-grid button").nth(index).click();
    await expect(chart).toHaveAttribute("data-jul-editor-chart-kind", family);
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
    await expect(chart.locator(shape[index]!).first()).toBeVisible();
    await expect(chart.locator("[data-chart-legend]")).toBeVisible();
  }
});

test("chart controls follow the site language switch", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  const chart = page.locator(".docs-live-charts [data-jul-editor-plugin=chart]");
  await chart.click();
  await expect(chart.getByLabel("차트 종류")).toBeVisible();
  await expect(chart.getByLabel("범주 열")).toBeVisible();
  await expect(chart.getByLabel("값 열")).toBeVisible();
  await expect(chart.locator("[data-chart-editor-title]")).toContainText("차트 설정");
});

test("chart editor groups settings, maps axes per type, and supports multiple series", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const chart = page.locator(".docs-live-charts [data-jul-editor-plugin=chart]");
  await chart.click();
  const editor = chart.locator("[data-jul-editor-plugin=chart-editor]");
  for (const name of ["type", "data", "axes", "colors"]) await expect(editor.locator(`[data-chart-editor-section=${name}]`)).toBeVisible();

  await page.getByTestId("jul-editor-chart-sample").click();
  await expect(page.getByTestId("jul-editor-chart-preview")).toContainText("Visitors");
  await expect(page.getByTestId("jul-editor-chart-preview")).toContainText("5 rows");
  await page.getByTestId("jul-editor-chart-y-Signups").check();
  await expect(chart.locator(".recharts-bar")).toHaveCount(2);

  await page.getByTestId("jul-editor-chart-kind-pie").click();
  await expect(chart).toHaveAttribute("data-jul-editor-chart-kind", "pie");
  await expect(page.getByTestId("jul-editor-chart-y-Signups")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Value column" })).toBeVisible();
});

test("chart editor reports invalid JSON inline and recolors from a preset palette", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const chart = page.locator(".docs-live-charts [data-jul-editor-plugin=chart]");
  await chart.click();
  await page.getByTestId("jul-editor-chart-format-json").click();
  await page.getByTestId("jul-editor-chart-json").fill("{oops");
  await expect(page.getByTestId("jul-editor-chart-error")).toBeVisible();
  await page.getByTestId("jul-editor-chart-sample").click();
  await expect(page.getByTestId("jul-editor-chart-error")).toHaveCount(0);

  await page.getByTestId("jul-editor-chart-palette-ocean").click();
  await expect(chart.locator(".recharts-bar-rectangle path").first()).toHaveAttribute("fill", "#3c94b7");
  await expect(chart.locator(".recharts-bar-rectangle path").nth(1)).not.toHaveAttribute("fill", "#3c94b7");
  await page.getByTestId("jul-editor-chart-palette-reset").click();
  await expect(chart.locator(".recharts-bar-rectangle path").first()).not.toHaveAttribute("fill", "#3c94b7");
});
