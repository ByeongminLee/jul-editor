// Editing surface: beforeinput handling beyond the IME spike --
// cross-block delete/replace, list-item conversion, Shift+Enter, Cmd+Backspace,
// history merge/undo/redo, Mod+A. Uses the "/editor" page (createEditor).

import { expect, test } from "@playwright/test";
import { blockExists, blockType, getDoc, getSelection, textOf } from "./helpers/editor-doc.js";
import { pasteText } from "./helpers/clipboard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("editing: insertText replaces a non-collapsed cross-block selection", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "q1", offset: 3 }, focus: { blockId: "li1", offset: 4 } }),
  );
  await page.keyboard.type("Z");

  const after = await getDoc(page);
  expect(textOf(after, "q1")).toBe("quoZnt item");
  expect(blockExists(after, "li1")).toBe(false);
});

test("editing: cross-block delete of a nested list range merges and drops the nested item", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "li1", offset: 6 }, focus: { blockId: "o1", offset: 1 } }),
  );
  await page.keyboard.press("Backspace");

  const after = await getDoc(page);
  expect(textOf(after, "li1")).toBe("parentne");
  expect(blockExists(after, "li1a")).toBe(false); // nested child was inside the removed subtree
  expect(blockExists(after, "o1")).toBe(false);
  expect(textOf(after, "o2")).toBe("two"); // untouched sibling
});

test("editing: Backspace at the start of a list item converts it to a paragraph, then merges", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("li1a", 0));

  await page.keyboard.press("Backspace");
  let after = await getDoc(page);
  expect(blockType(after, "li1a")).toBe("paragraph"); // converted, not yet merged
  expect(textOf(after, "li1a")).toBe("child item");
  expect(textOf(after, "li1")).toBe("parent item");

  await page.keyboard.press("Backspace");
  after = await getDoc(page);
  expect(blockExists(after, "li1a")).toBe(false);
  expect(textOf(after, "li1")).toBe("parent itemchild item");
});

test("editing: deleteContentForward at a block's end selects an adjacent void instead of merging into it", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((len) => window.__julEditor!.setCaret("o3", len), textOf(before, "o3").length);

  await page.keyboard.press("Delete");

  expect(await getSelection(page)).toEqual({ type: "block", ids: ["v1"] });
  const after = await getDoc(page);
  expect(textOf(after, "o3")).toBe("three"); // untouched
  expect(blockExists(after, "v1")).toBe(true);
});

test("editing: Cmd+Backspace (deleteSoftLineBackward) clears to the start of the line", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate((len) => window.__julEditor!.setCaret("p1", len), textOf(before, "p1").length);

  await page.keyboard.press("Meta+Backspace");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("");
});

test("editing: Shift+Enter inserts a literal newline inside the block", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 5)); // "Hello| world"
  await page.keyboard.press("Shift+Enter");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("Hello\n world");
});

test("editing: a typing burst merges into one undo step (Cmd+Z reverts the whole burst)", async ({ page }) => {
  const before = await getDoc(page);
  const len = textOf(before, "p1").length;
  await page.evaluate((offset) => window.__julEditor!.setCaret("p1", offset), len);

  await page.keyboard.type("abc", { delay: 30 }); // well inside the 500ms merge window
  let after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "abc");

  await page.keyboard.press("Meta+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1")); // whole burst undone at once

  await page.keyboard.press("Meta+Shift+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "abc");
});

test("editing: Mod+A selects the current block's text, then (pressed again) the whole document", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 3));

  await page.keyboard.press("Meta+a");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 11 } });

  await page.keyboard.press("Meta+a");
  const sel = (await getSelection(page)) as { type: string; ids: string[] };
  expect(sel.type).toBe("block");
  expect(sel.ids).toEqual(["p1", "h1", "q1", "li1", "o1", "o2", "o3", "v1", "pEnd"]);
});

test("editing: undo and redo a multi-block replacement before typing again", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "q1", offset: 3 }, focus: { blockId: "li1", offset: 4 } }));
  await page.keyboard.type("XYZ");
  expect(textOf(await getDoc(page), "q1")).toBe("quoXYZnt item");
  await page.keyboard.press("Meta+z");
  expect(await getDoc(page)).toEqual(before);
  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.type("!");
  expect(textOf(await getDoc(page), "q1")).toBe("quoXYZ!nt item");
});

test("editing: redo of a null selection clears the old native range", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate(() => {
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 3 }, focus: { blockId: "o3", offset: 2 } });
    window.__julEditor!.editor.update((tx) => tx.setSelection(null).setProps("p1", { textAlign: "center" }));
  });
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.type("!");
  const after = await getDoc(page);
  expect(after.blocks.map((b) => b.id)).toEqual(before.blocks.map((b) => b.id));
  expect(textOf(after, "o3")).toBe("th!ree");
});

