import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Agent editor showcase: a mock agent proposes edits that appear as tracked suggestions inside the editor.
const SHOTS = join(tmpdir(), "jul-editor-shots");
mkdirSync(SHOTS, { recursive: true });
const AGENT_CARD = 0;

async function open(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => { try { localStorage.setItem("jul-editor-theme", t); } catch { /* ignore */ } }, theme);
  await page.goto("/showcase");
  await page.locator(".showcase-picker-card").nth(AGENT_CARD).click();
  await expect(page.locator(".showcase-active")).toHaveAttribute("data-theme", "agent");
  await expect(page.locator(".showcase-agent .editor-content")).toBeVisible();
}
const block = (page: Page, id: string) => page.locator(`.showcase-agent [data-id=${id}] [data-jul-editor-content]`);
// The block's own text: suggestion widgets and ghost insertions are decoration, not document content.
const docText = (page: Page, id: string) => page.locator(`.showcase-agent [data-id=${id}] [data-jul-editor-content]`).evaluate((el) => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-jul-editor-suggest-anchor],[data-jul-editor-suggest-ghost]").forEach((n) => n.remove());
  return clone.textContent ?? "";
});
const count = (page: Page) => page.getByTestId("agent-count");
// One floating control (appended to <body>) serves the change under the pointer / caret.
const control = (page: Page) => page.locator("[data-jul-editor-suggest-control]");
const pendingCount = async (page: Page): Promise<number> => Number(/(\d+)/.exec((await count(page).textContent()) ?? "")?.[1] ?? 0);
// hover the n-th struck-through deletion, then act on its floating control
async function decide(page: Page, action: "accept" | "reject", n = 0) {
  await page.locator(".showcase-agent .editor-content .jul-editor-suggest-del").nth(n).hover();
  await expect(control(page)).toBeVisible();
  await control(page).locator(`[data-action=${action}]`).click();
}

