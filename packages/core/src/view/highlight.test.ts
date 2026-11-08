// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { fromDoc } from "../store/store.js";
import { doc } from "../store/test-helpers.js";
import { CONTENT_ATTR } from "./dom.js";
import { renderAll } from "./render.js";
import type { ViewRenderCtx } from "./render.js";
import { collectTextNodes, createHighlightController, mapRangeToDOM } from "./highlight.js";
import type { Highlighter, HighlightRange } from "./highlight.js";

function ctx(): ViewRenderCtx {
  return { registry: coreRegistry, blockEls: new Map(), isComposing: () => false };
}

function twoCodeBlocksDoc() {
  return doc([
    { id: "c1", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
    { id: "c2", type: "codeBlock", props: { language: "js" }, content: [{ type: "text", text: "let y = 2;" }] },
  ]);
}

// A minimal Set-like stand-in for the real (spec) Highlight/HighlightRegistry
// -- jsdom (and TS's own bundled lib.dom.d.ts, see highlight.ts's own comment)
// don't model the real add/delete/set/get surface, so tests install this
// polyfill onto `globalThis` the way a real browser's would behave.
class FakeHighlight {
  ranges = new Set<Range>();
  add(r: Range): void {
    this.ranges.add(r);
  }
  delete(r: Range): boolean {
    return this.ranges.delete(r);
  }
  get size(): number {
    return this.ranges.size;
  }
}

function installFakeHighlightApi(): Map<string, FakeHighlight> {
  const named = new Map<string, FakeHighlight>();
  (globalThis as unknown as { Highlight: unknown }).Highlight = FakeHighlight;
  (globalThis as unknown as { CSS: unknown }).CSS = {
    highlights: {
      set: (name: string, h: FakeHighlight) => named.set(name, h),
      get: (name: string) => named.get(name),
      delete: (name: string) => named.delete(name),
    },
  };
  return named;
}

function uninstallHighlightApi(): void {
  delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
  delete (globalThis as unknown as { CSS?: unknown }).CSS;
}

describe("collectTextNodes", () => {
  it("flattens multiple text nodes (marked runs) with cumulative offsets", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("abc"));
    const strong = document.createElement("strong");
    strong.appendChild(document.createTextNode("DEF"));
    div.appendChild(strong);
    div.appendChild(document.createTextNode("ghi"));
    const spans = collectTextNodes(div);
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
    ]);
    expect(spans.map((s) => s.node.data)).toEqual(["abc", "DEF", "ghi"]);
  });

  it("ignores a placeholder <br>", () => {
    const div = document.createElement("div");
    div.appendChild(document.createElement("br"));
    expect(collectTextNodes(div)).toEqual([]);
  });
});

describe("mapRangeToDOM", () => {
  it("builds a Range within one text node", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("hello world"));
    const spans = collectTextNodes(div);
    const r = mapRangeToDOM(document, spans, 0, 5)!;
    expect(r.toString()).toBe("hello");
  });

  it("builds a Range spanning across two adjacent text nodes", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("abc"));
    const strong = document.createElement("strong");
    strong.appendChild(document.createTextNode("DEF"));
    div.appendChild(strong);
    const spans = collectTextNodes(div);
    const r = mapRangeToDOM(document, spans, 1, 5)!;
    expect(r.toString()).toBe("bcDE");
  });

  it("returns null for an empty or out-of-bounds range", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("abc"));
    const spans = collectTextNodes(div);
    expect(mapRangeToDOM(document, spans, 2, 2)).toBeNull();
    expect(mapRangeToDOM(document, spans, 1, 100)).toBeNull();
  });
});

