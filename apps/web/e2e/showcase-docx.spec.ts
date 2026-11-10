import { expect, test } from "@playwright/test";
import { Document, ImageRun, Packer, Paragraph } from "docx";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const SHOTS = join(tmpdir(), "jul-editor-shots");
mkdirSync(SHOTS, { recursive: true });
const DOCX_CARD = 1;

async function openDocx(page: Page) {
  await page.goto("/showcase");
  await page.locator(".showcase-picker-card").nth(DOCX_CARD).click();
  const root = page.locator(".showcase-active .showcase-docx");
  await expect(root.locator(".editor-content")).toBeVisible();
  return root;
}

const sheetWidth = (page: Page) => page.locator(".showcase-docx .jul-paged__sheet").first().evaluate((el) => el.getBoundingClientRect().width / (el.closest(".jul-paged__stage") ? Number(new DOMMatrix(getComputedStyle(el.closest(".jul-paged__stage")!).transform).a) : 1));

test("docx editor: pages, zoom, font size, settings, export and re-import", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const root = await openDocx(page);

  // The NDA sample is long enough for several sheets, and the header/footer tokens resolve.
  await expect.poll(() => root.locator(".jul-paged__sheet").count()).toBeGreaterThanOrEqual(2);
  await expect(root.locator("[data-jul-paged-header]").first()).toContainText("Non-disclosure agreement");
  await expect(root.locator("[data-jul-paged-footer]").first()).toHaveText(/^1 \/ \d+$/);
  await expect(root.locator(".editor-content [data-jul-page-break]")).toHaveCount(1);
  await expect(root.locator(".editor-content")).toContainText("[Effective Date]");
  await root.scrollIntoViewIfNeeded();
  await root.screenshot({ path: `${SHOTS}/docx-desktop.png` });

  // Zoom: the stage scale follows the control.
  const stage = root.locator(".jul-paged__stage");
  const scale = async () => (await stage.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a));
  const before = await scale();
  await root.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(scale).toBeCloseTo(before + 0.1, 2);
  await root.getByRole("button", { name: "Zoom out" }).click();
  await root.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(scale).toBeCloseTo(before - 0.1, 2);
  await root.getByRole("button", { name: "Zoom in" }).click();

  // Font size on a selection: wraps exactly the selected text in a fontSize run.
  const lead = root.locator(".editor-content [data-type=paragraph]").first();
  await lead.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => String(getSelection()).length)).toBeGreaterThan(100);
  await page.waitForTimeout(150); // let the editor's selectionchange handler sync the store
  await root.getByLabel("Font size").selectOption("18pt");
  await expect(root.locator(".editor-content span[style*='font-size: 18pt']").first()).toBeVisible();
  await root.getByLabel("Font family").selectOption("Georgia");
  await expect(root.locator(".editor-content span[style*='Georgia']").first()).toBeVisible();
  await root.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(root.locator(".editor-content [data-type=paragraph]").first().locator("strong, b")).not.toHaveCount(0);

  // Block style + alignment on the title.
  const title = root.locator(".editor-content [data-type=heading]").first();
  await title.click();
  await root.getByLabel("Block style").selectOption("h3");
  await expect(root.locator(".editor-content [data-type=heading]").first()).toHaveAttribute("data-jul-editor-level", "3");
  await root.getByRole("button", { name: "Alignment" }).click();
  await page.getByRole("menuitemradio", { name: "Align right" }).click();
  await expect(root.locator(".editor-content [data-type=heading]").first()).toHaveAttribute("data-jul-editor-text-align", "right");

  // Page settings: size and orientation change the sheet geometry, header text is editable.
  await root.getByRole("button", { name: "Page settings" }).click();
  const panel = root.getByRole("complementary", { name: "Page settings" });
  await expect(panel).toBeVisible();
  const a4 = await sheetWidth(page);
  expect(Math.round(a4)).toBe(794);
  await panel.getByLabel("Page size").selectOption("Letter");
  await expect.poll(() => sheetWidth(page).then(Math.round)).toBe(816);
  await panel.getByLabel("Orientation").selectOption("landscape");
  await expect.poll(() => sheetWidth(page).then(Math.round)).toBe(1056);
  await panel.getByLabel("Orientation").selectOption("portrait");
  await panel.getByLabel("Page size").selectOption("A4");
  await panel.getByLabel("Header text").fill("Confidential NDA");
  await expect(root.locator("[data-jul-paged-header]").first()).toContainText("Confidential NDA");
  await root.screenshot({ path: `${SHOTS}/docx-settings.png` });

  // Export: a real .docx download (zip with word/document.xml).
  const [download] = await Promise.all([page.waitForEvent("download"), root.getByRole("button", { name: "Export", exact: false }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.toString("latin1")).toContain("word/document.xml");
  expect(bytes.toString("latin1")).toContain("word/header1.xml");
  await expect(root.locator(".docx-status")).toContainText("valid .docx zip");

  // Round trip: import the exported file back through mammoth.
  await root.getByTestId("docx-import-input").setInputFiles(path!);
  await expect(root.locator(".docx-status")).toContainText("Imported");
  await expect(root.locator(".editor-content")).toContainText("Non-Disclosure Agreement");
  await expect(root.locator(".editor-content")).toContainText("[Disclosing Party Name]");
});

