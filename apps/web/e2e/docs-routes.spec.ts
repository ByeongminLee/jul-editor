import { expect, test } from "@playwright/test";

test("documentation links keep the app mounted and browser history works", async ({ page }) => {
  await page.goto("/docs/getting-started");
  await page.evaluate(() => { (window as Window & { __navigationSentinel?: string }).__navigationSentinel = "kept"; });
  await page.locator('.mdx-doc-sidebar a[href="/docs/installation"]').click();
  await expect(page).toHaveURL(/\/docs\/installation$/);
  await expect(page.locator(".mdx-doc-header h1")).toHaveText("Installation");
  expect(await page.evaluate(() => (window as Window & { __navigationSentinel?: string }).__navigationSentinel)).toBe("kept");
  await page.goBack();
  await expect(page.locator(".mdx-doc-header h1")).toHaveText("Getting started");
  expect(await page.evaluate(() => (window as Window & { __navigationSentinel?: string }).__navigationSentinel)).toBe("kept");
});

test("documentation code examples use syntax colors", async ({ page }) => {
  await page.goto("/docs/plugins/charts");
  const code = page.locator(".mdx-doc-content .docs-code pre code").first();
  await expect(code).toBeVisible();
  await expect.poll(() => code.locator('[data-jul-editor-token="keyword"]').count()).toBeGreaterThan(0);
  const colors = await code.evaluate((element) => {
    const keyword = element.querySelector('[data-jul-editor-token="keyword"]');
    return { base: getComputedStyle(element).color, keyword: keyword ? getComputedStyle(keyword).color : "" };
  });
  expect(colors.keyword).not.toBe(colors.base);
});

test("read-only view reuses the saved document and custom renderers without editing UI", async ({ page }) => {
  await page.goto("/docs/core/read-only-view");
  const demo = page.getByTestId("docs-read-only-view");
  await expect(demo).toBeVisible();
  await demo.getByRole("button", { name: "View", exact: true }).click();
  await expect(demo.locator("[data-jul-editor-view]")).toBeVisible();
  await expect(demo.locator("[data-type=customCard]")).toContainText("Design review");
  await expect(demo.locator("[data-jul-editor-plugin=chart]")).toBeVisible();
  await expect(demo.locator("[contenteditable]")).toHaveCount(0);
  await expect(demo.locator("input, textarea")).toHaveCount(0);
});

test("custom slash menu filters commands, previews a choice and inserts its block", async ({ page }) => {
  await page.goto("/docs/core/customize-controls");
  const demo = page.getByTestId("docs-menu-customization");
  const content = demo.locator('[data-id="custom-menu-intro"] [data-jul-editor-content]');
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type("/");
  const menu = demo.locator(".docs-curated-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option")).toHaveCount(3);
  const notice = menu.getByRole("option", { name: "Notice card" });
  await notice.hover();
  await expect(menu.locator(".docs-curated-preview")).toContainText("A highlighted block for a key point");
  await notice.click();
  await expect(demo.locator('[data-type="notice"]')).toHaveCount(1);
});

