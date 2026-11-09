import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Notion-like showcase case (tab 3). Collaboration and comments run over BroadcastChannel,
// so two pages of ONE browser context behave like two tabs of the same browser.
const SHOTS = join(tmpdir(), "jul-editor-shots");
mkdirSync(SHOTS, { recursive: true });
const NOTION_CARD = 2;

async function openNotion(page: Page) {
  await page.goto("/showcase");
  await page.locator(".showcase-picker-card").nth(NOTION_CARD).click();
  const root = page.locator(".showcase-active .showcase-notion");
  await expect(root.locator(".nt-content")).toBeVisible();
  await expect(root.locator("[data-id=nt-title]")).toBeVisible();
  return root;
}
const block = (root: Locator, id: string) => root.locator(`[data-id=${id}]`);
const text = (root: Locator, id: string) => block(root, id).locator("[data-jul-editor-content]").first();
const caretAtEndOf = async (page: Page, root: Locator, id: string) => {
  await text(root, id).click();
  await page.keyboard.press("End");
};

test("opens the Notion tab with top bar, outline, callout, toggle, columns, bookmark and toc", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const root = await openNotion(page);
  await expect(root.locator("header.nt-topbar")).toBeVisible();
  await expect(root.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Redo" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Toggle light and dark theme" })).toBeVisible();
  await expect(root.locator("[data-jul-collab-avatars]")).toBeVisible();
  await expect(root.getByText("Open this page in another tab to collaborate").first()).toBeVisible();
  await expect(block(root, "nt-invite")).toHaveAttribute("data-type", "callout");
  await expect(block(root, "nt-toggle")).toHaveAttribute("data-type", "toggle");
  await expect(root.locator("[data-type=columns] [data-type=column]")).toHaveCount(2);
  await expect(root.locator("[data-jul-editor-plugin=bookmark]").first()).toContainText("example/jul-editor");
  // the embed stays a click-to-load placeholder: no iframe and no third-party request on load
  await expect(root.locator("[data-jul-editor-plugin=iframe][data-state=idle]")).toHaveCount(1);
  await expect(root.locator("iframe")).toHaveCount(0);
  await expect(root.locator("[data-type=todoListItem]")).toHaveCount(3);
  await expect(root.locator("[data-jul-toc]")).toContainText("Try some Markdown");
  // right-edge outline: mini lines that expand into titles on hover
  const sidebar = root.locator("[data-jul-toc-sidebar]");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await sidebar.hover();
  await expect(sidebar).toHaveAttribute("data-expanded", "true");
  await expect(sidebar).toContainText("Blocks that hold other blocks");
  await page.mouse.move(10, 10);
  await page.screenshot({ path: `${SHOTS}/notion-dark-desktop.png`, fullPage: false });
  await root.scrollIntoViewIfNeeded();
  await root.screenshot({ path: `${SHOTS}/notion-dark-desktop-editor.png` });

  // light theme
  await root.getByRole("button", { name: "Toggle light and dark theme" }).click();
  await expect(root).toHaveAttribute("data-nt-theme", "light");
  await root.screenshot({ path: `${SHOTS}/notion-light.png` });
  await root.getByRole("button", { name: "Toggle light and dark theme" }).click();
  await expect(root).toHaveAttribute("data-nt-theme", "dark");
});