test("docx editor: manual page break, color, link and image", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const root = await openDocx(page);
  const count = () => root.locator(".jul-paged__sheet").count();
  await expect.poll(count).toBeGreaterThanOrEqual(2);
  const before = await count();
  const last = root.locator(".editor-content [data-type=paragraph]").last();
  await last.click();
  await root.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Insert page break" }).click();
  await expect(root.locator(".editor-content [data-jul-page-break]")).toHaveCount(2);
  await expect.poll(count).toBeGreaterThan(before);

  await root.getByTestId("docx-image-input").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAT0lEQVR4nO3PQQ0AIBDAsFPHF/8C8IEIHg3JkgnoZq/zdcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY8dgHBoNCmXb2NNwAAAABJRU5ErkJggg==", "base64") });
  await expect(root.locator(".editor-content img")).toHaveCount(1);

  // Text color and link on a selected paragraph.
  const para = root.locator(".editor-content [data-type=paragraph]").first();
  await para.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => String(getSelection()).length)).toBeGreaterThan(100);
  await page.waitForTimeout(150);
  await root.getByRole("button", { name: "Text color" }).click();
  await page.getByRole("menuitem", { name: "blue" }).click();
  await expect(root.locator(".editor-content [data-jul-editor-color=blue]").first()).toBeVisible();
  await root.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByLabel("Link URL").fill("https://example.com/nda");
  await page.getByLabel("Link URL").press("Enter");
  await expect(root.locator('.editor-content a[href="https://example.com/nda"]').first()).toBeVisible();

  // Several sheets at once for the screenshot (40%).
  for (let i = 0; i < 6; i++) await root.getByRole("button", { name: "Zoom out" }).click();
  await expect(root.getByRole("status").first()).toHaveText("40%");
  await root.locator(".jul-paged").evaluate((el) => (el.scrollTop = 0));
  await root.screenshot({ path: `${SHOTS}/docx-pages.png` });
});

test("docx editor on a phone: toolbar scrolls, sheet scales to fit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await openDocx(page);
  await expect.poll(() => root.locator(".jul-paged__sheet").count()).toBeGreaterThanOrEqual(2);
  const wrap = await root.locator(".jul-paged").boundingBox();
  const sheet = await root.locator(".jul-paged__sheet").first().boundingBox();
  expect(sheet!.width).toBeLessThanOrEqual(wrap!.width);
  // No horizontal page scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // The toolbar is a single scrollable row, so everything stays reachable.
  expect(await root.locator(".docx-toolbar").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await root.locator(".docx-toolbar").evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await root.getByRole("button", { name: "Page settings" }).click();
  await expect(root.getByRole("complementary", { name: "Page settings" })).toBeVisible();
  await root.screenshot({ path: `${SHOTS}/docx-mobile.png` });
  await page.screenshot({ path: `${SHOTS}/docx-mobile-page.png` });
});

