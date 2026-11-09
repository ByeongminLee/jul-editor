import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
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
