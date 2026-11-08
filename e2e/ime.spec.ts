// Full IME coverage on top of ime-spike.spec.ts (kept separately,
// untouched) and the editing/structure/keymap/inputRule/suggestion
// surface. Chromium only -- CDP's Input.imeSetComposition is Chromium-
// specific; see the "@smoke" test at the
// bottom for the webkit/firefox cross-browser sanity check, and
// e2e/ime-manual.md for what only a real OS IME can verify.
//
// Scenarios ported from Lexical's own composition tests
// (refs/lexical/packages/lexical-playground/__tests__/e2e/Composition.spec.mjs:250,377,421,461
// -- "at the end of a mention", "part way through a mention", "into a new
// bold format", "typing after mention with IME") adapted to OUR mention
// model: atomic (length 1, never internally editable), not Lexical's
// TextNode-segmented one -- so where Lexical's own mention dissolves into
// plain text when composed into, ours must stay intact and the composed text
// must land OUTSIDE it.

import { expect, test } from "@playwright/test";
import { blockExists, blockType, childIds, getDoc, textOf } from "./helpers/editor-doc.js";
import { cancelComposition, commitComposition, composeSteps, typeComposed } from "./helpers/ime.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await cancelComposition(page).catch(() => {}); // best-effort: don't leak an open composition (page reloads per test anyway)
});

async function modKey(page: import("@playwright/test").Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  return mac ? "Meta" : "Control";
}

async function insertTestTable(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const cell = (id: string, text: string) => ({ id, type: "tableCell", props: {}, content: [{ type: "text", text }] });
    const table = {
      id: "tbl",
      type: "table",
      props: {},
      children: [{ id: "r1", type: "tableRow", props: {}, children: [cell("r1c1", "a"), cell("r1c2", "b")] }],
    };
    window.__julEditor!.editor.update((tx) => tx.insertBlock(null, 9, table as never));
  });
}

async function insertTestCodeBlock(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__julEditor!.editor.update((tx) =>
      tx.insertBlock(null, 9, { id: "cb", type: "codeBlock", props: { language: "js" }, content: [{ type: "text", text: "let x = 1;" }] } as never),
    );
  });
}

async function setupMentionParagraph(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__julEditor!.editor.update((tx) =>
      tx.replaceContent("pEnd", 0, 0, [
        { type: "text", text: "see " },
        { type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } },
        { type: "text", text: " now" },
      ] as never),
    );
  });
}

/** Places the real DOM selection collapsed at `offset` inside the mention's
 * own rendered label text node -- not representable as a model Point (a
 * mention is exactly 1 offset unit), so this is the only way to test what
 * happens when a real browser caret physically lands mid-mention. */
async function setDomCaretInMention(page: import("@playwright/test").Page, blockId: string, offset: number): Promise<void> {
  await page.evaluate(
    ({ blockId, offset }) => {
      document.querySelector<HTMLElement>("[data-jul-editor-root]")?.focus();
      const contentEl = document.querySelector(`[data-id="${blockId}"] [data-jul-editor-content]`)!;
      const mentionEl = contentEl.querySelector("[data-mention]")!;
      const textNode = mentionEl.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { blockId, offset },
  );
}

// ---- 1. composition then Enter, then Backspace ------------------------------

test("ime: composition then Enter splits keeping the full syllable, then Backspace merges it back", async ({ page }) => {
  const before = await getDoc(page);
  const offset = textOf(before, "p1").length;
  await page.evaluate((o) => window.__julEditor!.setCaret("p1", o), offset);

  await composeSteps(page, ["ㅎ", "하", "한"]);
  await commitComposition(page, "한");
  await page.keyboard.press("Enter");

  let after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("Hello world한");
  const roots = childIds(after, null);
  const nextId = roots[roots.indexOf("p1") + 1]!;
  expect(blockType(after, nextId)).toBe("paragraph");
  expect(textOf(after, nextId)).toBe("");

  await page.keyboard.press("Backspace");
  after = await getDoc(page);
  expect(blockExists(after, nextId)).toBe(false);
  expect(textOf(after, "p1")).toBe("Hello world한"); // merged back, syllable intact -- not lost or duplicated
});

// ---- 2. composition then blur ------------------------------------------------

test("ime: composition then blur (click elsewhere) commits exactly once", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await composeSteps(page, ["ㅎ", "하", "한", "한ㄱ", "한글"]);
  await page.getByTestId("blur-target").click();

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("한글");
  expect(textOf(after, "pEnd").match(/한글/g)?.length).toBe(1);
});

