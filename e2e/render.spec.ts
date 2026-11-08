// Render surface: selection mapping (nested blocks, void, Esc) and the
// attr-only render guarantees (numbered-list reindex, MutationObserver scope).
// Uses the "/editor" page (createEditor),
// e2e/helpers/editor-doc.ts for doc reads.

import { expect, test } from "@playwright/test";
import { getDoc, getSelection, textOf } from "./helpers/editor-doc.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("render: selection round-trip across nested blocks (any depth, pre-order)", async ({ page }) => {
  // li1 (parent item) and li1a are parent/child, not siblings -- a text
  // selection between them must map through the nested data-jul-editor-children
  // container in both directions.
  await page.evaluate(() =>
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "li1", offset: 0 }, focus: { blockId: "li1a", offset: 5 } }),
  );
  const mapped = await page.evaluate(() => {
    const sel = window.getSelection()!;
    const blockOf = (n: Node | null) => {
      const el = n && (n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element));
      return el?.closest("[data-jul-editor-block]")?.getAttribute("data-id") ?? null;
    };
    return { anchor: blockOf(sel.anchorNode), focus: blockOf(sel.focusNode) };
  });
  expect(mapped).toEqual({ anchor: "li1", focus: "li1a" });
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "li1", offset: 0 }, focus: { blockId: "li1a", offset: 5 } });
});

test("render: arrow keys into a void block select it (data-jul-editor-selected, no merge)", async ({ page }) => {
  const before = await getDoc(page);
  const o3Len = textOf(before, "o3").length; // "three"
  await page.evaluate((offset) => window.__julEditor!.setCaret("o3", offset), o3Len);

  await page.keyboard.press("ArrowRight");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });
  await expect(page.locator('[data-id="v1"]')).toHaveAttribute("data-jul-editor-selected", "");

  await page.keyboard.press("ArrowRight"); // move off the void, forward
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "pEnd", offset: 0 }, focus: { blockId: "pEnd", offset: 0 } });
  await expect(page.locator('[data-id="v1"]')).not.toHaveAttribute("data-jul-editor-selected", "");

  await page.keyboard.press("ArrowLeft"); // back into the void from the other side
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });
});

test("render: Escape converts a text selection to a block selection (Notion)", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 3));
  await page.keyboard.press("Escape");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["p1"] });
  await expect(page.locator('[data-id="p1"]')).toHaveAttribute("data-jul-editor-selected", "");
});

test("render: numbered-list reindex is an attribute patch, not a sibling rebuild", async ({ page }) => {
  await page.evaluate(() => {
    for (const id of ["o1", "o2", "o3"]) (document.querySelector(`[data-id="${id}"]`) as { __marked?: boolean }).__marked = true;
  });
  expect(await page.locator('[data-id="o1"]').getAttribute("data-jul-editor-index")).toBe("1");
  expect(await page.locator('[data-id="o3"]').getAttribute("data-jul-editor-index")).toBe("3");

  await page.evaluate(() =>
    window.__julEditor!.editor.update((tx) =>
      tx.insertBlock(null, 4, { id: "o0", type: "orderedListItem", props: {}, content: [{ type: "text", text: "zero" }] }),
    ),
  );

  const marks = await page.evaluate(() =>
    ["o1", "o2", "o3"].map((id) => (document.querySelector(`[data-id="${id}"]`) as { __marked?: boolean } | null)?.__marked === true),
  );
  expect(marks).toEqual([true, true, true]); // same DOM nodes survived the insert
  await expect(page.locator('[data-id="o0"]')).toHaveAttribute("data-jul-editor-index", "1");
  await expect(page.locator('[data-id="o1"]')).toHaveAttribute("data-jul-editor-index", "2");
  await expect(page.locator('[data-id="o2"]')).toHaveAttribute("data-jul-editor-index", "3");
  await expect(page.locator('[data-id="o3"]')).toHaveAttribute("data-jul-editor-index", "4");
});

test("render: one plain keystroke mutates only inside that block's content, 0 new Elements", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((offset) => window.__julEditor!.setCaret("p1", offset), textOf(before, "p1").length);

  await page.evaluate(() => {
    const root = document.querySelector("[data-jul-editor-root]")!;
    (window as unknown as { __moResult: { blockIds: Set<string>; newElements: number } }).__moResult = { blockIds: new Set(), newElements: 0 };
    const result = (window as unknown as { __moResult: { blockIds: Set<string>; newElements: number } }).__moResult;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        const el = t.nodeType === Node.TEXT_NODE ? t.parentElement : (t as Element);
        const blockEl = el?.closest("[data-jul-editor-block]");
        if (blockEl) result.blockIds.add(blockEl.getAttribute("data-id")!);
        for (const n of Array.from(r.addedNodes)) if (n.nodeType === Node.ELEMENT_NODE) result.newElements++;
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    (window as unknown as { __mo: MutationObserver }).__mo = mo;
  });

  await page.keyboard.type("!", { delay: 20 });
  await page.waitForTimeout(50);

  const result = await page.evaluate(() => {
    const w = window as unknown as { __moResult: { blockIds: Set<string>; newElements: number }; __mo: MutationObserver };
    w.__mo.disconnect();
    return { blockIds: [...w.__moResult.blockIds], newElements: w.__moResult.newElements };
  });
  expect(result.blockIds.length).toBeLessThanOrEqual(1);
  expect(result.newElements).toBe(0);

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "!");
});
