// Headless slash/mention/bubble menus, exercised on the "/react" demo
// (e2e/fixtures/src/react/react-demo.tsx). See packages/react/src/menus/
// *.test.ts for the pure-logic unit coverage (async race protection, keyboard
// nav, choseong filtering, convert-vs-insert-after) -- these are the real-
// browser behaviors that need it: actual typing, actual Korean IME
// composition, actual React re-render counting.

import { expect, test } from "@playwright/test";
import { typeComposed } from "./helpers/ime.js";

interface DocInline {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: { kind?: string; id?: string; label?: string };
}
interface DocBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: DocInline[];
}
interface DocLike {
  blocks: DocBlock[];
}

declare global {
  interface Window {
    __julEditorReact?: {
      getDoc: () => DocLike;
      renderCounts: { toolbar: number };
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: unknown) => void;
    };
  }
}

function findBlock(doc: DocLike, id: string): DocBlock {
  const block = doc.blocks.find((b) => b.id === id);
  if (!block) throw new Error(`block "${id}" not found`);
  return block;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/react");
  await expect(page.getByTestId("page-react")).toBeVisible();
  // r-p2 (e2e/fixtures/src/react/react-demo.tsx's sampleDoc) is the one
  // empty trailing paragraph -- every test below types into it fresh.
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
});

// ---- slash menu ----------------------------------------------------------

test("slash: '/' opens the menu, typing filters it, ArrowDown+Enter converts the block to a heading", async ({ page }) => {
  await page.keyboard.type("/head");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Heading 1")).toBeVisible();
  await expect(menu.getByText("Heading 2")).toBeVisible();
  await expect(menu.getByText("Heading 3")).toBeVisible();
  // Nothing not-a-heading should have survived the "head" filter.
  await expect(menu.getByText("Quote")).toHaveCount(0);

  await page.keyboard.press("ArrowDown"); // Heading 1 -> Heading 2
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const block = findBlock(doc, "r-p2");
  expect(block.type).toBe("heading");
  expect(block.props?.level).toBe(2);
  expect(block.content).toEqual([]); // the "/head" query text was consumed, not kept
});

test("slash: Escape closes the menu and leaves the block untouched", async ({ page }) => {
  await page.keyboard.type("/head");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("slash-menu")).toBeHidden();

  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  expect(findBlock(doc, "r-p2").type).toBe("paragraph");
});

test("slash: an old slash never reopens on space or moving the caret back", async ({ page }) => {
  await page.keyboard.type("/");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("slash-menu")).toBeHidden();
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 1));
  await expect(page.getByTestId("slash-menu")).toBeHidden();
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 1));
  await expect(page.getByTestId("slash-menu")).toBeHidden();
});