// ---- 3. a programmatic command right after composition flushes first -------

test("ime: a toolbar-style command right after composition flushes the pending sync first, no duplicate", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await typeComposed(page, ["ㅎ", "하", "한", "한ㄱ", "한글"], "한글");
  // A real toolbar button's click handler calls the command directly --
  // unlike a keyboard shortcut, it never goes through onKeyDown's
  // e.isComposing guard at all (a toolbar command like Bold runs after
  // the pending composition sync is flushed). The caret is collapsed at the end of "한글", so
  // this is a STORED-mark toggle (applies to the NEXT typed text, same as
  // any other collapsed Mod-b) -- the thing under test is that it operates
  // on a state that already reflects the composed "한글" (flushed first),
  // not that it retroactively re-marks already-typed text.
  await page.getByTestId("toolbar-bold").click();
  await page.keyboard.type("X", { delay: 10 });

  const after = await getDoc(page);
  const content = after.blocks.find((b) => b.id === "pEnd")!.content!;
  const runs = content.filter((inl) => inl.type === "text") as { type: "text"; text: string; marks?: { type: string }[] }[];
  expect(runs.map((r) => ({ text: r.text, bold: !!r.marks?.some((m) => m.type === "bold") }))).toEqual([
    { text: "한글", bold: false }, // no duplication, still plain
    { text: "X", bold: true }, // the toggle (post-flush) took effect on what's typed after it
  ]);
});

// ---- 4. composition around a mention -----------------------------------------

test("ime: composition right after a mention leaves the mention intact", async ({ page }) => {
  await setupMentionParagraph(page);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", "see ".length + 1)); // +1 = the mention's own 1 unit
  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  const mentionRun = after.blocks.find((b) => b.id === "pEnd")?.content?.find((inl) => inl.type === "mention");
  expect(mentionRun).toEqual({ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } });
  expect(textOf(after, "pEnd")).toBe("see @Alice한 now");
});

test("ime: composition part-way inside a mention lands outside it, mention intact", async ({ page }) => {
  await setupMentionParagraph(page);
  await setDomCaretInMention(page, "pEnd", 2); // somewhere inside "@Alice"'s own label text
  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  const mentionRun = after.blocks.find((b) => b.id === "pEnd")?.content?.find((inl) => inl.type === "mention");
  expect(mentionRun).toEqual({ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } });
  expect(textOf(after, "pEnd")).toBe("see @Alice한 now"); // clamped to right after the mention, never split into it
});

test("ime: composition at the very end of a mention's label lands after it, mention intact", async ({ page }) => {
  await setupMentionParagraph(page);
  await setDomCaretInMention(page, "pEnd", "@Alice".length);
  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  const mentionRun = after.blocks.find((b) => b.id === "pEnd")?.content?.find((inl) => inl.type === "mention");
  expect(mentionRun).toEqual({ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } });
  expect(textOf(after, "pEnd")).toBe("see @Alice한 now");
});

// ---- 5. composition into a new bold stored mark ------------------------------

test("ime: composing into a freshly toggled stored bold mark makes the composed text bold", async ({ page }) => {
  const mod = await modKey(page);
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.press(`${mod}+b`);
  await typeComposed(page, ["ㅎ", "하", "한", "한ㄱ", "한글"], "한글");

  const after = await getDoc(page);
  const content = after.blocks.find((b) => b.id === "pEnd")!.content!;
  const runs = content.filter((inl) => inl.type === "text") as { type: "text"; text: string; marks?: { type: string }[] }[];
  expect(runs.map((r) => ({ text: r.text, bold: !!r.marks?.some((m) => m.type === "bold") }))).toEqual([{ text: "한글", bold: true }]);
});

// ---- 6. composition in every kind of position/block --------------------------