test("typing --- makes a divider and pasted markdown becomes blocks", async ({ page }) => {
  const root = await openNotion(page);
  const dividers = root.locator("[data-type=divider]");
  const before = await dividers.count();
  await caretAtEndOf(page, root, "nt-end");
  await page.keyboard.type("---");
  await expect(dividers).toHaveCount(before + 1);

  const headings = root.locator("[data-type=heading]");
  const headingsBefore = await headings.count();
  await page.evaluate(() => {
    const el = document.querySelector(".showcase-notion [data-jul-editor-root]") ?? document.querySelector(".showcase-notion .nt-content");
    const data = new DataTransfer();
    data.setData("text/plain", "# Pasted heading\n\n- first bullet\n- second bullet\n\n> a pasted quote");
    const target = document.activeElement && el?.contains(document.activeElement) ? document.activeElement : el;
    target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(headings).toHaveCount(headingsBefore + 1);
  await expect(root.locator("[data-type=heading]", { hasText: "Pasted heading" })).toBeVisible();
  await expect(root.locator("[data-type=bulletListItem]", { hasText: "second bullet" })).toBeVisible();
  await expect(root.locator("[data-type=quote]", { hasText: "a pasted quote" })).toBeVisible();
});

test("slash menu lists every block and inserts a callout", async ({ page }) => {
  const root = await openNotion(page);
  const callouts = root.locator("[data-type=callout]");
  const before = await callouts.count();
  await caretAtEndOf(page, root, "nt-end");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  for (const name of ["Callout", "Toggle", "Table of contents", "Bookmark", "Embed", "Figma"]) await expect(menu.getByRole("option", { name: new RegExp(name, "i") }).first()).toBeVisible();
  await page.keyboard.type("callout");
  await expect(menu.getByRole("option").first()).toHaveText("Callout"); // filtered: Callout first, then its color variants
  await page.keyboard.press("Enter");
  await expect(callouts).toHaveCount(before + 1);
});

test("a toggle collapses and expands, hiding its children", async ({ page }) => {
  const root = await openNotion(page);
  const toggle = block(root, "nt-toggle");
  const body = block(root, "nt-toggle-body");
  await expect(toggle).toHaveAttribute("data-jul-editor-open", "true");
  await expect(body).toBeVisible();
  await toggle.locator("[data-toggle-chevron]").first().click();
  await expect(toggle).toHaveAttribute("data-jul-editor-open", "false");
  await expect(body).toBeHidden();
  await toggle.locator("[data-toggle-chevron]").first().click();
  await expect(body).toBeVisible();
});

test("the drag handle opens a block menu whose Turn into list has callout and toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const root = await openNotion(page);
  await block(root, "nt-lead").hover();
  const handle = root.getByRole("button", { name: /Drag to move/ });
  await expect(handle).toBeVisible();
  await handle.click();
  const menu = root.getByRole("menu", { name: "Turn into" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Callout/ }).first()).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Toggle/ }).first()).toBeVisible();
  await menu.getByRole("menuitem", { name: "Callout", exact: true }).click();
  await expect(block(root, "nt-lead")).toHaveAttribute("data-type", "callout");
});

test("select text, add a comment from the bubble menu and see it in the panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const root = await openNotion(page);
  await text(root, "nt-md-intro").click({ clickCount: 3 });
  const bubble = page.locator(".nt-bubble");
  await expect(bubble).toBeVisible();
  for (const name of ["Bold", "Italic", "Underline", "Text color and highlight"]) await expect(bubble.getByRole("button", { name })).toBeVisible();
  await bubble.getByRole("button", { name: "Text color and highlight" }).click();
  await expect(page.getByRole("group", { name: "Text color and highlight" })).toBeVisible();
  await page.getByRole("button", { name: "Highlight: yellow" }).click();
  await expect(root.locator("mark[data-jul-editor-highlight=yellow]").first()).toBeVisible();
  await root.screenshot({ path: `${SHOTS}/notion-bubble.png` });
  await bubble.getByRole("button", { name: "Add comment" }).click();
  const panel = root.locator(".nt-comments");
  await expect(panel).toBeVisible();
  await panel.getByPlaceholder("Write a comment").fill("Can we shorten this intro?");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel).toContainText("Can we shorten this intro?");
  await expect(root.locator("[data-mark=comment]").first()).toBeVisible();
  await root.screenshot({ path: `${SHOTS}/notion-comments.png` });
});