test("editing: typing follows the caret inside a scrolling editor", async ({ page }) => {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
    Object.assign(root.style, { height: "100px", overflow: "auto" });
    const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    window.__julEditor!.editor.update((tx) => tx.replaceContent("p1", 0, 11, [{ type: "text", text }]));
    window.__julEditor!.setCaret("p1", text.length);
    root.scrollTop = 0;
  });
  await page.keyboard.type("x");
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("[data-jul-editor-root]")!.scrollTop)).toBeGreaterThan(0);
});

for (const action of ["typing", "Enter", "paste"] as const) {
  test(`editing: ${action} scrolls the viewport to the caret`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 580 });
    await page.evaluate(() => {
      window.__julEditor!.editor.setDoc({ version: 1, blocks: [
        ...Array.from({ length: 100 }, (_, i) => ({ id: `scroll-${i}`, type: "paragraph", props: {}, content: [{ type: "text" as const, text: `line ${i}` }] })),
        { id: "last", type: "paragraph", props: {}, content: [{ type: "text", text: "End" }] },
      ] });
      window.__julEditor!.setCaret("last", 3);
      window.scrollTo(0, 0);
    });
    if (action === "typing") await page.keyboard.type("!");
    else if (action === "Enter") await page.keyboard.press("Enter");
    else await pasteText(page, "!");
    await expect.poll(() => page.evaluate(() => {
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      let rect = range.getBoundingClientRect();
      if (!rect.height && !rect.width) rect = (selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement)!.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && window.scrollY > 0;
    })).toBe(true);
    if (action !== "Enter") expect(textOf(await getDoc(page), "last")).toBe("End!");
  });
}

test("editing: selecting a void keeps the current page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 580 });
  await page.evaluate(() => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `void-scroll-${i}`, type: "paragraph", props: {}, content: [{ type: "text" as const, text: `line ${i}` }] })),
      { id: "last-void", type: "divider", props: {} },
      { id: "end", type: "paragraph", props: {}, content: [] },
    ] });
    document.querySelector('[data-id="last-void"]')!.scrollIntoView({ block: "center" });
    document.querySelector<HTMLElement>('[data-testid="toolbar-bold"]')!.focus({ preventScroll: true });
  });
  const position = await page.evaluate(() => {
    const rect = document.querySelector('[data-id="last-void"] [data-jul-editor-void]')!.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scroll: window.scrollY };
  });
  await page.mouse.click(position.x, position.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(position.scroll);
});

for (const offset of [3, 7]) test(`editing: shift arrows extend across one void at offset ${offset} and contract`, async ({ page }) => {
  await page.evaluate((offset) => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [
      { id: "head", type: "heading", props: {}, content: [{ type: "text", text: "Heading" }] },
      { id: "one", type: "divider", props: {} }, { id: "two", type: "divider", props: {} },
      { id: "end", type: "paragraph", props: {}, content: [] },
    ] });
    window.__julEditor!.setCaret("head", offset);
  }, offset);
  await page.keyboard.press("Shift+ArrowDown");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["head", "one"] });
  await page.keyboard.press("Shift+ArrowDown");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["head", "one", "two"] });
  await page.keyboard.press("Shift+ArrowUp");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["head", "one"] });
});

test("editing: redo after a split restores the new block caret", async ({ page }) => {
  await page.evaluate(() => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "abcd" }] }] });
    window.__julEditor!.setCaret("p", 2);
  });
  await page.keyboard.press("Enter");
  const next = (await getDoc(page)).blocks[1]!.id;
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.type("!");
  expect(textOf(await getDoc(page), "p")).toBe("ab");
  expect(textOf(await getDoc(page), next)).toBe("!cd");
});

test("editing: toolbar keyboard formatting retains toolbar focus", async ({ page }) => {
  await page.evaluate(() => {
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } });
    const button = document.querySelector<HTMLElement>('[data-testid="toolbar-bold"]')!;
    button.setAttribute("data-jul-editor-keep-selection", "");
    button.focus();
  });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("toolbar-bold")).toBeFocused();
  expect((await getDoc(page)).blocks[0]?.content?.[0]).toEqual({ type: "text", text: "Hello", marks: [{ type: "bold" }] });
});

test("editing: accessibility tree groups consecutive list items", async ({ page }) => {
  const snapshot = await page.locator("[data-jul-editor-root]").ariaSnapshot();
  expect(snapshot).toMatch(/list:\n\s+- listitem: one\n\s+- listitem: two\n\s+- listitem: three/);
});

