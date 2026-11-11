import { expect, test, type Locator, type Page } from "@playwright/test";

// Edit controls show only while the block is selected, the same for the chart block and both
// code workspace views. Selection is cleared when focus leaves the editor.

interface Case {
  name: string;
  open: (page: Page) => Promise<{ block: Locator; select: () => Promise<void>; controls: Locator; interact: () => Promise<void> }>;
}

const cases: Case[] = [
  {
    name: "chart block",
    open: async (page) => {
      await page.goto("/playground");
      const block = page.locator("[data-id=demo-chart]");
      return {
        block,
        select: async () => { await block.click(); },
        controls: page.getByTestId("jul-editor-chart-format-json"),
        interact: async () => { await page.getByTestId("jul-editor-chart-source").selectOption("inline"); await page.getByTestId("jul-editor-chart-color-1").fill("#112233"); await page.getByTestId("jul-editor-chart-palette-ocean").click(); },
      };
    },
  },
  {
    name: "basic code workspace",
    open: async (page) => {
      await page.goto("/docs/plugins/code-workspace");
      const demo = page.getByTestId("docs-code-workspace");
      const block = demo.locator('[data-id="workspace-demo"]');
      return {
        block,
        select: async () => { await block.click(); },
        controls: demo.getByLabel("File tree"),
        interact: async () => { await demo.getByLabel("Line numbers").uncheck(); await demo.getByLabel("Line numbers").check(); },
      };
    },
  },
  {
    name: "IDE code workspace",
    open: async (page) => {
      await page.goto("/docs/plugins/code-workspace");
      const ide = page.getByTestId("docs-code-workspace-ide");
      return {
        block: ide,
        select: async () => { await ide.locator("[data-jul-editor-code-preview]").click(); },
        controls: ide.getByRole("button", { name: "New file", exact: true }),
        interact: async () => {
          await ide.getByRole("button", { name: "New file", exact: true }).click();
          await ide.getByRole("textbox", { name: "New file name" }).fill("scratch.ts");
          await ide.getByRole("textbox", { name: "New file name" }).press("Enter");
          await ide.getByRole("textbox", { name: "Code" }).fill("const x = 1;");
          await ide.getByRole("textbox", { name: "Added line ranges" }).fill("1");
        },
      };
    },
  },
];

for (const c of cases) {
  test.describe(c.name, () => {
    test("controls hide when the user clicks outside the editor", async ({ page }) => {
      const view = await c.open(page);
      await expect(view.controls).toHaveCount(0);
      await view.select();
      await expect(view.controls.first()).toBeVisible();
      await page.getByRole("heading", { level: 1 }).first().click();
      await expect(view.controls).toHaveCount(0);
    });

    test("controls stay while interacting with them", async ({ page }) => {
      const view = await c.open(page);
      await view.select();
      await expect(view.controls.first()).toBeVisible();
      await view.interact();
      await expect(view.controls.first()).toBeVisible();
    });

    test("controls hide when the keyboard moves the selection off the block", async ({ page }) => {
      const view = await c.open(page);
      await view.select();
      await expect(view.controls.first()).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await expect(view.controls).toHaveCount(0);
    });
  });
}

