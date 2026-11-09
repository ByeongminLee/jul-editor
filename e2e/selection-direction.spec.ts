// Regressions from the editor audit (round 1, batch 1):
//  - a mark toggle that only MOVES run boundaries must re-render at once
//    (it used to look like Bold did nothing, then the bold "grew" on the
//    next keystroke);
//  - a right-to-left (backward) selection must behave exactly like the same
//    left-to-right one for toggleMark, Backspace and typing over it
//    (toggleMark used to DUPLICATE the selected text);
//  - IME composition in an empty block must keep DOM and model in sync.
// Uses the "/editor" page (createEditor).

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getDoc, textOf } from "./helpers/editor-doc.js";
import { cancelComposition, typeComposed } from "./helpers/ime.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

function contentHtml(page: Page, blockId: string): Promise<string> {
  return page.evaluate((id) => document.querySelector(`[data-id="${id}"] [data-jul-editor-content]`)!.innerHTML, blockId);
}

function setSel(page: Page, blockId: string, anchor: number, focus: number): Promise<void> {
  return page.evaluate(
    ({ blockId, anchor, focus }) => {
      document.querySelector<HTMLElement>("[data-jul-editor-root]")?.focus();
      window.__julEditor!.setSelection({ type: "text", anchor: { blockId, offset: anchor }, focus: { blockId, offset: focus } });
    },
    { blockId, anchor, focus },
  );
}

/** Viewport point of a character offset inside a block's (single) text node. */
async function charPoint(page: Page, blockId: string, offset: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ blockId, offset }) => {
      const content = document.querySelector(`[data-id="${blockId}"] [data-jul-editor-content]`)!;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let left = offset;
      let node = walker.nextNode() as Text | null;
      while (node && left > node.data.length) {
        left -= node.data.length;
        node = walker.nextNode() as Text | null;
      }
      const range = document.createRange();
      range.setStart(node!, left);
      range.collapse(true);
      const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2 };
    },
    { blockId, offset },
  );
}

test("selection-direction: a boundary-only bold change re-renders immediately, and undo/redo too", async ({ page }) => {
  await setSel(page, "p1", 6, 11); // "world"
  await page.keyboard.press("ControlOrMeta+b");
  expect(await contentHtml(page, "p1")).toBe("Hello <strong>world</strong>");

  await setSel(page, "p1", 2, 8); // "llo wo" -- overlaps the start of the bold run
  await page.keyboard.press("ControlOrMeta+b");
  expect(await contentHtml(page, "p1")).toBe("He<strong>llo world</strong>");

  await page.keyboard.press("ControlOrMeta+z");
  expect(await contentHtml(page, "p1")).toBe("Hello <strong>world</strong>");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await contentHtml(page, "p1")).toBe("He<strong>llo world</strong>");

  // partial unbold inside the bold run keeps DOM == model
  await setSel(page, "p1", 8, 11); // "rld"
  await page.keyboard.press("ControlOrMeta+b");
  expect(await contentHtml(page, "p1")).toBe("He<strong>llo wo</strong>rld");
});

async function dragBackward(page: Page, blockId: string, fromOffset: number, toOffset: number): Promise<void> {
  const from = await charPoint(page, blockId, fromOffset);
  const to = await charPoint(page, blockId, toOffset);
  await page.mouse.move(from.x + 1, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("selection-direction: right-to-left mouse drag then Bold formats instead of duplicating", async ({ page }) => {
  await dragBackward(page, "p1", 11, 6);
  await page.keyboard.press("ControlOrMeta+b");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("Hello world");
  expect(await contentHtml(page, "p1")).toBe("Hello <strong>world</strong>");
});

for (const key of ["Backspace", "Delete", "ControlOrMeta+x"]) {
  test(`selection-direction: ${key} over a right-to-left drag leaves the caret where the text was`, async ({ page }) => {
    await dragBackward(page, "p1", 8, 2); // "llo wo"
    await page.keyboard.press(key);
    await page.keyboard.type("Z");
    expect(textOf(await getDoc(page), "p1")).toBe("HeZrld");
  });
}

test("selection-direction: IME composition in an empty block stays in sync with later typing", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("[data-jul-editor-root]")?.focus();
    window.__julEditor!.setCaret("pEnd", 0);
  });
  try {
    await typeComposed(page, ["ㅎ", "하"], "한");
    await page.keyboard.type("ab");
    await page.keyboard.type("cd");
  } finally {
    await cancelComposition(page).catch(() => {});
  }
  expect(textOf(await getDoc(page), "pEnd")).toBe("한abcd");
  const domText = await page.evaluate(() => document.querySelector(`[data-id="pEnd"] [data-jul-editor-content]`)!.textContent);
  expect(domText).toBe("한abcd");
});
