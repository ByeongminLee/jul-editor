// Image width/align/caption +
// resize handles, and the new `embed` block (YouTube/Vimeo iframe allowlist,
// X/link as a link card) + URL-paste auto-embed + slash insertion.
//
// Image resize/align/caption run on the "/editor" vanilla page (its own
// hand-rolled image renderer deliberately mirrors @jul-editor/react's ImageView
// shape -- see EditorPage.tsx's header comment): this file title contains
// "media:".
//
// Embed's paste-to-embed conversion is core/view-layer (not React-specific),
// so it's also exercised on "/editor"; seeing the actual rendered iframe/
// link-card DOM (with its safety attributes) needs the real @jul-editor/react
// EmbedView, wired on "/react" (react-demo.tsx).

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Doc } from "../packages/core/src/model/types.js";
import { blockProps, blockType, childIds, getDoc, getSelection } from "./helpers/editor-doc.js";
import { pasteText } from "./helpers/clipboard.js";

// react.spec.ts/drag.spec.ts/menus.spec.ts each declare their own
// (differently-shaped) `Window.__julEditorReact` global for the same reason --
// these spec files aren't run through one shared tsc program (Playwright
// transpiles each independently), so this repeats that same local pattern
// rather than fighting declaration-merging across files.
declare global {
  interface Window {
    __julEditorReact?: {
      getDoc: () => unknown;
      setCaret: (blockId: string, offset: number) => void;
    };
  }
}

async function getReactDoc(page: Page): Promise<Doc> {
  return (await page.evaluate(() => window.__julEditorReact!.getDoc())) as Doc;
}

function newIdAfter(beforeIds: string[], afterIds: string[]): string {
  const id = afterIds.find((i) => !beforeIds.includes(i));
  if (!id) throw new Error("no new block id found");
  return id;
}

// ---- image: resize / align / caption (vanilla "/editor" page) -------------

test.describe("media: image width/align/caption (/editor)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByTestId("page-editor")).toBeVisible();
  });

  test("media: dragging the right resize handle updates width in ONE undo step", async ({ page }) => {
    await page.locator('[data-id="v1"] img').click(); // selects v1 -> resize handles become visible
    expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });
    await expect.poll(() => page.locator('[data-id="v1"] img').evaluate((img) => (img as HTMLImageElement).complete)).toBe(true);

    const handle = page.locator('[data-id="v1"] [data-jul-editor-resize-handle="right"]');
    await expect(handle).toBeVisible();
    await handle.hover();
    const box = (await handle.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY, { steps: 4 });
    await page.mouse.move(startX + 80, startY, { steps: 4 });
    // Still mid-drag: no doc write yet (preview is DOM-only).
    expect(blockProps(await getDoc(page), "v1")?.width).toBeUndefined();
    await page.mouse.up();

    const after = await getDoc(page);
    const width = blockProps(after, "v1")?.width as number;
    expect(typeof width).toBe("number");
    expect(width).toBeGreaterThan(80); // grew from the drag

    await page.keyboard.press("ControlOrMeta+z");
    expect(blockProps(await getDoc(page), "v1")?.width).toBeUndefined(); // one undo step removes the whole resize
  });

  test("media: align buttons toggle align, aria-pressed reflects the current value", async ({ page }) => {
    await page.locator('[data-id="v1"] img').click();
    const center = page.locator('[data-id="v1"] [aria-label="Align center"]');
    const left = page.locator('[data-id="v1"] [aria-label="Align left"]');
    await expect(center).toHaveAttribute("aria-pressed", "true"); // default
    await left.click();
    await expect(left).toHaveAttribute("aria-pressed", "true");
    await expect(center).toHaveAttribute("aria-pressed", "false");
    expect(blockProps(await getDoc(page), "v1")?.align).toBe("left");
    await expect(page.locator('[data-id="v1"] figure')).toHaveAttribute("data-align", "left");
  });

  test("media: caption input (selected) edits the caption prop, and shows as plain text once deselected", async ({ page }) => {
    await page.locator('[data-id="v1"] img').click();
    const captionInput = page.locator('[data-id="v1"] input[aria-label="Caption"]');
    await expect(captionInput).toBeVisible();
    await captionInput.fill("a nice caption");
    expect(blockProps(await getDoc(page), "v1")?.caption).toBe("a nice caption");

    await page.locator('[data-id="p1"]').click(); // deselect v1
    expect(await getSelection(page)).not.toEqual({ type: "block", ids: ["v1"] });
    await expect(page.locator('[data-id="v1"] figure')).toContainText("a nice caption");
  });
});

// ---- embed: URL-paste auto-embed (core/view layer, "/editor" page) --------

