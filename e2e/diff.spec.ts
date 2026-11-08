// <DiffView>/<DiffStats> ("/diff" playground route). Verifies the page
// loads, its rendered stats match @jul-editor/plugins/diff's own diffStats() for the
// exact same before/after docs, the "changes"-mode collapsed-run button
// expands, and the 5000-block doc renders in "changes" mode under 1000ms
// (a real, page-measured budget, not a hand-rolled counter).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Doc } from "../packages/core/src/model/types.js";
import { coreRegistry } from "../packages/core/src/index.js";
import { diffStats } from "../packages/plugins/src/diff/diff.js";
import { buildDiffDemoDocs } from "./fixtures/src/diff/build-demo-docs.js";

// Playwright's own test loader (plain Node ESM) doesn't accept a bare JSON
// import the way Vite's resolveJsonModule handling does -- read the fixture
// with fs instead of importing it (buildDiffDemoDocs.ts takes the parsed Doc
// as a parameter for exactly this reason, see its module doc comment).
function loadFixture(name: "doc-500.json" | "doc-5000.json"): Doc {
  const path = fileURLToPath(new URL(`../bench/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Doc;
}

declare global {
  interface Window {
    __julEditorDiff?: {
      renderMs: number;
      stats: { inserted: number; deleted: number; modified: number; moved: number; unchanged: number };
    };
  }
}

test("diff: the /diff page loads with a diff view", async ({ page }) => {
  await page.goto("/diff");
  await expect(page.getByTestId("page-diff")).toBeVisible();
  await expect(page.locator("[data-jul-editor-diff-view]")).toBeVisible();
  await expect(page.locator("[data-jul-editor-diff-block]").first()).toBeVisible();
});

test("diff: rendered stats match @jul-editor/plugins/diff's own diffStats for the same docs", async ({ page }) => {
  await page.goto("/diff");
  await page.waitForFunction(() => window.__julEditorDiff !== undefined);

  const { before, after } = buildDiffDemoDocs(loadFixture("doc-500.json"), 500);
  const expected = diffStats(before, after, coreRegistry);

  const actual = await page.evaluate(() => window.__julEditorDiff!.stats);
  expect(actual).toEqual(expected);

  for (const [key, value] of Object.entries(expected)) {
    await expect(page.locator(`[data-diff-stat="${key}"]`)).toHaveText(String(value));
  }
  // The demo mutation is built to exercise every scenario (text edit, format change, move, insert, delete) --
  // sanity-check none of the required categories silently ended up empty.
  expect(expected.inserted).toBeGreaterThan(0);
  expect(expected.deleted).toBeGreaterThan(0);
  expect(expected.modified).toBeGreaterThan(0);
  expect(expected.moved).toBeGreaterThan(0);
});

test("diff: a collapsed run of unchanged blocks expands on click", async ({ page }) => {
  await page.goto("/diff");
  const buttonsBefore = await page.locator("button[data-diff-collapsed]").count();
  expect(buttonsBefore).toBeGreaterThan(0);

  const first = page.locator("button[data-diff-collapsed]").first();
  const label = (await first.textContent()) ?? "";
  const n = Number(label.match(/\d+/)?.[0] ?? "0");
  expect(n).toBeGreaterThan(0);

  const blocksBefore = await page.locator("[data-jul-editor-diff-block]").count();
  await first.click();
  const blocksAfter = await page.locator("[data-jul-editor-diff-block]").count();
  const buttonsAfter = await page.locator("button[data-diff-collapsed]").count();

  expect(buttonsAfter).toBe(buttonsBefore - 1);
  expect(blocksAfter).toBe(blocksBefore + n);
});

test("diff: a 5000-block doc renders in 'changes' mode under 1000ms", async ({ page }) => {
  await page.goto("/diff?doc=5000");
  await expect(page.getByTestId("page-diff")).toBeVisible();
  await page.waitForFunction(() => window.__julEditorDiff !== undefined);

  const modeValue = await page.locator("[data-testid=diff-mode]").inputValue();
  expect(modeValue).toBe("changes"); // default -- this is the mode the budget applies to

  const ms = await page.evaluate(() => window.__julEditorDiff!.renderMs);
  expect(ms).toBeLessThan(1000);
});
