// Clipboard: copy/cut/paste (markdown, HTML, jul-editor-json), XSS
// safety. Uses the "/editor" page (createEditor) + e2e/helpers/clipboard.ts's
// synthetic ClipboardEvent dispatch (the real OS clipboard is unavailable in
// headless chromium). e2e/helpers/editor-doc.ts for doc reads.

import { expect, test } from "@playwright/test";
import { blockType, childIds, getDoc, textOf } from "./helpers/editor-doc.js";
import { copySelection, cutSelection, pasteHTML, pasteJulEditorJson, pasteText } from "./helpers/clipboard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByTestId("page-editor")).toBeVisible();
});

test("clipboard: copy a block selection (marks/mentions/nesting) and paste it elsewhere round-trips exactly", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.editor.setDoc({
      version: 1,
      blocks: [
        {
          id: "src",
          type: "bulletListItem",
          props: {},
          content: [
            { type: "text", text: "bold ", marks: [{ type: "bold" }] },
            { type: "mention", attrs: { kind: "user", id: "u1", label: "Bo" } },
            { type: "text", text: " end" },
          ],
          children: [{ id: "srcChild", type: "bulletListItem", props: {}, content: [{ type: "text", text: "nested" }] }],
        },
        { id: "dst", type: "paragraph", props: {}, content: [] },
      ],
    }),
  );
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "block", ids: ["src"] }));

  const { json } = await copySelection(page);
  expect(json.length).toBeGreaterThan(0);

  await page.evaluate(() => window.__julEditor!.setSelection({ type: "block", ids: ["dst"] }));
  await pasteJulEditorJson(page, json);

  const doc = await getDoc(page);
  expect(childIds(doc, null)).toEqual(["src", expect.any(String)]);
  const pastedId = childIds(doc, null)[1]!;
  expect(blockType(doc, pastedId)).toBe("bulletListItem");
  expect(doc.blocks.find((b) => b.id === pastedId)!.content).toEqual([
    { type: "text", text: "bold ", marks: [{ type: "bold" }] },
    { type: "mention", attrs: { kind: "user", id: "u1", label: "Bo" } },
    { type: "text", text: " end" },
  ]);
  expect(childIds(doc, pastedId).length).toBe(1);
  expect(textOf(doc, childIds(doc, pastedId)[0]!)).toBe("nested");
  // ids were reissued, not copied verbatim (decodeClipboard's contract)
  expect(pastedId).not.toBe("src");
  expect(childIds(doc, pastedId)[0]).not.toBe("srcChild");
});

test("clipboard: paste HTML from a Google Docs sample (font-weight:normal wrapper, span marks)", async ({ page }) => {
  const html =
    '<meta charset="utf-8">' +
    '<b style="font-weight:normal;" id="docs-internal-guid-1234">' +
    '<p dir="ltr">Hello <span style="font-weight:700">world</span></p>' +
    "</b>";
  // pEnd starts empty and the pasted fragment is a single block, so per
  // buildInsertFragmentOps's "single text-content fragment merges inline"
  // rule this lands as pEnd's OWN content (no new block) -- see
  // packages/core/src/store/edits.ts.
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await pasteHTML(page, html);

  const doc = await getDoc(page);
  expect(textOf(doc, "pEnd")).toBe("Hello world");
  const content = doc.blocks.find((b) => b.id === "pEnd")!.content!;
  const bold = content.find((inl) => inl.type === "text" && inl.marks?.some((m) => m.type === "bold"));
  expect(bold).toBeDefined();
});

test("clipboard: paste markdown text (heading + bold) parses through fromMarkdown", async ({ page }) => {
  // A BLOCK-selection target (rather than a text caret) so the two parsed
  // blocks (heading, paragraph) are inserted verbatim, types included --
  // pasting at a text caret would instead merge the fragment's own content
  // into the target block per buildInsertFragmentOps' merge rule, which is a
  // different (already store-unit-tested) behavior, not what this test cares
  // about (that fromMarkdown parsed the right block types from the syntax).
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "block", ids: ["pEnd"] }));
  await pasteText(page, "# Heading\n\nSome **bold** text");

  const doc = await getDoc(page);
  const ids = childIds(doc, null);
  const headingId = ids.find((id) => blockType(doc, id) === "heading" && textOf(doc, id) === "Heading");
  expect(headingId).toBeTruthy();
  const paraId = ids.find((id) => textOf(doc, id) === "Some bold text");
  expect(paraId).toBeTruthy();
  const content = doc.blocks.find((b) => b.id === paraId)!.content!;
  const bold = content.find((inl) => inl.type === "text" && inl.text === "bold" && inl.marks?.some((m) => m.type === "bold"));
  expect(bold).toBeDefined();
});

