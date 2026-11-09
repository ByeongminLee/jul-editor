// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { coreBlocks, coreInlines, coreMarks, coreRegistry } from "../model/builtins.js";
import { createRegistry } from "../model/schema.js";
import { fromDoc } from "../store/store.js";
import { doc, para } from "../store/test-helpers.js";
import { BLOCK_ATTR, CHILDREN_ATTR, COLSPAN_ATTR, CONTENT_ATTR, EMPTY_ATTR, FOCUSED_ATTR, PLACEHOLDER_TEXT_ATTR, ROWSPAN_ATTR, VOID_ATTR } from "./dom.js";
import { applyFocusedAttr, renderAll } from "./render.js";
import type { ViewRenderCtx } from "./render.js";

function ctx(overrides: Partial<ViewRenderCtx> = {}): ViewRenderCtx {
  return { registry: coreRegistry, blockEls: new Map(), isComposing: () => false, ...overrides };
}

describe("renderAll", () => {
  it("renders a persistent wrapper + content div per block", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "hello"), para("p2", "world")]), coreRegistry);
    const c = ctx();
    renderAll(root, store, c);
    const wrappers = root.querySelectorAll(`[${BLOCK_ATTR}]`);
    expect(wrappers.length).toBe(2);
    expect(root.querySelector(`[data-id="p1"] > [${CONTENT_ATTR}]`)?.textContent).toBe("hello");
    expect(root.querySelector(`[data-id="p2"] > [${CONTENT_ATTR}]`)?.textContent).toBe("world");
  });

  it("exposes the effective heading level and clears it after a type change", () => {
    const root = document.createElement("div");
    const c = ctx();
    renderAll(root, fromDoc(doc([{ id: "h", type: "heading", props: {}, content: [] }]), coreRegistry), c);
    const wrapper = root.querySelector(`[data-id="h"]`)!;
    expect(wrapper.getAttribute("data-jul-editor-level")).toBe("1");

    renderAll(root, fromDoc(doc([{ id: "h", type: "heading", props: { level: 2 }, content: [] }]), coreRegistry), c);
    expect(wrapper.getAttribute("data-jul-editor-level")).toBe("2");

    renderAll(root, fromDoc(doc([para("h", "text")]), coreRegistry), c);
    expect(wrapper.hasAttribute("data-jul-editor-level")).toBe(false);
  });

  it("an initially-empty block gets the placeholder <br> on its very first render", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    renderAll(root, store, ctx());
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    expect(content.querySelector("br[data-jul-editor-placeholder]")).not.toBeNull();
  });

  it("reuses the same wrapper/content elements across renders (identity fast path is a true no-op)", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const c = ctx();
    renderAll(root, store, c);
    const wrapper1 = root.querySelector(`[data-id="p1"]`);
    const content1 = root.querySelector(`[${CONTENT_ATTR}]`);
    const textNode1 = content1!.firstChild;
    renderAll(root, store, c); // same store, nothing changed
    expect(root.querySelector(`[data-id="p1"]`)).toBe(wrapper1);
    expect(root.querySelector(`[${CONTENT_ATTR}]`)).toBe(content1);
    expect(content1!.firstChild).toBe(textNode1); // never touched
  });

  it("patches a tag label in place while keeping its # prefix", () => {
    const root = document.createElement("div");
    const c = ctx();
    const tagged = (label: string) => fromDoc(doc([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "mention", attrs: { kind: "tag", id: "t1", label } }] }]), coreRegistry);
    renderAll(root, tagged("research"), c);
    const span = root.querySelector("[data-mention]")!;
    renderAll(root, tagged("design"), c);
    expect(root.querySelector("[data-mention]")).toBe(span);
    expect(span.textContent).toBe("#design");
  });

  it("nested children render inside a persistent data-jul-editor-children container", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "top", [para("c1", "child")])]), coreRegistry);
    renderAll(root, store, ctx());
    const childrenEl = root.querySelector(`[data-id="p1"] > [${CHILDREN_ATTR}]`);
    expect(childrenEl).not.toBeNull();
    expect(childrenEl!.querySelector(`[data-id="c1"] [${CONTENT_ATTR}]`)?.textContent).toBe("child");
  });

  it("a void block gets a persistent contenteditable=false container and calls renderVoid once", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }, para("p1", "x")]), coreRegistry);
    const renderVoid = vi.fn((_block, el: HTMLElement) => {
      el.textContent = "IMG";
    });
    const c = ctx({ renderVoid });
    renderAll(root, store, c);
    renderAll(root, store, c);
    expect(renderVoid).toHaveBeenCalledTimes(1); // never re-invoked on a stable id
    const voidEl = root.querySelector(`[data-id="img1"] [${VOID_ATTR}]`);
    expect(voidEl?.getAttribute("contenteditable")).toBe("false");
    expect(voidEl?.textContent).toBe("IMG");
  });

  it("removes a decorated block's renderer when that block becomes void", () => {
    const registry = createRegistry({
      blocks: coreBlocks.map((block) => block.type === "paragraph" ? { ...block, decorated: true } : block),
      inlines: coreInlines,
      marks: coreMarks,
    });
    const root = document.createElement("div");
    const destroyDecoration = vi.fn();
    const renderVoid = vi.fn()
      .mockReturnValueOnce(destroyDecoration)
      .mockReturnValue(undefined);
    const c = ctx({ registry, renderVoid });
    renderAll(root, fromDoc(doc([para("p1", "text")]), registry), c);
    expect(root.querySelector('[data-id="p1"] > [data-jul-editor-decoration]')).not.toBeNull();

    renderAll(root, fromDoc(doc([{ id: "p1", type: "divider", props: {} }]), registry), c);
    expect(root.querySelector('[data-id="p1"] > [data-jul-editor-decoration]')).toBeNull();
    expect(root.querySelector('[data-id="p1"] > [data-jul-editor-void]')).not.toBeNull();
    expect(destroyDecoration).toHaveBeenCalledTimes(1);
  });

  it("removes a block's DOM and calls its void destroy when the block disappears from the store", () => {
    const root = document.createElement("div");
    const destroy = vi.fn();
    const withImage = fromDoc(doc([{ id: "img1", type: "image", props: { src: "a.png", alt: "" } }, para("p1", "x")]), coreRegistry);
    const c = ctx({ renderVoid: () => destroy });
    renderAll(root, withImage, c);
    expect(root.querySelector(`[data-id="img1"]`)).not.toBeNull();
    const without = fromDoc(doc([para("p1", "x")]), coreRegistry);
    renderAll(root, without, c);
    expect(root.querySelector(`[data-id="img1"]`)).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("reorders existing wrappers instead of recreating them when block order changes", () => {
    const root = document.createElement("div");
    const store1 = fromDoc(doc([para("a", "A"), para("b", "B")]), coreRegistry);
    const c = ctx();
    renderAll(root, store1, c);
    const aEl = root.querySelector(`[data-id="a"]`);
    const bEl = root.querySelector(`[data-id="b"]`);
    const store2 = fromDoc(doc([para("b", "B"), para("a", "A")]), coreRegistry);
    renderAll(root, store2, c);
    expect(root.children[0]).toBe(bEl);
    expect(root.children[1]).toBe(aEl);
  });

  it("skips DOM writes entirely for the block reported as composing", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "hello")]), coreRegistry);
    const c = ctx({ isComposing: (id) => id === "p1" });
    renderAll(root, store, c);
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    content.textContent = "TOTALLY DIFFERENT"; // simulate the browser mutating it mid-composition
    const store2 = fromDoc(doc([para("p1", "hello-changed")]), coreRegistry);
    renderAll(root, store2, c);
    expect(content.textContent).toBe("TOTALLY DIFFERENT"); // untouched
  });

  // A block whose content has several ADJACENT
  // same-mark text runs (bench/gen.mjs's fixture generator never merges
  // word-groups/spaces into one run) forces a run-COUNT change on the first
  // edit that touches it, which patchContent's sameShape fast path (an
  // all-or-nothing, equal-length check) can't handle -- it fell back to a
  // full rebuild, discarding and recreating every run's DOM node, including
  // any UNRELATED marked run elsewhere in the same block. This checks the
  // group-level reconciliation fallback: a marked run's own DOM node
  // (survives untouched) plus its plain-text neighbors merging correctly.
  it("a run-count-changing edit (adjacent plain runs merging) reuses an untouched marked run's own DOM node", () => {
    const root = document.createElement("div");
    const before = fromDoc(
      doc([
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
            { type: "text", text: "BOLD", marks: [{ type: "bold" }] },
            { type: "text", text: " nice" },
          ],
        },
      ]),
      coreRegistry,
    );
    const c = ctx();
    renderAll(root, before, c);
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    const boldEl = content.querySelector("strong")!;
    const boldTextNode = boldEl.firstChild;
    expect(boldEl.textContent).toBe("BOLD");

    // The first two (adjacent, unmarked) runs merge into one -- run count
    // drops from 4 to 3, so `sameShape` (equal-length) fails.
    const after = fromDoc(
      doc([
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "Hello world" },
            { type: "text", text: "BOLD", marks: [{ type: "bold" }] },
            { type: "text", text: " nice" },
          ],
        },
      ]),
      coreRegistry,
    );
    renderAll(root, after, c);

    expect(content.textContent).toBe("Hello worldBOLD nice");
    expect(content.querySelector("strong")).toBe(boldEl); // same element, not rebuilt
    expect(content.querySelector("strong")!.firstChild).toBe(boldTextNode); // same text node
  });

  // A toggleMark that only MOVES run boundaries (bold extended over the plain
  // text before it) keeps the plain text and the run count/marks sequence
  // identical; patchContent used to take its "DOM already matches" shortcut
  // and never re-render, so Bold looked like it did nothing until the next
  // keystroke made the formatting suddenly "grow".
  it("re-renders a mark change that only shifts run boundaries (same text, same run keys)", () => {
    const root = document.createElement("div");
    const mk = (a: string, b: string) =>
      fromDoc(doc([{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: a }, { type: "text", text: b, marks: [{ type: "bold" }] }] }]), coreRegistry);
    const c = ctx();
    renderAll(root, mk("This sample uses ", "JulEditor"), c);
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    expect(content.innerHTML).toBe("This sample uses <strong>JulEditor</strong>");
    renderAll(root, mk("T", "his sample uses JulEditor"), c);
    expect(content.innerHTML).toBe("T<strong>his sample uses JulEditor</strong>");
    // and back (undo)
    renderAll(root, mk("This sample uses ", "JulEditor"), c);
    expect(content.innerHTML).toBe("This sample uses <strong>JulEditor</strong>");
  });

  // IME composition in an EMPTY block: the browser replaces the placeholder
  // <br> with its own text node, which `runNodes` never learned about. The
  // next (non-composing) render must not trust the stale runNodes.
  it("after composing in an empty block, later renders resync the DOM", () => {
    const root = document.createElement("div");
    let composing = false;
    const c = ctx({ isComposing: () => composing });
    const mk = (t: string) => fromDoc(doc([para("p1", t)]), coreRegistry);
    renderAll(root, mk(""), c);
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    // browser composes: placeholder <br> replaced by its own text node
    composing = true;
    content.replaceChildren(document.createTextNode("\uD55C"));
    renderAll(root, mk("\uD55C"), c);
    composing = false;
    renderAll(root, mk("\uD55C"), c); // composition end commit (same text)
    renderAll(root, mk("\uD55Ca"), c);
    expect(content.textContent).toBe("\uD55Ca");
    renderAll(root, mk("\uD55Cab"), c);
    expect(content.textContent).toBe("\uD55Cab");
    expect(content.childNodes.length).toBe(1);
  });
});