test("focusing the move handle keeps the selected chart, and the keyboard move relocates that chart", async ({ page }) => {
  await page.goto("/playground");
  await page.evaluate(() => document.fonts.ready); // late font swaps shift the layout and keep hover's stability check retrying under load
  const order = () => page.locator(".editor-content > [data-jul-editor-block]").evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  const chart = page.locator("[data-id=demo-chart]");
  const controls = page.getByTestId("jul-editor-chart-format-json");
  const handle = page.getByRole("button", { name: "Move block" });
  await chart.click();
  await expect(controls.first()).toBeVisible();
  await chart.evaluate((el) => { el.scrollIntoView({ block: "start", behavior: "instant" }); window.scrollBy({ top: -120, behavior: "instant" }); }); // instant: the site sets scroll-behavior: smooth, and a smooth scrollBy cancels the smooth scrollIntoView mid-way, leaving the block off screen. Playwright's own scroll parks the top edge under the sticky site header, which then intercepts the hover; keep the block top (the hover point) clear of it
  // the handle shows once the pointer has been over the block; re-issue the hover (leaving the block first so a real mousemove fires) if a re-render swallowed the first one
  await expect(async () => { await chart.hover({ position: { x: 12, y: 12 } }); await expect(handle).toBeVisible({ timeout: 1500 }); }).toPass();
  const before = await order();
  const index = before.indexOf("demo-chart");
  expect(index).toBeGreaterThanOrEqual(0);
  expect(index).toBeLessThan(before.length - 1);

  // Tab is handled inside the editor, so focus the handle directly (the same focus move Tab from the page makes), then drive it by keyboard.
  await handle.focus();
  await expect(handle).toBeFocused();
  await page.waitForTimeout(50); // let core's deferred focus-leave check run
  await expect(controls.first()).toBeVisible(); // the block selection survived the handle taking focus

  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect.poll(order).toEqual(before.map((id, i) => (i === index ? before[index + 1]! : i === index + 1 ? "demo-chart" : id)));
  await expect(controls.first()).toBeVisible(); // still selected after the move
});

for (const target of ["page h1", "header link"] as const) {
  test(`chart edit controls hide after the move handle is used and focus leaves to the ${target}`, async ({ page }) => {
    await page.goto("/playground");
    const chart = page.locator("[data-id=demo-chart]");
    const controls = page.getByTestId("jul-editor-chart-format-json");
    const handle = page.getByRole("button", { name: "Move block" });
    await chart.click();
    await expect(controls.first()).toBeVisible();
    await chart.evaluate((el) => { el.scrollIntoView({ block: "start", behavior: "instant" }); window.scrollBy({ top: -120, behavior: "instant" }); }); // instant: the site sets scroll-behavior: smooth, and a smooth scrollBy cancels the smooth scrollIntoView mid-way, leaving the block off screen. Playwright's own scroll parks the top edge under the sticky site header, which then intercepts the hover; keep the block top (the hover point) clear of it
    // The handle appears on a pointer move over the block; re-issue the hover (leaving the block first so a real mousemove fires) if a re-render swallowed the first one.
    await expect(async () => { await chart.hover({ position: { x: 12, y: 12 } }); await expect(handle).toBeVisible({ timeout: 1500 }); }).toPass();
    await handle.focus();
    await expect(handle).toBeFocused();
    await page.waitForTimeout(50);
    await expect(controls.first()).toBeVisible();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(controls.first()).toBeVisible();
    if (target === "page h1") await page.locator("h1").first().click();
    else await page.locator(".site-header a").first().focus();
    await expect(controls).toHaveCount(0);
  });
}

test('Escape from chart controls returns focus to editor', async ({ page }) => {
  await page.goto('/playground');
  await page.locator('[data-id=demo-chart]').click();
  const control = page.getByTestId('jul-editor-chart-csv');
  await control.focus();
  await control.press('Escape');
  await expect(page.locator('.playground-workspace [data-jul-editor-root]')).toBeFocused();
  await expect(control).toHaveCount(0);
});

test('Escape from diagram controls returns focus to editor', async ({ page }) => {
  await page.goto('/docs/plugins/diagram');
  const demo = page.locator('.docs-plugin-demo');
  const diagram = demo.locator('[data-jul-editor-plugin=diagram]');
  await expect(diagram.getByTestId('jul-editor-diagram-preview')).toBeVisible();
  await diagram.click();
  const source = demo.getByTestId('jul-editor-diagram-code');
  await expect(source).toBeVisible();
  await source.focus();
  await source.press('Escape');
  await expect(demo.locator('[data-jul-editor-root]')).toBeFocused();
  await expect(source).toHaveCount(0);
});
