// Editing surface: beforeinput handling beyond the IME spike --
// cross-block delete/replace, list-item conversion, Shift+Enter, Cmd+Backspace,
// history merge/undo/redo, Mod+A. Uses the "/editor" page (createEditor).

import { expect, test } from "@playwright/test";
import { blockExists, blockType, getDoc, getSelection, textOf } from "./helpers/editor-doc.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("editing: insertText replaces a non-collapsed cross-block selection", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "q1", offset: 3 }, focus: { blockId: "li1", offset: 4 } }),
  );
  await page.keyboard.type("Z");

  const after = await getDoc(page);
  expect(textOf(after, "q1")).toBe("quoZnt item");
  expect(blockExists(after, "li1")).toBe(false);
});

test("editing: cross-block delete of a nested list range merges and drops the nested item", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "li1", offset: 6 }, focus: { blockId: "o1", offset: 1 } }),
  );
  await page.keyboard.press("Backspace");

  const after = await getDoc(page);
  expect(textOf(after, "li1")).toBe("parentne");
  expect(blockExists(after, "li1a")).toBe(false); // nested child was inside the removed subtree
  expect(blockExists(after, "o1")).toBe(false);
  expect(textOf(after, "o2")).toBe("two"); // untouched sibling
});

test("editing: Backspace at the start of a list item converts it to a paragraph, then merges", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("li1a", 0));

  await page.keyboard.press("Backspace");
  let after = await getDoc(page);
  expect(blockType(after, "li1a")).toBe("paragraph"); // converted, not yet merged
  expect(textOf(after, "li1a")).toBe("child item");
  expect(textOf(after, "li1")).toBe("parent item");

  await page.keyboard.press("Backspace");
  after = await getDoc(page);
  expect(blockExists(after, "li1a")).toBe(false);
  expect(textOf(after, "li1")).toBe("parent itemchild item");
});

test("editing: deleteContentForward at a block's end selects an adjacent void instead of merging into it", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((len) => window.__julEditor!.setCaret("o3", len), textOf(before, "o3").length);

  await page.keyboard.press("Delete");

  expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });
  const after = await getDoc(page);
  expect(textOf(after, "o3")).toBe("three"); // untouched
  expect(blockExists(after, "v1")).toBe(true);
});

test("editing: Cmd+Backspace (deleteSoftLineBackward) clears to the start of the line", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((len) => window.__julEditor!.setCaret("p1", len), textOf(before, "p1").length);

  await page.keyboard.press("Meta+Backspace");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("");
});

test("editing: Shift+Enter inserts a literal newline inside the block", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 5)); // "Hello| world"
  await page.keyboard.press("Shift+Enter");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("Hello\n world");
});

test("editing: a typing burst merges into one undo step (Cmd+Z reverts the whole burst)", async ({ page }) => {
  const before = await getDoc(page);
  const len = textOf(before, "p1").length;
  await page.evaluate((offset) => window.__julEditor!.setCaret("p1", offset), len);

  await page.keyboard.type("abc", { delay: 30 }); // well inside the 500ms merge window
  let after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "abc");

  await page.keyboard.press("Meta+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1")); // whole burst undone at once

  await page.keyboard.press("Meta+Shift+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "abc");
});

test("editing: Mod+A selects the current block's text, then (pressed again) the whole document", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 3));

  await page.keyboard.press("Meta+a");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 11 } });

  await page.keyboard.press("Meta+a");
  const sel = (await getSelection(page)) as { type: string; ids: string[] };
  expect(sel.type).toBe("block");
  expect(sel.ids).toEqual(["p1", "h1", "q1", "li1", "o1", "o2", "o3", "v1", "pEnd"]);
});
