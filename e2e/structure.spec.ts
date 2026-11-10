// Structural editing, formatting keys, markdown input rules, and the
// keymap/inputRule/suggestion extension points. Uses the "/editor" page
// (createEditor) -- e2e/helpers/editor-doc.ts for doc reads, e2e/helpers/ime.ts
// for the Korean-composition-while-suggestion-open case.

import { expect, test } from "@playwright/test";
import { blockExists, blockProps, blockType, childIds, getDoc, getSelection, textOf } from "./helpers/editor-doc.js";
import { composeSteps, commitComposition } from "./helpers/ime.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("End moves the editor caret without scrolling the document to its bottom", async ({ page }) => {
  await page.evaluate(() => {
    const before = document.createElement("div");
    const after = document.createElement("div");
    before.style.height = "700px";
    after.style.height = "1200px";
    document.body.prepend(before);
    document.body.append(after);
    window.__julEditor!.setCaret("p1", 2);
  });
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("End");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 11 }, focus: { blockId: "p1", offset: 11 } });
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.keyboard.press("Home");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } });
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 2));
  await page.keyboard.press("Shift+End");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "p1", offset: 2 }, focus: { blockId: "p1", offset: 11 } });
});

test("a key that changes nothing leaves a page scrolled away from the caret where it is", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 580 });
  await page.evaluate(() => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `line-${i}`, type: "paragraph", props: {}, content: [{ type: "text" as const, text: `line ${i}` }] })),
      { id: "last", type: "paragraph", props: {}, content: [{ type: "text", text: "End" }] },
    ] });
    window.__julEditor!.setCaret("last", 3);
  });
  await page.keyboard.type("!");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const key of ["Shift", "ControlOrMeta+c", "PageUp"]) {
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }
  await page.keyboard.type("!");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("Shift+ArrowDown from a text range takes in the next void instead of jumping past it", async ({ page }) => {
  await page.evaluate(() => {
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [
      { id: "head", type: "heading", props: {}, content: [{ type: "text", text: "Heading" }] },
      { id: "one", type: "divider", props: {} }, { id: "two", type: "divider", props: {} },
      { id: "end", type: "paragraph", props: {}, content: [{ type: "text", text: "end" }] },
    ] });
    window.__julEditor!.setCaret("head", 3);
  });
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await getSelection(page)).toEqual({ type: "block", ids: ["head", "one"] });
});

async function modKey(page: import("@playwright/test").Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  return mac ? "Meta" : "Control";
}

// ---- default input rules ----------------------------------------------------

test("structure: '# ' converts to a level-1 heading", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("# Hi", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("heading");
  // level 1 IS heading's schema default, so it's omitted from stored props.
  expect((blockProps(after, "pEnd") as { level?: number }).level ?? 1).toBe(1);
  expect(textOf(after, "pEnd")).toBe("Hi");
});

test("structure: '## ' converts to a level-2 heading", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("## Hi", { delay: 10 });
  const after = await getDoc(page);
  expect((blockProps(after, "pEnd") as { level: number }).level).toBe(2);
});

test("structure: '- ' converts to a bullet list item", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("- item", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("bulletListItem");
  expect(textOf(after, "pEnd")).toBe("item");
});

test("structure: '1. ' converts to an ordered list item", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("1. item", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("orderedListItem");
});

test("structure: '[x] ' converts to a checked todo item", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("[x] done", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("todoListItem");
  expect((blockProps(after, "pEnd") as { checked: boolean }).checked).toBe(true);
  expect(textOf(after, "pEnd")).toBe("done");
});

test("structure: '[] ' converts to an unchecked todo item", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("[] todo", { delay: 10 });
  const after = await getDoc(page);
  // checked:false IS todoListItem's schema default, so it's omitted.
  expect((blockProps(after, "pEnd") as { checked?: boolean }).checked ?? false).toBe(false);
});

test("structure: '> ' converts to a quote", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("> wise words", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("quote");
  expect(textOf(after, "pEnd")).toBe("wise words");
});

