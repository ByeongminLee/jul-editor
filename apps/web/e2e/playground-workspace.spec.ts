import { expect, test, type Page } from "@playwright/test";

const editorRoot = (page: Page) => page.locator(".playground-workspace [data-jul-editor-root]");
const source = (page: Page) => page.locator("#playground-source");

async function typeAtEnd(page: Page, id: string, text: string) {
  const content = page.locator(`[data-id=${id}] [data-jul-editor-content]`);
  await content.scrollIntoViewIfNeeded();
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

async function applySourceAtTop(page: Page, tab: "Markdown" | "HTML", text: string) {
  await page.getByRole("tab", { name: tab }).click();
  await source(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(page.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
}

test("applying edited Markdown or HTML changes only the edited blocks in Diff", async ({ page }) => {
  await page.goto("/playground");
  const stats = page.locator(".playground-diff-stats");
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(stats).toContainText("+1 inserted");
  await expect(stats).toContainText("−0 deleted");
  await expect(stats).toContainText("~1 modified");

  await page.getByRole("tab", { name: "Markdown" }).click();
  await source(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nADDED");
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(editorRoot(page)).toContainText("ADDED");
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(stats).toContainText("+2 inserted");
  await expect(stats).toContainText("−0 deleted");
  await expect(stats).toContainText("~1 modified");

  await page.getByRole("tab", { name: "HTML" }).click();
  await source(page).fill((await source(page).inputValue()).replace("Review the changes", "Review every change"));
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(editorRoot(page)).toContainText("Review every change");
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(stats).toContainText("+2 inserted");
  await expect(stats).toContainText("−0 deleted");
  await expect(stats).toContainText("~2 modified");
  // A prop Markdown and HTML cannot express survives the round trip on an untouched block.
  await page.getByRole("tab", { name: "JSON" }).click();
  expect(JSON.parse(await source(page).inputValue()).blocks.find((block: { id: string }) => block.id === "demo-image").props.width).toBe(420);
});

test("Undo reverts an applied source and a restored sample", async ({ page }) => {
  await page.goto("/playground");
  const undo = page.locator(".playground-workspace .editor-toolbar").getByRole("button", { name: "Undo" });
  await typeAtEnd(page, "demo-p1", " TYPED1");
  await applySourceAtTop(page, "Markdown", "# APPLIED\n\n");
  await expect(editorRoot(page)).toContainText("APPLIED");
  await undo.click();
  await expect(editorRoot(page)).not.toContainText("APPLIED");
  await expect(editorRoot(page)).toContainText("TYPED1");
  await undo.click();
  await expect(editorRoot(page)).not.toContainText("TYPED1");

  await typeAtEnd(page, "demo-p1", " KEEPME");
  await page.getByRole("button", { name: "Restore sample" }).click();
  await expect(editorRoot(page)).not.toContainText("KEEPME");
  await expect(page.locator(".unified-feedback")).toContainText("Sample restored");
  await undo.click();
  await expect(editorRoot(page)).toContainText("KEEPME");
});

test("a source draft that the editor has moved past is flagged before it is applied", async ({ page }) => {
  await page.goto("/playground");
  await page.getByRole("tab", { name: "Markdown" }).click();
  await source(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("# DRAFTHEAD\n\n");
  await expect(page.locator(".source-stale")).toHaveCount(0);

  await page.getByRole("tab", { name: "Editor" }).click();
  await expect(page.locator(".window-live")).toHaveText(/UNAPPLIED SOURCE/);
  await expect(page.getByRole("tab", { name: "Markdown" })).toHaveAttribute("data-unapplied", "");
  await typeAtEnd(page, "demo-p1", " EDITORCHANGE");

  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(page.locator(".source-stale")).toContainText("The document changed in the editor");
  await expect(page.locator(".source-live")).toHaveText(/Out of date/);
  await page.getByRole("button", { name: "Reload from document" }).click();
  await expect(source(page)).toHaveValue(/EDITORCHANGE/);
  await expect(source(page)).not.toHaveValue(/DRAFTHEAD/);
  await expect(page.locator(".source-stale")).toHaveCount(0);
  await page.getByRole("tab", { name: "Editor" }).click();
  await expect(page.locator(".window-live")).toHaveText(/READY TO EDIT/);
});

test("feedback clears on the next tab change or edit, and every tab controls a real panel", async ({ page }) => {
  await page.goto("/playground");
  for (const tab of await page.getByRole("tab").all()) {
    const controls = await tab.getAttribute("aria-controls");
    await expect(page.locator(`[id="${controls}"]`)).toHaveCount(1);
  }

  await applySourceAtTop(page, "Markdown", "# APPLIED\n\n");
  const feedback = page.locator(".unified-feedback");
  await expect(feedback).toContainText("Source applied to the document.");
  await typeAtEnd(page, "demo-p1", "x");
  await expect(feedback).toHaveCount(0);

  await page.getByRole("button", { name: "Restore sample" }).click();
  await expect(feedback).toContainText("Sample restored");
  await page.getByRole("tab", { name: "Diff" }).click();
  await page.getByRole("tab", { name: "Editor" }).click();
  await expect(feedback).toHaveCount(0);
});
