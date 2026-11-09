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

test("slash: a void item (image) replaces the empty '/' line, adds a trailing paragraph, and the caret lands there", async ({ page }) => {
  const before = await page.evaluate(() => window.__julEditorReact!.getDoc());
  const idx = before.blocks.findIndex((b) => b.id === "r-p2");
  await page.keyboard.type("/image");
  await expect(page.getByTestId("slash-menu").getByText("Image", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  // A void block (no content/children slot of its own) can never be
  // "converted into": the now-empty '/' paragraph is swapped for the image,
  // and a fresh trailing paragraph follows and takes the caret, so the next
  // keystroke types there instead of replacing the image (Notion).
  await page.keyboard.type("Next line");
  const doc = await page.evaluate(() => window.__julEditorReact!.getDoc());
  expect(doc.blocks.some((b) => b.id === "r-p2")).toBe(false);
  expect(doc.blocks[idx]?.type).toBe("image");
  expect(doc.blocks[idx + 1]?.type).toBe("paragraph");
  expect(doc.blocks[idx + 1]?.content).toEqual([{ type: "text", text: "Next line" }]);
});

test("slash: Enter with no matching items closes the menu and splits the line", async ({ page }) => {
  await page.keyboard.type("/zzz");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await expect(page.getByTestId("slash-menu").getByText("No results")).toBeVisible();
  await page.waitForTimeout(200); // past the 100ms item debounce: the empty result has landed
  const before = (await page.evaluate(() => window.__julEditorReact!.getDoc())).blocks.length;
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slash-menu")).toBeHidden();
  await expect.poll(async () => (await page.evaluate(() => window.__julEditorReact!.getDoc())).blocks.length).toBe(before + 1);
});

test("slash/mention: never open inside a code block; Enter types a newline", async ({ page }) => {
  await page.evaluate(() => window.__julEditorReact!.setCaret("r-code1", 0));
  await page.keyboard.type("/");
  await page.waitForTimeout(150);
  await expect(page.getByTestId("slash-menu")).toBeHidden();
  await page.keyboard.press("Enter");
  await page.keyboard.type("@김");
  await page.waitForTimeout(400);
  await expect(page.getByTestId("mention-menu")).toBeHidden();
  const code = findBlock(await page.evaluate(() => window.__julEditorReact!.getDoc()), "r-code1");
  expect(code.content?.every((inl) => inl.type === "text")).toBe(true);
  expect(code.content?.map((inl) => inl.text).join("")).toMatch(/^\/\n@김const greet/);
});

test("mention: '@' right after a letter (an email address) does not open the menu", async ({ page }) => {
  await page.keyboard.type("email me@x");
  await page.waitForTimeout(400);
  await expect(page.getByTestId("mention-menu")).toBeHidden();
  await page.keyboard.type(" @");
  await expect(page.getByTestId("mention-menu")).toBeVisible();
});

test("slash: the menu closes when focus leaves the editor", async ({ page }) => {
  await page.keyboard.type("/");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "outside-focus";
    button.textContent = "outside";
    document.body.appendChild(button);
  });
  await page.locator("#outside-focus").focus();
  await expect(page.getByTestId("slash-menu")).toBeHidden();
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

test("bubble: follows the live selection (backward drag, Shift+Arrow) and hides after a click outside the editor", async ({ page }) => {
  const bubble = page.getByTestId("bubble-menu");
  const point = (offset: number) =>
    page.evaluate((offset) => {
      const text = document.querySelector('[data-id="r-p1"] [data-jul-editor-content]')!.firstChild as Text;
      const r = document.createRange();
      r.setStart(text, offset);
      r.setEnd(text, offset + 1);
      const b = r.getClientRects()[0]!;
      return { x: b.left + 1, y: b.top + b.height / 2 };
    }, offset);
  const selLeft = () => page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().left);
  const bubbleLeft = async () => (await bubble.boundingBox())!.x;

  // backward drag: the bubble sits at the selection's left edge, not where the drag started
  const a = await point(20);
  const z = await point(6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 10 });
  await page.mouse.up();
  await expect(bubble).toBeVisible();
  await expect.poll(async () => Math.abs((await bubbleLeft()) - (await selLeft()))).toBeLessThan(2);

  // Shift+ArrowLeft extends the (backward) selection further left: the bubble moves with it
  const before = await bubbleLeft();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(bubbleLeft).toBeLessThan(before - 5);
  await expect.poll(async () => Math.abs((await bubbleLeft()) - (await selLeft()))).toBeLessThan(2);

  // a click outside the editor moves the DOM selection away: no bubble acting on invisible text
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.dataset.testid = "outside-text";
    p.textContent = "Some page text outside the editor";
    p.style.cssText = "position: fixed; left: 8px; bottom: 8px; margin: 0; z-index: 100; background: white;";
    document.body.append(p);
  });
  await page.getByTestId("outside-text").click();
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
