import { expect, test } from "@playwright/test";

test("chart data switches from inline JSON to a fetched JSON URL", async ({ page }) => {
  await page.route("https://cdn.example.test/visitors.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify([{ month: "Jan", feedback: 7 }, { month: "Feb", feedback: 21 }]),
  }));
  await page.goto("/playground");
  await page.locator("[data-id=demo-chart]").click();
  await page.getByTestId("jul-editor-chart-format-json").click();
  await page.getByTestId("jul-editor-chart-json").fill('[{"month":"Jan","feedback":8},{"month":"Feb","feedback":13}]');
  await expect(page.locator("[data-id=demo-chart] .recharts-responsive-container")).toBeVisible();

  await page.getByTestId("jul-editor-chart-source").selectOption("url");
  await page.getByTestId("jul-editor-chart-format-json").click();
  await page.getByTestId("jul-editor-chart-url").fill("https://cdn.example.test/visitors.json");
  await expect(page.locator("[data-id=demo-chart] .recharts-responsive-container")).toBeVisible();
  await page.getByRole("tablist", { name: "Document view" }).getByRole("tab", { name: "JSON" }).click();
  await expect(page.locator(".unified-source-view textarea")).toContainText('"type": "url"');
  await expect(page.locator(".unified-source-view textarea")).toContainText("https://cdn.example.test/visitors.json");
});

test("file picker stores images and queues attachments without blob URLs", async ({ page }) => {
  await page.goto("/playground");
  const input = page.locator('.unified-workspace input[type="file"]');
  await input.setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator('[data-jul-editor-image][data-state="ready"]:has(img[alt="pixel.png"])')).toHaveCount(1);
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await expect(page.locator('[data-jul-editor-attachment][data-state="queued"]')).toContainText("notes.txt");
  await page.getByRole("tab", { name: "JSON" }).click();
  const json = await page.locator(".unified-source-view textarea").inputValue();
  expect(json).toContain('"type": "attachment"');
  expect(json).not.toContain("blob:");
  expect(json).toContain("data:image/png;base64,");
});

test("Code Workspace opens file tabs, highlights syntax, and can hide its tree and line numbers", async ({ page }) => {
  await page.goto("/docs/plugins/code-workspace");
  const demo = page.getByTestId("docs-code-workspace");
  await expect(demo.locator('[data-jul-editor-plugin="code-workspace"]')).toBeVisible();
  await demo.getByRole("button", { name: "src/Dialog.tsx" }).click();
  await expect(demo.getByRole("tab", { name: "Dialog.tsx" })).toBeVisible();
  await expect(demo.locator('[data-jul-editor-code-line][data-change="added"]')).toHaveCount(1);
  await expect.poll(() => demo.locator('[data-jul-editor-token="keyword"]').count()).toBeGreaterThan(0);

  await demo.locator('[data-id="workspace-demo"]').click();
  await demo.getByLabel("File tree").uncheck();
  await expect(demo.locator("[data-jul-editor-code-tree]")).toHaveCount(0);
  await expect(demo.locator('[data-jul-editor-code-tabs] [role="tab"]')).toHaveCount(3);
  await demo.getByLabel("Line numbers").uncheck();
  await expect(demo.locator("[data-jul-editor-code-gutter]").first()).toHaveText("");
});