const DOT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAT0lEQVR4nO3PQQ0AIBDAsFPHF/8C8IEIHg3JkgnoZq/zdcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY8dgHBoNCmXb2NNwAAAABJRU5ErkJggg==", "base64");
const loadedImages = (root: ReturnType<Page["locator"]>) => root.locator(".editor-content img").evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).length);

test("docx editor: an inserted image shows, and image + page break survive export and re-import", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const root = await openDocx(page);
  await expect(root.locator(".editor-content [data-jul-page-break]")).toHaveCount(1);
  await root.locator(".editor-content [data-type=paragraph]").first().click();
  await root.getByTestId("docx-image-input").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: DOT_PNG });
  await expect(root.locator(".editor-content img")).toHaveCount(1);
  // the picture actually renders (not a broken <img> whose src was stripped)
  await expect.poll(() => loadedImages(root)).toBe(1);

  const download = page.waitForEvent("download");
  await root.getByRole("button", { name: "Export" }).click();
  const path = await (await download).path();
  await expect(root.locator(".docx-status")).toContainText("valid .docx zip");
  await expect(root.locator(".docx-status")).not.toContainText("simplified");
  expect(readFileSync(path!).toString("latin1")).toMatch(/word\/media\/[^"]+\.png/);

  await root.getByTestId("docx-import-input").setInputFiles(path!);
  await expect(root.locator(".docx-status")).toContainText("with 1 image");
  await expect(root.locator(".editor-content [data-jul-page-break]")).toHaveCount(1);
  await expect.poll(() => loadedImages(root)).toBe(1);
  await root.screenshot({ path: `${SHOTS}/docx-image-roundtrip.png` });
});

test("docx editor: opening one toolbar menu closes the other", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const root = await openDocx(page);
  await root.locator(".editor-content [data-jul-editor-block]").first().click();
  const color = root.getByRole("button", { name: "Text color" });
  const align = root.getByRole("button", { name: "Alignment" });
  await color.click();
  await expect(color).toHaveAttribute("aria-expanded", "true");
  await align.click();
  await expect(align).toHaveAttribute("aria-expanded", "true");
  await expect(color).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-docx-menu-panel]")).toHaveCount(1);
});

