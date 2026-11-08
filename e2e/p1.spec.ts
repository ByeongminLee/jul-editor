// Input rules/marks/placeholder on the
// "/editor" page (createEditor, e2e/helpers/editor-doc.ts), and the new React
// hooks/atoms (useTurnInto/useLinkEditor/useColorPicker/drag-handle "+") on
// the "/react" page (react-demo.tsx). Every test title contains "p1:".

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { blockProps, blockType, getDoc, textOf } from "./helpers/editor-doc.js";
import { commitComposition, composeSteps } from "./helpers/ime.js";

test.describe("p1: input rules + marks (/editor)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByTestId("page-editor")).toBeVisible();
  });

  test("p1: '```' converts to codeBlock instantly, '```ts' + space sets the language", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type("```", { delay: 10 });
    let after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("codeBlock"); // instant -- no trailing space/Enter needed
    expect(textOf(after, "pEnd")).toBe("");

    await page.keyboard.type("ts", { delay: 10 });
    await page.keyboard.press("Space");
    after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("codeBlock");
    expect((blockProps(after, "pEnd") as { language?: string }).language).toBe("ts");
    expect(textOf(after, "pEnd")).toBe(""); // the lang token was consumed, not left as code content
  });

  // Verifies the pre-existing codeBlock.keymap.Enter handler
  // (builtins-keymap.ts) still sets the language from a typed "```lang" +
  // Enter -- a separate mechanism from the input-rule phases
  // (codeBlock's content:'code' never runs input
  // rules at all; this fires on the keydown regardless).
  test("p1: '```rust' + Enter (not Space) also sets the language", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type("```rust", { delay: 10 });
    await page.keyboard.press("Enter");
    const after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("codeBlock");
    expect((blockProps(after, "pEnd") as { language?: string }).language).toBe("rust");
    expect(textOf(after, "pEnd")).toBe(""); // the lang token was consumed, and Enter did NOT also insert a newline
  });

  test("p1: '#### ' makes an H4 (heading levels widened to 1-6)", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type("#### Deep heading", { delay: 10 });
    const after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("heading");
    expect((blockProps(after, "pEnd") as { level: number }).level).toBe(4);
    expect(textOf(after, "pEnd")).toBe("Deep heading");
  });

  test("p1: '***' converts to a divider instantly (no Enter needed), same as '---'", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type("***", { delay: 10 });
    const after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("divider");
  });

  test("p1: autolink on type -- a URL then a space wraps it in a link mark, the space stays literal", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type("see https://example.com and more", { delay: 10 });
    const after = await getDoc(page);
    const content = after.blocks.find((b) => b.id === "pEnd")!.content!;
    const linked = content.find((inl) => inl.type === "text" && (inl as { text: string }).text === "https://example.com") as { marks?: { type: string; attrs?: Record<string, unknown> }[] } | undefined;
    expect(linked?.marks?.[0]).toEqual({ type: "link", attrs: { href: "https://example.com" } });
    expect(textOf(after, "pEnd")).toBe("see https://example.com and more");
  });

  test("p1: Mod+U toggles the underline mark, rendered as a real <u> in the DOM", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("p1", 0));
    await page.evaluate(() => window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
    await page.keyboard.press("ControlOrMeta+u");
    const after = await getDoc(page);
    const content = after.blocks.find((b) => b.id === "p1")!.content!;
    expect(content[0]).toMatchObject({ marks: [{ type: "underline" }] });
    await expect(page.locator(`[data-id="p1"] u`)).toHaveText("Hello");
  });

  test("p1: data-jul-editor-empty / data-jul-editor-focused toggle on the real editor DOM", async ({ page }) => {
    const pEnd = page.locator(`[data-jul-editor-block][data-id="pEnd"]`);
    await expect(pEnd).toHaveAttribute("data-jul-editor-empty", "");
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await expect(pEnd).toHaveAttribute("data-jul-editor-focused", "");
    await expect(page.locator(`[data-jul-editor-block][data-id="p1"]`)).not.toHaveAttribute("data-jul-editor-focused", "");

    await page.keyboard.type("x", { delay: 10 });
    await expect(pEnd).not.toHaveAttribute("data-jul-editor-empty", "");
  });

  test("p1: Korean IME composing '```' does not trigger the codeBlock rule; real ASCII typing afterward still works", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await composeSteps(page, ["`", "``", "```"]);
    await commitComposition(page, "```");
    let after = await getDoc(page);
    // Composed text never runs input rules at all (same guarantee IME's own
    // "composition inside a codeBlock" test relies on) -- still a paragraph,
    // holding the composed backticks as literal text.
    expect(blockType(after, "pEnd")).toBe("paragraph");
    expect(textOf(after, "pEnd")).toBe("```");

    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("```", { delay: 10 });
    after = await getDoc(page);
    expect(blockType(after, "pEnd")).toBe("codeBlock"); // real typing converts normally afterward
  });
});

