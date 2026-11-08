import { expect, test } from "@playwright/test";
import * as ts from "typescript";
import type { Page } from "@playwright/test";

// Case tabs: Agent, DOCX and Notion-like editors, then shadcn and Custom. Presets live in the Custom sidebar.
const SHADCN_CARD = 3;
const CUSTOM_CARD = 4;
const PRESET_IDS = ["Default", "Notebook", "Editorial", "Midnight", "Terminal", "Studio", "Blueprint", "Canvas"];

async function openCustom(page: Page) {
  await page.goto("/showcase");
  await page.locator(".showcase-picker-card").nth(CUSTOM_CARD).click();
  return page.getByRole("region", { name: "Customize theme" });
}
const preset = (page: Page, name: string) => page.getByRole("region", { name: "Customize theme" }).locator(".custom-theme-preset-list button", { hasText: name }).first();

test("five cases: agent, docx and notion-like editors, shadcn, and Custom with block, rich, and full controls", async ({ page }) => {
  await page.goto("/showcase");
  const choices = page.locator(".showcase-picker-card");
  await expect(choices).toHaveCount(5);
  for (const index of [0, 1, 2, 3, 4]) await expect(choices.nth(index)).toBeEnabled();
  for (const [index, id] of ["agent", "docx", "notion"].entries()) {
    await choices.nth(index).click();
    await expect(page.locator(".showcase-active")).toHaveAttribute("data-theme", id);
    await expect(page.locator(`.showcase-active .showcase-${id} .editor-content`)).toBeVisible();
    await page.locator(".showcase-switches").getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.locator(".showcase-active .docs-code")).toBeVisible();
    await page.locator(".showcase-switches").getByRole("button", { name: "Preview", exact: true }).click();
  }
  await choices.nth(CUSTOM_CARD).click();
  for (const removed of ["notebook", "editorial", "midnight", "terminal", "studio", "blueprint", "canvas"]) await expect(page.locator(`.showcase-picker-card .jul-editor-theme--${removed}`)).toHaveCount(0);
  await expect(page.locator(".showcase-active .editor-instance")).toHaveCount(1);
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-theme", "custom");
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-mode", "full");
  await expect(page.locator(".showcase-active .editor-toolbar")).toHaveCount(1);

  await choices.nth(SHADCN_CARD).click();
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-theme", "shadcn");
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-mode", "block");
  await expect(page.locator(".showcase-active .editor-toolbar")).toHaveCount(0);
  const paragraph = page.locator(".showcase-active [data-id=s-p] [data-jul-editor-content]");
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Another note.");
  await expect(paragraph).toContainText("Another note.");
  await paragraph.hover();
  await page.getByRole("button", { name: "Add a block below" }).click();
  await expect(page.locator(".showcase-active .editor-content > [data-jul-editor-block]")).toHaveCount(23);
  await expect(page.locator(".showcase-active .slash-menu")).toHaveCount(0);
});

test("showcase opens on Custom with only the page title and description", async ({ page }) => {
  await page.goto("/showcase");
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-theme", "custom");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Showcase");
  await expect(page.getByText("Nine visual directions")).toHaveCount(0);
  await expect(page.getByText("Use your own design system.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read the styling guide" })).toBeVisible();
});

test("Custom accent drives links, toolbar, quote, and table header; styles change radius and borders", async ({ page }) => {
  await page.goto("/showcase");
  const controls = page.getByRole("region", { name: "Customize theme" });
  await controls.getByRole("button", { name: "Rose", exact: true }).click();
  const color = (selector: string, prop: string) => page.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);
  await expect.poll(() => color(".showcase-active [data-type=quote]", "border-left-color")).toBe("rgb(190, 18, 60)");
  await expect.poll(() => color(".showcase-active .editor-content a", "color")).toBe("rgb(190, 18, 60)");
  await expect.poll(() => color(".showcase-active [data-type=tableRow]:first-child [data-type=tableCell]", "color")).toBe("rgb(190, 18, 60)");
  await controls.locator(".custom-theme-looks button", { hasText: "Brutal" }).click();
  await expect.poll(() => color(".showcase-active .editor-instance", "border-top-width")).toBe("3px");
  await expect.poll(() => color(".showcase-active [data-type=quote]", "box-shadow")).toContain("5px 5px");
  await controls.locator(".custom-theme-looks button", { hasText: "Sharp" }).click();
  await expect.poll(() => color(".showcase-active .editor-instance", "border-top-left-radius")).toBe("0px");
  await expect(page.locator(".showcase-active [data-type=chart]")).toHaveCount(1);
});