test('docx menu supports keyboard navigation and restores focus on Escape', async ({ page }) => {
  const root = await openDocx(page);
  const button = root.getByRole('button', { name: 'Alignment' });
  await button.focus();
  await button.press('Enter');
  const items = page.getByRole('menuitemradio');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('docx local image survives switching showcase previews', async ({ page }) => {
  const root = await openDocx(page);
  await root.locator('.editor-content [data-type=paragraph]').first().click();
  await root.getByTestId('docx-image-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: DOT_PNG });
  await expect.poll(() => loadedImages(root)).toBe(1);
  await page.getByRole('group', { name: 'DOCX editor view' }).getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(() => loadedImages(root)).toBe(1);
  const download = page.waitForEvent('download');
  await root.getByRole('button', { name: 'Export' }).click();
  const path = await (await download).path();
  expect(readFileSync(path!).toString('latin1')).toMatch(/word\/media\/[^"]+\.png/);
});

test('docx local images survive a locale roundtrip', async ({ page }) => {
  const root = await openDocx(page);
  await root.locator('.editor-content [data-type=paragraph]').first().click();
  await root.getByTestId('docx-image-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: DOT_PNG });
  await expect.poll(() => loadedImages(root)).toBe(1);
  await page.getByRole('button', { name: '한국어' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect.poll(() => loadedImages(root)).toBe(1);
});


test('docx pending image survives a preview remount', async ({ page }) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    let reads = 0;
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob instanceof File && blob.name === 'pending.png' && ++reads === 1) return;
      read.call(this, blob);
    };
  });
  const root = await openDocx(page);
  await root.locator('.editor-content [data-type=paragraph]').first().click();
  await root.getByTestId('docx-image-input').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: DOT_PNG });
  await expect(root.locator('.editor-content [data-type=image] img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('group', { name: 'DOCX editor view' }).getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(root.locator('.editor-content [data-type=image] img')).toHaveAttribute('src', /^data:image\/png/);
});

test('docx export preserves dimensions of a local image URL', async ({ page }) => {
  await page.goto('/showcase');
  const base64 = await page.evaluate(async (settingsUrl) => {
    const io = await import('/src/pages/showcase/docx-editor-io.ts');
    const pages = await import(/* @vite-ignore */ settingsUrl);
    const doc = { version: 1, blocks: [{ id: 'image', type: 'image', props: { src: '/editor-canvas.svg' } }] };
    const result = await io.buildDocx(doc, pages.normalizeSettings());
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  }, `/@fs${process.cwd()}/packages/plugins/src/pages/settings.ts`);
  const file = join(tmpdir(), 'jul-editor-local-image.docx');
  writeFileSync(file, Buffer.from(base64, 'base64'));
  const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' });
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
  expect(extent).not.toBeNull();
  expect(Number(extent![1]) / Number(extent![2])).toBeCloseTo(840 / 460, 1);
});


test('docx export reports an unavailable image instead of failing the document', async ({ page }) => {
  await page.goto('/showcase');
  const result = await page.evaluate(async (settingsUrl) => {
    const io = await import('/src/pages/showcase/docx-editor-io.ts');
    const pages = await import(/* @vite-ignore */ settingsUrl);
    return io.buildDocx({ version: 1, blocks: [{ id: 'image', type: 'image', props: { src: '/missing-image.png' } }] }, pages.normalizeSettings()).then(({ validZip, lossy }) => ({ validZip, lossy }));
  }, `/@fs${process.cwd()}/packages/plugins/src/pages/settings.ts`);
  expect(result).toEqual({ validZip: true, lossy: 1 });
});

test('docx block style reflects a level-one heading after selecting it', async ({ page }) => {
  const root = await openDocx(page);
  const paragraph = root.locator('.editor-content [data-type=paragraph]').first();
  const id = await paragraph.getAttribute('data-id');
  await paragraph.click();
  await root.getByLabel('Block style').selectOption('h1');
  await root.locator('.editor-content [data-type=paragraph]').first().click();
  await root.locator(`[data-id="${id}"]`).click();
  await expect(root.getByLabel('Block style')).toHaveValue('h1');
});

test('docx menu opens with ArrowDown and Tab exits', async ({ page }) => {
  const root = await openDocx(page);
  const button = root.getByRole('button', { name: 'Alignment' });
  await button.focus();
  await button.press('ArrowDown');
  await expect(page.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('WebP image survives DOCX export and import with its proportions', async ({ page }) => {
  const root = await openDocx(page);
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 32;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 32);
    return canvas.toDataURL('image/webp').split(',')[1]!;
  });
  await root.locator('.editor-content [data-type=paragraph]').first().click();
  await root.getByTestId('docx-image-input').setInputFiles({ name: 'landscape.webp', mimeType: 'image/webp', buffer: Buffer.from(bytes, 'base64') });
  await expect(root.locator('[data-jul-editor-image]')).toHaveAttribute('data-state', 'ready');
  const download = page.waitForEvent('download');
  await root.getByRole('button', { name: 'Export' }).click();
  const path = await (await download).path();
  await expect(root.locator('.docx-status')).not.toContainText('simplified');
  await root.getByTestId('docx-import-input').setInputFiles(path!);
  await expect(root.locator('.docx-status')).toContainText('with 1 image');
  const image = root.locator('.editor-content [data-jul-editor-image] img');
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight)).toBe(2);
});


test('imported DOCX remains after switching preview', async ({ page }) => {
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('IMPORTED DOCX DRAFT ONLY')] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await expect(root.locator('.editor-content')).toContainText('IMPORTED DOCX DRAFT ONLY');
  await page.getByRole('group', { name: 'DOCX editor view' }).getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(root.locator('.editor-content')).toContainText('IMPORTED DOCX DRAFT ONLY');
});