test.describe("media: URL-paste auto-embed (/editor)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByTestId("page-editor")).toBeVisible();
  });

  test("media: pasting a bare youtube URL into an EMPTY paragraph converts it to an embed block via TWO undo steps (Notion: paste inserts the link first, then converts)", async ({ page }) => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await pasteText(page, url);

    const doc = await getDoc(page);
    expect(blockType(doc, "pEnd")).toBe("embed");
    expect(blockProps(doc, "pEnd")).toMatchObject({ provider: "youtube", id: "dQw4w9WgXcQ", url });

    await page.keyboard.press("ControlOrMeta+z");
    const afterFirstUndo = await getDoc(page);
    expect(blockType(afterFirstUndo, "pEnd")).toBe("paragraph"); // first undo: back to the url as LINKED TEXT, not empty
    const content = afterFirstUndo.blocks.find((b) => b.id === "pEnd")!.content!;
    expect(content).toMatchObject([{ text: url, marks: [{ type: "link", attrs: { href: url } }] }]);

    await page.keyboard.press("ControlOrMeta+z");
    const afterSecondUndo = await getDoc(page);
    expect(blockType(afterSecondUndo, "pEnd")).toBe("paragraph");
    expect(afterSecondUndo.blocks.find((b) => b.id === "pEnd")!.content).toEqual([]); // second undo: back to empty
  });

  test("media: pasting a vimeo URL into an empty paragraph also converts to an embed", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await pasteText(page, "https://vimeo.com/123456789");
    const doc = await getDoc(page);
    expect(blockType(doc, "pEnd")).toBe("embed");
    expect(blockProps(doc, "pEnd")).toMatchObject({ provider: "vimeo", id: "123456789" });
  });

  test("media: pasting an x.com status URL into an empty paragraph converts to an embed (provider 'x', link-card)", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await pasteText(page, "https://x.com/someone/status/1234567890");
    const doc = await getDoc(page);
    expect(blockType(doc, "pEnd")).toBe("embed");
    expect(blockProps(doc, "pEnd")).toMatchObject({ provider: "x" });
  });

  test("media: pasting a generic (non-embeddable) URL into an empty paragraph stays a plain autolinked paragraph", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await pasteText(page, "https://example.com/page");
    const doc = await getDoc(page);
    expect(blockType(doc, "pEnd")).toBe("paragraph");
    const content = doc.blocks.find((b) => b.id === "pEnd")!.content!;
    expect(content[0]).toMatchObject({ text: "https://example.com/page", marks: [{ type: "link", attrs: { href: "https://example.com/page" } }] });
  });

  test("media: pasting a youtube URL mid-sentence (non-empty text) stays a plain link, not an embed", async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("p1", 0)); // p1 = "Hello world", non-empty
    await pasteText(page, "https://youtu.be/dQw4w9WgXcQ");
    const doc = await getDoc(page);
    expect(blockType(doc, "p1")).toBe("paragraph"); // unchanged type -- never became an embed
    const content = doc.blocks.find((b) => b.id === "p1")!.content!;
    const linked = content.find((inl) => inl.type === "text" && (inl as { text: string }).text === "https://youtu.be/dQw4w9WgXcQ");
    expect(linked).toMatchObject({ marks: [{ type: "link", attrs: { href: "https://youtu.be/dQw4w9WgXcQ" } }] });
  });
});

// ---- embed: rendered DOM (real @jul-editor/react EmbedView, "/react" page) -----

test.describe("media: embed rendering (/react)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/react");
    await expect(page.getByTestId("page-react")).toBeVisible();
  });

  test("media: a youtube embed renders a sandboxed youtube-nocookie iframe", async ({ page }) => {
    const iframe = page.locator('[data-id="r-embed1"] iframe');
    await expect(iframe).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
    await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(iframe).toHaveAttribute("loading", "lazy");
  });

  test("media: slash '/유튜브' inserts an empty embed block with a URL input; typing there doesn't touch the doc until Enter", async ({ page }) => {
    const before = await getReactDoc(page);
    const beforeIds = childIds(before, null);
    await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
    await page.keyboard.type("/유튜브");
    await expect(page.getByTestId("slash-menu").getByText("YouTube", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");

    const doc = await getReactDoc(page);
    const id = newIdAfter(beforeIds, childIds(doc, null));
    expect(blockType(doc, id)).toBe("embed");
    expect(blockProps(doc, id)?.url ?? "").toBe("");

    const urlInput = page.locator(`[data-id="${id}"] input[aria-label="Embed URL"]`);
    await expect(urlInput).toBeVisible();
    await urlInput.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(blockProps(await getReactDoc(page), id)?.url ?? "").toBe(""); // typing alone never reaches the doc

    await urlInput.press("Enter");
    const after = await getReactDoc(page);
    expect(blockProps(after, id)).toMatchObject({ provider: "youtube", id: "dQw4w9WgXcQ" });
    await expect(page.locator(`[data-id="${id}"] iframe`)).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  test("media: pasting an x.com URL into an empty paragraph on /react renders a link card, never an iframe", async ({ page }) => {
    await page.evaluate(() => window.__julEditorReact!.setCaret("r-p2", 0));
    await pasteText(page, "https://x.com/someone/status/1234567890");

    // Converting an EMPTY paragraph into an embed reuses the SAME block id
    // (view/embedPaste.ts's tryEmbedPaste inserts the url as linked text,
    // then tx.replaceBlock()s that same id into the embed -- see its own
    // header comment on the two-step undo this now gives) -- no "new" id to
    // hunt for here, unlike the slash-menu insertion test above (which
    // inserts a fresh void block after the current one).
    const doc = await getReactDoc(page);
    const id = "r-p2";
    expect(blockType(doc, id)).toBe("embed");

    const embedEl = page.locator(`[data-id="${id}"] [data-jul-editor-embed]`);
    await expect(embedEl).toHaveAttribute("data-provider", "x");
    expect(await embedEl.locator("iframe").count()).toBe(0);
    await expect(embedEl.locator("a")).toHaveAttribute("href", "https://x.com/someone/status/1234567890");
  });
});