describe("EMPTY_ATTR / placeholder / applyFocusedAttr", () => {
  it("EMPTY_ATTR is present on an empty text block's wrapper, absent on a non-empty one", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", ""), para("p2", "hi")]), coreRegistry);
    renderAll(root, store, ctx());
    expect(root.querySelector(`[data-id="p1"]`)!.hasAttribute(EMPTY_ATTR)).toBe(true);
    expect(root.querySelector(`[data-id="p2"]`)!.hasAttribute(EMPTY_ATTR)).toBe(false);
  });

  it("EMPTY_ATTR toggles off/on across an empty<->non-empty transition, and doesn't touch the attribute otherwise", () => {
    const root = document.createElement("div");
    const store1 = fromDoc(doc([para("p1", "")]), coreRegistry);
    const c = ctx();
    renderAll(root, store1, c);
    const wrapper = root.querySelector(`[data-id="p1"]`)!;
    expect(wrapper.hasAttribute(EMPTY_ATTR)).toBe(true);

    const store2 = fromDoc(doc([para("p1", "x")]), coreRegistry);
    renderAll(root, store2, c);
    expect(wrapper.hasAttribute(EMPTY_ATTR)).toBe(false);

    // re-rendering the SAME (non-empty) store must not touch the attribute
    // at all -- guarded by the current attribute presence, not just recomputed
    // and reassigned every pass (perf: this is what keeps typing in an
    // already non-empty block mutation-free for the MutationObserver budget).
    const setAttrSpy = vi.spyOn(wrapper, "setAttribute");
    const removeAttrSpy = vi.spyOn(wrapper, "removeAttribute");
    renderAll(root, store2, c);
    expect(setAttrSpy.mock.calls.some(([name]) => name === EMPTY_ATTR)).toBe(false);
    expect(removeAttrSpy.mock.calls.some(([name]) => name === EMPTY_ATTR)).toBe(false);
  });

  it("a `placeholder` string is written as data-placeholder on the content element", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "")]), coreRegistry);
    renderAll(root, store, ctx({ placeholder: "Type '/' for commands" }));
    const content = root.querySelector(`[${CONTENT_ATTR}]`)!;
    expect(content.getAttribute(PLACEHOLDER_TEXT_ATTR)).toBe("Type '/' for commands");
  });

  it("a `placeholder` function is resolved per block", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", ""), para("p2", "")]), coreRegistry);
    renderAll(root, store, ctx({ placeholder: (block) => `placeholder-${block.id}` }));
    expect(root.querySelector(`[data-id="p1"] > [${CONTENT_ATTR}]`)!.getAttribute(PLACEHOLDER_TEXT_ATTR)).toBe("placeholder-p1");
    expect(root.querySelector(`[data-id="p2"] > [${CONTENT_ATTR}]`)!.getAttribute(PLACEHOLDER_TEXT_ATTR)).toBe("placeholder-p2");
  });

  it("applyFocusedAttr moves FOCUSED_ATTR from the previously-focused block to the new one, and is a no-op when unchanged", () => {
    const root = document.createElement("div");
    const store = fromDoc(doc([para("p1", "a"), para("p2", "b")]), coreRegistry);
    const c = ctx();
    renderAll(root, store, c);
    const w1 = root.querySelector(`[data-id="p1"]`)!;
    const w2 = root.querySelector(`[data-id="p2"]`)!;

    applyFocusedAttr(c, "p1");
    expect(w1.hasAttribute(FOCUSED_ATTR)).toBe(true);
    expect(w2.hasAttribute(FOCUSED_ATTR)).toBe(false);

    applyFocusedAttr(c, "p2");
    expect(w1.hasAttribute(FOCUSED_ATTR)).toBe(false);
    expect(w2.hasAttribute(FOCUSED_ATTR)).toBe(true);

    const setAttrSpy = vi.spyOn(w2, "setAttribute");
    const removeAttrSpy = vi.spyOn(w1, "removeAttribute");
    applyFocusedAttr(c, "p2"); // unchanged -- no-op
    expect(setAttrSpy).not.toHaveBeenCalled();
    expect(removeAttrSpy).not.toHaveBeenCalled();

    applyFocusedAttr(c, null);
    expect(w2.hasAttribute(FOCUSED_ATTR)).toBe(false);
  });
});

