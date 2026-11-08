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