test("editing: Tab exits a collapsed ordinary paragraph without indenting", async ({ page }) => {
  await page.evaluate(() => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [
      { id: "first", type: "paragraph", props: {}, content: [{ type: "text", text: "first" }] },
      { id: "second", type: "paragraph", props: {}, content: [{ type: "text", text: "second" }] },
    ] });
    window.__julEditor!.setCaret("second", 3);
  });
  const before = await getDoc(page);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-jul-editor-root"))).toBe(false);
  expect(await getDoc(page)).toEqual(before);
});

test("editing: keyboard focus returning from toolbar restores the text range", async ({ page }) => {
  await page.evaluate(() => {
    window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } });
    const button = document.querySelector<HTMLElement>('[data-testid="toolbar-bold"]')!;
    button.setAttribute("data-jul-editor-keep-selection", "");
    button.focus();
  });
  await page.keyboard.press("Enter");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await page.locator('[data-jul-editor-root]').evaluate((el) => el === document.activeElement)) break;
  }
  await expect(page.locator('[data-jul-editor-root]')).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Hello");
});

for (const { key, ids, expected } of [
  { key: "Tab", ids: ["y", "v"], expected: [["x", ["y"]], ["u", ["v"]]] },
  { key: "Shift+Tab", ids: ["y", "v"], expected: [["x"], ["u"], "y", "v"] },
  { key: "ControlOrMeta+Shift+ArrowUp", ids: ["y", "v"], expected: [["y", "x"], ["v", "u"]] },
  { key: "ControlOrMeta+Shift+ArrowDown", ids: ["x", "u"], expected: [["y", "x"], ["v", "u"]] },
]) test(`editing: ${key} moves independent selected runs as one history step`, async ({ page }) => {
  await page.evaluate((selected) => {
    const p = (id: string, children?: Array<{ id: string; type: string; props: {}; content: Array<{ type: "text"; text: string }> }>) => ({ id, type: "paragraph", props: {}, content: [{ type: "text" as const, text: id }], ...(children ? { children } : {}) });
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [p("a", [p("x"), p("y")]), p("b", [p("u"), p("v")]), p("end")] });
    window.__julEditor!.setSelection({ type: "block", ids: selected });
  }, ids);
  const before = await getDoc(page);
  await page.keyboard.press(key);
  const after = await getDoc(page);
  const a = after.blocks.find(b => b.id === "a")!;
  const b = after.blocks.find(b => b.id === "b")!;
  if (key === "Tab") {
    expect([a, b].map(parent => parent.children?.map(child => [child.id, child.children?.map(n => n.id)]))).toEqual(expected.map(group => [group]));
  } else if (key === "Shift+Tab") {
    expect([a.children?.map(n => n.id), b.children?.map(n => n.id), after.blocks[1]?.id, after.blocks[3]?.id]).toEqual(expected);
  } else {
    expect([a.children?.map(n => n.id), b.children?.map(n => n.id)]).toEqual(expected);
  }
  await page.keyboard.press("ControlOrMeta+z");
  expect(await getDoc(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await getDoc(page)).toEqual(after);
});

test("editing: native backward mixed-parent range never expands after moving", async ({ page }) => {
  await page.evaluate(() => {
    const p = (id: string, children?: Array<{ id: string; type: string; props: {}; content: Array<{ type: "text"; text: string }> }>) => ({ id, type: "paragraph", props: {}, content: [{ type: "text" as const, text: id }], ...(children ? { children } : {}) });
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [p("r"), p("a", [p("x"), p("y")]), p("b"), p("z")] });
    document.querySelector<HTMLElement>("[data-jul-editor-root]")!.focus();
    const selection = window.getSelection()!;
    const text = (id: string) => document.querySelector(`[data-id="${id}"] [data-jul-editor-content]`)!.firstChild!;
    selection.setBaseAndExtent(text("b"), 1, text("y"), 0);
  });
  await expect.poll(() => getSelection(page)).toEqual({ type: "text", anchor: { blockId: "b", offset: 1 }, focus: { blockId: "y", offset: 0 } });
  const before = await getDoc(page);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  const after = await getDoc(page);
  expect(after.blocks[1]?.children?.map(b => b.id)).toEqual(["y", "x"]);
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["y", "b"] });
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  expect(await getDoc(page)).toEqual(after);
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["y", "b"] });
  await page.keyboard.press("ControlOrMeta+z");
  expect(await getDoc(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await getDoc(page)).toEqual(after);
});