test("IDE workspace edits files in place while the basic workspace remains available", async ({ page }) => {
  await page.goto("/docs/plugins/code-workspace");
  const basic = page.getByTestId("docs-code-workspace");
  const ide = page.getByTestId("docs-code-workspace-ide");
  await expect(basic.locator('[data-jul-editor-plugin="code-workspace"]')).toBeVisible();
  await expect(ide.locator('[data-jul-editor-plugin="code-workspace-ide"]')).toBeVisible();
  await expect(ide.getByRole("group", { name: "Code Workspace settings" })).toHaveCount(0);
  // View appearance by default: no edit controls until the block is selected.
  await expect(ide.getByRole("button", { name: "New file", exact: true })).toHaveCount(0);
  await expect(ide.getByRole("textbox", { name: "Code" })).toHaveCount(0);
  await expect(ide.getByRole("checkbox")).toHaveCount(0);
  await ide.locator("[data-jul-editor-code-preview]").click();
  await expect(ide.getByRole("button", { name: "New file", exact: true })).toBeVisible();

  await ide.getByRole("button", { name: "New file", exact: true }).click();
  await ide.getByRole("textbox", { name: "New file name" }).fill("notes.tsx");
  await ide.getByRole("textbox", { name: "New file name" }).press("Enter");
  await expect(ide.getByRole("tab", { name: "notes.tsx" })).toBeVisible();
  await expect(ide.locator("[data-jul-editor-code-toolbar]")).toContainText("tsx");
  await expect(ide.getByRole("textbox", { name: "Language" })).toHaveCount(0);
  await ide.getByRole("checkbox", { name: "Pin notes.tsx" }).check();
  await ide.getByRole("textbox", { name: "Code" }).fill("export const answer = 42;\nconsole.log(answer);");
  await ide.getByRole("textbox", { name: "Added line ranges" }).fill("1");
  await ide.getByRole("textbox", { name: "Deleted line ranges" }).fill("2");
  await expect(ide.getByRole("button", { name: "Mark line 1 added" })).toHaveAttribute("aria-pressed", "true");
  await expect(ide.getByRole("button", { name: "Mark line 2 deleted" })).toHaveAttribute("aria-pressed", "true");
  // +/- are mutually exclusive: marking line 1 deleted clears its added state.
  await ide.getByRole("button", { name: "Mark line 1 deleted" }).click();
  await expect(ide.getByRole("button", { name: "Mark line 1 added" })).toHaveAttribute("aria-pressed", "false");
  await expect(ide.getByRole("button", { name: "Mark line 1 deleted" })).toHaveAttribute("aria-pressed", "true");
  await expect(ide.getByRole("textbox", { name: "Code" })).toHaveValue("export const answer = 42;\nconsole.log(answer);");
  // Regression: in edit mode both toggles are always visible on every line (line 1 deleted, line 2 deleted).
  const opacity = (name: string) => ide.getByRole("button", { name }).evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(0, 0);
  for (const name of ["Mark line 1 deleted", "Mark line 1 added", "Mark line 2 added", "Mark line 2 deleted"]) {
    await expect(ide.getByRole("button", { name })).toBeVisible();
    expect(await opacity(name)).toBe("1");
  }
  await expect(ide.getByRole("button", { name: "Mark line 1 deleted" })).toHaveAttribute("aria-pressed", "true");
  await expect(ide.getByRole("button", { name: "Mark line 1 added" })).toHaveAttribute("aria-pressed", "false");
});

