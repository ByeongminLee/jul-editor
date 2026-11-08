import { expect, test } from "@playwright/test";

test("loads the demo page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("page-demo")).toBeVisible();
});

test("loads the demo page @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("page-demo")).toBeVisible();
});