test("pasting a URL shows the Link / Bookmark / Embed / Mention menu", async ({ page }) => {
  const root = await openNotion(page);
  await caretAtEndOf(page, root, "nt-end");
  await page.evaluate(() => {
    const active = document.activeElement ?? document.body;
    const data = new DataTransfer();
    data.setData("text/plain", "https://www.figma.com/design/1234567890123456789/Jul-demo?node-id=1-2");
    active.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const menu = page.getByRole("menu", { name: "Paste as" });
  await expect(menu).toBeVisible();
  for (const name of ["Link", "Bookmark", "Embed", "Mention"]) await expect(menu.getByRole("menuitem", { name })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Bookmark" }).click();
  await expect(root.locator("[data-jul-editor-plugin=bookmark]")).toHaveCount(3);
});

test("two pages sync typing and comments over BroadcastChannel and show two avatars", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await context.newPage();
  const rootA = await openNotion(a);
  const b = await context.newPage();
  const rootB = await openNotion(b);

  await expect(rootA.locator("[data-jul-collab-avatar]")).toHaveCount(2);
  await expect(rootB.locator("[data-jul-collab-avatar]")).toHaveCount(2);

  await caretAtEndOf(a, rootA, "nt-lead");
  await a.keyboard.type(" Typed in tab A.");
  await expect(text(rootB, "nt-lead")).toContainText("Typed in tab A.");
  await caretAtEndOf(b, rootB, "nt-md-intro");
  await b.keyboard.type(" Typed in tab B.");
  await expect(text(rootA, "nt-md-intro")).toContainText("Typed in tab B.");

  // toggle state (a doc prop) follows the collaborator too
  await block(rootA, "nt-toggle").locator("[data-toggle-chevron]").first().click();
  await expect(block(rootB, "nt-toggle")).toHaveAttribute("data-jul-editor-open", "false");

  // a comment made in A shows up in B's panel, and the anchored text is marked there
  // Home + Shift+End: a triple click here would extend into the following (void) bookmark block
  await text(rootA, "nt-links-intro").click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Shift+End");
  await a.locator(".nt-bubble").getByRole("button", { name: "Add comment" }).click();
  await rootA.locator(".nt-comments").getByPlaceholder("Write a comment").fill("Shared across tabs");
  await rootA.locator(".nt-comments").getByRole("button", { name: "Comment", exact: true }).click();
  await rootB.getByRole("button", { name: "Comments" }).click();
  await expect(rootB.locator(".nt-comments")).toContainText("Shared across tabs");
  await expect(rootB.locator("[data-mark=comment]").first()).toBeVisible();

  await rootB.getByRole("button", { name: "Comments" }).click({ trial: true });
  await rootA.screenshot({ path: `${SHOTS}/notion-collab-tab-a.png` });
  await rootB.screenshot({ path: `${SHOTS}/notion-collab-tab-b.png` });

  // leaving the case disconnects: B drops back to one avatar (itself)
  await a.locator(".showcase-picker-card").nth(0).click();
  await expect(rootB.locator("[data-jul-collab-avatar]")).toHaveCount(1);
  await context.close();
});

test("mobile width: the page scrolls, comments open as a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await openNotion(page);
  await expect(root.locator("[data-jul-toc-sidebar]")).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await root.scrollIntoViewIfNeeded();
  await root.screenshot({ path: `${SHOTS}/notion-mobile.png` });
  await root.getByRole("button", { name: "Comments" }).click();
  await expect(root.locator(".nt-comments")).toBeVisible();
  await root.screenshot({ path: `${SHOTS}/notion-mobile-comments.png` });
  await root.getByRole("button", { name: "Close" }).click();
  await expect(root.locator(".nt-comments")).toBeHidden();
});

test("slash Bookmark and Web embed ask for a URL inline, and Embed is listed once", async ({ page }) => {
  const root = await openNotion(page);
  await caretAtEndOf(page, root, "nt-end");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: "Embed", exact: true })).toHaveCount(1);
  await page.keyboard.type("bookmark");
  await expect(menu.getByRole("option").first()).toHaveText("Bookmark");
  await page.keyboard.press("Enter");
  const field = root.getByRole("textbox", { name: "Bookmark URL" });
  await expect(field).toBeFocused();
  await page.keyboard.type("github.com/ueberdosis/tiptap");
  await page.keyboard.press("Enter");
  const card = root.locator('a[data-jul-editor-plugin="bookmark"][href="https://github.com/ueberdosis/tiptap"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("ueberdosis/tiptap");
  await expect(root.getByText("No URL")).toHaveCount(0);
});

test("slash Web embed asks for a URL inline, then shows the click-to-load placeholder", async ({ page }) => {
  const root = await openNotion(page);
  const menu = page.getByRole("listbox");
  await caretAtEndOf(page, root, "nt-end");
  await page.keyboard.type("/web");
  await expect(menu.getByRole("option").first()).toHaveText("Web embed");
  await page.keyboard.press("Enter");
  const embedField = root.getByRole("textbox", { name: "Embed URL" });
  await expect(embedField).toBeFocused();
  await page.keyboard.type("https://codepen.io/team/pen/abc");
  await page.keyboard.press("Enter");
  await expect(root.locator(".nt-embed-idle", { hasText: "codepen.io" })).toBeVisible();
});

// Round 2: the three editor cases unmounted on switch and came back as the untouched sample.
test("edits survive switching to another showcase case and back", async ({ page }) => {
  let root = await openNotion(page);
  await caretAtEndOf(page, root, "nt-title");
  await page.keyboard.type(" EDITED");
  await expect(text(root, "nt-title")).toContainText("EDITED");
  await page.locator(".showcase-picker-card").nth(0).click();
  await expect(page.locator(".showcase-active .showcase-agent")).toBeVisible();
  await page.locator(".showcase-picker-card").nth(NOTION_CARD).click();
  root = page.locator(".showcase-active .showcase-notion");
  await expect(text(root, "nt-title")).toContainText("EDITED");
});