test.describe("p1: React hooks (/react)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/react");
    await expect(page.getByTestId("page-react")).toBeVisible();
  });

  async function selectWord(page: Page, blockId: string, from: number, to: number): Promise<void> {
    await page.evaluate(({ blockId, from, to }) => window.__julEditorReact!.setSelection({ type: "text", anchor: { blockId, offset: from }, focus: { blockId, offset: to } }), { blockId, from, to });
  }

  test("p1: TurnInto (bubble menu) converts a paragraph to H2, then to a code block", async ({ page }) => {
    await selectWord(page, "r-p1", 0, 5);
    const select = page.getByTestId("turn-into-select");
    await expect(select).toBeVisible();
    await select.selectOption("heading-2");
    let doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { id: string; type: string; props?: Record<string, unknown> }[] };
    expect(doc.blocks.find((b) => b.id === "r-p1")).toMatchObject({ type: "heading", props: { level: 2 } });

    await selectWord(page, "r-p1", 0, 5);
    await page.getByTestId("turn-into-select").selectOption("codeBlock");
    doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { id: string; type: string }[] };
    expect(doc.blocks.find((b) => b.id === "r-p1")).toMatchObject({ type: "codeBlock" });
  });

  test("p1: Mod+K opens the LinkEditor (no window.prompt) and applies a link", async ({ page }) => {
    let promptCalled = false;
    await page.exposeFunction("__p1PromptCalled", () => {
      promptCalled = true;
    });
    await page.addInitScript(() => {
      window.prompt = () => {
        (window as unknown as { __p1PromptCalled: () => void }).__p1PromptCalled();
        return null;
      };
    });
    await page.reload();
    await expect(page.getByTestId("page-react")).toBeVisible();

    await selectWord(page, "r-p1", 0, 5);
    await page.keyboard.press("ControlOrMeta+k");
    const editorPopover = page.getByTestId("link-editor");
    await expect(editorPopover).toBeVisible();
    await page.getByTestId("link-editor-input").fill("https://example.com");
    await page.getByTestId("link-editor-apply").click();
    await expect(editorPopover).toBeHidden();

    const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { id: string; content?: { marks?: { type: string; attrs?: Record<string, unknown> }[] }[] }[] };
    const first = doc.blocks.find((b) => b.id === "r-p1")!.content![0]!;
    expect(first.marks?.[0]).toEqual({ type: "link", attrs: { href: "https://example.com" } });
    expect(promptCalled).toBe(false);
  });

  test("p1: color picker sets data-jul-editor-color on the selected text", async ({ page }) => {
    await selectWord(page, "r-p1", 0, 5);
    await page.getByTestId("color-text-red").click();
    const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { id: string; content?: { marks?: { type: string; attrs?: Record<string, unknown> }[] }[] }[] };
    const first = doc.blocks.find((b) => b.id === "r-p1")!.content![0]!;
    expect(first.marks?.some((m) => m.type === "textColor" && m.attrs?.color === "red")).toBe(true);
    await expect(page.locator(`[data-id="r-p1"] span[data-jul-editor-color="red"]`)).toBeVisible();
  });

  test("p1: drag handle '+' inserts an empty paragraph without opening slash", async ({ page }) => {
    const box = (await page.locator(`[data-jul-editor-block][data-id="r-p1"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(10, box.height / 2), { steps: 3 });
    await page.waitForTimeout(50);
    await expect(page.getByTestId("drag-handle")).toBeVisible();
    await page.getByTestId("drag-insert-slash").click();
    await expect(page.getByTestId("slash-menu")).toBeHidden();

    const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { id: string; content?: { text?: string }[] }[] };
    const idx = doc.blocks.findIndex((b) => b.id === "r-p1");
    expect(doc.blocks[idx + 1]!.content).toEqual([]);
    await page.keyboard.type("x");
    const afterTyping = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as { blocks: { content?: { text?: string }[] }[] };
    expect(afterTyping.blocks[idx + 1]!.content?.[0]?.text).toBe("x");
  });
});