test("home, playground, shadcn, Custom, and every Custom preset demonstrate an image, table, and highlighted code", async ({ page }) => {
  for (const route of ["/", "/playground"]) {
    await page.goto(route);
    await expect(page.locator(".unified-workspace [data-type=image]")).toHaveCount(1);
    await expect(page.locator(".unified-workspace [data-type=table]")).toHaveCount(1);
    await expect(page.locator(".unified-workspace [data-type=codeBlock]")).toHaveCount(1);
  }
  await page.goto("/showcase");
  const editor = page.locator(".showcase-active .editor-content");
  const expectDemo = async () => {
    await expect(editor.locator("[data-type=image] img")).toHaveCount(1);
    await expect(editor.locator("[data-type=table]")).toHaveCount(1);
    await expect(editor.locator("[data-type=codeBlock]")).toHaveCount(1);
  };
  await page.locator(".showcase-picker-card").nth(SHADCN_CARD).click();
  await expectDemo();
  await page.locator(".showcase-picker-card").nth(CUSTOM_CARD).click();
  for (const name of PRESET_IDS) {
    await preset(page, name).click();
    await expectDemo();
  }
  await expect.poll(() => page.evaluate(() => CSS.highlights.has("jul-editor-keyword"))).toBe(true);
});

test("Terminal preset keeps its marker inline and block controls clear the list gutter at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openCustom(page);
  await preset(page, "Terminal").click();
  await expect(page.locator("[data-id=t-title]")).toContainText("Release checklist");
  const title = page.locator("[data-id=t-title]");
  const heading = await title.evaluate((element) => ({
    contentHeight: element.querySelector("[data-jul-editor-content]")!.getBoundingClientRect().height,
    marker: getComputedStyle(element.querySelector("[data-jul-editor-content]")!, "::before").content,
  }));
  expect(heading.marker).toContain("#");
  expect(heading.contentHeight).toBeLessThan(60);

  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator("[data-id=t-list]").hover();
    const dots = page.locator(".drag-handle svg circle");
    await expect(dots).toHaveCount(6);
    const columns = await dots.evaluateAll((circles) => [...new Set(circles.map((circle) => {
      const rect = circle.getBoundingClientRect();
      return Math.round(rect.left + rect.width / 2);
    }))].sort((a, b) => a - b));
    expect(columns).toHaveLength(2);
    expect(columns[1]! - columns[0]!).toBeLessThanOrEqual(7);
    await expect.poll(async () => page.locator(".drag-handle").evaluate((element) => {
      const grip = element.getBoundingClientRect();
      const row = document.querySelector("[data-id=t-list]")!.getBoundingClientRect();
      return Math.abs(grip.top - row.top) < 12;
    })).toBe(true);
    const gutter = await page.locator(".editor-content").evaluate((editor) => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const content = editor.getBoundingClientRect();
      const row = rect("[data-id=t-list]");
      const add = rect(".block-add");
      const grip = rect(".drag-handle");
      return { addInside: add.left - content.left, controlGap: grip.left - add.right, markerGap: row.left - grip.right };
    });
    expect(gutter.addInside).toBeGreaterThanOrEqual(8);
    expect(gutter.controlGap).toBeGreaterThanOrEqual(6);
    expect(gutter.markerGap).toBeGreaterThanOrEqual(10);
  }
});