describe("createHighlightController", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
    renderAll(root, store, ctx());
  });

  it("no-ops (never throws) when the CSS Custom Highlight API is unsupported", async () => {
    uninstallHighlightApi();
    const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
    const highlighter: Highlighter = { highlight: () => [{ from: 0, to: 5, token: "keyword" }] };
    const controller = createHighlightController({ root, registry: coreRegistry, getState: () => ({ store, selection: null }), isComposing: () => false });
    expect(() => controller.setHighlighter(highlighter)).not.toThrow();
    await new Promise((r) => setTimeout(r, 80));
    expect((globalThis as unknown as { CSS?: unknown }).CSS).toBeUndefined();
    controller.destroy();
  });

  describe("with the highlight API available", () => {
    // Installed ONCE for this whole describe (not per-test): highlight.ts
    // caches its (per-Document) token->Highlight mapping across every
    // controller it ever creates for that Document (by design -- see
    // highlight.ts's own DocRegistry comment), and jsdom reuses the SAME
    // global `document` for every test in this file. Swapping in a brand
    // new `CSS.highlights` container per test would silently desync from
    // that cache (a Highlight created under an earlier fake registry is
    // still the one highlight.ts reuses, but it would never get (re-)
    // registered into a later test's fresh container). Each test instead
    // relies on its own controller's `destroy()` to remove exactly what IT
    // contributed, leaving the shared Highlight objects empty again for the
    // next test -- exactly the real-world contract this module promises.
    let named: Map<string, FakeHighlight>;

    beforeAll(() => {
      named = installFakeHighlightApi();
    });

    it("registers ranges under fixed `jul-editor-<token>` highlight names, mapped onto the block's own content div", async () => {
      const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
      const ranges: Record<string, HighlightRange[]> = {
        c1: [{ from: 0, to: 5, token: "keyword" }],
        c2: [{ from: 0, to: 3, token: "keyword" }],
      };
      const highlighter: Highlighter = { highlight: (code, _lang) => ranges[code.includes("const") ? "c1" : "c2"]! };
      const controller = createHighlightController({ root, registry: coreRegistry, getState: () => ({ store, selection: null }), isComposing: () => false });
      controller.setHighlighter(highlighter);
      await new Promise((r) => setTimeout(r, 80));

      const kw = named.get("jul-editor-keyword")!;
      expect(kw).toBeDefined();
      expect(kw.size).toBe(2); // one range per codeBlock

      controller.destroy();
    });

    it("updating one block's highlighting replaces only ITS OWN ranges, leaving another block's ranges untouched", async () => {
      const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
      let c1Ranges: HighlightRange[] = [{ from: 0, to: 5, token: "keyword" }];
      const highlighter: Highlighter = {
        highlight: (code) => (code.includes("const") ? c1Ranges : [{ from: 0, to: 3, token: "keyword" }]),
      };
      const controller = createHighlightController({ root, registry: coreRegistry, getState: () => ({ store, selection: null }), isComposing: () => false });
      controller.setHighlighter(highlighter);
      await new Promise((r) => setTimeout(r, 80));

      const kw = named.get("jul-editor-keyword")!;
      expect(kw.size).toBe(2);
      const c2RangeBefore = [...kw.ranges].find((r) => r.toString() === "let");
      expect(c2RangeBefore).toBeDefined();

      // Re-highlight only c1 (different range shape) via a fresh onCommit.
      c1Ranges = [{ from: 6, to: 7, token: "keyword" }];
      controller.onCommit(new Set(["c1"]));
      await new Promise((r) => setTimeout(r, 80));

      expect(kw.size).toBe(2); // still exactly one range per block
      // c2's own contributed Range object is still the SAME instance -- never
      // touched by c1's update.
      expect([...kw.ranges]).toContain(c2RangeBefore);

      controller.destroy();
    });

    it("destroy() removes every range this controller ever contributed", async () => {
      const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
      const highlighter: Highlighter = { highlight: () => [{ from: 0, to: 3, token: "comment" }] };
      const controller = createHighlightController({ root, registry: coreRegistry, getState: () => ({ store, selection: null }), isComposing: () => false });
      controller.setHighlighter(highlighter);
      await new Promise((r) => setTimeout(r, 80));

      const comment = named.get("jul-editor-comment")!;
      expect(comment.size).toBe(2);
      controller.destroy();
      expect(comment.size).toBe(0);
    });

    it("an unmapped token is dropped, never registered under an arbitrary name", async () => {
      const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
      const highlighter: Highlighter = { highlight: () => [{ from: 0, to: 3, token: "not-a-real-token" }] };
      const controller = createHighlightController({ root, registry: coreRegistry, getState: () => ({ store, selection: null }), isComposing: () => false });
      controller.setHighlighter(highlighter);
      await new Promise((r) => setTimeout(r, 80));
      expect(named.get("jul-editor-not-a-real-token")).toBeUndefined();
      controller.destroy();
    });

    it("skips a block under active IME composition", async () => {
      const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
      const highlighter: Highlighter = { highlight: () => [{ from: 0, to: 3, token: "keyword" }] };
      const controller = createHighlightController({
        root,
        registry: coreRegistry,
        getState: () => ({ store, selection: null }),
        isComposing: (id) => id === "c1",
      });
      controller.setHighlighter(highlighter);
      await new Promise((r) => setTimeout(r, 80));
      const kw = named.get("jul-editor-keyword")!;
      expect(kw.size).toBe(1); // only c2 (c1 stayed composing)
      controller.destroy();
    });
  });
});

// jsdom's own DOM/Range implementation is real enough (Range.setStart/
// setEnd/toString all work as in a browser) that CONTENT_ATTR-based DOM
// lookups (findContentEl, used internally by applyRanges) resolve exactly
// like they would in render.test.ts's own suite -- sanity-checked here.
describe("content div structure sanity", () => {
  it("codeBlock renders a data-jul-editor-content div with plain text", () => {
    const root = document.createElement("div");
    const store = fromDoc(twoCodeBlocksDoc(), coreRegistry);
    renderAll(root, store, ctx());
    expect(root.querySelector(`[data-id="c1"] > [${CONTENT_ATTR}]`)?.textContent).toBe("const x = 1;");
  });
});