test("documentation has separate grouped pages in both languages", async ({ page }) => {
  await page.goto("/docs");
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  const nav = page.getByRole("navigation", { name: "Documentation" });
  await expect(nav.getByText("Core", { exact: true })).toBeVisible();
  await expect(nav.getByText("Plugins", { exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Document model" }).click();
  await expect(page).toHaveURL(/\/docs\/core\/document-model$/);
  await expect(page.getByRole("heading", { level: 1, name: "Document model and state" })).toBeVisible();
  await expect(page).toHaveTitle("Document model and state | JulEditor");
  await expect(nav.getByRole("link", { name: "Document model" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "문서 모델과 상태" })).toBeVisible();
  await expect(page).toHaveTitle("문서 모델과 상태 | JulEditor");
  await expect(page.getByRole("navigation", { name: "개발 문서" }).getByRole("link", { name: "문서 모델" })).toHaveAttribute("aria-current", "page");
});

test("all documentation routes render their own MDX content", async ({ page }) => {
  for (const path of [
    "/docs/getting-started", "/docs/installation", "/docs/packages",
    "/docs/core/composition", "/docs/core/document-model", "/docs/core/formats",
    "/docs/core/toolbar-typography", "/docs/core/menus", "/docs/core/interactions",
    "/docs/core/tables-media", "/docs/core/custom-blocks", "/docs/core/styling-i18n-performance",
    "/docs/plugins/charts", "/docs/plugins/chart-customization", "/docs/plugins/diagram",
    "/docs/plugins/data-table", "/docs/plugins/code-highlighting", "/docs/core/tags-mentions",
    "/docs/plugins/diff",
  ]) {
    await page.goto(path);
    await expect(page.locator(".mdx-doc-content p").first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(path + "$"));
  }
});

test("mobile documentation keeps grouped navigation usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/docs/core/formats");
  await page.getByText("Browse documentation").click();
  const nav = page.getByRole("navigation", { name: "Mobile documentation" });
  await expect(nav.getByText("Core", { exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Packages" }).click();
  await expect(page).toHaveURL(/\/docs\/packages$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("changing documentation language keeps an edited preview's undo history", async ({ page }) => {
  await page.goto("/docs/core/toolbar-typography");
  const preview = page.getByTestId("docs-typography");
  const line = preview.locator("[data-id=custom-body] [data-jul-editor-content]");
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Undo survives.");
  await expect(line).toContainText("Undo survives.");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(line).toContainText("Undo survives.");
  await preview.getByRole("button", { name: "실행 취소" }).click();
  await expect(line).not.toContainText("Undo survives.");
});

test("changing documentation language keeps an edited plugin block", async ({ page }) => {
  await page.goto("/docs/plugins/code-highlighting");
  const code = page.locator("[data-id=docs-code-block] [data-jul-editor-content]");
  await code.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // saved");
  await expect(code).toContainText("// saved");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(code).toContainText("// saved");
  await code.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(code).not.toContainText("// saved");
});

test("chart customization keeps an edited chart through language changes", async ({ page }) => {
  await page.goto("/docs/plugins/chart-customization");
  const demo = page.locator(".docs-chart-customization");
  const chart = demo.locator("[data-jul-editor-plugin=chart]");
  await chart.click();
  await demo.getByRole("combobox", { name: "Chart type" }).selectOption("pie");
  await expect(chart).toHaveAttribute("data-jul-editor-chart-kind", "pie");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(chart).toHaveAttribute("data-jul-editor-chart-kind", "pie");
});

test("format and plugin pages keep live examples and copyable code", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/core/formats");
  const live = page.locator(".docs-live-formats");
  await live.locator("[data-jul-editor-content]").first().click();
  await page.keyboard.type("Live ");
  await expect(live.getByTestId("docs-live-output")).toContainText("Live");
  await page.getByRole("button", { name: "Copy page" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("fromMarkdown");
  await page.locator(".mdx-doc-content .docs-code").first().getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("fromMarkdown");
  await page.getByRole("link", { name: "Charts", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/plugins\/charts$/);
  await expect(page.locator('[data-jul-editor-chart-kind="bar"]')).toBeVisible();
  await page.getByRole("button", { name: /area/i }).click();
  await expect(page.locator('[data-jul-editor-chart-kind="area"]')).toBeVisible();
  await page.getByRole("link", { name: "Diff", exact: true }).click();
  await expect(page.locator('[data-diff="modify"]')).toHaveCount(1);
});

test("Copy page includes the current package table and no other guide", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/packages");
  await expect(page.locator(".mdx-doc-content table")).toBeVisible();
  await page.getByRole("button", { name: "Copy page" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("| @jul-editor/core | Document schema");
  expect(copied).toContain("| --- | --- |");
  expect(copied).not.toContain("## Your first document");
});

test("Copy page includes inline guide notes after MDX loads", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/getting-started");
  const copy = page.getByRole("button", { name: "Copy page" });
  await expect(copy).toBeEnabled();
  await copy.click();
  let copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Install with pnpm add @jul-editor/core @jul-editor/react to use these imports in your app.");
  expect(copied).toContain("Next, follow Installation");

  await page.goto("/docs/plugins/charts");
  await page.getByRole("button", { name: "Copy page" }).click();
  copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("For private database records, keep");
});