test("Blueprint and Canvas presets have distinct working editor surfaces", async ({ page }) => {
  await openCustom(page);
  await preset(page, "Blueprint").click();
  await expect(page.locator("[data-id=b-title]")).toContainText("Build specification");
  await expect(page.locator(".showcase-active .editor-toolbar")).toBeVisible();
  expect(await page.locator(".showcase-active .editor-content").evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("linear-gradient");

  await preset(page, "Canvas").click();
  await expect(page.locator("[data-id=c-title]")).toContainText("Make room for ideas");
  await expect.poll(() => page.locator("[data-id=c-quote]").evaluate((element) => getComputedStyle(element).boxShadow)).toContain("5px 5px");

  await preset(page, "Notebook").click();
  await expect.poll(() => page.locator(".showcase-active .editor-content").evaluate((element) => getComputedStyle(element).backgroundSize)).toContain("31px");
  await expect(page.locator("[data-id=n-title]")).toContainText("Field notes");
});

test("selecting a preset fills the palette editor and every value stays editable", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const controls = await openCustom(page);
  await preset(page, "Midnight").click();
  await expect(preset(page, "Midnight")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".showcase-active .editor-content").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(23, 25, 35)");
  await expect(controls.getByLabel("Accent", { exact: true })).toHaveValue("#cfb5ef");
  await expect(controls.getByLabel("Background")).toHaveValue("#171923");
  await expect(controls.getByRole("combobox", { name: "Headings" })).toHaveValue("serif");
  await expect(controls.getByRole("combobox", { name: "Sample document" })).toHaveValue("midnight");
  await expect(page.locator("[data-id=m-title]")).toBeVisible();

  await controls.getByLabel("Accent", { exact: true }).fill("#ff0066");
  await controls.getByRole("button", { name: "Square", exact: true }).click();
  await controls.getByRole("combobox", { name: "Sample document" }).selectOption("custom");
  await expect(page.locator("[data-id=x-title]")).toBeVisible();
  await expect.poll(() => page.locator(".showcase-custom-bars i").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 0, 102)");
  await controls.getByRole("button", { name: "Get code" }).click();
  const code = page.locator(".showcase-code-pane code");
  for (const fragment of ["--jul-editor-bg: #171923", "--jul-editor-accent: #ff0066", "--jul-editor-radius: 0px", "--jul-editor-heading: Georgia"]) await expect(code).toContainText(fragment);
  await page.getByRole("button", { name: "React", exact: true }).click();
  await expect(code).toContainText("ThemeExample");
});

