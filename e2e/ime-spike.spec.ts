// IME spike gate (the highest-risk design point). Chromium
// only -- CDP's Input.imeSetComposition is Chromium-specific;
// Safari/Firefox get e2e:smoke (load-only) + e2e/ime-manual.md.

import { expect, test } from "@playwright/test";
import type { Doc } from "../packages/core/src/model/types.js";
import { cancelComposition, commitComposition, composeSteps, typeComposed } from "./helpers/ime.js";

declare global {
  interface Window {
    __julEditorSpike?: {
      getDoc: () => Doc;
      setCaret: (blockId: string, offset: number) => void;
    };
  }
}

async function getDoc(page: import("@playwright/test").Page): Promise<Doc> {
  return page.evaluate(() => window.__julEditorSpike!.getDoc());
}

function textOf(doc: Doc, blockId: string): string {
  const block = doc.blocks.find((b) => b.id === blockId);
  return (block?.content ?? []).map((inl) => (inl.type === "text" ? inl.text : inl.type === "mention" ? inl.attrs.label : "")).join("");
}

/** Model offset length (UTF-16 code units, a mention counts as exactly 1 --
 * see store/store.ts's contentLength) -- NOT the
 * same as textOf(...).length, which expands a mention to its display label. */
function modelLength(doc: Doc, blockId: string): number {
  const block = doc.blocks.find((b) => b.id === blockId);
  return (block?.content ?? []).reduce((n, inl) => n + (inl.type === "text" ? inl.text.length : 1), 0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/spike");
  await expect(page.getByTestId("page-spike")).toBeVisible();
});

test("ime-spike: 1. ASCII typing at the end of paragraph 1", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((len) => window.__julEditorSpike!.setCaret("p1", len), textOf(before, "p1").length);
  await page.keyboard.type("hello", { delay: 50 });

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("First paragraph.hello");
});

test("ime-spike: 2. Korean composition '한글' mid-paragraph, no duplication", async ({ page }) => {
  const before = await getDoc(page);
  const midOffset = "Second ".length; // right after "Second ", before "bold"
  await page.evaluate((offset) => window.__julEditorSpike!.setCaret("p2", offset), midOffset);

  await typeComposed(page, ["ㅎ", "하", "한", "한ㄱ", "한그", "한글"], "한글");

  const after = await getDoc(page);
  const text = textOf(after, "p2");
  expect(text).toBe(textOf(before, "p2").slice(0, midOffset) + "한글" + textOf(before, "p2").slice(midOffset));
  expect(text.match(/한글/g)?.length).toBe(1); // no duplication
});

test("ime-spike: 3. composition then immediately Enter -- split correct, no lost/duplicated syllable", async ({ page }) => {
  const before = await getDoc(page);
  const offset = "First paragraph.".length;
  await page.evaluate((o) => window.__julEditorSpike!.setCaret("p1", o), offset);

  await composeSteps(page, ["ㅎ", "하", "한"]);
  await commitComposition(page, "한"); // commit ...
  await page.keyboard.press("Enter"); // ...then immediately split, back-to-back

  const after = await getDoc(page);
  expect(after.blocks.length).toBe(before.blocks.length + 1);
  const p1Index = after.blocks.findIndex((b) => b.id === "p1");
  expect(textOf(after, "p1")).toBe("First paragraph.한");
  const nextBlock = after.blocks[p1Index + 1]!;
  const nextText = (nextBlock.content ?? []).map((inl) => (inl.type === "text" ? inl.text : "")).join("");
  expect(nextText).toBe(""); // the rest of p1 was empty, so the new block is empty
});

test("ime-spike: 4. composition at the start of an empty block", async ({ page }) => {
  await page.evaluate(() => window.__julEditorSpike!.setCaret("p4", 0));
  await typeComposed(page, ["ㅌ", "테", "테ㅅ", "테스", "테스트"], "테스트");

  const after = await getDoc(page);
  expect(textOf(after, "p4")).toBe("테스트");
});

test("ime-spike: 5. composition right after a mention span", async ({ page }) => {
  const before = await getDoc(page);
  const fullP2 = textOf(before, "p2"); // "...mentions @Alice." (mention expanded to its label here)
  // Model offset right after the mention, right before the trailing "." -- a
  // mention is exactly 1 unit in offset space, NOT its label's display length.
  const offset = modelLength(before, "p2") - 1;
  await page.evaluate((o) => window.__julEditorSpike!.setCaret("p2", o), offset);

  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  const mentionRun = after.blocks.find((b) => b.id === "p2")?.content?.find((inl) => inl.type === "mention");
  expect(mentionRun).toEqual({ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } }); // mention untouched
  expect(textOf(after, "p2")).toBe(fullP2.slice(0, -1) + "한" + fullP2.slice(-1)); // "...@Alice" + "한" + "."
});

test("ime-spike: 6. backspace after composition removes one syllable", async ({ page }) => {
  await page.evaluate(() => window.__julEditorSpike!.setCaret("p4", 0));
  await typeComposed(page, ["ㅎ", "하", "한", "한ㄱ", "한글"], "한글");
  await page.keyboard.press("Backspace");

  const after = await getDoc(page);
  expect(textOf(after, "p4")).toBe("한");
});

test("ime-spike: 7. an external mutation to a paragraph's content div is reverted", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-id="p3"] [data-jul-editor-content]')!;
    el.textContent = "HIJACKED";
  });
  await page.waitForTimeout(50); // let the MutationObserver callback run

  const contentText = await page.locator('[data-id="p3"] [data-jul-editor-content]').textContent();
  expect(contentText).toBe(textOf(before, "p3"));
  const after = await getDoc(page);
  expect(textOf(after, "p3")).toBe(textOf(before, "p3")); // model was never touched either
});

test("ime-spike: 8. typing inside a void block's own <input> never reaches the model", async ({ page }) => {
  const before = await getDoc(page);
  const input = page.getByTestId("void-input");
  await input.click();
  await page.keyboard.type("xyz", { delay: 30 });

  await expect(input).toHaveValue("xyz"); // the input itself still works
  const after = await getDoc(page);
  expect(after.blocks.find((b) => b.id === "v1")?.type).toBe("image"); // untouched
  expect(after).toEqual(before); // nothing in the model changed at all
});

test.afterEach(async ({ page }) => {
  await cancelComposition(page).catch(() => {}); // best-effort: don't leak an open composition into the next test
});