test("structure: '---' converts to a divider instantly on the 3rd dash (Notion) and adds a following paragraph", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("---", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("divider");
  const roots = childIds(after, null);
  const nextId = roots[roots.indexOf("pEnd") + 1];
  expect(nextId).toBeTruthy();
  expect(blockType(after, nextId!)).toBe("paragraph");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: nextId, offset: 0 }, focus: { blockId: nextId, offset: 0 } });
});

// Each inline rule gets its OWN fresh empty block: typing one right after
// another on the SAME line would inherit the previous run's marks (stored-
// marks context inheritance, by design -- see the "stored marks" test below),
// which is exactly what would make a combined test flaky/misleading here.
for (const [markup, text, markType] of [
  ["**bold**", "bold", "bold"],
  ["_ital_", "ital", "italic"],
  ["`code`", "code", "code"],
  ["~~gone~~", "gone", "strike"],
] as const) {
  test(`structure: inline ${markup} applies the ${markType} mark`, async ({ page }) => {
    await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
    await page.keyboard.type(markup, { delay: 10 });
    const after = await getDoc(page);
    const content = after.blocks.find((b) => b.id === "pEnd")!.content!;
    const runs = content.filter((inl) => inl.type === "text") as { type: "text"; text: string; marks?: { type: string }[] }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe(text);
    expect(runs[0]!.marks?.map((m) => m.type)).toEqual([markType]);
  });
}

test("structure: Backspace right after an auto-conversion reverts it (Notion/Google Docs)", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("# ", { delay: 10 });
  expect(blockType(await getDoc(page), "pEnd")).toBe("heading");

  await page.keyboard.press("Backspace");
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("paragraph");
  expect(textOf(after, "pEnd")).toBe("# ");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "pEnd", offset: 2 }, focus: { blockId: "pEnd", offset: 2 } });
});

test("structure: stored marks -- toggling Mod-b with a collapsed caret applies to the NEXT typed text only", async ({ page }) => {
  const mod = await modKey(page);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("bold", { delay: 10 });
  await page.keyboard.press(`${mod}+b`); // toggle back off
  await page.keyboard.type("plain", { delay: 10 });

  const after = await getDoc(page);
  const content = after.blocks.find((b) => b.id === "pEnd")!.content!;
  const runs = content.filter((inl) => inl.type === "text") as { type: "text"; text: string; marks?: { type: string }[] }[];
  expect(runs.map((r) => ({ text: r.text, bold: !!r.marks?.some((m) => m.type === "bold") }))).toEqual([
    { text: "bold", bold: true },
    { text: "plain", bold: false },
  ]);
});

// ---- table ------------------------------------------------------------------

async function insertTestTable(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const cell = (id: string, text: string) => ({ id, type: "tableCell", props: {}, content: [{ type: "text", text }] });
    const table = {
      id: "tbl",
      type: "table",
      props: {},
      children: [
        { id: "r1", type: "tableRow", props: {}, children: [cell("r1c1", "a"), cell("r1c2", "b")] },
        { id: "r2", type: "tableRow", props: {}, children: [cell("r2c1", "c"), cell("r2c2", "d")] },
      ],
    };
    window.__julEditor!.editor.update((tx) => tx.insertBlock(null, 9, table as never));
  });
}

test("structure: table Tab moves to the next cell (wrapping rows), Shift-Tab back", async ({ page }) => {
  await insertTestTable(page);
  await page.evaluate(() => window.__julEditor!.setCaret("r1c1", 0));

  // Tab lands at the END of the next cell, same as Shift-Tab (typing appends instead of prefixing).
  await page.keyboard.press("Tab");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "r1c2", offset: 1 }, focus: { blockId: "r1c2", offset: 1 } });

  await page.keyboard.press("Tab");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "r2c1", offset: 1 }, focus: { blockId: "r2c1", offset: 1 } });

  await page.keyboard.press("Shift+Tab");
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "r1c2", offset: 1 }, focus: { blockId: "r1c2", offset: 1 } });
});