describe("COLSPAN_ATTR/ROWSPAN_ATTR", () => {
  // 3 rows so a rowspan up to 3 is within range (model/canonical.ts's span
  // clamping otherwise clamps a rowspan down to the table's real row count).
  // Rows after the first carry no cells of their own -- a lone spanning cell
  // (colspan 2) legitimately covers the whole grid; padTableRows fills any
  // row left uncovered with a genuine filler cell, so the table stays valid
  // either way (spanned or plain).
  function tableStore(cellProps: Record<string, number>, rows = 3) {
    const tableRows = [
      { id: "r1", type: "tableRow", props: {}, children: [{ id: "c1", type: "tableCell", props: cellProps, content: [] }] },
      ...Array.from({ length: rows - 1 }, (_, i) => ({ id: `r${i + 2}`, type: "tableRow", props: {}, children: [] })),
    ];
    return fromDoc(doc([{ id: "t1", type: "table", props: {}, children: tableRows }]), coreRegistry);
  }

  it("sets the attr only when colspan/rowspan is > 1 (omitted at the default 1)", () => {
    const root = document.createElement("div");
    renderAll(root, tableStore({ colspan: 2, rowspan: 3 }), ctx());
    const cellEl = root.querySelector(`[data-id="c1"]`)!;
    expect(cellEl.getAttribute(COLSPAN_ATTR)).toBe("2");
    expect(cellEl.getAttribute(ROWSPAN_ATTR)).toBe("3");

    const root2 = document.createElement("div");
    renderAll(root2, tableStore({}), ctx());
    const plainCellEl = root2.querySelector(`[data-id="c1"]`)!;
    expect(plainCellEl.hasAttribute(COLSPAN_ATTR)).toBe(false);
    expect(plainCellEl.hasAttribute(ROWSPAN_ATTR)).toBe(false);
  });

  it("clears the attr on a re-render once a merge is split back apart", () => {
    const root = document.createElement("div");
    const c = ctx();
    renderAll(root, tableStore({ colspan: 2, rowspan: 2 }), c);
    renderAll(root, tableStore({}), c);
    const cellEl = root.querySelector(`[data-id="c1"]`)!;
    expect(cellEl.hasAttribute(COLSPAN_ATTR)).toBe(false);
    expect(cellEl.hasAttribute(ROWSPAN_ATTR)).toBe(false);
  });

  it("clamps an out-of-range rowspan down to the table's actual row count", () => {
    const root = document.createElement("div");
    // Only 1 real row -- a rowspan of 3 can't fit, so model/canonical.ts's
    // span clamping (blockTableGrid) clamps it down to 1 (the default, hence
    // omitted from the DOM) instead of rendering an out-of-bounds span.
    renderAll(root, tableStore({ rowspan: 3 }, 1), ctx());
    const cellEl = root.querySelector(`[data-id="c1"]`)!;
    expect(cellEl.hasAttribute(ROWSPAN_ATTR)).toBe(false);
  });
});
