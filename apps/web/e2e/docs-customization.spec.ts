import { expect, test } from "@playwright/test";

test("docs customization guides expose working typography, toolbar and custom blocks", async ({ page }) => {
  await page.goto("/docs/core/toolbar-typography");
  const typography = page.getByTestId("docs-typography");
  await expect(typography.locator("[data-jul-editor-root]")).toBeVisible();
  await typography.getByLabel("Font family").selectOption("serif");
  await expect(typography.locator("[data-jul-editor-root]")).toHaveCSS("font-family", "serif");
  const toolbar = page.getByTestId("docs-toolbar");
  await expect(toolbar.getByRole("button", { name: "Underline", exact: true })).toHaveCount(1);
  await toolbar.getByRole("checkbox").uncheck();
  await expect(toolbar.getByRole("button", { name: "Underline", exact: true })).toHaveCount(0);
  await page.goto("/docs/core/custom-blocks");
  const custom = page.getByTestId("docs-custom-blocks");
  await expect(custom.getByTestId("docs-metric")).toHaveCount(1);
  await custom.getByRole("button", { name: "+1", exact: true }).click();
  await expect(custom.getByTestId("docs-metric").locator("strong")).toHaveText("121");
  await custom.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(custom.getByTestId("docs-metric").locator("strong")).toHaveText("120");
  await custom.getByRole("button", { name: "Insert metric block" }).click();
  await expect(custom.getByTestId("docs-metric")).toHaveCount(2);
  await custom.getByText("View saved JSON").click();
  await expect(custom.getByTestId("docs-custom-json")).toContainText('"type": "metric"');
  await expect(page.locator(".mdx-doc-content .docs-code pre").first()).toBeVisible();
});

test("tag suggestions insert a structured tag and update serialized output", async ({ page }) => {
  await page.goto("/docs/core/tags-mentions");
  const section = page.locator(".docs-live-tags");
  const content = section.locator('[data-id="docs-tags-line"] [data-jul-editor-content]');
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" #res");
  await page.getByRole("option", { name: "#research" }).click();
  await expect(section.getByTestId("docs-live-output")).toContainText("#research");
  await expect(section.locator('[data-type="paragraph"]')).toContainText("#research");
});

test("optional plugin examples render on their pages and docs stay readable in Korean", async ({ page }) => {
  await page.goto("/docs/plugins/data-table");
  await expect(page.locator('.docs-plugin-demo [data-jul-editor-plugin="dataTable"]')).toBeVisible();
  await page.goto("/docs/plugins/diagram");
  await expect(page.locator('.docs-plugin-demo [data-testid="jul-editor-diagram-preview"]')).toBeVisible({ timeout: 20000 });
  await page.goto("/docs/plugins/code-highlighting");
  await expect(page.locator('.docs-plugin-demo [data-jul-editor-code-chrome]')).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await page.goto("/docs/core/custom-blocks");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByTestId("docs-custom-blocks")).toBeVisible();
});


test("docs copy controls copy the current page and report clipboard failures", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/core/composition");
  await expect(page.locator(".mdx-doc-content .docs-code").first()).toBeVisible();
  await page.getByRole("button", { name: "Copy page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Editor.Content");
  expect(copied).not.toContain("function MetricView");
  expect(copied).not.toContain("Copy code");
  const source = page.locator(".mdx-doc-content .docs-code").first();
  const snippet = await source.locator("pre code").textContent() ?? "";
  expect(snippet.trim().length).toBeGreaterThan(0);
  await expect(source.locator("summary, details")).toHaveCount(0);
  await expect(source.locator(".docs-code-head")).toContainText("Copy code");
  await source.getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(snippet);
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(source.getByRole("button", { name: "코드 복사" })).toBeVisible();
  await page.locator(".docs-copy-page").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe(copied);
  await page.goto("/docs/core/custom-blocks");
  await expect(page.locator(".mdx-doc-content .docs-code:visible").first()).toBeVisible();
  await page.locator(".docs-copy-page").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("function MetricView");
  await page.getByRole("button", { name: "English" }).click();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("denied"); } }); });
  await page.locator(".docs-copy-page").click();
  await expect(page.locator(".docs-copy-page")).toHaveText("Copy failed. Try again");
});

test("the copied custom block recipe round trips through Markdown and HTML", async ({ page }) => {
  const { resolve } = await import("node:path");
  const ts = await import("typescript");
  await page.goto("/docs/core/custom-blocks");
  const recipe = await page.locator(".mdx-doc-content .docs-code").filter({ hasText: "const portableMetric" }).locator("pre code").textContent() ?? "";
  expect(recipe).toContain("const portableMetric");
  const coreUrl = new URL("/@fs/" + resolve("packages/core/src/index.ts"), page.url()).href;
  const serdeUrl = new URL("/@fs/" + resolve("packages/core/src/serde/index.ts"), page.url()).href;
  const check = `
const edgeDoc = { version: 1, blocks: [{ id: "custom", type: "metric", props: { label: '<Docs & "exports">', value: 321 } }] };
const edgeMd = fromMarkdown(toMarkdown(edgeDoc, { registry }).markdown, { registry }).doc;
const edgeHtml = fromHTML(toHTML(edgeDoc, { registry }), { registry }).doc;
export const result = { restoredMd, restoredHtml, edgeMd, edgeHtml };`;
  const javascript = ts.transpileModule(recipe + check, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll('"@jul-editor/core"', JSON.stringify(coreUrl))
    .replaceAll('"@jul-editor/core/serde"', JSON.stringify(serdeUrl));
  const result = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try { return (await import(/* @vite-ignore */ url)).result; }
    finally { URL.revokeObjectURL(url); }
  }, javascript);
  for (const restored of [result.restoredMd, result.restoredHtml]) {
    expect(restored.blocks[0].type).toBe("metric");
    expect(restored.blocks[0].props).toEqual({});
  }
  for (const restored of [result.edgeMd, result.edgeHtml]) {
    expect(restored.blocks[0]).toMatchObject({ type: "metric", props: { label: '<Docs & "exports">', value: 321 } });
  }
});
