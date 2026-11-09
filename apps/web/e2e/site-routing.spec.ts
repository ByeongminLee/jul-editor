import { expect, test } from "@playwright/test";

// GitHub Pages serves every route from <route>/index.html and redirects /playground to /playground/.
test("trailing-slash URLs render their own page and are rewritten to the canonical path", async ({ page }) => {
  for (const [path, link] of [["/playground/", "Playground"], ["/showcase/", "Showcase"], ["/about/", "About"]] as const) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.slice(0, -1)}$`));
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "An editor that fits your product." })).toHaveCount(0);
  }
  await page.goto("/playground/");
  await expect(page.getByRole("heading", { level: 1, name: "Playground" })).toBeVisible();
  await page.goto("/docs/core/menus/");
  await expect(page).toHaveURL(/\/docs\/core\/menus$/);
  await expect(page.locator(".mdx-doc-header h1")).toHaveText("Menus");
});

test("old /docs#hash bookmarks stay on the page they point at", async ({ page }) => {
  for (const [hash, path, title] of [["menus", "/docs/core/menus", "Menus"], ["diff", "/docs/plugins/diff", "Diff"], ["state", "/docs/core/document-model", "Document model and state"]] as const) {
    await page.goto(`/docs#${hash}`);
    await expect(page.locator(".mdx-doc-header h1")).toHaveText(title);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator(".mdx-doc-header h1")).toHaveText(title);
  }
});

test("unknown URLs show a not-found message instead of another page", async ({ page }) => {
  await page.goto("/nope");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "An editor that fits your product." })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
  await expect(page).toHaveURL(/\/nope$/);

  for (const path of ["/docs/nope", "/docs/core"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "This guide does not exist" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("navigation", { name: "Documentation" })).toBeVisible();
  }
  await page.getByRole("link", { name: "Read the docs" }).click();
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  await expect(page.locator(".mdx-doc-header h1")).toHaveText("Getting started");
});

test("Escape closes the mobile menu and returns focus to the toggle", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/docs/core/menus");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await expect(page.locator(".site-nav-open")).toHaveCount(0);
});
