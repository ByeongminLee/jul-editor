// Regressions from the editor audit (round 1, batch 3), reported as "drag selection / tooltip does not
// work" on the deployed playground: the bubble menu was placed once from a stale rect (it covered the
// selection after an upward drag and stayed put on scroll), sat under the sticky header with no flip,
// and a triple click selected into the next block, so Bold/typing spilled over into it.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/playground");
  await expect(page.locator("[data-id=demo-p1] [data-jul-editor-content]")).toBeVisible();
});

function charPoint(page: Page, blockId: string, offset: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ blockId, offset }) => {
      const content = document.querySelector(`[data-id="${blockId}"] [data-jul-editor-content]`)!;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      let rem = offset;
      while (node && rem >= node.data.length) {
        rem -= node.data.length;
        node = walker.nextNode() as Text | null;
      }
      const r = document.createRange();
      r.setStart(node!, rem);
      r.setEnd(node!, rem + 1);
      const b = r.getClientRects()[0]!;
      return { x: b.left + 1, y: b.top + b.height / 2 };
    },
    { blockId, offset },
  );
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

const selectionRect = (page: Page) =>
  page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left };
  });

function overlaps(a: { top: number; bottom: number }, b: { y: number; height: number }): boolean {
  return b.y < a.bottom && b.y + b.height > a.top;
}

test("the bubble menu never covers the selection after an upward drag, and follows it on scroll", async ({ page }) => {
  const bubble = page.locator(".bubble-tools");
  await drag(page, await charPoint(page, "demo-list-3", 20), await charPoint(page, "demo-p1", 10));
  await expect(bubble).toBeVisible();
  const sel = await selectionRect(page);
  expect(overlaps(sel, (await bubble.boundingBox())!)).toBe(false);

  const before = (await bubble.boundingBox())!.y;
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await bubble.boundingBox())?.y ?? before).toBeLessThan(before - 60);
  const after = await selectionRect(page);
  const box = (await bubble.boundingBox())!;
  expect(overlaps(after, box)).toBe(false);
});

test("near the sticky header the bubble flips below the selection", async ({ page }) => {
  const bubble = page.locator(".bubble-tools");
  // put demo-p1 right under the sticky header
  await page.evaluate(() => {
    const header = document.querySelector(".site-header")!.getBoundingClientRect().bottom;
    const p = document.querySelector("[data-id=demo-p1]")!.getBoundingClientRect().top;
    window.scrollBy({ top: p - header - 4, behavior: "instant" }); // the site scrolls smoothly by default
  });
  await page.waitForTimeout(100);
  await drag(page, await charPoint(page, "demo-p1", 2), await charPoint(page, "demo-p1", 20));
  await expect(bubble).toBeVisible();
  const header = await page.evaluate(() => document.querySelector(".site-header")!.getBoundingClientRect().bottom);
  const sel = await selectionRect(page);
  const box = (await bubble.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header);
  expect(box.y).toBeGreaterThanOrEqual(sel.bottom);
});

test("the bubble hides after a click outside the editor", async ({ page }) => {
  const bubble = page.locator(".bubble-tools");
  await drag(page, await charPoint(page, "demo-p1", 2), await charPoint(page, "demo-p1", 20));
  await expect(bubble).toBeVisible();
  await page.getByRole("heading", { name: "Playground", exact: true }).click();
  await expect(bubble).toBeHidden();
});

test("Bold on a triple-clicked paragraph stays inside it, and typing keeps the next bullet", async ({ page }) => {
  const p = await charPoint(page, "demo-p1", 14);
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  const bubble = page.locator(".bubble-tools");
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "Bold" }).click();
  await expect(page.locator("[data-id=demo-list-1] [data-jul-editor-content] strong")).toHaveCount(0);
  await expect(page.locator("[data-id=demo-p1] [data-jul-editor-content] strong").first()).toBeVisible();
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  await page.keyboard.type("N");
  await expect(page.locator("[data-id=demo-p1] [data-jul-editor-content]")).toHaveText("N");
  await expect(page.locator("[data-id=demo-list-1][data-type=bulletListItem]")).toContainText("Drag the handle");
});

