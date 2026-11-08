// P2: code block syntax highlighting (CSS Custom Highlight API) + language
// picker + copy button, on the "/react" page (e2e/fixtures/src/react/
// react-demo.tsx registers @jul-editor/plugins' lowlight highlighter and mounts
// @jul-editor/react's `createCodeBlockRenderer` chrome for the `r-code1` seed
// block). Chromium-only (supports the Custom Highlight API; see
// playwright.config.ts's `pnpm e2e` script), matching every other suite's
// convention of putting the browser-API name in the title ("ime:", "code:").

import { expect, test } from "@playwright/test";

interface DocBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}
interface DocLike {
  blocks: DocBlock[];
}

function textOf(doc: DocLike, blockId: string): string {
  const block = doc.blocks.find((b) => b.id === blockId);
  return (block?.content ?? []).map((inl) => inl.text ?? "").join("");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/react");
  await expect(page.getByTestId("page-react")).toBeVisible();
  // The lowlight highlighter is registered from a `useEffect` (after mount) --
  // wait for the FIRST highlight pass on the seed codeBlock rather than an
  // arbitrary sleep.
  await page.waitForFunction(() => {
    const h = (window as unknown as { CSS?: { highlights?: Map<string, { size: number }> } }).CSS?.highlights;
    return !!h?.get("jul-editor-keyword")?.size;
  });
});

test("code: typing TS into a code block highlights its keywords via CSS.highlights, DOM-free", async ({ page }) => {
  const codeBlock = page.locator('[data-id="r-code1"] [data-jul-editor-content]');
  await expect(codeBlock).toBeVisible();

  // A codeBlock's content div only ever has bare text nodes (+ a possible
  // trailing placeholder <br>) -- highlighting must never add wrapping spans.
  const elementsBefore = await codeBlock.evaluate((el) => el.querySelectorAll("*").length);

  await page.evaluate(() => window.__julEditorReact!.setCaret("r-code1", 0));
  await page.keyboard.type("const z = 1;\n", { delay: 20 });

  await page.waitForFunction(() => {
    const h = (window as unknown as { CSS?: { highlights?: Map<string, { size: number }> } }).CSS?.highlights;
    return (h?.get("jul-editor-keyword")?.size ?? 0) >= 2; // the seed "const" + the freshly typed one
  });

  const elementsAfter = await codeBlock.evaluate((el) => el.querySelectorAll("*").length);
  expect(elementsAfter).toBe(elementsBefore); // no new elements -- highlighting is DOM-free

  const covers = await page.evaluate(() => {
    const h = (window as unknown as { CSS: { highlights: Map<string, Iterable<Range>> } }).CSS.highlights;
    const kw = h.get("jul-editor-keyword")!;
    return Array.from(kw, (r) => r.toString());
  });
  expect(covers).toContain("const");
});

test("code: changing the language via the select updates props.language and re-highlights", async ({ page }) => {
  const chrome = page.locator('[data-id="r-code1"] [data-jul-editor-code-chrome]');
  const select = chrome.getByLabel("Language");
  await expect(select).toHaveValue("ts");

  await select.selectOption("python");

  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(doc.blocks.find((b) => b.id === "r-code1")!.props.language).toBe("python");

  // Re-highlighted for the new language: "def"/"import" aren't TS keywords,
  // but the existing "const greet = ..." line has no Python keyword either
  // -- assert instead that the highlighter actually re-ran by typing a real
  // Python keyword and seeing it picked up.
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-code1", 0));
  await page.keyboard.type("import os\n", { delay: 20 });
  await page.waitForFunction(() => {
    const h = (window as unknown as { CSS?: { highlights?: Map<string, Iterable<Range>> } }).CSS?.highlights;
    const kw = h?.get("jul-editor-keyword");
    return !!kw && Array.from(kw, (r) => r.toString()).includes("import");
  });
});

test("code: copy button writes the current code to the clipboard and shows a copied state", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const chrome = page.locator('[data-id="r-code1"] [data-jul-editor-code-chrome]');
  const copyButton = chrome.getByRole("button", { name: "Copy code" });

  await copyButton.click();
  // data-copied now distinguishes "done" from "error" (a rejected
  // Clipboard API falls back to execCommand instead of losing the state
  // entirely) -- see CodeBlockView.tsx's own writeClipboardText.
  await expect(copyButton).toHaveAttribute("data-copied", "done");

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(clipboardText).toBe(textOf(doc, "r-code1"));
});

test("code: an unsupported CSS.highlights environment never breaks typing (feature-detected no-op)", async ({ page }) => {
  // Simulate the API being absent (older Firefox/Safari) by deleting it after
  // load, then confirm the editor is still fully functional -- this suite
  // only RUNS on chromium (playwright.config.ts), but the module's own
  // feature-detection is what this checks, not the browser itself.
  await page.evaluate(() => {
    // @ts-expect-error -- deliberately un-defining a real global for the test
    delete window.CSS.highlights;
  });
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-code1", 0));
  await page.keyboard.type("x", { delay: 0 });
  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(textOf(doc, "r-code1")).toContain("x");
});