test("Custom sidebar stays visible while the long document scrolls, and stacks on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const controls = await openCustom(page);
  const layout = page.locator(".showcase-custom-layout");
  const metrics = () => controls.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrollable: element.scrollHeight > element.clientHeight };
  });
  const editorHeight = await layout.locator(".showcase-custom-preview").evaluate((element) => element.getBoundingClientRect().height);
  expect(editorHeight).toBeGreaterThan(900);
  for (const offset of [500, 1200]) {
    await page.evaluate((y) => window.scrollTo(0, document.querySelector(".showcase-custom-layout")!.getBoundingClientRect().top + scrollY + y), offset);
    const m = await metrics();
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.top).toBeLessThan(120);
    expect(m.bottom).toBeLessThanOrEqual(m.viewport + 1);
  }
  expect((await metrics()).scrollable).toBe(true);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.locator(".showcase-picker-card").nth(CUSTOM_CARD).click();
  const stacked = await page.evaluate(() => {
    const side = document.querySelector(".custom-theme-controls")!.getBoundingClientRect();
    const preview = document.querySelector(".showcase-custom-preview")!.getBoundingClientRect();
    return { position: getComputedStyle(document.querySelector(".custom-theme-controls")!).position, sideAbovePreview: side.bottom <= preview.top + 1, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  expect(stacked.position).toBe("static");
  expect(stacked.sideAbovePreview).toBe(true);
  expect(stacked.overflow).toBeLessThanOrEqual(1);
});

test("Custom palette and typography update the editor and copied CSS without losing edits", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCustom(page);
  const editor = page.locator(".showcase-active [data-id=x-p] [data-jul-editor-content]");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Saved draft.");
  await expect(editor).toContainText("Saved draft.");

  const controls = page.getByRole("region", { name: "Customize theme" });
  await expect(controls.getByRole("button", { name: "Cobalt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".showcase-custom-bars i").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(29, 78, 216)");
  await controls.getByRole("button", { name: "Ocean", exact: true }).click();
  await controls.getByRole("button", { name: "Violet", exact: true }).click();
  await expect.poll(() => page.locator(".showcase-custom-bars i").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(3, 105, 161)");
  await controls.getByRole("button", { name: "Nocturne", exact: true }).click();
  await expect(editor).toContainText("Saved draft.");
  await expect.poll(() => page.locator(".showcase-active .editor-content").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(24, 24, 27)");

  await controls.getByRole("button", { name: "Rose", exact: true }).click();
  await controls.getByRole("button", { name: "Paper", exact: true }).click();
  await controls.getByRole("button", { name: "Compact", exact: true }).click();
  await controls.getByRole("combobox", { name: "Body" }).selectOption("mono");
  await controls.getByRole("combobox", { name: "Headings" }).selectOption("serif");
  await controls.getByRole("button", { name: "Spectrum", exact: true }).click();
  await expect(controls.getByRole("slider")).toHaveCount(0);
  await controls.getByRole("button", { name: "Square", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(controls.getByRole("button", { name: "Square", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toContainText("Saved draft.");
  await expect.poll(() => page.locator("[data-id=x-title]").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Georgia");
  await expect.poll(() => page.locator(".showcase-active .tool-button").first().evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
  await expect.poll(() => page.locator(".showcase-custom-bars i").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(194, 65, 12)");

  await controls.getByRole("button", { name: "Get code" }).click();
  await expect(page.locator(".showcase-code-tabs button[aria-pressed=true]")).toHaveText("CSS");
  const code = page.locator(".showcase-code-pane code");
  for (const fragment of ["--jul-editor-accent: #be123c", "--jul-editor-radius: 0px", "--chart-1: #c2410c", "--jul-editor-heading: Georgia", "line-height: 1.55"]) await expect(code).toContainText(fragment);
  await expect(code).not.toContainText("fonts.googleapis.com");
  await page.getByRole("button", { name: "Copy theme CSS" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("--jul-editor-accent: #be123c");
  await page.getByRole("button", { name: "React", exact: true }).click();
  await expect(code).toContainText("export function ThemeExample()");
  await expect(code).toContainText('theme="custom" mode="full"');
  await page.getByRole("button", { name: "Copy React component" }).click();
  const component = await page.evaluate(() => navigator.clipboard.readText());
  expect(ts.transpileModule(component, { fileName: "CustomThemeExample.tsx", compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  await page.locator(".showcase-switches").getByRole("button", { name: "Preview", exact: true }).click();
  await expect(editor).toContainText("Saved draft.");
});

test("Custom controls and preview fit a narrow Korean screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/showcase");
  await page.getByRole("button", { name: "한국어" }).click();
  await page.locator(".showcase-picker-card").nth(CUSTOM_CARD).click();
  const controls = page.getByRole("region", { name: "테마 사용자 지정" });
  await controls.getByRole("button", { name: "민트", exact: true }).click();
  await expect(page.locator("[data-id=x-title]")).toContainText("내 에디터 만들기");
  await controls.getByRole("button", { name: "녹턴", exact: true }).click();
  await expect(controls.getByRole("button", { name: "녹턴", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("showcase drag handle reorders a block through the editor canvas", async ({ page }) => {
  await openCustom(page);
  await preset(page, "Terminal").click();
  await expect(page.locator("[data-id=t-title]")).toBeVisible();
  // The sticky site header would cover a block scrolled to the very top, so center the list first.
  await page.locator("[data-id=t-list]").evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.locator("[data-id=t-list]").hover();
  await expect(page.locator(".drag-handle")).toBeVisible();
  const grip = await page.locator(".drag-handle").boundingBox();
  const title = await page.locator("[data-id=t-title]").boundingBox();
  expect(grip).not.toBeNull();
  expect(title).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(title!.x + 20, title!.y + 3, { steps: 12 });
  await expect(page.locator(".drop-indicator")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => page.locator(".showcase-active .editor-content > [data-jul-editor-block]").evaluateAll((blocks) => blocks.slice(0, 3).map((block) => block.getAttribute("data-id")))).toEqual(["t-list", "t-title", "t-p"]);
});

test("copied theme CSS and React source for a Custom preset match the live surface without site styles", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCustom(page);
  await preset(page, "Notebook").click();
  await page.locator(".showcase-switches").getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".showcase-code-pane code")).toContainText("Editor.DragHandle");
  await page.getByRole("button", { name: "CSS", exact: true }).click();
  await expect(page.locator(".showcase-code-pane code")).toContainText(".jul-editor-theme--custom");
  await page.getByRole("button", { name: "Copy theme CSS" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(".jul-editor-theme--custom");
  const css = await page.evaluate(() => navigator.clipboard.readText());
  expect(css).toContain("\n.jul-editor-theme--custom");
  const isolated = await page.evaluate((themeCss) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const style = doc.createElement("style");
    style.textContent = themeCss;
    doc.head.append(style);
    doc.body.innerHTML = '<div class="jul-editor-theme jul-editor-theme--custom"><div class="editor-instance"><div class="editor-toolbar"><button class="tool-button">B</button></div><div class="editor-content"><div data-jul-editor-block data-type="paragraph"><div data-jul-editor-children></div></div><div data-jul-editor-block data-type="codeBlock"><div data-jul-editor-code-chrome>plain text</div></div><div data-type="table"><div data-jul-editor-children><div data-type="tableRow"><div data-jul-editor-children><div data-type="tableCell">A</div></div></div></div><div data-type="divider"><hr></div></div></div></div>';
    const computed = (selector: string) => frame.contentWindow!.getComputedStyle(doc.querySelector(selector)!);
    const result = {
      background: computed(".editor-content").backgroundColor,
      toolbar: computed(".editor-toolbar").display,
      nested: computed("[data-type=paragraph] [data-jul-editor-children]").marginLeft,
      codeDisplay: computed("[data-type=codeBlock]").display,
      codeDirection: computed("[data-type=codeBlock]").flexDirection,
      table: computed("[data-type=table]").display,
      row: computed("[data-type=tableRow]").display,
      cell: computed("[data-type=tableCell]").display,
      divider: computed("[data-type=divider] hr").borderTopStyle,
    };
    frame.remove();
    return result;
  }, css);
  expect(isolated).toEqual({
    background: "rgb(248, 245, 238)", toolbar: "flex", nested: "24px",
    codeDisplay: "flex", codeDirection: "column-reverse",
    table: "table", row: "table-row", cell: "table-cell", divider: "solid",
  });
  await page.getByRole("button", { name: "Copy React component" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("function ShowcaseEditor");
  const component = await page.evaluate(() => navigator.clipboard.readText());
  expect(component).toMatch(/^"use client";\nimport "\.\/theme\.css";/);
  expect(component).toContain('theme="custom" mode="full"');
  expect(ts.transpileModule(component, { fileName: "ThemeExample.tsx", compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  for (const feature of ["Editor.Toolbar", "BubbleTools", "AddBelow", "dropIndicatorRect", 'aria-live="polite"']) expect(component).toContain(feature);
  expect(component).toMatch(/\n\s*<Editor value=/);
});

test("docs switch fully between Korean and English, including chart instructions", async ({ page }) => {
  await page.goto("/docs/getting-started");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.goto("/docs/plugins/charts");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("차트");
  await page.locator(".docs-chart-grid button").last().click();
  await expect(page.locator('.docs-live-charts [data-jul-editor-chart-kind="radial"]')).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("mobile docs and showcase stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/docs/getting-started", "/showcase"]) {
    await page.goto(route);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});

test("the empty-block placeholder stays over the caret instead of pushing it right", async ({ page }) => {
  await page.goto("/");
  const content = page.locator("[data-id=intro-empty] [data-jul-editor-content]");
  await content.scrollIntoViewIfNeeded();
  await content.click();
  await expect(page.locator("[data-id=intro-empty]")).toHaveAttribute("data-jul-editor-focused", "");
  const metrics = await content.evaluate((element) => {
    const range = window.getSelection()!.getRangeAt(0).cloneRange();
    const placeholder = getComputedStyle(element, "::before");
    const placeholderWidth = parseFloat(placeholder.width);
    const position = placeholder.position;
    // A collapsed range before the empty block's <br> has no client rect in Chromium.
    const probe = document.createElement("span");
    probe.textContent = String.fromCharCode(8203);
    range.insertNode(probe);
    const caretLeft = probe.getBoundingClientRect().left;
    probe.remove();
    return { caretLeft, contentLeft: element.getBoundingClientRect().left, placeholderWidth, position };
  });
  expect(metrics.position).toBe("absolute");
  expect(metrics.placeholderWidth).toBeGreaterThan(50);
  expect(Math.abs(metrics.caretLeft - metrics.contentLeft)).toBeLessThan(3);
  expect(metrics.caretLeft).toBeLessThan(metrics.contentLeft + metrics.placeholderWidth * .2);
});

test("home full editor and Shadcn block controls keep language and theme settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-live .editor-toolbar")).toBeVisible();
  await page.locator("[data-id=intro-list] [data-jul-editor-content]").click();
  await page.locator("[data-id=intro-list]").hover();
  await expect(page.locator(".home-live .drag-handle")).toBeVisible();
  const intro = page.locator("[data-id=intro-lead] [data-jul-editor-content]");
  await intro.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Saved note.");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { name: /제품에 맞는 에디터를 직접 만드세요/ })).toBeVisible();
  await expect(page.locator("[data-id=intro-title]")).toContainText("출시 노트 초안");
  await page.getByRole("button", { name: "English" }).click();
  await expect(intro).toContainText("Saved note.");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByRole("button", { name: "라이트 테마로 전환" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/showcase");
  await expect(page.getByRole("heading", { name: "쇼케이스", level: 1 })).toBeVisible();
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-mode", "full");
  await expect(page.locator(".showcase-active .editor-toolbar")).toHaveCount(1);
  await expect.poll(() => page.locator(".showcase-active .editor-content").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect(page.locator("[data-id=x-title]")).toContainText("내 에디터 만들기");
  await page.locator("[data-id=x-list] [data-jul-editor-content]").click();
  await expect(page.locator(".showcase-active .drag-handle")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/showcase$/);
  await expect(page.getByRole("link", { name: "Demo" })).toHaveCount(0);
});
