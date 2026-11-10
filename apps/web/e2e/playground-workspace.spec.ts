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

test('HTML source retains embedded image bytes when applied', async ({ page }) => {
  await page.goto('/playground');
  await page.getByRole('tab', { name: 'HTML' }).click();
  const image = '<img alt="local picture" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" />';
  await source(page).fill(`${await source(page).inputValue()}\n${image}`);
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  const img = page.getByRole('img', { name: 'local picture' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

test('HTML source exports and reapplies a picked local image', async ({ page }) => {
  await page.goto('/playground');
  await page.locator('.unified-workspace input[type="file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('[data-jul-editor-image][data-state="ready"]:has(img[alt="pixel.png"])')).toHaveCount(1);
  await page.getByRole('tab', { name: 'HTML' }).click();
  await expect(source(page)).toHaveValue(/data:image\/png;base64/);
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  const image = page.locator('[data-jul-editor-image][data-state="ready"]:has(img[alt="pixel.png"]) img');
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

for (const format of ['Markdown', 'JSON'] as const) {
  test(`${format} source exports and reapplies a picked local image`, async ({ page }) => {
    await page.goto('/playground');
    await page.locator('.unified-workspace input[type="file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await expect(page.locator('[data-jul-editor-image][data-state="ready"]:has(img[alt="pixel.png"])')).toHaveCount(1);
    await page.getByRole('tab', { name: format }).click();
    await expect(source(page)).toHaveValue(/data:image\/png;base64/);
    await page.getByRole('button', { name: 'Apply source to document' }).click();
    const image = page.locator('[data-jul-editor-image][data-state="ready"]:has(img[alt="pixel.png"]) img');
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  });
}

test('a ready local image survives undo and redo', async ({ page }) => {
  await page.goto('/playground');
  await page.locator('.unified-workspace input[type="file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  const image = page.locator('[data-jul-editor-image]:has(img[alt="pixel.png"])');
  await expect(image).toHaveAttribute('data-state', 'ready');
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Undo' }).click();
  await expect(image).toHaveCount(0);
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Redo' }).click();
  await expect(image).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => image.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

test('empty table cells have no editor prompt and wide tables fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/playground');
  await page.getByRole('tab', { name: 'HTML' }).click();
  await source(page).fill('<table><tr><td></td><td>LongUnbreakableTableValueLongUnbreakable</td><td>LongUnbreakableTableValueLongUnbreakable</td><td>LongUnbreakableTableValueLongUnbreakable</td></tr></table>');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  const cell = page.locator('.playground-workspace [data-type=tableCell]').first();
  await cell.click();
  const prompt = await cell.locator('[data-jul-editor-content]').evaluate(el => getComputedStyle(el, '::before').content);
  const overflow = await cell.evaluate(el => { const table = el.closest('[data-type=table]')!; const root = el.closest('[data-jul-editor-root]')!; return table.getBoundingClientRect().right - root.getBoundingClientRect().right; });
  expect(overflow).toBeLessThanOrEqual(1);
  const cellOverflow = await page.locator('.playground-workspace [data-type=tableCell] [data-jul-editor-content]').evaluateAll(els => Math.max(...els.map(el => el.scrollWidth - el.clientWidth)));
  expect(cellOverflow).toBeLessThanOrEqual(1);
  expect(await cell.evaluate(el => { const table = el.closest<HTMLElement>('[data-type=table]')!; return table.scrollWidth - table.clientWidth; })).toBeLessThanOrEqual(1);
  expect(await cell.evaluate(el => el.closest('[data-jul-editor-root]')!.getBoundingClientRect().right - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(['none', 'normal', '""']).toContain(prompt);
});

test('playground editor has a localized accessible name', async ({ page }) => {
  await page.goto('/playground');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await page.getByRole('button', { name: '한국어' }).click();
  await expect(page.getByRole('textbox', { name: '문서 편집기' })).toBeVisible();
});

test('redo restores an image when its local upload completed after undo', async ({ page }) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => read.call(this, file), 500); };
  });
  await page.goto('/playground');
  await page.locator('.unified-workspace input[type="file"]').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  const image = page.locator('[data-jul-editor-image]:has(img[alt="slow.png"])');
  await expect(image).toHaveAttribute('data-state', 'uploading');
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Undo' }).click();
  await expect(image).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Redo' }).click();
  await expect(image).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => image.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});

test('undo restores an image after applying replacement HTML', async ({ page }) => {
  await page.goto('/playground');
  const original = page.locator('[data-id=demo-image] img');
  await expect(original).toHaveAttribute('src', '/editor-canvas.svg');
  await page.getByRole('tab', { name: 'HTML' }).click();
  await source(page).fill((await source(page).inputValue()).replace(/<figure data-jul-editor-type="image"[^]*?<\/figure>/, '<img alt="replacement" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">'));
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await expect(original).toHaveAttribute('src', /^data:image\/png/);
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Undo' }).click();
  await expect(original).toHaveAttribute('src', '/editor-canvas.svg');
});

test('undo restores an image after applying an SVG data image', async ({ page }) => {
  await page.goto('/playground');
  const original = page.locator('[data-id=demo-image] img');
  await page.getByRole('tab', { name: 'HTML' }).click();
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2"/></svg>');
  await source(page).fill((await source(page).inputValue()).replace(/<figure data-jul-editor-type="image"[^]*?<\/figure>/, `<img alt="replacement" src="${svg}">`));
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await expect(original).toHaveAttribute('src', /^data:image\/png/);
  await page.locator('.playground-workspace .editor-toolbar').getByRole('button', { name: 'Undo' }).click();
  await expect(original).toHaveAttribute('src', '/editor-canvas.svg');
});

test('an asynchronous source apply cannot overwrite the document after changing locale', async ({ page }) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => read.call(this, file), 600); };
  });
  await page.goto('/playground');
  await page.getByRole('tab', { name: 'HTML' }).click();
  await source(page).fill('<p>EN ONLY RACE</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await page.getByRole('button', { name: '한국어' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('tab', { name: '에디터' }).click();
  await expect(editorRoot(page)).not.toContainText('EN ONLY RACE');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('tab', { name: 'HTML' }).click();
  await expect(source(page)).toHaveValue(/EN ONLY RACE/);
});

test('an older image conversion cannot apply over a newer source draft', async ({ page }) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => read.call(this, file), 600); };
  });
  await page.goto('/playground');
  await page.getByRole('tab', { name: 'HTML' }).click();
  await source(page).fill('<p>OLD APPLY</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await source(page).fill('<p>NEW DRAFT</p>');
  await page.waitForTimeout(900);
  await expect(source(page)).toHaveValue('<p>NEW DRAFT</p>');
  await expect(page.locator('.conversion-message')).toContainText('nothing was applied');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await expect(editorRoot(page)).toContainText('NEW DRAFT');
  await expect(editorRoot(page)).not.toContainText('OLD APPLY');
});

test('a newer source apply wins over an older image conversion', async ({ page }) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => read.call(this, file), 600); };
  });
  await page.goto('/playground');
  await page.getByRole('tab', { name: 'HTML' }).click();
  await source(page).fill('<p>OLD APPLY</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await source(page).fill('<p>NEW APPLY</p>');
  await page.getByRole('button', { name: 'Apply source to document' }).click();
  await page.waitForTimeout(900);
  await expect(editorRoot(page)).toContainText('NEW APPLY');
  await expect(editorRoot(page)).not.toContainText('OLD APPLY');
});