test("clipboard: paste into a codeBlock inserts plain text only (marks/structure dropped)", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.editor.setDoc({
      version: 1,
      blocks: [{ id: "code1", type: "codeBlock", props: { language: "" }, content: [] }],
    }),
  );
  await page.evaluate(() => window.__julEditor!.setCaret("code1", 0));
  await pasteHTML(page, "<p><strong>bold</strong> line one</p><p>line two</p>");

  const doc = await getDoc(page);
  expect(childIds(doc, null)).toEqual(["code1"]); // no new blocks
  expect(textOf(doc, "code1")).toBe("bold line one\nline two");
  const content = doc.blocks.find((b) => b.id === "code1")!.content!;
  expect(content.every((inl) => inl.type === "text" && !inl.marks)).toBe(true);
});

test("clipboard: paste a multi-block fragment into the middle of a paragraph splits it (head/tail merge)", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.editor.setDoc({
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "-A" }] },
        { id: "b", type: "paragraph", props: {}, content: [{ type: "text", text: "MID" }] },
        { id: "c", type: "paragraph", props: {}, content: [{ type: "text", text: "Z-" }] },
        { id: "target", type: "paragraph", props: {}, content: [{ type: "text", text: "hello world" }] },
      ],
    }),
  );
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "block", ids: ["a", "b", "c"] }));
  const { json } = await cutSelection(page); // removes a/b/c so only "target" + the pasted result remain

  await page.evaluate(() => window.__julEditor!.setCaret("target", 5)); // "hello| world"
  await pasteJulEditorJson(page, json);

  const doc = await getDoc(page);
  const ids = childIds(doc, null);
  expect(ids[0]).toBe("target");
  expect(textOf(doc, "target")).toBe("hello-A"); // head merges the fragment's first block
  expect(textOf(doc, ids[1]!)).toBe("MID"); // middle block inserted verbatim
  expect(textOf(doc, ids[2]!)).toBe("Z- world"); // last block merges the original tail
});

test("clipboard: cut is a single undo step", async ({ page }) => {
  const before = await getDoc(page);
  await page.evaluate(() => window.__julEditor!.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));

  const { text } = await cutSelection(page);
  expect(text).toBe("Hello");

  let after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(" world");

  await page.keyboard.press("Meta+z");
  after = await getDoc(page);
  expect(textOf(after, "p1")).toBe(textOf(before, "p1")); // fully restored in one undo
});

test("clipboard: XSS paste (javascript: link, img onerror) never reaches the model or DOM", async ({ page }) => {
  await page.evaluate(() => window.__julEditor!.setCaret("pEnd", 0));
  await pasteHTML(
    page,
    '<p><a href="javascript:alert(1)">click me</a></p><p><img src="x" onerror="alert(1)"></p>',
  );

  const doc = await getDoc(page);
  const json = JSON.stringify(doc);
  expect(json).not.toMatch(/javascript:/i);

  const domCheck = await page.evaluate(() => {
    const root = document.querySelector("[data-jul-editor-root]")!;
    const badHref = Array.from(root.querySelectorAll("a")).some((a) => (a.getAttribute("href") ?? "").toLowerCase().includes("javascript:"));
    const hasOnerror = root.innerHTML.toLowerCase().includes("onerror");
    return { badHref, hasOnerror };
  });
  expect(domCheck.badHref).toBe(false);
  expect(domCheck.hasOnerror).toBe(false);
});

test("clipboard: VS Code style markdown paste (text/plain + vscode-editor-data + span html) into an empty paragraph becomes heading + list", async ({ page }) => {
  await page.evaluate(() =>
    window.__julEditor!.editor.setDoc({ version: 1, blocks: [{ id: "empty", type: "paragraph", props: {}, content: [] }] }),
  );
  await page.evaluate(() => window.__julEditor!.setCaret("empty", 0));
  await page.evaluate(() => {
    const md = "# Title\n- one\n- two with **bold**";
    const dt = new DataTransfer();
    dt.setData("text/plain", md);
    dt.setData("vscode-editor-data", JSON.stringify({ mode: "markdown" }));
    dt.setData("text/html", `<div style="color:#ccc"><span>${md.replace(/\n/g, "<br>")}</span></div>`);
    const root = document.querySelector("[data-jul-editor-root]")!;
    root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  const doc = await getDoc(page);
  const ids = childIds(doc, null);
  expect(ids.map((id) => blockType(doc, id))).toEqual(["heading", "bulletListItem", "bulletListItem"]);
  expect(textOf(doc, ids[0]!)).toBe("Title");
  // the DOM really renders styled blocks, not raw markdown text
  await expect(page.locator('[data-jul-editor-root] [data-id="' + ids[0] + '"]')).toBeVisible();
  await expect(page.locator("[data-jul-editor-root]")).not.toContainText("# Title");
  await expect(page.locator("[data-jul-editor-root] strong, [data-jul-editor-root] b").first()).toHaveText("bold");
});