test("structure: Tab in the last cell of the last row appends a new row", async ({ page }) => {
  await insertTestTable(page);
  await page.evaluate(() => window.__julEditor!.setCaret("r2c2", 1));

  await page.keyboard.press("Tab");
  const after = await getDoc(page);
  const table = after.blocks.find((b) => b.id === "tbl")!;
  expect(table.children).toHaveLength(3);
  const newRow = table.children![2]!;
  expect(newRow.children).toHaveLength(2);
  const newCellId = newRow.children![0]!.id;
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: newCellId, offset: 0 }, focus: { blockId: newCellId, offset: 0 } });
});

// ---- codeBlock ---------------------------------------------------------------

async function insertTestCodeBlock(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__julEditor!.editor.update((tx) =>
      tx.insertBlock(null, 9, { id: "cb", type: "codeBlock", props: { language: "js" }, content: [{ type: "text", text: "let x = 1;" }] } as never),
    );
  });
}

test("structure: Enter inside a codeBlock inserts a literal newline (no split)", async ({ page }) => {
  await insertTestCodeBlock(page);
  await page.evaluate(() => window.__julEditor!.setCaret("cb", "let x = 1;".length));
  await page.keyboard.press("Enter");
  await page.keyboard.type("let y = 2;", { delay: 10 });

  const after = await getDoc(page);
  expect(blockExists(after, "cb")).toBe(true);
  expect(blockType(after, "cb")).toBe("codeBlock");
  expect(textOf(after, "cb")).toBe("let x = 1;\nlet y = 2;");
});

test("structure: Mod-Enter exits a codeBlock into a new paragraph after it", async ({ page }) => {
  const mod = await modKey(page);
  await insertTestCodeBlock(page);
  await page.evaluate(() => window.__julEditor!.setCaret("cb", "let x = 1;".length));
  await page.keyboard.press(`${mod}+Enter`);

  const after = await getDoc(page);
  const roots = childIds(after, null);
  const nextId = roots[roots.indexOf("cb") + 1];
  expect(blockType(after, nextId!)).toBe("paragraph");
  expect(textOf(after, "cb")).toBe("let x = 1;"); // unchanged
  const sel = (await getSelection(page)) as { type: string; anchor: { blockId: string } };
  expect(sel.anchor.blockId).toBe(nextId);
});

test("structure: Tab inside a codeBlock indents the code, never the block; Shift-Tab undoes it", async ({ page }) => {
  await insertTestCodeBlock(page);
  await page.evaluate(() => window.__julEditor!.setCaret("cb", 0));
  await page.keyboard.press("Tab");
  let after = await getDoc(page);
  expect(childIds(after, null)).toContain("cb"); // still a root block (not nested under its previous sibling)
  expect(textOf(after, "cb")).toBe("  let x = 1;");
  await page.keyboard.press("Shift+Tab");
  after = await getDoc(page);
  expect(childIds(after, null)).toContain("cb");
  expect(textOf(after, "cb")).toBe("let x = 1;");
});

test("structure: a word typed after ``` stays code unless it names a language", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("```", { delay: 10 });
  await page.keyboard.type("const x = 1", { delay: 10 });
  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("codeBlock");
  expect(textOf(after, "pEnd")).toBe("const x = 1");
});

// ---- todo Mod-Enter -----------------------------------------------------------

test("structure: Mod-Enter toggles a todo item's checked state", async ({ page }) => {
  const mod = await modKey(page);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("[] task", { delay: 10 });
  expect((blockProps(await getDoc(page), "pEnd") as { checked?: boolean }).checked ?? false).toBe(false);

  await page.keyboard.press(`${mod}+Enter`);
  expect((blockProps(await getDoc(page), "pEnd") as { checked?: boolean }).checked).toBe(true);

  await page.keyboard.press(`${mod}+Enter`);
  expect((blockProps(await getDoc(page), "pEnd") as { checked?: boolean }).checked ?? false).toBe(false);
});

// ---- move block up/down (Mod-Shift-ArrowUp/Down) -----------------------------

