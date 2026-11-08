/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { customThemeExtra, customThemePreset, customThemeTokens, DEFAULT_CUSTOM_CONFIG } from "./custom-theme.js";

test("a palette preset changes the editor skin and exported chart colors together", () => {
  const preset = customThemePreset("violet");
  assert.deepEqual(
    { palette: preset.palette, appearance: preset.appearance, style: preset.style, look: preset.look, bodyFont: preset.bodyFont, headingFont: preset.headingFont },
    { palette: "violet", appearance: "dark", style: "airy", look: "soft", bodyFont: "sans", headingFont: "display" },
  );

  const tokens = customThemeTokens(preset);
  assert.equal(tokens["--jul-editor-bg"], "#18181b");
  assert.equal(tokens["--jul-editor-accent"], "#c4b5fd");
  assert.match(tokens["--jul-editor-heading"]!, /Fraunces/);
  assert.equal(tokens["--chart-1"], "#c4b5fd");
  assert.match(customThemeExtra(preset), /line-height: 1\.95/);

  const adjusted = customThemeTokens({ ...DEFAULT_CUSTOM_CONFIG, radius: 0, headingFont: "mono", chart: "spectrum" });
  assert.equal(adjusted["--jul-editor-radius"], "0px");
  assert.match(adjusted["--jul-editor-heading"]!, /ui-monospace/);
  assert.notEqual(adjusted["--chart-1"], tokens["--chart-1"]);
});

test("the default custom theme uses the colored Cobalt accent, not grey", () => {
  assert.equal(DEFAULT_CUSTOM_CONFIG.palette, "blue");
  assert.equal(customThemeTokens(DEFAULT_CUSTOM_CONFIG)["--chart-1"], "#1d4ed8");
});

test("former showcase themes are Custom presets that keep their exact tokens, fonts, and extras", async () => {
  const { THEME_PRESETS, SAMPLE_IDS, readableOn } = await import("./custom-theme.js");
  assert.deepEqual(THEME_PRESETS.map((preset) => preset.id), ["default", "notebook", "editorial", "midnight", "terminal", "studio", "blueprint", "canvas"]);
  assert.deepEqual([...SAMPLE_IDS], ["custom", "notebook", "editorial", "midnight", "terminal", "studio", "blueprint", "canvas"]);
  const by = (id: string) => THEME_PRESETS.find((preset) => preset.id === id)!.config;

  const notebook = customThemeTokens(by("notebook"));
  assert.equal(notebook["--jul-editor-bg"], "#f8f5ee");
  assert.equal(notebook["--jul-editor-accent"], "#a76640");
  assert.equal(notebook["--jul-editor-radius"], "3px");
  assert.match(notebook["--jul-editor-font"]!, /^Georgia/);
  assert.match(customThemeExtra(by("notebook")), /background-size: 100% 31px/);

  const terminal = customThemeTokens(by("terminal"));
  assert.equal(terminal["--jul-editor-bg"], "#101614");
  assert.match(terminal["--jul-editor-font"]!, /ui-monospace/);
  assert.equal(terminal["--jul-editor-accent-ink"], "#18181b");
  assert.match(customThemeExtra(by("terminal")), /content: '#'/);

  assert.match(customThemeExtra(by("blueprint")), /background-size: 24px 24px/);
  assert.equal(customThemeTokens(by("midnight"))["--jul-editor-border"], "#36313f");
  assert.equal(customThemeTokens(by("canvas"))["--chart-1"], "#795000");
  assert.equal(readableOn("#ffffff"), "#18181b");
  assert.equal(readableOn("#1d4ed8"), "#ffffff");
});
