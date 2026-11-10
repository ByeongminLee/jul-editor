import { expect, test } from "@playwright/test";

test("the unified site connects overview, showcase, playground and docs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /An editor that fits your product/ })).toBeVisible();
  await expect(page.locator(".home-live [data-jul-editor-root]")).toBeVisible();

  await page.getByRole("link", { name: "Explore the showcase" }).click();
  await expect(page).toHaveURL(/\/showcase$/);
  await page.getByRole("link", { name: "Playground", exact: true }).first().click();
  await expect(page).toHaveURL(/\/playground$/);
  await expect(page.locator("[data-id=demo-chart] [data-jul-editor-plugin=chart]")).toBeVisible();
  await page.locator("[data-id=demo-blank] [data-jul-editor-content]").click();
  await page.keyboard.type("/");
  await expect(page.getByRole("option", { name: "Chart" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(page.getByLabel("Edit markdown source")).toBeVisible();
  await expect(page.locator("[data-jul-editor-root]")).toBeHidden();

  await page.getByRole("link", { name: "Docs", exact: true }).first().click();
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("home has the full editor toolbar and optional block commands", async ({ page }) => {
  await page.goto("/");
  const workspace = page.locator(".home-live");
  await expect(workspace.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await expect(workspace.getByTitle("Heading 1")).toBeVisible();
  await expect(workspace.getByTitle("Insert table")).toBeVisible();
  await workspace.locator("[data-id=intro-empty] [data-jul-editor-content]").click();
  await page.keyboard.type("/");
  await expect(page.getByRole("option", { name: "Chart" })).toBeVisible();
});

test("home keeps chart and diagram rendering code on demand", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/");
  await expect(page.locator(".home-live [data-jul-editor-root]")).toBeVisible();
  expect(requested.filter((url) => /recharts-chart|mermaid\.core/i.test(url))).toEqual([]);
  await page.locator("[data-id=intro-empty] [data-jul-editor-content]").click();
  await page.keyboard.type("/");
  await page.getByRole("option", { name: "Chart" }).click();
  await expect.poll(() => requested.some((url) => url.includes("recharts-chart"))).toBe(true);
});

test("home switches one document between editor, source formats, and diff", async ({ page }) => {
  await page.goto("/");
  const workspace = page.locator(".home-live");
  const editor = workspace.locator("[data-jul-editor-root]");
  const views = ["Editor", "Markdown", "HTML", "JSON", "Diff"];
  for (const name of views) await expect(workspace.getByRole("tab", { name })).toBeVisible();

  const paragraph = workspace.locator("[data-id=intro-lead] [data-jul-editor-content]");
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Home edit.");

  await workspace.getByRole("tab", { name: "Markdown" }).click();
  await expect(editor).toBeHidden();
  await expect(workspace.getByLabel("Edit markdown source")).toContainText("Home edit.");
  await expect(workspace.getByLabel("Edit html source")).toBeHidden();

  await workspace.getByRole("tab", { name: "Editor" }).click();
  await workspace.getByTitle("Undo").click();
  await expect(paragraph).not.toContainText("Home edit.");
  await workspace.getByTitle("Redo").click();
  await expect(paragraph).toContainText("Home edit.");

  await workspace.getByRole("tab", { name: "HTML" }).click();
  await expect(workspace.getByLabel("Edit html source")).toHaveValue(/Home edit\./);
  await workspace.getByLabel("Edit html source").fill("<h1>One home document</h1><p>Changed through HTML.</p>");
  await workspace.getByRole("button", { name: "Apply source to document" }).click();
  await expect(workspace.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("One home document");
  await expect(editor).toContainText("Changed through HTML.");

  await workspace.getByRole("tab", { name: "JSON" }).click();
  await expect(editor).toBeHidden();
  await expect(workspace.getByLabel("Edit json source")).toContainText("One home document");
  await workspace.getByRole("tab", { name: "Diff" }).click();
  await expect(editor).toBeHidden();
  await expect(workspace.getByRole("tabpanel", { name: "Diff" })).toBeVisible();
  await workspace.getByRole("tab", { name: "Editor" }).click();
  await expect(editor).toContainText("One home document");
});

test("switching views keeps the live editor's undo history", async ({ page }) => {
  await page.goto("/");
  const workspace = page.locator(".home-live");
  const line = workspace.locator("[data-id=intro-lead] [data-jul-editor-content]");
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Undo across views.");
  await workspace.getByRole("tab", { name: "Markdown" }).click();
  await expect(workspace.getByLabel("Edit markdown source")).toContainText("Undo across views.");
  await workspace.getByRole("tab", { name: "Editor" }).click();
  await workspace.getByRole("button", { name: "Undo" }).click();
  await expect(line).not.toContainText("Undo across views.");
});

test("a source draft survives view switches until it is imported", async ({ page }) => {
  await page.goto("/");
  const workspace = page.locator(".home-live");
  await workspace.getByRole("tab", { name: "Markdown" }).click();
  const source = workspace.getByLabel("Edit markdown source");
  await source.fill("# Draft only\n\nUnimported text.");
  await workspace.getByRole("tab", { name: "Editor" }).click();
  await expect(workspace.locator("[data-jul-editor-root]")).toContainText("Release notes draft");
  await workspace.getByRole("tab", { name: "HTML" }).click();
  await expect(workspace.getByLabel("Edit html source")).not.toHaveValue(/Unimported text/);
  await workspace.getByRole("tab", { name: "Markdown" }).click();
  await expect(source).toHaveValue("# Draft only\n\nUnimported text.");
  await workspace.getByRole("button", { name: "Apply source to document" }).click();
  await expect(workspace.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.locator("[data-jul-editor-root]")).toContainText("Draft only");
});

test("conversion warnings stay visible after importing into the editor", async ({ page }) => {
  await page.goto("/playground");
  await page.getByRole("tab", { name: "HTML" }).click();
  await page.getByLabel("Edit html source").fill('<p>Image note</p><script>discarded</script>');
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(page.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".unified-feedback")).toContainText("dropped-element");
  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.locator(".conversion-message")).toContainText("dropped-element");
});

test("the home workspace stays usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const workspace = page.locator(".home-live .unified-workspace");
  await expect(workspace.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await workspace.getByRole("tab", { name: "Markdown" }).click();
  await expect(workspace.getByLabel("Edit markdown source")).toBeVisible();
  await workspace.getByRole("tab", { name: "Diff" }).click();
  await expect(workspace.getByRole("tabpanel", { name: "Diff" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("visual edits and HTML/Markdown imports round trip in the playground", async ({ page }) => {
  await page.goto("/playground");
  const editor = page.locator(".playground-workspace [data-jul-editor-root]");
  const source = page.getByLabel("Edit markdown source");

  const paragraph = page.locator("[data-id=demo-p1] [data-jul-editor-content]");
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" A new detail.");
  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(editor).toBeHidden();
  await expect(source).toContainText("A new detail.");

  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.getByLabel("Edit html source")).toHaveValue(/<h1(?:\s|>)/);
  await page.getByLabel("Edit html source").fill("<h1>Imported title</h1><p>Changed through HTML.</p>");
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(page.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("Imported title");
  await expect(editor).toContainText("Changed through HTML.");

  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(source).toContainText("# Imported title");
  await source.fill("# From Markdown\n\nBack to blocks.");
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(page.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("From Markdown");
  await expect(editor).toContainText("Back to blocks.");

  await page.getByRole("tab", { name: "JSON" }).click();
  await page.getByLabel("Edit json source").fill("{");
  await page.getByRole("button", { name: "Apply source to document" }).click();
  await expect(page.locator(".error-message")).toBeVisible();
  await page.getByRole("tab", { name: "Editor" }).click();
  await expect(editor).toContainText("From Markdown");
});

test("playground diff compares edits made in the same workspace", async ({ page }) => {
  await page.goto("/playground");
  const paragraph = page.locator("[data-id=demo-list-1] [data-jul-editor-content]");
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Changed.");
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.locator("[data-jul-editor-root]")).toBeHidden();
  const diff = page.getByRole("tabpanel", { name: "Diff" });
  await expect(diff).toBeVisible();
  await expect(diff.getByText("document.md")).toBeVisible();
  await expect(diff.getByText("Before", { exact: true })).toBeVisible();
  await expect(diff.getByText("After", { exact: true })).toBeVisible();
  await expect(diff.locator('[data-diff-side="before"][data-diff-status="modify"]').first()).toBeVisible();
  await expect(diff.locator('[data-diff-side="after"][data-diff-status="insert"]').first()).toBeVisible();
  await expect(diff.locator('[data-diff-line-number="1"]')).toHaveCount(2);

  await expect(diff.locator(".playground-diff-stats")).toContainText("2 modified");
  await expect(diff.getByText("Changed.", { exact: false })).toBeVisible();

  await diff.getByRole("button", { name: "Save current as baseline" }).click();
  await expect(diff.locator(".playground-diff-stats")).toContainText("0 modified");
  await expect(diff.locator(".playground-diff-empty")).toBeVisible();
  await diff.getByRole("button", { name: "Restore sample baseline" }).click();
  await expect(diff.locator(".playground-diff-stats")).toContainText("2 modified");
  await page.getByRole("tab", { name: "Editor" }).click();
  await expect(page.locator("[data-id=demo-list-1] [data-jul-editor-content]")).toContainText("Changed.");
});

test("the comparison works in Korean, light theme, and a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/playground");
  await page.getByRole("button", { name: "한국어" }).click();
  await page.getByRole("button", { name: "라이트 테마로 전환" }).click();
  await page.getByRole("tab", { name: "비교" }).click();
  const diff = page.getByRole("tabpanel", { name: "비교" });
  await expect(diff.getByText("이전", { exact: true })).toBeVisible();
  await expect(diff.getByText("이후", { exact: true })).toBeVisible();
  await expect(diff.getByText("document.md")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(diff.locator(".playground-diff-scroll")).toBeVisible();
});

test("playground sample follows the language and keeps edits in each language", async ({ page }) => {
  await page.goto("/playground");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("[data-id=demo-title] [data-jul-editor-content]")).toContainText("제품 업데이트 초안");
  const koreanLine = page.locator("[data-id=demo-p1] [data-jul-editor-content]");
  await koreanLine.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 사용자 메모.");
  await expect(koreanLine).toContainText("사용자 메모.");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("[data-id=demo-title] [data-jul-editor-content]")).toContainText("Product update draft");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("[data-id=demo-p1] [data-jul-editor-content]")).toContainText("사용자 메모.");
});

test("playground inserts a tag from the keyboard menu and exports it", async ({ page }) => {
  await page.goto("/playground");
  const blank = page.locator("[data-id=demo-blank] [data-jul-editor-content]");
  await blank.click();
  await page.keyboard.type("#");
  await expect(page.getByRole("option", { name: "#idea" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-id=demo-blank] [data-mention-kind=tag]")).toContainText("#idea");
  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(page.getByLabel("Edit markdown source")).toContainText("#idea");
});
test("a touch gesture moves a block by its handle", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5190", viewport: { width: 800, height: 1100 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/playground");
    const source = page.locator("[data-id=demo-list-1] [data-jul-editor-content]");
    await source.scrollIntoViewIfNeeded();
    const sourceRect = (await source.boundingBox())!;
    await page.touchscreen.tap(sourceRect.x + 20, sourceRect.y + sourceRect.height / 2);
    const handle = page.locator(".drag-handle");
    await expect(handle).toBeVisible();
    await expect.poll(async () => Math.abs((await handle.boundingBox())!.y - sourceRect.y)).toBeLessThan(10);
    expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
    const handleRect = (await handle.boundingBox())!;
    const targetRect = (await page.locator("[data-id=demo-list-3]").boundingBox())!;
    const sx = handleRect.x + handleRect.width / 2;
    const sy = handleRect.y + handleRect.height / 2;
    const tx = targetRect.x + 5;
    const ty = targetRect.y + targetRect.height * .92;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + (tx - sx) * step / 10, y: sy + (ty - sy) * step / 10, id: 1 }] });
      await page.waitForTimeout(20);
    }
    await expect(page.locator(".drop-indicator")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => page.locator(".editor-content > [data-jul-editor-block]").evaluateAll((els) => {
      const ids = els.map((el) => el.getAttribute("data-id"));
      return ids.indexOf("demo-list-1") - ids.indexOf("demo-list-3");
    })).toBe(1);
  } finally {
    await context.close();
  }
});
test("the move handle is reachable and reorders a block with only the keyboard", async ({ page }) => {
  await page.goto("/playground");
  const handle = page.getByRole("button", { name: "Move block" });
  await expect(handle).toBeVisible();
  let focused = false;
  for (let step = 0; step < 20; step++) {
    await page.keyboard.press("Tab");
    focused = await handle.evaluate((el) => el === document.activeElement);
    if (focused) break;
  }
  expect(focused).toBe(true);
  const before = await page.locator(".editor-content > [data-jul-editor-block]").evaluateAll((els) => els.slice(0, 2).map((el) => el.getAttribute("data-id")));
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect.poll(async () => page.locator(".editor-content > [data-jul-editor-block]").evaluateAll((els) => els.slice(0, 2).map((el) => el.getAttribute("data-id")))).toEqual([before[1], before[0]]);
});

test("block controls leave the viewport when focus leaves or the editor scrolls away", async ({ page }) => {
  await page.goto("/playground");
  const block = page.locator("[data-id=demo-list-1] [data-jul-editor-content]");
  const handle = page.getByRole("button", { name: "Move block" });
  const add = page.getByRole("button", { name: "Add a block below" });
  await block.click();
  await expect(handle).toBeVisible();
  await expect(add).toBeVisible();

  await page.getByRole("heading", { name: "Playground", exact: true }).click();
  await expect(handle).not.toBeVisible();
  await expect(add).not.toBeVisible();

  await block.hover();
  await expect(handle).toBeVisible();
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(handle).not.toBeVisible();
  await expect(add).not.toBeVisible();
});