// Regression: an added/deleted line is tinted across the whole row (code area to the right of the text), not only in the gutter.
for (const scheme of ["light", "dark"] as const) {
  test(`IDE workspace tints the whole changed row, not just the gutter (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/docs/plugins/code-workspace");
    const ide = page.getByTestId("docs-code-workspace-ide");
    await ide.locator("[data-jul-editor-code-preview]").click();
    await ide.getByRole("textbox", { name: "Code" }).fill("short\nshort added\nshort removed\nlong " + "x".repeat(300));
    await ide.getByRole("textbox", { name: "Added line ranges" }).fill("2");
    await ide.getByRole("textbox", { name: "Deleted line ranges" }).fill("3");
    // The row element's own background (color-mix resolves to color(srgb r g b / a), plain rows stay transparent) and whether it spans to the pane's right edge.
    const bg = (line: number) => ide.locator(`[data-jul-editor-code-preview] [data-jul-editor-code-row="${line}"]`).evaluate((el) => {
      const pane = el.closest("pre")!.getBoundingClientRect();
      const nums = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      const [r = 0, g = 0, b = 0, a = 1] = nums.length === 3 ? [...nums, 1] : nums;
      return { r, g, b, a, reachesRight: el.getBoundingClientRect().right >= pane.right };
    });
    const add = await bg(2), del = await bg(3), plain = await bg(1);
    expect(plain.a).toBe(0);
    expect(add.a).toBeGreaterThan(0);
    expect(add.g).toBeGreaterThan(add.r);
    expect(del.a).toBeGreaterThan(0);
    expect(del.r).toBeGreaterThan(del.g);
    expect(add.reachesRight && del.reachesRight).toBe(true);
    // Still painted while scrolled horizontally (the long line widens the content).
    await ide.getByRole("textbox", { name: "Code" }).evaluate((el) => { (el as HTMLTextAreaElement).scrollLeft = 200; });
    expect(await bg(2)).toEqual(add);
    await ide.screenshot({ path: `${SHOTS}code-diff-fullrow${scheme === "dark" ? "-dark" : ""}.png` });
  });
}

test("IDE workspace creates folders, renames files, and moves them by drag and drop", async ({ page }) => {
  await page.goto("/docs/plugins/code-workspace");
  const ide = page.getByTestId("docs-code-workspace-ide");
  await ide.locator("[data-jul-editor-code-preview]").click();
  await ide.getByRole("button", { name: "New folder", exact: true }).click();
  await ide.getByRole("textbox", { name: "New folder name" }).fill("notes");
  await ide.getByRole("textbox", { name: "New folder name" }).press("Enter");
  await expect(ide.getByRole("button", { name: "notes", exact: true })).toBeVisible();

  // Synthetic drag events: with the block selected, the host editor sometimes swallows a native mouse drag.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await ide.getByRole("button", { name: "src/Button.tsx" }).dispatchEvent("dragstart", { dataTransfer });
  await ide.getByRole("button", { name: "notes", exact: true }).dispatchEvent("dragover", { dataTransfer });
  await ide.getByRole("button", { name: "notes", exact: true }).dispatchEvent("drop", { dataTransfer });
  const moved = ide.getByRole("button", { name: "notes/Button.tsx" });
  await expect(moved).toBeVisible();
  await moved.dblclick();
  await ide.getByRole("textbox", { name: "Rename notes/Button.tsx" }).fill("Button.jsx");
  await ide.getByRole("textbox", { name: "Rename notes/Button.tsx" }).press("Enter");
  await expect(ide.getByRole("button", { name: "notes/Button.jsx" })).toBeVisible();
  await ide.getByRole("button", { name: "notes/Button.jsx" }).click();
  await expect(ide.locator("[data-jul-editor-code-toolbar]")).toContainText("jsx");
});

test("playground preserves Code Workspace through Markdown and HTML views", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.locator('[data-id="demo-code-workspace"]')).toBeVisible();
  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(page.locator(".unified-source-view textarea")).toContainText("jul-editor-code-workspace");
  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.locator(".unified-source-view textarea")).toContainText("data-jul-editor-code-workspace");
});

// Regression: a changed line is ONE seamless band from the gutter's left edge to the pane's right edge (like GitHub). Pixels are sampled from a real screenshot, so any uncolored strip, alpha mismatch or height drift between the gutter and the code is caught, whichever element paints it.
const SHOTS = "test-results/";
type Rect = { x: number; y: number; w: number; h: number };
async function readPixels(page: import("@playwright/test").Page, rawClip: Rect): Promise<(x: number, y: number) => [number, number, number]> {
  // Integer clip so pixel indexes map 1:1 to CSS pixels (fractional clips get rounded by the browser).
  const clip = { x: Math.floor(rawClip.x), y: Math.floor(rawClip.y), w: Math.ceil(rawClip.w) + 1, h: Math.ceil(rawClip.h) + 1 };
  const png = (await page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } })).toString("base64");
  const data = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return { w: bitmap.width, px: Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data) };
  }, png);
  return (x, y) => { const i = ((Math.floor(y) - clip.y) * data.w + (Math.floor(x) - clip.x)) * 4; return [data.px[i]!, data.px[i + 1]!, data.px[i + 2]!]; };
}
const near = (a: number[], b: number[], tol = 2) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

/** gutter and code are the elements that paint the row (the same element for the read-only view, two row elements for the IDE view). */
async function expectSeamlessBand(page: import("@playwright/test").Page, gutter: import("@playwright/test").Locator, code: import("@playwright/test").Locator, plainGutter: import("@playwright/test").Locator, scroller: import("@playwright/test").Locator): Promise<void> {
  // Web fonts and late layout (docs page content above the editor, hydration) shift rows after goto: wait for fonts, then scroll and sample until the rects of all four elements are identical on two consecutive animation frames. Row heights themselves are fixed (20px IDE, min-height 21px grid rows), only the position moves while the page settles.
  await page.evaluate(() => document.fonts.ready);
  const box = async (l: import("@playwright/test").Locator) => { const b = (await l.boundingBox())!; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const snapshot = async () => { await gutter.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))); return JSON.stringify([await box(gutter), await box(code), await box(plainGutter), await box(scroller)]); };
  let last = await snapshot();
  await expect.poll(async () => { const next = await snapshot(); const stable = next === last; last = next; return stable; }, { message: "layout settled" }).toBe(true);
  const [g, c, p, pane] = JSON.parse(last) as Rect[];
  // Same top and height: no drift between the two pieces, and not taller or shorter than a plain row's pitch.
  expect(Math.abs(g.y - c.y)).toBeLessThan(0.6);
  expect(Math.abs(g.h - c.h)).toBeLessThan(0.6);
  expect(Math.abs(g.h - (c.y > p.y ? c.y - p.y : p.y - c.y) / Math.max(1, Math.round(Math.abs(c.y - p.y) / g.h)))).toBeLessThan(1);
  const left = Math.floor(Math.min(g.x, c.x)), right = Math.floor(Math.min(c.x + c.w, pane.x + pane.w)) - 2;
  const px = await readPixels(page, { x: left - 4, y: g.y - 6, w: right - left + 8, h: g.h + 12 });
  const topY = Math.ceil(g.y) + 1, bottomY = Math.floor(g.y + g.h) - 2;
  const reference = px(left + 2, topY);
  const outside = px(left + 2, Math.floor(g.y) - 4);
  // The changed color must be distinguishable from the plain background above the row.
  expect(near(reference, outside, 4), `${gutter} changed ${reference} vs plain ${outside} rows g=${JSON.stringify(g)} c=${JSON.stringify(c)}`).toBe(false);
  // Every pixel on a scanline near the top and near the bottom of the row (above and below the glyphs) is the changed color, edge to edge: gutter, boundary and code alike.
  for (const y of [topY, bottomY]) {
    for (let x = left + 1; x < right; x++) expect(near(px(x, y), reference), `pixel ${x - left},${y - Math.floor(g.y)} is ${px(x, y)} not ${reference}`).toBe(true);
  }
  const boundary = Math.round(Math.max(g.x + g.w, c.x > g.x ? c.x : g.x + g.w));
  for (const dx of [-3, -1, 0, 1, 3]) expect(near(px(boundary + dx, topY), reference)).toBe(true);
  // Vertical continuity at the boundary column too (no strip at the row's top or bottom edge).
  for (const y of [Math.ceil(g.y) + 1, Math.floor(g.y + g.h) - 2]) expect(near(px(boundary, y), reference)).toBe(true);
}

for (const scheme of ["light", "dark"] as const) {
  test(`changed line is one seamless band across gutter and code in every Code Workspace view (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.goto("/docs/plugins/code-workspace");

    // Read-only view: the whole row element is the band.
    const basic = page.getByTestId("docs-code-workspace");
    const roLine = basic.locator('[data-jul-editor-code-line="4"][data-change="added"]');
    await expect(roLine).toHaveCount(1);
    await expectSeamlessBand(page, roLine.locator("[data-jul-editor-code-gutter]"), roLine.locator("code"), basic.locator('[data-jul-editor-code-line="3"] [data-jul-editor-code-gutter]'), basic.locator("[data-jul-editor-code-viewport]"));
    await expect(roLine.locator("[data-jul-editor-code-gutter]")).toContainText("+");
    await basic.screenshot({ path: `${SHOTS}code-band-readonly-${scheme}.png` });
    await basic.locator('[data-jul-editor-code-line="4"]').screenshot({ path: `${SHOTS}code-band-readonly-${scheme}-zoom.png` });

    // IDE view, read-only and then selected (editable gutter with toggles).
    const ide = page.getByTestId("docs-code-workspace-ide");
    for (const editable of [false, true]) {
      if (editable) await ide.locator("[data-jul-editor-code-preview]").click();
      const gutter = ide.locator('[data-jul-editor-code-gutter] [data-jul-editor-code-line="4"]');
      const code = ide.locator('[data-jul-editor-code-row="4"]');
      await expect(code).toHaveAttribute("data-change", "added");
      await ide.screenshot({ path: `${SHOTS}code-band-ide-${editable ? "editable-" : ""}${scheme}.png` });
      await expectSeamlessBand(page, gutter, code, ide.locator('[data-jul-editor-code-gutter] [data-jul-editor-code-line="3"]'), ide.locator("[data-jul-editor-code-preview]"));
      if (!editable) await expect(gutter.locator("[data-jul-editor-code-change-marker]")).toHaveText("+");
    }

    // Playground (full editor): the IDE view inside the site editor, where the site's own CSS also applies.
    await page.goto("/playground");
    const pg = page.locator('[data-jul-editor-plugin="code-workspace-ide"]').first();
    await pg.scrollIntoViewIfNeeded();
    const pgGutter = pg.locator('[data-jul-editor-code-gutter] [data-jul-editor-code-line="4"]');
    await expectSeamlessBand(page, pgGutter, pg.locator('[data-jul-editor-code-row="4"]'), pg.locator('[data-jul-editor-code-gutter] [data-jul-editor-code-line="3"]'), pg.locator("[data-jul-editor-code-preview]"));
    await pg.screenshot({ path: `${SHOTS}code-band-playground-${scheme}.png` });
  });
}

