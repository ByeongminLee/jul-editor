// @jul-editor/react's compound API ("/react" page, react-demo.tsx) + the
// "/vanilla" page (createEditor with no React wrapper at all in the editing
// path). See packages/react/src/index.test.tsx for the jsdom-level unit
// coverage (SSR, value semantics, Slot, toolbar aria) -- these are the
// real-browser behaviors that need it: actual keyboard events, actual
// portaled DOM, React's actual Profiler commit counting.

import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __julEditorReact?: {
      getDoc: () => unknown;
      renderCounts: { toolbar: number };
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: unknown) => void;
    };
    __julEditorVanilla?: { getDoc: () => unknown };
  }
}

interface DocBlock {
  id: string;
  type: string;
  content?: { type: string; text?: string; marks?: { type: string }[] }[];
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
});

test("react toolbar: selecting text then clicking Bold marks it bold in the model", async ({ page }) => {
  // Stored marks (typing continues in whatever was toggled at an empty caret)
  // aren't a thing yet -- core doesn't have that concept wired up (keymap/mark
  // plumbing is still being added), so this selects real text first.
  await page.evaluate(() =>
    window.__julEditorReact!.setSelection({ type: "text", anchor: { blockId: "r-p1", offset: 0 }, focus: { blockId: "r-p1", offset: 5 } }),
  );
  // <Editor.BubbleMenu> was added (its own Bold/Italic/Link atoms, shown on
  // this same non-empty selection) alongside the fixed Toolbar -- scope to
  // the toolbar specifically, since "Bold" is no longer a page-unique name.
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();

  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  const first = doc.blocks.find((b) => b.id === "r-p1")!.content![0]!;
  expect(first.marks?.some((m) => m.type === "bold")).toBe(true);
});

test("react toolbar: typing 100 plain chars causes no Toolbar re-renders; toggling Bold (Mod+b) does", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));

  const before = await page.evaluate(() => window.__julEditorReact!.renderCounts.toolbar);
  await page.keyboard.type("a".repeat(100), { delay: 0 });
  const afterTyping = await page.evaluate(() => window.__julEditorReact!.renderCounts.toolbar);
  expect(afterTyping).toBe(before);

  // Mod+b on a *collapsed* caret has nothing to toggle (core has no "stored
  // marks for the next typed character" concept) -- select some of what was
  // just typed first, same workaround as the click-Bold test above.
  await page.evaluate(() => window.__julEditorReact!.setSelection({ type: "text", anchor: { blockId: "r-p2", offset: 0 }, focus: { blockId: "r-p2", offset: 10 } }));
  await page.keyboard.press("ControlOrMeta+b");
  const afterBold = await page.evaluate(() => window.__julEditorReact!.renderCounts.toolbar);
  expect(afterBold).toBeGreaterThan(afterTyping);

  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(textOf(doc, "r-p2")).toBe("a".repeat(100));
});

test("react toolbar: clicking Bold at a collapsed caret shows it pressed and keeps focus, so the next typed text is bold", async ({ page }) => {
  const p1 = page.locator('[data-id="r-p1"]');
  const box = (await p1.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2); // caret near the start of r-p1
  await page.keyboard.press("End");
  const bold = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" });
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-jul-editor-root]"))).toBe(true);
  await page.keyboard.type("Q");
  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  const content = doc.blocks.find((b) => b.id === "r-p1")!.content!;
  expect(content.at(-1)).toMatchObject({ text: "Q", marks: [{ type: "bold" }] });

  // The pending mark is dropped once the caret moves elsewhere.
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
});

test("react toolbar: clicking a block-type button keeps focus in the converted block; clicking it again reverts", async ({ page }) => {
  const p1 = page.locator('[data-id="r-p1"]');
  const box = (await p1.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.press("End");
  const h1 = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading 1" });
  await h1.click();
  await expect(h1).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("ZZ");
  let doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(doc.blocks.find((b) => b.id === "r-p1")!.type).toBe("heading");
  expect(textOf(doc, "r-p1")).toBe("Hello from the React demo.ZZ");
  await h1.click();
  await expect(h1).toHaveAttribute("aria-pressed", "false");
  doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(doc.blocks.find((b) => b.id === "r-p1")!.type).toBe("paragraph");
});

test("react void renderer: mounts via portal into the same DOM node and survives typing elsewhere", async ({ page }) => {
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="void-image"]');
    (window as unknown as { __voidProbe?: Element | null }).__voidProbe = el;
    return el?.outerHTML;
  });
  expect(before).toContain("pic");

  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("typing elsewhere");

  const sameNode = await page.evaluate(
    () => document.querySelector('[data-testid="void-image"]') === (window as unknown as { __voidProbe?: Element | null }).__voidProbe,
  );
  expect(sameNode).toBe(true);
});

test("react void renderer: an error in one renderer is contained by its ErrorBoundary; the editor stays editable", async ({ page }) => {
  // r-diagram1's renderer (BrokenDiagramRenderer) throws on every render --
  // the page must still be up, and typing elsewhere must still work.
  await expect(page.getByTestId("page-react")).toBeVisible();
  await expect(page.getByTestId("void-image")).toBeVisible(); // its sibling portal is unaffected

  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.keyboard.type("still editable");

  const doc = (await page.evaluate(() => window.__julEditorReact!.getDoc())) as DocLike;
  expect(textOf(doc, "r-p2")).toBe("still editable");
});

test("vanilla page: typing updates the model with no React wrapper involved", async ({ page }) => {
  await page.goto("/vanilla");
  await expect(page.getByTestId("page-vanilla")).toBeVisible();

  await page.locator("[data-jul-editor-root]").click();
  await page.keyboard.type("hello vanilla");

  const doc = (await page.evaluate(() => window.__julEditorVanilla!.getDoc())) as DocLike;
  expect(textOf(doc, "v-p1")).toBe("hello vanilla");
});