test('an imported DOCX stays with the locale that started the import', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => setTimeout(() => read.call(this).then(resolve, reject), 600)); };
  });
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('ORIGIN LOCALE ONLY')] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await page.getByRole('button', { name: '한국어' }).click();
  await page.waitForTimeout(1200);
  await expect(root.locator('.editor-content')).not.toContainText('ORIGIN LOCALE ONLY');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(root.locator('.editor-content')).toContainText('ORIGIN LOCALE ONLY');
});


test('a DOCX image remains with its originating locale during import', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => setTimeout(() => read.call(this).then(resolve, reject), 600)); };
  });
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new ImageRun({ data: DOT_PNG, type: 'png', transformation: { width: 64, height: 32 } })] })] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'picture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await page.getByRole('button', { name: '한국어' }).click();
  await page.waitForTimeout(1400);
  await expect(root.locator('.editor-content [data-jul-editor-image]')).toHaveCount(0);
  await page.getByRole('button', { name: 'English' }).click();
  await expect.poll(() => loadedImages(root)).toBe(1);
});

test('a DOCX import persists if preview closes while reading', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => setTimeout(() => read.call(this).then(resolve, reject), 600)); };
  });
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('ASYNC IMPORT DRAFT')] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await page.getByRole('group', { name: 'DOCX editor view' }).getByRole('button', { name: 'Code', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(root.locator('.editor-content')).toContainText('ASYNC IMPORT DRAFT');
});

test('a DOCX import appears if preview reopens before reading finishes', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => setTimeout(() => read.call(this).then(resolve, reject), 1000)); };
  });
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('DELAYED REOPEN IMPORT')] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await page.getByRole('group', { name: 'DOCX editor view' }).getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(root.locator('.editor-content')).toContainText('DELAYED REOPEN IMPORT');
});

test('a delayed DOCX import does not overwrite newer edits', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => setTimeout(() => read.call(this).then(resolve, reject), 1000)); };
  });
  const root = await openDocx(page);
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('STALE IMPORT')] }] }));
  await root.getByTestId('docx-import-input').setInputFiles({ name: 'import.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  const paragraph = root.locator('.editor-content [data-type=paragraph]').first();
  await paragraph.click();
  await page.keyboard.type('NEWER EDIT');
  await expect(root.locator('.docx-status')).toContainText('document changed while importing');
  await expect(root.locator('.editor-content')).toContainText('NEWER EDIT');
  await expect(root.locator('.editor-content')).not.toContainText('STALE IMPORT');
});

test("docx formatting menus fit above a low selection and restore keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  const root = await openDocx(page);
  const more = root.getByRole("button", { name: "More" });
  await more.scrollIntoViewIfNeeded();
  await more.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 390));
  await more.focus();
  await more.press("ArrowDown");
  const menu = page.locator('[data-docx-menu-panel]');
  await expect(menu.getByRole("menuitem", { name: "Underline" })).toBeFocused();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(500);
  await menu.press("End");
  await expect(menu.getByRole("menuitem", { name: "Redo" })).toBeFocused();
  await menu.press("Escape");
  await expect(more).toBeFocused();

  const paragraph = root.locator(".editor-content [data-type=paragraph]").first();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 460));
  await paragraph.click({ position: { x: 10, y: 8 } });
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByLabel("Link URL");
  await expect(input).toBeFocused();
  const linkBox = (await input.locator("..").boundingBox())!;
  expect(linkBox.y).toBeGreaterThanOrEqual(0);
  expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(500);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await page.keyboard.type("typed after closing");
  await expect(paragraph).toContainText("typed after closing");
});

test("docx menu tracks its trigger while the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  const root = await openDocx(page);
  const trigger = root.getByRole("button", { name: "More" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 390));
  await trigger.click();
  const menu = page.locator("[data-docx-menu-panel]");
  const before = (await menu.boundingBox())!;
  await page.evaluate(() => window.scrollBy(0, 100));
  await expect.poll(async () => (await menu.boundingBox())?.y).not.toBe(before.y);
  await expect(menu.getByRole("menuitem", { name: "Underline" })).toBeFocused();
});