// Regression: line numbers sit in one column whether or not a row carries a +/- marker, and for 1 digit vs 2 digit numbers (right edges equal). The marker lives in its own reserved column.
async function expectAlignedNumbers(numbers: import("@playwright/test").Locator, min: number): Promise<void> {
  const rights = await numbers.evaluateAll((els) => els.map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().right;
  }));
  expect(rights.length).toBeGreaterThanOrEqual(min);
  for (const r of rights) expect(Math.abs(r - rights[0]), JSON.stringify(rights)).toBeLessThanOrEqual(0.5);
}

for (const scheme of ["light", "dark"] as const) {
  test(`line numbers share one right edge with and without markers in every Code Workspace view (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.goto("/docs/plugins/code-workspace");

    // Read-only basic view (includes the +4 line).
    const basic = page.getByTestId("docs-code-workspace");
    await expect(basic.locator('[data-jul-editor-code-line][data-change="added"]')).not.toHaveCount(0);
    await expectAlignedNumbers(basic.locator("[data-jul-editor-code-number]"), 4);
    await basic.locator('[data-jul-editor-code-line="4"]').screenshot({ path: `${SHOTS}code-gutter-align-readonly-${scheme}.png` });

    // IDE view, read-only then editable, with 12 lines so 1 and 2 digit numbers mix with the marker rows.
    const ide = page.getByTestId("docs-code-workspace-ide");
    const gutterNumbers = ide.locator("[data-jul-editor-code-gutter] [data-jul-editor-code-number]");
    await expectAlignedNumbers(gutterNumbers, 4);
    await ide.locator("[data-jul-editor-code-preview]").click();
    await ide.getByRole("textbox", { name: "Code" }).fill(Array.from({ length: 12 }, (_, i) => `const v${i + 1} = ${i + 1};`).join("\n"));
    await expect(gutterNumbers).toHaveCount(12);
    await expectAlignedNumbers(gutterNumbers, 12);
    await ide.locator('[data-jul-editor-code-gutter] [data-jul-editor-code-line="4"]').hover();
    await expectAlignedNumbers(gutterNumbers, 12);
    await ide.locator("[data-jul-editor-code-gutter]").screenshot({ path: `${SHOTS}code-gutter-align-ide-editable-${scheme}.png` });
    if (scheme === "light") await ide.locator("[data-jul-editor-code-gutter]").screenshot({ path: `${SHOTS}code-edit-toggles.png` });
    await ide.getByRole("textbox", { name: "Code" }).blur();
    await page.mouse.click(5, 5);
    await expectAlignedNumbers(gutterNumbers, 12);
    await ide.locator("[data-jul-editor-code-gutter]").screenshot({ path: `${SHOTS}code-gutter-align-ide-${scheme}.png` });

    // Playground.
    await page.goto("/playground");
    const pg = page.locator('[data-jul-editor-plugin="code-workspace-ide"]').first();
    await pg.scrollIntoViewIfNeeded();
    const pgNumbers = pg.locator("[data-jul-editor-code-gutter] [data-jul-editor-code-number]");
    await expectAlignedNumbers(pgNumbers, 4);
    await pg.locator("[data-jul-editor-code-preview]").click();
    await pg.getByRole("textbox", { name: "Code" }).fill(Array.from({ length: 12 }, (_, i) => `const v${i + 1} = ${i + 1};`).join("\n"));
    await expect(pgNumbers).toHaveCount(12);
    await expectAlignedNumbers(pgNumbers, 12);
    await pg.locator("[data-jul-editor-code-gutter]").screenshot({ path: `${SHOTS}code-gutter-align-playground-${scheme}.png` });
  });
}