test("structure: Mod-Shift-ArrowUp/Down swaps a block among its siblings", async ({ page }) => {
  const mod = await modKey(page);
  await page.evaluate(() => window.__julEditor!.setCaret("o2", 0));
  await page.keyboard.press(`${mod}+Shift+ArrowUp`);

  let after = await getDoc(page);
  const roots = childIds(after, null);
  expect(roots.indexOf("o2")).toBe(roots.indexOf("o1") - 1);

  await page.keyboard.press(`${mod}+Shift+ArrowDown`);
  after = await getDoc(page);
  expect(childIds(after, null).indexOf("o2")).toBe(childIds(after, null).indexOf("o1") + 1);
});

test("structure: Mod-Shift-ArrowUp on a nested block's first child moves it OUT to become its parent's previous sibling", async ({ page }) => {
  const mod = await modKey(page);
  expect(childIds(await getDoc(page), "li1")).toEqual(["li1a"]); // precondition: li1a is li1's only (first) child
  await page.evaluate(() => window.__julEditor!.setCaret("li1a", 0));
  await page.keyboard.press(`${mod}+Shift+ArrowUp`);

  const after = await getDoc(page);
  expect(childIds(after, "li1")).toEqual([]); // li1a left li1's children entirely
  const roots = childIds(after, null);
  expect(roots.indexOf("li1a")).toBe(roots.indexOf("li1") - 1); // ...to become li1's own previous sibling
});

// ---- extension points: registerKeymap priority + block-level precedence -----

test("structure: registerKeymap priority -- higher-priority registration wins, lower is never called", async ({ page }) => {
  const mod = await modKey(page);
  await page.evaluate(() => {
    (window as unknown as { __log: string[] }).__log = [];
    window.__julEditor!.editor.registerKeymap(
      {
        "Mod-b": () => {
          (window as unknown as { __log: string[] }).__log.push("low");
          return true;
        },
      },
      { priority: 1 },
    );
    window.__julEditor!.editor.registerKeymap(
      {
        "Mod-b": () => {
          (window as unknown as { __log: string[] }).__log.push("high");
          return true;
        },
      },
      { priority: 10 },
    );
  });
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.press(`${mod}+b`);

  const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log);
  expect(log).toEqual(["high"]);
});

test("structure: block-level keymap runs before ANY registered keymap, regardless of priority", async ({ page }) => {
  await insertTestTable(page);
  await page.evaluate(() => {
    (window as unknown as { __log: string[] }).__log = [];
    window.__julEditor!.editor.registerKeymap(
      {
        Tab: () => {
          (window as unknown as { __log: string[] }).__log.push("registered");
          return true;
        },
      },
      { priority: 1000 },
    );
  });
  await page.evaluate(() => window.__julEditor!.setCaret("r1c1", 0));
  await page.keyboard.press("Tab");

  const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log);
  expect(log).toEqual([]); // tableCell's own block-level Tab handler wins, the registered one never runs
  expect(await getSelection(page)).toEqual({ type: "text", anchor: { blockId: "r1c2", offset: 1 }, focus: { blockId: "r1c2", offset: 1 } });
});

// ---- suggestion controller: Korean composition updates the open query -------

test("structure: a slash suggestion's query updates mid-composition (Korean)", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __events: unknown[] }).__events = [];
    window.__julEditor!.editor.registerSuggestion({
      char: "/",
      onUpdate: (s) => (window as unknown as { __events: unknown[] }).__events.push({ open: s.open, query: s.query }),
    });
  });
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("/", { delay: 20 });
  await composeSteps(page, ["ㅍ", "표"]);

  const events = await page.evaluate(() => (window as unknown as { __events: { open: boolean; query: string }[] }).__events);
  expect(events.some((e) => e.open && e.query === "표")).toBe(true); // updated WHILE composing, not only after commit

  await commitComposition(page, "표");
  const finalEvents = await page.evaluate(() => (window as unknown as { __events: { open: boolean; query: string }[] }).__events);
  expect(finalEvents[finalEvents.length - 1]).toEqual({ open: true, query: "표" });
});