test("ime: composition at a block's own start inserts before the existing text", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate(() => window.__julEditor!.setCaret("p1", 0));
  await typeComposed(page, ["ㅁ", "머", "먼", "먼ㅈ", "먼저"], "먼저");

  const after = await getDoc(page);
  expect(textOf(after, "p1")).toBe("먼저" + textOf(before, "p1"));
});

test("ime: composition in an empty block", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await typeComposed(page, ["ㅌ", "테", "테ㅅ", "테스", "테스트"], "테스트");

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("테스트");
});

test("ime: composition inside a table cell", async ({ page }) => {
  await insertTestTable(page);
  await page.evaluate(() => window.__julEditor!.setCaret("r1c1", 1));
  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  expect(textOf(after, "r1c1")).toBe("a한");
});

test("ime: composition inside a list item", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("li1", "parent ".length));
  await typeComposed(page, ["ㄷ", "다", "단", "단어"], "단어");

  const after = await getDoc(page);
  expect(textOf(after, "li1")).toBe("parent 단어item");
});

test("ime: composition inside a codeBlock does not trigger markdown input rules", async ({ page }) => {
  await insertTestCodeBlock(page);
  await page.evaluate(() => window.__julEditor!.setCaret("cb", "let x = 1;".length));
  await page.keyboard.type("\n# ", { delay: 10 });

  let after = await getDoc(page);
  expect(blockType(after, "cb")).toBe("codeBlock"); // '# ' must NOT convert this to a heading
  expect(textOf(after, "cb")).toBe("let x = 1;\n# ");

  await typeComposed(page, ["ㅎ", "하", "한"], "한");
  after = await getDoc(page);
  expect(blockType(after, "cb")).toBe("codeBlock");
  expect(textOf(after, "cb")).toBe("let x = 1;\n# 한");
});

// ---- 7. fast consecutive compositions ----------------------------------------

test("ime: five fast consecutive composition sequences build up '안녕하세요' without loss or duplication", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  const syllables: Array<{ steps: string[]; commit: string }> = [
    { steps: ["ㅇ", "아", "안"], commit: "안" },
    { steps: ["ㄴ", "녀", "녕"], commit: "녕" },
    { steps: ["ㅎ", "하"], commit: "하" },
    { steps: ["ㅅ", "세"], commit: "세" },
    { steps: ["ㅇ", "요"], commit: "요" },
  ];
  for (const s of syllables) await typeComposed(page, s.steps, s.commit);

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("안녕하세요");
});

// ---- 8. composition after pre-deleting a cross-block selection --------------

test("ime: composition after pre-deleting a non-collapsed cross-block selection merges the blocks correctly", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "q1", offset: 3 }, focus: { blockId: "li1", offset: 4 } }));
  await typeComposed(page, ["ㅎ", "하", "한"], "한");

  const after = await getDoc(page);
  expect(textOf(after, "q1")).toBe("quo한nt item");
  expect(blockExists(after, "li1")).toBe(false);
});

// ---- 9. composition while a suggestion menu is open --------------------------

test("ime: a slash suggestion's query updates while composing, Enter selects without leaking the composed text", async ({ page }) => {
  await page.evaluate(() => {
    type Sugg = { open: boolean; query: string; range: { blockId: string; from: number; to: number } | null };
    const win = window as unknown as { __sugg?: Sugg };
    // `onKey` needs the handle's own `replaceRange`, but the handle is only
    // returned AFTER registration -- a holder object sidesteps the "used
    // before assigned" ordering issue (onKey only ever fires later, off a
    // real keydown, by which point the holder is already filled in).
    const holder: { replaceRange?: (range: NonNullable<Sugg["range"]>, content: { type: string; text: string }[]) => void } = {};
    const handle = window.__julEditor!.editor.registerSuggestion({
      char: "/",
      onUpdate: (s) => {
        win.__sugg = s;
      },
      onKey: (e) => {
        const sugg = win.__sugg;
        if (e.key !== "Enter" || !sugg?.open || !sugg.range) return false;
        holder.replaceRange?.(sugg.range, [{ type: "text", text: "TABLE" }]);
        return true;
      },
    });
    holder.replaceRange = handle.replaceRange;
  });
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("/", { delay: 20 });
  await composeSteps(page, ["ㅍ", "표"]);

  const midQuery = await page.evaluate(() => (window as unknown as { __sugg?: { query: string } }).__sugg?.query);
  expect(midQuery).toBe("표"); // updated WHILE composing, not only after commit

  await commitComposition(page, "표");
  await page.keyboard.press("Enter");

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("TABLE"); // neither "/" nor "표" leaked into the final content
});

