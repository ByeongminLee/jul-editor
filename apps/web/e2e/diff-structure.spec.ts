import { expect, test, type Page } from "@playwright/test";

async function importDocument(page: Page, doc: object) {
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.locator("#playground-source").fill(JSON.stringify(doc));
  await page.getByRole("button", { name: "Apply source to document" }).click();
}

async function captureThenImport(page: Page, before: object, after: object) {
  await page.goto("/playground");
  await importDocument(page, before);
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("button", { name: "Save current as baseline" }).click();
  await importDocument(page, after);
  await page.getByRole("tab", { name: "Diff" }).click();
}

test("split diff preserves each version's block order and real line numbers", async ({ page }) => {
  const first = { id: "alpha", type: "paragraph", props: {}, content: [{ type: "text", text: "Alpha" }] };
  const second = { id: "beta", type: "paragraph", props: {}, content: [{ type: "text", text: "Beta" }] };
  await captureThenImport(page, { version: 1, blocks: [first, second] }, { version: 1, blocks: [second, first] });
  const before = (await page.locator('.playground-diff-line[data-diff-side="before"] code').allTextContents()).join("\n");
  const after = (await page.locator('.playground-diff-line[data-diff-side="after"] code').allTextContents()).join("\n");
  expect(before.indexOf("Alpha")).toBeLessThan(before.indexOf("Beta"));
  expect(after.indexOf("Beta")).toBeLessThan(after.indexOf("Alpha"));
  await expect(page.locator('.playground-diff-line[data-diff-side="before"] code').filter({ hasText: "Alpha" }).locator("..")).toHaveAttribute("data-diff-line-number", "1");
});

test("split diff renders changed table cells from the full Markdown subtree", async ({ page }) => {
  const table = {
    id: "table", type: "table", props: { headerRow: true }, children: [
      { id: "header", type: "tableRow", props: {}, children: [
        { id: "h1", type: "tableCell", props: {}, content: [{ type: "text", text: "Name" }] },
        { id: "h2", type: "tableCell", props: {}, content: [{ type: "text", text: "Value" }] },
      ] },
      { id: "row", type: "tableRow", props: {}, children: [
        { id: "c1", type: "tableCell", props: {}, content: [{ type: "text", text: "Score" }] },
        { id: "c2", type: "tableCell", props: {}, content: [{ type: "text", text: "Before cell" }] },
      ] },
    ],
  };
  const updated = structuredClone(table);
  updated.children[1]!.children[1]!.content[0]!.text = "After cell";
  await captureThenImport(page, { version: 1, blocks: [table] }, { version: 1, blocks: [updated] });
  const before = (await page.locator('.playground-diff-line[data-diff-side="before"] code').allTextContents()).join("\n");
  const after = (await page.locator('.playground-diff-line[data-diff-side="after"] code').allTextContents()).join("\n");
  expect(before).toContain("Before cell");
  expect(after).toContain("After cell");
});