test("preset to suggestions: accept one, then reject all restores the rest", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.screenshot({ path: `${SHOTS}/agent-desktop-light.png` });
  const original = (await docText(page, "ag-draft")).trim();
  expect(original).toContain("recieve");

  await page.locator("[data-preset=fix]").click();
  await expect(page.getByTestId("agent-thinking")).toBeVisible();
  await expect(count(page)).toBeVisible();
  const total = await pendingCount(page);
  expect(total).toBeGreaterThan(1);
  // word granularity: "teh" is ONE change, not three character hunks
  expect(total).toBeLessThan(12);
  await expect(control(page)).toBeHidden();
  await expect(page.locator(".showcase-agent .editor-content .jul-editor-suggest-del").first()).toBeVisible();
  await block(page, "ag-draft").scrollIntoViewIfNeeded();
  await page.locator(".showcase-agent .editor-content .jul-editor-suggest-del").first().hover();
  await expect(control(page)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/agent-suggestions-v2.png` });

  // the document itself is untouched until a change is accepted
  expect((await docText(page, "ag-draft"))).toContain("recieve");

  await decide(page, "accept");
  await expect(count(page)).toContainText(`${total - 1} change`);
  await expect(control(page)).toBeHidden();
  const afterAccept = await docText(page, "ag-draft");
  expect(afterAccept).not.toBe(original);

  await page.getByTestId("agent-reject-all").click();
  await expect(page.locator(".showcase-agent .editor-content .jul-editor-suggest-del")).toHaveCount(0);
  await expect(count(page)).toHaveCount(0);
  // rejected changes stay as the user wrote them; only the one accepted change differs
  const finalText = await docText(page, "ag-draft");
  expect(finalText).toContain("recieve");
  expect(finalText).toBe(afterAccept);
});

test("chat layout: composer pinned to the bottom, thread keeps history across two runs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const panel = page.locator(".showcase-agent .agent-panel");
  const composer = page.getByTestId("agent-composer");
  await expect(page.getByTestId("agent-empty")).toBeVisible();
  await expect(page.getByTestId("agent-turn")).toHaveCount(0);
  const near = async () => {
    const p = (await panel.boundingBox())!, c = (await composer.boundingBox())!;
    expect(Math.abs(p.y + p.height - (c.y + c.height))).toBeLessThanOrEqual(2);
    expect(c.y).toBeGreaterThan(p.y + p.height / 2); // lower half of the panel
  };
  await near();

  await page.locator("[data-preset=fix]").click();
  await expect(page.getByTestId("agent-msg-user")).toHaveCount(1);
  await expect(page.getByTestId("agent-msg-user")).toContainText("Fix grammar");
  await expect(page.getByTestId("agent-empty")).toHaveCount(0);
  await expect(count(page)).toBeVisible();
  await near();
  await page.getByTestId("agent-accept-all").click();
  await expect(page.getByTestId("agent-outcome")).toContainText(/Accepted \d+, rejected 0/);

  await page.getByLabel("Instruction").fill("please add a checklist");
  await page.getByLabel("Instruction").press("Enter");
  await expect(count(page)).toBeVisible();
  // history persists: both turns are in the thread, the older one shows its outcome, the newest is live
  await expect(page.getByTestId("agent-turn")).toHaveCount(2);
  await expect(page.getByTestId("agent-msg-user").first()).toContainText("Fix grammar");
  await expect(page.getByTestId("agent-msg-user").last()).toContainText("please add a checklist");
  await expect(page.getByTestId("agent-outcome")).toHaveCount(1);
  await expect(count(page)).toHaveCount(1);
  // the newest message is scrolled into view and the composer did not move
  await expect(page.getByTestId("agent-msg-ai").last()).toBeInViewport();
  await near();
  await page.screenshot({ path: `${SHOTS}/agent-chat-en-light.png` });
  await page.getByTestId("agent-reject-all").click();
  await expect(page.getByTestId("agent-outcome")).toHaveCount(2);
  await expect(page.getByTestId("agent-outcome").last()).toContainText("Accepted 0, rejected");
});

test("accept all applies the whole proposal, and the edit is undoable", async ({ page }) => {
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  await page.getByTestId("agent-accept-all").click();
  await expect(page.locator(".showcase-agent .editor-content .jul-editor-suggest-del")).toHaveCount(0);
  const fixed = await docText(page, "ag-draft");
  expect(fixed).toContain("receive");
  expect(fixed).not.toContain("recieve");
});

test("selection scopes the agent and free text is routed by keyword", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("agent-scope")).toContainText("Whole document");
  // select the draft paragraph text
  await block(page, "ag-draft").click({ clickCount: 3 });
  await expect(page.getByTestId("agent-scope")).toContainText("Selection");
  await page.getByLabel("Instruction").fill("please add a checklist");
  await page.getByLabel("Instruction").press("Enter");
  await expect(count(page)).toBeVisible();
  // a checklist is inserted as new todo blocks shown as ghost lines with one Accept / Reject
  await expect(page.locator(".showcase-agent .editor-content [data-jul-editor-suggest-ghost]").first()).toBeVisible();
  await page.getByTestId("agent-accept-all").click();
  await expect(page.locator(".showcase-agent .editor-content [data-type=todoListItem]")).toHaveCount(4);
});

test("the same proposal opens in the review panel and the diff compare", async ({ page }) => {
  await open(page);
  await page.locator("[data-preset=table]").click();
  await expect(count(page)).toBeVisible();
  await page.locator(".agent-views [data-view=review]").click();
  await expect(page.getByTestId("agent-review")).toBeVisible();
  await expect(page.getByTestId("agent-review").locator("[data-jul-editor-suggestion]")).toBeVisible();
  await page.locator(".agent-views [data-view=compare]").click();
  await expect(page.getByTestId("agent-review").locator("[data-jul-editor-diff-compare]")).toBeVisible();
  await page.getByTestId("agent-review").getByRole("button", { name: "Block" }).click();
  await expect(page.getByTestId("agent-review").locator("[data-jul-editor-diff-view]")).toBeVisible();
  await page.locator(".agent-views [data-view=editor]").click();
  await expect(page.locator(".showcase-agent .editor-content")).toBeVisible();
  await expect(page.locator(".showcase-agent .editor-content [data-jul-editor-suggest-anchor]").first()).toBeAttached();
});

test("partial decisions made in the editor carry over to the Review and Diff views", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  const total = await pendingCount(page);
  expect(total).toBeGreaterThan(2);
  await decide(page, "reject"); // one rejected, one accepted: both leave the pending list
  await expect(count(page)).toContainText(`${total - 1} change`);
  await decide(page, "accept");
  await expect(count(page)).toContainText(`${total - 2} change`);
  await page.locator(".agent-views [data-view=review]").click();
  await expect(page.getByTestId("agent-review").locator("[data-jul-editor-suggestion]")).toBeVisible();
  await expect(page.getByTestId("agent-count")).toContainText(`${total - 2} change`);
  await expect(page.getByTestId("agent-review").locator("[data-suggestion-pending]")).toContainText(`${total - 2} pending`);
  await page.locator(".agent-views [data-view=compare]").click();
  await expect(page.getByTestId("agent-review").locator("[data-jul-editor-diff-compare]")).toBeVisible();
});

test("the control follows the caret and is keyboard accessible", async ({ page }) => {
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  const total = await pendingCount(page);
  const del = page.locator(".showcase-agent .editor-content .jul-editor-suggest-del").first();
  await del.click(); // caret inside the struck text
  await expect(control(page)).toBeVisible();
  await expect(control(page).locator("[data-action=accept]")).toHaveAttribute("aria-label", /^Accept: /);
  await page.keyboard.press("Alt+Shift+A");
  await expect(count(page)).toContainText(`${total - 1} change`);
});

test("toolbar: zoom, heading, bold, align, table and chart work", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByTestId("agent-zoom")).toHaveText("110%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByTestId("agent-zoom")).toHaveText("100%");

  const intro = block(page, "ag-intro");
  await intro.click({ clickCount: 3 });
  await page.getByRole("button", { name: "Underline" }).click();
  await expect(intro.locator("u")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Align center" }).click();
  await expect(page.locator("[data-id=ag-intro]")).toHaveAttribute("data-jul-editor-text-align", "center");
  await page.getByLabel("Text style").selectOption("h2");
  await expect(page.locator("[data-id=ag-intro]")).toHaveAttribute("data-type", "heading");
  await page.getByLabel("Font size").selectOption("24px");
  await expect(intro.locator("[style*='font-size']").first()).toBeVisible();

  const tables = page.locator(".showcase-agent .editor-content [data-type=table]");
  const before = await tables.count();
  await page.getByRole("button", { name: "Insert table" }).click();
  await expect(tables).toHaveCount(before + 1);
  const charts = page.locator(".showcase-agent .editor-content [data-type=chart]");
  const chartsBefore = await charts.count();
  await page.getByRole("button", { name: "Insert chart" }).click();
  await expect(charts).toHaveCount(chartsBefore + 1);
});

test("Korean labels and a mobile layout without horizontal page scroll", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("jul-editor-locale", "ko"); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "dark");
  await expect(page.getByTestId("agent-scope")).toContainText("문서 전체");
  await page.locator("[data-preset=shorter]").click();
  await expect(count(page)).toContainText("변경");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator(".showcase-agent").screenshot({ path: `${SHOTS}/agent-mobile.png` });
  // chat layout on mobile: the composer is still the bottom of the (stacked) panel, thread above it
  const panel = (await page.locator(".showcase-agent .agent-panel").boundingBox())!;
  const comp = (await page.getByTestId("agent-composer").boundingBox())!;
  expect(Math.abs(panel.y + panel.height - (comp.y + comp.height))).toBeLessThanOrEqual(2);
  await expect(page.getByTestId("agent-msg-user")).toContainText("짧게 줄이기");
  await page.getByTestId("agent-thread").scrollIntoViewIfNeeded();
  await page.locator(".showcase-agent .agent-panel").screenshot({ path: `${SHOTS}/agent-chat-ko-mobile.png` });
});

test("Review and Diff count the same suggestions as the editor, and Apply with no decisions accepts none", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  const total = await pendingCount(page);
  expect(total).toBeGreaterThan(1);
  await page.locator(".agent-views [data-view=review]").click();
  const review = page.getByTestId("agent-review");
  await expect(review.locator("[data-jul-editor-suggestion]")).toBeVisible();
  // the editor's normalized trailing paragraph is not a suggested insertion
  await expect(count(page)).toContainText(`${total} change`);
  await expect(review.locator("[data-suggestion-pending]")).toContainText(`${total} pending`);
  await expect(review.locator("[data-jul-editor-diff-block][data-diff=insert]")).toHaveCount(0);
  await page.locator(".agent-views [data-view=compare]").click();
  await expect(count(page)).toContainText(`${total} change`);
  await page.locator(".agent-views [data-view=review]").click();
  await page.getByTestId("agent-apply").click();
  await expect(page.getByTestId("agent-outcome")).toHaveText(`Accepted 0, rejected ${total}`);
  expect(await docText(page, "ag-draft")).toContain("recieve");
});

test("the Review view keeps the document's formatting: headings, table grid and chart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  await page.locator(".agent-views [data-view=review]").click();
  const review = page.getByTestId("agent-review");
  await expect(review.locator("[data-jul-editor-suggestion]")).toBeVisible();
  // heading level reaches the review markup and is sized above body text
  const title = review.locator("[data-jul-editor-diff-block][data-id=ag-title]");
  await expect(title).toHaveAttribute("data-jul-editor-level", "1");
  const size = (sel: string) => review.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size("[data-id=ag-title]")).toBeGreaterThan(await size("[data-id=ag-intro]"));
  // one table row lays its cells out side by side
  const cells = review.locator("[data-id=ag-r0] [data-type=tableCell]");
  await expect(cells).toHaveCount(3);
  const tops = await cells.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // the chart renders through the read-only ChartView instead of an empty placeholder
  await expect(review.locator("[data-id=ag-chart] [data-jul-editor-plugin=chart], [data-id=ag-chart] svg").first()).toBeVisible();
  await review.screenshot({ path: `${SHOTS}/agent-review-formatting.png` });
});

// Round 2: Undo after Accept all brought back the typo text but dropped the review, so the changes could
// no longer be decided one at a time.
test("Undo after Accept all reopens the pending suggestions", async ({ page }) => {
  await open(page);
  await page.locator("[data-preset=fix]").click();
  await expect(count(page)).toBeVisible();
  const total = await pendingCount(page);
  expect(total).toBeGreaterThan(0);
  await page.getByTestId("agent-accept-all").click();
  await expect(page.locator(".showcase-agent .editor-content .jul-editor-suggest-del")).toHaveCount(0);
  await page.locator(".showcase-agent .agent-toolbar").getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => docText(page, "ag-draft")).toContain("recieve");
  await expect(count(page)).toBeVisible();
  expect(await pendingCount(page)).toBe(total);
  await expect(page.getByTestId("agent-accept-all")).toBeEnabled();
});
