// Adversarial gate A (real Chromium). Every test asserts the CORRECT behavior
// and is expected to FAIL on the current code.
import { expect, test } from "@playwright/test";
import { getDoc, textOf } from "../helpers/editor-doc.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("gate-A: Mod+B on a selected range shows <strong> in the DOM", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
  await page.keyboard.press("ControlOrMeta+b");
  const doc = await getDoc(page);
  expect(doc.blocks[0]!.content![0]).toEqual({ type: "text", text: "Hello", marks: [{ type: "bold" }] });
  await expect(page.locator('[data-id="p1"] strong')).toHaveText("Hello");
});

test("gate-A: Backspace after an emoji deletes the whole emoji", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("a\u{1F600}");
  expect(textOf(await getDoc(page), "pEnd")).toBe("a\u{1F600}");
  await page.keyboard.press("Backspace");
  expect(textOf(await getDoc(page), "pEnd")).toBe("a");
});

test("gate-A: Backspace after a ZWJ family emoji deletes the whole grapheme", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.insertText("a\u{1F468}‍\u{1F469}‍\u{1F467}");
  await page.keyboard.press("Backspace");
  expect(textOf(await getDoc(page), "pEnd")).toBe("a");
});

test("gate-A: after '---', clicking the divider and typing never stores text on the divider", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("---");
  // "---" converts instantly on the 3rd dash (Notion), no Enter needed
  let doc = await getDoc(page);
  expect(doc.blocks.find((b) => b.id === "pEnd")?.type).toBe("divider");
  await page.locator('[data-id="pEnd"]').click(); // target the divider itself (it has no content div)
  await page.keyboard.type("x");
  doc = await getDoc(page);
  expect(doc.blocks.find((b) => b.id === "pEnd")?.content).toBeUndefined();
});

test("gate-A: select all twice + Backspace, then typing still inserts text", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 2));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("new");
  const doc = await getDoc(page);
  expect(JSON.stringify(doc)).toContain("new");
});
