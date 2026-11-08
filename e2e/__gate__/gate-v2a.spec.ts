// Adversarial gate (real Chromium). Every test asserts the CORRECT
// behavior and is expected to FAIL on the current code. Driven through "/editor"'s window.__julEditor.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getDoc, textOf } from "../helpers/editor-doc.js";

type AnyEditor = {
  setDoc(doc: unknown): void;
  getDoc(): { blocks: { id: string; type: string; props: Record<string, unknown>; children?: { id: string }[] }[] };
  update(build: (tx: Record<string, (...a: unknown[]) => unknown>) => unknown): void;
  registerHighlighter(h: { highlight(code: string, lang: string): { from: number; to: number; token: string }[] }): () => void;
  commands: Record<string, (...a: unknown[]) => void>;
};
const ed = "(window.__julEditor.editor)";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

/** Texts of every jul-editor-keyword Range that lives inside the editor root. */
async function keywordTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights.get("jul-editor-keyword");
    const root = document.querySelector("[data-jul-editor-root]") ?? document.body;
    return h ? Array.from(h).filter((r) => root.contains(r.startContainer)).map((r) => r.toString()) : [];
  });
}

async function installWholeKeywordHighlighter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    e.registerHighlighter({ highlight: (code: string) => (code.length ? [{ from: 0, to: code.length, token: "keyword" }] : []) });
  });
}

test("gate-v2A: '# ' typed on the second line (after Shift+Enter) keeps the first line's text", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("foo");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("# ");
  const doc = await getDoc(page);
  expect(textOf(doc, "pEnd")).toContain("foo");
});

test("gate-v2A: a slash-menu style empty codeBlock keeps 'npm install' (Space never steals the first word as the language)", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.evaluate(() => (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor.commands.setBlockType!("codeBlock"));
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("npm install");
  const doc = await getDoc(page);
  expect(textOf(doc, "pEnd")).toBe("npm install");
});

test("gate-v2A: setDoc with a codeBlock gets syntax-highlighted (CSS.highlights)", async ({ page }) => {
  await installWholeKeywordHighlighter(page);
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    e.setDoc({ version: 1, blocks: [{ id: "c1", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const x = 1" }] }, { id: "p", type: "paragraph", props: {}, content: [] }] });
  });
  await page.waitForTimeout(300);
  expect(await keywordTexts(page)).toEqual(["const x = 1"]);
});

test("gate-v2A: turning a highlighted codeBlock into a paragraph removes its highlight", async ({ page }) => {
  await installWholeKeywordHighlighter(page);
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    e.update((tx) => tx.insertBlock!(null, 0, { id: "c1", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const x" }] }));
  });
  await expect.poll(() => keywordTexts(page)).toEqual(["const x"]);
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    e.update((tx) => tx.setType!("c1", "paragraph"));
  });
  await page.waitForTimeout(300);
  expect(await keywordTexts(page)).toEqual([]);
});

test("gate-v2A: IME composition inside a codeBlock is re-highlighted after it ends", async ({ page }) => {
  await installWholeKeywordHighlighter(page);
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    e.update((tx) => tx.insertBlock!(null, 0, { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "ab" }] }));
  });
  await expect.poll(() => keywordTexts(page)).toEqual(["ab"]);
  await page.evaluate(() => window.__julEditor!.setCaret("c1", 2));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(200); // composition outlasts the 50ms debounce
  await cdp.send("Input.insertText", { text: "한" });
  await page.waitForTimeout(300);
  expect(textOf(await getDoc(page), "c1")).toBe("ab한");
  expect(await keywordTexts(page)).toEqual(["ab한"]);
});

test("gate-v2A: a merged table survives setDoc(getDoc()) without phantom cells", async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    const c = (id: string, text: string) => ({ id, type: "tableCell", props: {}, content: text ? [{ type: "text", text }] : [] });
    e.setDoc({ version: 1, blocks: [{ id: "t", type: "table", props: {}, children: [{ id: "r0", type: "tableRow", props: {}, children: [c("A", "a"), c("A2", ""), c("B", "b")] }, { id: "r1", type: "tableRow", props: {}, children: [c("C", "c"), c("D", "d"), c("E", "e")] }] }, { id: "p", type: "paragraph", props: {}, content: [] }] });
    e.update((tx) => tx.mergeCells!("t", 0, 0, 0, 1));
    e.setDoc(e.getDoc()); // e.g. save + reload
  });
  const doc = await getDoc(page);
  const r0 = (doc.blocks[0] as unknown as { children: { id: string; children: unknown[] }[] }).children[0]!;
  expect(r0.children.length).toBe(2); // A(colspan 2) + B, no padding cell
});

test("gate-v2A: Shift+ArrowRight then Backspace next to a merged cell clears the two selected cells", async ({ page }) => {
  await page.evaluate(() => {
    const e = (window as unknown as { __julEditor: { editor: AnyEditor } }).__julEditor.editor;
    const c = (id: string, text: string) => ({ id, type: "tableCell", props: {}, content: text ? [{ type: "text", text }] : [] });
    e.setDoc({ version: 1, blocks: [{ id: "t", type: "table", props: {}, children: [{ id: "r0", type: "tableRow", props: {}, children: [c("A", "a"), c("A2", ""), c("B", "b"), c("F", "f")] }, { id: "r1", type: "tableRow", props: {}, children: [c("C", "c"), c("D", "d"), c("E", "e"), c("G", "g")] }] }, { id: "p", type: "paragraph", props: {}, content: [] }] });
    e.update((tx) => tx.mergeCells!("t", 0, 0, 0, 1));
  });
  await page.evaluate(() => window.__julEditor!.setCaret("B", 1));
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Backspace");
  const doc = await getDoc(page);
  expect(textOf(doc, "B")).toBe("");
  expect(textOf(doc, "F")).toBe("");
});