// Round 2: mark buttons looked enabled inside a code block but did nothing, and Bold/Italic did nothing
// over a drag-selected rectangle of table cells.
test("inside a code block there is no bubble and the toolbar mark buttons are disabled", async ({ page }) => {
  const code = page.locator("[data-type=codeBlock] [data-jul-editor-content]").first();
  await code.scrollIntoViewIfNeeded();
  await expect(async () => {
    const [x1, y1, x2, y2] = await code.evaluate((el) => {
      const t = el.firstChild as Text;
      const i = t.data.indexOf("accent");
      const r = document.createRange();
      r.setStart(t, i); r.setEnd(t, i + 1);
      const s = r.getBoundingClientRect();
      r.setStart(t, i + 5); r.setEnd(t, i + 6);
      const e = r.getBoundingClientRect();
      return [s.left + 1, s.top + s.height / 2, e.right - 1, e.top + e.height / 2];
    });
    await page.mouse.move(x1!, y1!);
    await page.mouse.down();
    await page.mouse.move(x2!, y2!, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("accent");
  }).toPass({ timeout: 10_000 });
  await page.waitForTimeout(200);
  await expect(page.locator(".bubble-tools")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bold" }).first()).toBeDisabled();
});

test("Bold applies to every cell of a drag-selected rectangle", async ({ page }) => {
  const cell = (text: string) => page.locator("[data-type=tableCell]", { hasText: text }).first();
  await cell("Docs").scrollIntoViewIfNeeded();
  await expect(async () => {
    const a = (await cell("Docs").boundingBox())!;
    const z = (await cell("880").boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + 20, z.y + z.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("[data-jul-editor-cell-selected]")).toHaveCount(4, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(() => page.$$eval("[data-type=tableCell] strong", (els) => els.map((e) => e.textContent))).toEqual(["Docs", "1,240", "Showcase", "880"]);
});

test("clicking a disabled formatting button preserves editor focus", async ({ page }) => {
  await page.goto("/playground");
  const code = page.locator('[data-id="demo-code"] [data-jul-editor-content]');
  await code.click();
  const editor = page.locator("[data-jul-editor-root]");
  await expect(editor).toBeFocused();
  const bold = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" });
  await expect(bold).toBeDisabled();
  await bold.scrollIntoViewIfNeeded();
  const box = (await bold.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editor).toBeFocused();
});

test("a backward drag keeps its native anchor until release", async ({ page }) => {
  const from = await charPoint(page, "demo-list-3", 0);
  const to = await charPoint(page, "demo-list-2", 1);
  await page.mouse.move(from.x - 2, from.y);
  await page.mouse.down();
  expect(await page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(0);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const anchorBlock = () => page.evaluate(() => {
    const node = window.getSelection()?.anchorNode;
    return node?.parentElement?.closest("[data-id]")?.getAttribute("data-id");
  });
  await expect.poll(anchorBlock).toBe("demo-list-3");
  await page.mouse.up();
  await expect.poll(anchorBlock).toBe("demo-list-2");
});

test("a delayed site font does not disrupt an active drag", async ({ page }) => {
  const require = createRequire(realpathSync("apps/web/node_modules/mermaid/package.json"));
  const font = readFileSync(join(dirname(require.resolve("katex/package.json")), "dist/fonts/KaTeX_Main-Regular.woff2"));
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => { releaseFont = resolve; });
  let requestedFont!: () => void;
  const fontRequested = new Promise<void>((resolve) => { requestedFont = resolve; });
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    const display = new URL(route.request().url()).searchParams.get("display");
    await route.fulfill({ contentType: "text/css", body: `@font-face { font-family: 'DM Sans'; src: url(https://fonts.gstatic.com/test.woff2); font-display: ${display}; }` });
  });
  await page.route("https://fonts.gstatic.com/**", async (route) => {
    requestedFont();
    await fontGate;
    await route.fulfill({ contentType: "font/woff2", body: font });
  });
  await page.goto("/playground", { waitUntil: "domcontentloaded" });
  await fontRequested;
  const canvas = page.locator(".unified-workspace .unified-editor-view .editor-content");
  await expect(canvas).toHaveCSS("font-family", /DM Sans/);
  await expect(canvas.locator('[data-type="codeBlock"]').first()).toHaveCSS("font-family", /monospace/);
  // Let the optional font's block period expire before starting the drag.
  await page.waitForTimeout(500);
  const from = await charPoint(page, "demo-list-3", 20);
  const to = await charPoint(page, "demo-p1", 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  releaseFont();
  await page.evaluate(() => document.fonts.ready);
  expect(await charPoint(page, "demo-list-3", 20)).toEqual(from);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  await expect(page.locator(".bubble-tools")).toBeVisible();
});
