// Image upload: paste/drop a file, data: images from pasted HTML,
// upload failure + retry, click-to-select a void, and the playground's
// vanilla alt-text input (packages/react's <ImageView> equivalent is unit-
// tested separately in packages/react/src/blocks/image-view.test.tsx). Uses
// the "/editor" page's controllable `window.__julEditorUploads` mock (see
// e2e/fixtures/src/editor-page.tsx). Resolved mock upload URLs use a real
// https:// origin (not a fake "mock:" scheme) since opSetProps now runs every image src through sanitizeUrl (image kind only allows
// http/https/blob), the same as every other model write path.

import { expect, test } from "@playwright/test";
import { blockProps, blockType, childIds, getDoc, getSelection, textOf } from "./helpers/editor-doc.js";
import { ONE_PX_PNG_BASE64, dropImageFile, pasteHTML, pasteImageFile } from "./helpers/clipboard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

function newIdAfter(beforeIds: string[], afterIds: string[]): string {
  const id = afterIds.find((i) => !beforeIds.includes(i));
  if (!id) throw new Error("no new block id found");
  return id;
}

test("image: pasting a PNG File inserts an uploading image block, then goes ready with the mocked onUpload src", async ({ page }) => {
  const before = await getDoc(page);
  const beforeIds = childIds(before, null);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));

  await pasteImageFile(page, ONE_PX_PNG_BASE64, "photo.png");

  let doc = await getDoc(page);
  const id = newIdAfter(beforeIds, childIds(doc, null));
  expect(blockType(doc, id)).toBe("image");
  expect(blockProps(doc, id)?.src ?? "").toBe(""); // "" is the schema default, so normalizeProps omits it entirely (C1: opInsertBlock now normalizes too)
  const uploading = await page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id);
  expect(uploading).toEqual({ status: "uploading" });

  await page.evaluate(() => window.__julEditorUploads!.resolveNext({ src: "https://cdn.example/uploaded.png" }));

  await expect.poll(() => page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id)).toBeUndefined();
  doc = await getDoc(page);
  expect(blockProps(doc, id)?.src).toBe("https://cdn.example/uploaded.png");
});

test("image: a data: image embedded in pasted HTML is uploaded through the same hook", async ({ page }) => {
  const before = await getDoc(page);
  const beforeIds = childIds(before, null);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));

  await pasteHTML(page, `<p><img src="data:image/png;base64,${ONE_PX_PNG_BASE64}" alt="inline"></p>`);

  let doc = await getDoc(page);
  const id = newIdAfter(beforeIds, childIds(doc, null));
  expect(blockType(doc, id)).toBe("image");
  expect(blockProps(doc, id)?.src ?? "").toBe(""); // "" is the schema default, so normalizeProps omits it entirely

  await expect.poll(() => page.evaluate(() => window.__julEditorUploads!.pending().length)).toBe(1);
  await page.evaluate(() => window.__julEditorUploads!.resolveNext({ src: "https://cdn.example/from-html.png" }));

  await expect.poll(() => page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id)).toBeUndefined();
  doc = await getDoc(page);
  expect(blockProps(doc, id)?.src).toBe("https://cdn.example/from-html.png");
});

test("image: an upload failure shows an error state, and retry can still succeed", async ({ page }) => {
  const before = await getDoc(page);
  const beforeIds = childIds(before, null);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await pasteImageFile(page, ONE_PX_PNG_BASE64, "photo.png");
  const doc = await getDoc(page);
  const id = newIdAfter(beforeIds, childIds(doc, null));

  await page.evaluate(() => window.__julEditorUploads!.rejectNext("network down"));
  await expect.poll(() => page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id)).toEqual({ status: "error", message: "network down" });
  await expect(page.locator(`[data-id="${id}"] figure`)).toHaveAttribute("data-state", "error");

  await page.evaluate((id) => window.__julEditor!.editor.retryUpload(id), id);
  await expect.poll(() => page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id)).toEqual({ status: "uploading" });

  await page.evaluate(() => window.__julEditorUploads!.resolveNext({ src: "https://cdn.example/retried.png" }));
  await expect.poll(() => page.evaluate((id) => window.__julEditor!.editor.getUploadState(id), id)).toBeUndefined();
  const after = await getDoc(page);
  expect(blockProps(after, id)?.src).toBe("https://cdn.example/retried.png");
});

test("image: dropping a file on a void block inserts it right after that block (nearest-block fallback)", async ({ page }) => {
  // Headless (no CSS at all besides rootStyle.ts's 3 functional styles) means
  // adjacent TEXT blocks are stacked with zero pixel gap, so there's no real
  // "gap between h1 and q1" to drop into -- the fallback path (task spec:
  // "drop between blocks inserts after the nearest block") is instead
  // reliably exercised by dropping ON a void block itself: it's
  // contenteditable=false, so caretRangeFromPoint/caretPositionFromPoint
  // resolve to no text position there at all, same as landing in a genuine
  // inter-block gap would.
  const before = await getDoc(page);
  const beforeIds = childIds(before, null);
  const v1Box = (await page.locator('[data-id="v1"]').boundingBox())!;
  const x = v1Box.x + v1Box.width / 2;
  const y = v1Box.y + v1Box.height / 2;

  await dropImageFile(page, ONE_PX_PNG_BASE64, "dropped.png", x, y);

  const doc = await getDoc(page);
  const ids = childIds(doc, null);
  const id = newIdAfter(beforeIds, ids);
  expect(blockType(doc, id)).toBe("image");
  expect(ids.indexOf(id)).toBe(ids.indexOf("v1") + 1); // right after the void it was dropped on
});

test("image: clicking an image selects it as a block; Backspace deletes it; undo restores it", async ({ page }) => {
  await page.locator('[data-id="v1"] img').click();
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });

  await page.keyboard.press("Backspace");
  let doc = await getDoc(page);
  expect(childIds(doc, null).includes("v1")).toBe(false);

  await page.keyboard.press("Meta+z");
  doc = await getDoc(page);
  expect(childIds(doc, null).includes("v1")).toBe(true);
});

test("image: typing in the alt-text input updates only the image's alt prop, never the doc's text content", async ({ page }) => {
  const before = await getDoc(page);
  await page.locator('[data-id="v1"] img').click(); // selects v1 -> the vanilla alt <input> becomes visible

  const altInput = page.locator('[data-id="v1"] input[aria-label="Alt text"]');
  await expect(altInput).toBeVisible();
  await altInput.fill("a new caption");

  const after = await getDoc(page);
  expect(blockProps(after, "v1")?.alt).toBe("a new caption");
  // every other block's own text is untouched
  for (const id of childIds(after, null)) {
    if (id === "v1") continue;
    expect(textOf(after, id)).toBe(textOf(before, id));
  }
});