test("slash: choseong search '/ㅊㅌ' finds the Chart item", async ({ page }) => {
  await page.keyboard.type("/ㅊㅌ");
  await expect(page.getByTestId("slash-menu").getByText("Chart")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("slash: '/표' composed via a real IME sequence shows the Table item", async ({ page }) => {
  await page.keyboard.type("/");
  await typeComposed(page, ["ㅍ", "표"], "표"); // ㅍ + ㅛ -> 표, committed mid-query
  await expect(page.getByTestId("slash-menu").getByText("Table", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("slash: inserting a void item (image) inserts after, and adds a trailing paragraph", async ({ page }) => {
  await page.keyboard.type("/image");
  await expect(page.getByTestId("slash-menu").getByText("Image", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const idx = doc.blocks.findIndex((b) => b.id === "r-p2");
  // A void block (no content/children slot of its own) can never be
  // "converted into" -- r-p2 stays a (now-empty) paragraph, the image is
  // inserted right after it, and a fresh trailing paragraph follows (the
  // doc must not end -- or have any block sit -- with no cursor slot).
  expect(doc.blocks[idx]?.type).toBe("paragraph");
  expect(doc.blocks[idx]?.content).toEqual([]);
  expect(doc.blocks[idx + 1]?.type).toBe("image");
  expect(doc.blocks[idx + 2]?.type).toBe("paragraph");
});

test("slash: '/chart' (an @jul-editor/plugins-integrated item, per extraItems) inserts a real chart void, not just an empty placeholder", async ({ page }) => {
  await page.keyboard.type("/chart");
  await expect(page.getByTestId("slash-menu").getByText("Chart", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  // pluginRenderers.chart (wired into this demo's <Editor renderers>) actually
  // renders a chart element for the inserted block -- proves the "/chart"
  // item + its renderer are wired together, not just a dangling void.
  await expect(page.locator('[data-jul-editor-plugin="chart"]')).toBeVisible();
});

// ---- mention menu ---------------------------------------------------------

test("mention: '@' + typing shows async user results after latency, Enter inserts a mention with kind 'user'", async ({ page }) => {
  await page.keyboard.type("@김");
  const menu = page.getByTestId("mention-menu");
  await expect(menu).toBeVisible({ timeout: 1000 });
  await expect(menu.getByText("김민준")).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const mention = findBlock(doc, "r-p2").content!.find((inl) => inl.type === "mention")!;
  expect(mention.attrs?.kind).toBe("user");
  expect(mention.attrs?.label).toBe("김민준");
});

test("mention: Tab toggles from user to post kind and re-searches", async ({ page }) => {
  await page.keyboard.type("@");
  const menu = page.getByTestId("mention-menu");
  await expect(menu).toBeVisible({ timeout: 1000 });
  await expect(menu).toHaveAttribute("data-kind", "user");

  await page.keyboard.press("Tab");
  await expect(menu).toHaveAttribute("data-kind", "post");
  await expect(menu.getByText("분기 로드맵")).toBeVisible({ timeout: 1000 });

  await page.keyboard.press("Enter");
  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const mention = findBlock(doc, "r-p2").content!.find((inl) => inl.type === "mention")!;
  expect(mention.attrs?.kind).toBe("post");
});

test("mention: Backspace right after an inserted mention deletes it as one atomic unit", async ({ page }) => {
  await page.keyboard.type("@김");
  const menu = page.getByTestId("mention-menu");
  await expect(menu.getByText("김민준")).toBeVisible({ timeout: 1000 }); // wait for the async result, not just the (immediately-open) menu shell
  await page.keyboard.press("Enter"); // inserts "<mention> " -- caret lands after the trailing space
  await page.keyboard.press("ArrowLeft"); // step back over the trailing space, caret now right after the mention
  await page.keyboard.press("Backspace");

  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const block = findBlock(doc, "r-p2");
  expect(block.content!.some((inl) => inl.type === "mention")).toBe(false);
  expect(block.content!.map((inl) => inl.text ?? "").join("")).toBe(" "); // only the trailing space is left
});

// ---- bubble menu -----------------------------------------------------------

test("bubble: shows only on a non-empty selection, hides when collapsed, and Bold from the bubble applies", async ({ page }) => {
  const bubble = page.getByTestId("bubble-menu");
  await expect(bubble).toBeHidden();

  await page.evaluate(() =>
    window.__julEditorReact!.setSelection({ type: "text", anchor: { blockId: "r-p1", offset: 0 }, focus: { blockId: "r-p1", offset: 5 } }),
  );
  await expect(bubble).toBeVisible();

  await bubble.getByRole("button", { name: "Bold" }).click();
  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const first = findBlock(doc, "r-p1").content![0]!;
  expect(first.marks?.some((m) => m.type === "bold")).toBe(true);

  await page.evaluate(() =>
    window.__julEditorReact!.setSelection({ type: "text", anchor: { blockId: "r-p1", offset: 5 }, focus: { blockId: "r-p1", offset: 5 } }),
  );
  await expect(bubble).toBeHidden();
});

// ---- shared: menus must not touch the Toolbar's own render count ----------

test("menus: opening and typing in the slash menu causes zero Toolbar re-renders", async ({ page }) => {
  const before = await page.evaluate(() => window.__julEditorReact!.renderCounts.toolbar);
  await page.keyboard.type("/table");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  const after = await page.evaluate(() => window.__julEditorReact!.renderCounts.toolbar);
  expect(after).toBe(before);
});
