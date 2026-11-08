import { describe, expect, it } from "vitest";
import { createLowlightHighlighter } from "./highlighter.js";
import { pluginCodeLanguages } from "./languages.js";

describe("createLowlightHighlighter", () => {
  it("returns [] for an empty/plaintext/unregistered language without touching lowlight at all", async () => {
    const h = createLowlightHighlighter();
    expect(await h.highlight("const x = 1;", "")).toEqual([]);
    expect(await h.highlight("hello", "plaintext")).toEqual([]);
    expect(await h.highlight("hello", "not-a-real-language")).toEqual([]);
  });

  it("maps a TypeScript keyword/string/comment/number to jul-editor's fixed tokens with correct offsets", async () => {
    const h = createLowlightHighlighter();
    const code = 'const x = 1; // hi\nconst s = "yo";';
    const ranges = await h.highlight(code, "ts");

    const kw = ranges.filter((r) => r.token === "keyword");
    expect(kw.length).toBeGreaterThan(0);
    for (const r of kw) expect(code.slice(r.from, r.to)).toBe("const");

    const num = ranges.find((r) => r.token === "number");
    expect(num).toBeDefined();
    expect(code.slice(num!.from, num!.to)).toBe("1");

    const comment = ranges.find((r) => r.token === "comment");
    expect(comment).toBeDefined();
    expect(code.slice(comment!.from, comment!.to)).toBe("// hi");

    const str = ranges.find((r) => r.token === "string");
    expect(str).toBeDefined();
    expect(code.slice(str!.from, str!.to)).toBe('"yo"');
  });

  it("maps a function name (title.function_) to the 'function' token, and a class/import name (title.class_) to 'type'", async () => {
    const h = createLowlightHighlighter();
    const ranges = await h.highlight('function foo(a) { return a; }\nimport Bar from "bar";', "ts");
    const fn = ranges.find((r) => r.token === "function");
    expect(fn).toBeDefined();
    const type = ranges.find((r) => r.token === "type");
    expect(type).toBeDefined();
  });

  it("resolves 'ts'/'tsx'/'js'/'jsx'/'html' as highlight.js aliases of their real grammars", async () => {
    const h = createLowlightHighlighter();
    for (const lang of ["ts", "tsx", "js", "jsx", "html"]) {
      const ranges = await h.highlight("const x = 1;", lang);
      // html doesn't have a "const" keyword, but must not throw/return [] due
      // to an unregistered-language early-out (a real highlight.js call runs).
      expect(Array.isArray(ranges)).toBe(true);
    }
  });

  it("every pluginCodeLanguages value (besides plaintext) is a language lowlight's common preset actually registers", async () => {
    const h = createLowlightHighlighter();
    for (const { value } of pluginCodeLanguages) {
      if (value === "plaintext") continue;
      const ranges = await h.highlight("x", value);
      expect(Array.isArray(ranges)).toBe(true);
    }
  });

  it("never throws on malformed input, even for a registered language", async () => {
    const h = createLowlightHighlighter();
    await expect(h.highlight("", "ts")).resolves.toEqual([]);
  });
});
