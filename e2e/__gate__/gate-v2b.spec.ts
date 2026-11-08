// Adversarial gate: real-browser repros on the "/react" page
// (ReactDemo: codeBlock chrome from createCodeBlockRenderer on `r-code1`,
// which sits right after the empty paragraph `r-p2`).
import { expect, test } from "@playwright/test";

interface B {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: { text?: string }[];
  children?: B[];
}
declare global {
  interface Window {
    __julEditorReact?: { getDoc: () => unknown; setCaret: (blockId: string, offset: number) => void };
  }
}
const doc = async (page: import("@playwright/test").Page) => (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: B[] };

test.beforeEach(async ({ page }) => {
  await page.goto("/react");
  await expect(page.getByTestId("page-react")).toBeVisible();
  await expect(page.locator('[data-id="r-code1"] [data-jul-editor-code-chrome] select')).toBeVisible();
});

test("gate-v2B: E1 Tab on the focused code-language select moves focus on; it must not indent the code block", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-code1", 0));
  const select = page.locator('[data-id="r-code1"] [data-jul-editor-code-chrome] select');
  await select.focus();
  await page.keyboard.press("Tab");
  const blocks = (await doc(page)).blocks;
  expect(blocks.map((b) => b.id)).toContain("r-code1"); // observed: r-code1 nested under r-p2
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-jul-editor-code-copy") !== null && document.activeElement?.tagName === "BUTTON");
  expect(focused).toBe(true);
});

test("gate-v2B: E2 Tab on the focused select while the caret is in ANOTHER block leaves that block alone", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-h1", 1));
  await page.locator('[data-id="r-code1"] [data-jul-editor-code-chrome] select').focus();
  await page.keyboard.press("Tab");
  const blocks = (await doc(page)).blocks;
  expect(blocks.map((b) => b.id)).toContain("r-h1"); // observed: r-h1 indented under r-p1
});
