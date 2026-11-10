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

test("mobile docs contents closes after choosing a page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/docs/core/menus");
  const details = page.locator(".mdx-doc-mobile-nav details");
  await details.locator("summary").click();
  await details.getByRole("link", { name: "Tables and media" }).click();
  await expect(details).not.toHaveAttribute("open", "");
});

test("page titles follow the selected language", async ({ page }) => {
  await page.goto("/about");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page).toHaveTitle("소개 | JulEditor");
  await expect(page.getByRole("navigation", { name: "기본 메뉴" }).getByRole("link", { name: "소개" })).toBeVisible();
});

test("mobile menu dismisses on outside click or scroll and keeps Tab inside the header", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/about");
  const toggle = page.locator(".mobile-menu-button");
  await toggle.click();
  await page.mouse.click(5, 780);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.mouse.wheel(0, 300);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = -1;
    const check = () => (scrollY === last ? resolve() : ((last = scrollY), setTimeout(check, 100)));
    check();
  }));
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("banner").getByRole("link", { name: "JulEditor home" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(toggle).toBeFocused();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "About" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "JulEditor on GitHub" })).toBeFocused();
});
