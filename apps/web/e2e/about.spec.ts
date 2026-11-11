import { expect, test } from "@playwright/test";

test("About compares native engines and renders measured data with the chart plugin", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: /A document, from first edit/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "About", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Lexical 0.52.0")).toBeVisible();
  await expect(page.getByText("ProseMirror 1.25/1.4/1.42")).toBeVisible();
  const swimlane = page.getByTestId("about-swimlane");
  const lanes = swimlane.getByRole("img", { name: "One keystroke in four editors" });
  await expect(lanes).toBeVisible();
  await expect(lanes.locator("rect.zone")).toHaveCount(4);
  await expect(lanes.locator("rect.bx")).toHaveCount(20);
  await expect(lanes.getByText("JulEditor", { exact: true })).toBeVisible();
  await expect(lanes.getByText("Like ProseMirror").first()).toBeAttached();
  await expect(lanes.getByText("Like Lexical").first()).toBeAttached();
  const sequence = page.getByTestId("about-walkthrough").getByRole("img", { name: "Typing the letter a in JulEditor" });
  await expect(sequence).toBeAttached();
  await expect(sequence.locator("line.lf")).toHaveCount(5);
  await expect(sequence.locator("text", { hasText: "replaceContent op" })).toBeAttached();
  await expect(page.getByTestId("about-walkthrough").locator(".docs-code").first().getByText("replaceContent")).toBeVisible();
  const overview = page.getByTestId("about-overview").getByRole("img", { name: "Similar, borrowed, different" });
  await expect(overview).toBeVisible();
  await expect(overview.getByText("Different", { exact: true })).toBeVisible();
  await expect(overview.locator("text", { hasText: "React-free core" })).toBeVisible();
  const charts = page.getByTestId("about-charts");
  await expect(charts.locator('[data-jul-editor-plugin="chart"]')).toHaveCount(2);
  await expect(charts.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(charts.locator("input, textarea, [contenteditable]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Delta" }).first()).toHaveAttribute("href", "https://quilljs.com/docs/delta");
});

test("About stays bilingual and scrolls tables inside a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/about");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "첫 편집부터 오래 남는 읽기 화면까지." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "세 가지 편집 엔진과 JulEditor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "글자 하나를 입력하면 무슨 일이 일어날까요?" })).toBeVisible();
  await expect(page.getByTestId("about-swimlane").getByRole("img", { name: /키 입력 하나/ })).toBeVisible();
  await expect(page.getByTestId("about-overview").locator("text:visible", { hasText: "다른 점" })).toBeVisible();
  await expect(page.getByTestId("about-charts").locator('[data-jul-editor-plugin="chart"]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("About prose, hero and diagram captions switch language from one MDX file per language", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: /A document, from first edit/ })).toBeVisible();
  await expect(page.getByTestId("about-swimlane").getByText("Read each lane from left to right.")).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "첫 편집부터 오래 남는 읽기 화면까지." })).toBeVisible();
  await expect(page.getByTestId("about-swimlane").getByText("각 줄을 왼쪽에서 오른쪽으로 읽으세요.")).toBeVisible();
  await expect(page.getByText("Three editing engines, then our approach")).toHaveCount(0);
});

test("browser Back restores About scroll position", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByTestId("about-charts")).toBeVisible();
  await page.getByTestId("about-charts").scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Playground" }).click();
  await expect(page.locator(".playground-workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.getByTestId("about-charts")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});

test("About keeps tables and charts within tablet widths and the code header above its sample", async ({ page }) => {
  for (const width of [768, 800, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/about");
    if (await page.getByRole("button", { name: "English" }).count()) await page.getByRole("button", { name: "English" }).click();
    for (const locale of ["en", "ko"]) {
      if (locale === "ko") await page.getByRole("button", { name: "한국어" }).click();
      await expect(page.getByTestId("about-charts").locator(".recharts-bar-rectangle").first()).toBeVisible();
      const boxes = await page.locator(".about-hero-model .docs-code").evaluate((el) => ({
        head: el.querySelector(".docs-code-head")!.getBoundingClientRect().bottom,
        code: el.querySelector("pre")!.getBoundingClientRect().top,
      }));
      expect(boxes.head).toBeLessThanOrEqual(boxes.code + 1);
      await expect.poll(() => page.locator(".about-hero-model pre").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      for (const chart of await page.locator(".about-bench-charts > section").all()) {
        await expect.poll(() => chart.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});

test("overflowing About tables can be scrolled with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/about");
  const wrapper = page.locator(".about-table-scroll").first();
  await expect.poll(() => wrapper.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  await expect(wrapper).toHaveAttribute("tabindex", "0");
  await wrapper.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => wrapper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => wrapper.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(wrapper.getByRole("table")).toBeVisible();
});