// ---- 10. input rule (ASCII marker) then composition --------------------------

test("ime: '# ' converts to heading, then composed '제목' becomes the heading text", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("# ", { delay: 10 });
  expect(blockType(await getDoc(page), "pEnd")).toBe("heading");

  await typeComposed(page, ["ㅈ", "제", "제ㅁ", "제무", "제목"], "제목");

  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("heading");
  expect(textOf(after, "pEnd")).toBe("제목");
});

test("ime: '1. ' converts to an ordered list item, then composed '항목' becomes its text", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("1. ", { delay: 10 });
  expect(blockType(await getDoc(page), "pEnd")).toBe("orderedListItem");

  await typeComposed(page, ["ㅎ", "하", "항", "항ㅁ", "항모", "항목"], "항목");

  const after = await getDoc(page);
  expect(blockType(after, "pEnd")).toBe("orderedListItem");
  expect(textOf(after, "pEnd")).toBe("항목");
});

// ---- 11. Japanese composition with a kanji replacement -----------------------

test("ime: Japanese composition with a kanji replacement commits '日本語', not the raw hiragana", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await composeSteps(page, ["に", "にほ", "にほん", "にほんご"]);
  await commitComposition(page, "日本語"); // Input.insertText's own "text" param IS the real committed replacement -- how a real Japanese IME's space-to-convert-then-Enter also differs from its raw hiragana composition steps.

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("日本語");
});

// ---- 12. undo after composition -----------------------------------------------

test("ime: undo after composition removes the whole composed word in one step", async ({ page }) => {
  const before = await getDoc(page);
  const len = textOf(before, "p1").length;
  await page.evaluate((o) => window.__julEditor!.setCaret("p1", o), len);
  await typeComposed(page, ["ㅎ", "하", "한", "한ㄱ", "한글"], "한글");

  let after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1") + "한글");

  await page.keyboard.press("Meta+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1")); // the whole composed word undone in one step, not syllable-by-syllable
});

// ---- 13. simulated autocorrect/replacement -----------------------------------

test("ime: insertReplacementText (simulated autocorrect) replaces a misspelled word", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("I said wrold today", { delay: 5 });

  await page.evaluate(() => {
    const contentEl = document.querySelector('[data-id="pEnd"] [data-jul-editor-content]')!;
    const textNode = contentEl.firstChild as Text;
    const text = textNode.textContent ?? "";
    const start = text.indexOf("wrold");
    const end = start + "wrold".length;
    // Real browsers only populate getTargetRanges() for a TRUSTED (native)
    // beforeinput -- a script-dispatched one may or may not, so the real DOM
    // selection is also set as a second, always-honored path (onInsertText
    // falls back to it via readDOMSelection when getTargetRanges() is empty).
    const domRange = document.createRange();
    domRange.setStart(textNode, start);
    domRange.setEnd(textNode, end);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(domRange);
    const staticRange = new StaticRange({ startContainer: textNode, startOffset: start, endContainer: textNode, endOffset: end });
    const ev = new InputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: "world",
      bubbles: true,
      cancelable: true,
      targetRanges: [staticRange],
    } as InputEventInit & { targetRanges: StaticRange[] });
    contentEl.dispatchEvent(ev);
  });

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("I said world today");
});

// ---- @smoke: cross-browser sanity (NOT a real IME) --------------------------

test("ime @smoke: ASCII typing + keyboard.insertText('한글') sanity check (not a true IME)", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await page.keyboard.type("abc", { delay: 20 });
  // Playwright's insertText fires a single input event with the given text --
  // it does NOT drive a real OS composition sequence (no compositionstart/
  // update/end at all), so this only catches gross cross-browser regressions
  // in the plain absorb path, never a genuine IME race. See e2e/ime-manual.md
  // for what still needs a human with a real IME.
  await page.keyboard.insertText("한글");

  const after = await getDoc(page);
  expect(textOf(after, "pEnd")).toBe("abc한글");
});
