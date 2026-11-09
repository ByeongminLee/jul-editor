// @vitest-environment jsdom
import { createTransaction, runInputRules } from "@jul-editor/core";
import type { Block, Keymap, KeymapCtx, Transaction } from "@jul-editor/core";
import { fromHTML, toHTML, toMarkdown, toText } from "@jul-editor/core/serde";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { caretAt, doc, mountEditor, para, registry, stateOf, stripIds, text } from "../notion-shared/test-helpers.js";
import { collapsedToggleAncestors, createMemoryOpenStore, fromMarkdownExt, setToggleOpen, ToggleView, toggleBlock, toggleHeadingSlashItems, toggleInputRules, togglePlugin, toggleSlashItem } from "./index.js";

afterEach(cleanup);

const toggle = (id: string, props: Record<string, unknown>, t = "", children?: Block[]): Block => ({
  id,
  type: "toggle",
  props: props as Block["props"],
  content: t ? text(t) : [],
  ...(children ? { children } : {}),
});

describe("toggle block: create", () => {
  it("slash items: plain toggle (open) and three heading levels with distinct ids", () => {
    expect(toggleSlashItem.create()).toMatchObject({ type: "toggle", props: { open: true } });
    expect(toggleHeadingSlashItems.map((i) => i.id)).toEqual(["toggle-heading-1", "toggle-heading-2", "toggle-heading-3"]);
    expect(toggleHeadingSlashItems.map((i) => i.create().props.level)).toEqual([1, 2, 3]);
    expect(togglePlugin.blocks[0]).toBe(toggleBlock);
  });
});

describe("toggle serde", () => {
  it("writes <details> with open state, heading summaries and nested children", () => {
    const d = doc([toggle("t", { open: true, level: 2 }, "Title", [para("k", "body")])]);
    expect(toMarkdown(d, { registry }).markdown).toBe("<details open>\n<summary><h2>Title</h2></summary>\n\nbody\n\n</details>");
    expect(toMarkdown(doc([toggle("t", {}, "Closed")]), { registry }).markdown).toBe("<details>\n<summary>Closed</summary>\n</details>");
  });

  it("round-trips through markdown: open/closed, headings, nesting, marks, following blocks", () => {
    const d = doc([
      toggle("a", { open: true }, "outer", [
        para("p", "first"),
        toggle("b", { level: 3 }, "inner heading", [{ id: "c", type: "bulletListItem", props: {}, content: text("item") }]),
      ]),
      toggle("e", {}, "empty closed"),
      para("z", "after"),
    ]);
    const { markdown, lossy } = toMarkdown(d, { registry });
    expect(lossy).toEqual([]);
    const back = fromMarkdownExt(markdown, { registry });
    expect(back.lossy).toEqual([]);
    expect(stripIds(back.doc.blocks)).toEqual(stripIds(d.blocks));
  });

  it("parses hand-written single-line and loose <details>, ignores tags inside code fences", () => {
    const one = fromMarkdownExt("<details><summary>T</summary>body</details>", { registry });
    expect(one.doc.blocks[0]).toMatchObject({ type: "toggle", content: text("T") });
    expect(one.doc.blocks[0]!.children?.[0]).toMatchObject({ type: "paragraph", content: text("body") });
    const fenced = fromMarkdownExt("```html\n<details>\n<summary>x</summary>\n</details>\n```", { registry });
    expect(fenced.doc.blocks.map((b) => b.type)).toEqual(["codeBlock"]);
    const loose = fromMarkdownExt("before\n\n<details>\n<summary>Hi **there**</summary>\n\nline\n\n```\n</details>\n```\n\n</details>\n\nafter", { registry });
    expect(loose.doc.blocks.map((b) => b.type)).toEqual(["paragraph", "toggle", "paragraph"]);
    expect(loose.doc.blocks[1]!.content?.[1]).toMatchObject({ text: "there", marks: [{ type: "bold" }] });
    expect(loose.doc.blocks[1]!.children?.map((b) => b.type)).toEqual(["paragraph", "codeBlock"]);
  });

  it("an unbalanced <details> stays plain text", () => {
    const r = fromMarkdownExt("<details>\n<summary>x</summary>\nno end", { registry });
    expect(r.doc.blocks.some((b) => b.type === "toggle")).toBe(false);
  });

  it("round-trips through HTML and accepts a foreign <details>", () => {
    const d = doc([toggle("t", { open: true, level: 1 }, "H", [para("k", "kid")])]);
    const html = toHTML(d, { registry });
    expect(html).toContain('<details data-jul-editor-type="toggle" data-level="1" open><summary>H</summary>');
    expect(stripIds(fromHTML(html, { registry }).doc.blocks)).toEqual(stripIds(d.blocks));
    const foreign = fromHTML("<details open><summary><h2>Docs</h2></summary><p>text</p></details>", { registry }).doc.blocks[0]!;
    expect(foreign).toMatchObject({ type: "toggle", props: { open: true, level: 2 }, content: text("Docs") });
    expect(foreign.children?.[0]).toMatchObject({ type: "paragraph" });
    expect(toText(d, { registry })).toBe("▸ H\n  kid");
  });
});

describe("toggle editing behavior", () => {
  function runKey(d: ReturnType<typeof doc>, sel: ReturnType<typeof caretAt>, combo: string) {
    let state = stateOf(d, sel);
    const ctx: KeymapCtx = {
      state,
      registry,
      root: null as never,
      event: {} as KeyboardEvent,
      dispatch: (build) => {
        const r = build(createTransaction(state, registry)).commit();
        state = r.state;
        return r;
      },
      marksRef: { stored: null },
      onLinkRequest: async () => null,
    };
    const handled = (toggleBlock.keymap as Keymap)[combo]!(ctx);
    return { handled, state };
  }

  it("Enter in the summary of an open toggle creates the first child; collapsed-with-children falls through", () => {
    const open = runKey(doc([toggle("t", { open: true }, "abc", [para("k", "old")])]), caretAt("t", 3), "Enter");
    expect(open.handled).toBe(true);
    const rec = open.state.store.records.get("t")!;
    expect(rec.childIds).toHaveLength(2);
    expect(rec.childIds[1]).toBe("k"); // new child goes first
    expect(open.state.selection).toMatchObject({ anchor: { blockId: rec.childIds[0] } });
    expect(runKey(doc([toggle("t", {}, "abc", [para("k", "old")])]), caretAt("t", 3), "Enter").handled).toBe(false);
  });

  it("Enter on a closed toggle without children opens it and adds a child; empty toggle exits to a paragraph", () => {
    const r = runKey(doc([toggle("t", {}, "abc")]), caretAt("t", 3), "Enter");
    expect(r.state.store.records.get("t")).toMatchObject({ props: { open: true } });
    expect(r.state.store.records.get("t")!.childIds).toHaveLength(1);
    const exit = runKey(doc([toggle("t", { open: true })]), caretAt("t", 0), "Enter");
    expect(exit.state.store.records.get("t")!.type).toBe("paragraph");
  });

  it("Mod-Enter flips the open prop", () => {
    const a = runKey(doc([toggle("t", {}, "x")]), caretAt("t", 1), "Mod-Enter");
    expect(a.state.store.records.get("t")!.props.open).toBe(true);
    const b = runKey(doc([toggle("t", { open: true }, "x")]), caretAt("t", 1), "Mod-Enter");
    expect(b.state.store.records.get("t")!.props.open).toBeUndefined();
  });

  it("'>> ' and '>>## ' typed prefixes convert a paragraph (plain '> ' stays the quote rule)", () => {
    const convert = (typed: string) => {
      let state = stateOf(doc([para("p", typed)]), caretAt("p", typed.length));
      const ctx = {
        get state() {
          return state;
        },
        registry,
        dispatch: (build: (tx: Transaction) => Transaction) => {
          const r = build(createTransaction(state, registry)).commit();
          state = r.state;
          return r;
        },
      };
      const hit = runInputRules(ctx as never, { blockId: "p", offset: typed.length }, [], toggleInputRules, []);
      return { hit, rec: state.store.records.get("p")! };
    };
    expect(convert(">> ").rec).toMatchObject({ type: "toggle", content: [] });
    expect(convert(">>## ").rec).toMatchObject({ type: "toggle", props: { level: 2 } });
    expect(convert("> ").hit).toBeNull();
  });
});

describe("toggle collapse (real editor)", () => {
  it("setToggleOpen persists open and moves the caret out of hidden children when collapsing", () => {
    const m = mountEditor(doc([toggle("t", { open: true }, "title", [para("k", "kid")]), para("z", "end")]));
    m.editor.update((tx) => tx.setSelection(caretAt("k", 1)));
    setToggleOpen(m.editor, "t", false);
    expect(m.editor.getState().store.records.get("t")!.props.open).toBeUndefined();
    expect(m.editor.getState().selection).toMatchObject({ anchor: { blockId: "t", offset: 5 }, focus: { blockId: "t", offset: 5 } }); // end of "title"
    setToggleOpen(m.editor, "t", true);
    expect(m.editor.getState().store.records.get("t")!.props.open).toBe(true);
    m.editor.commands.undo();
    expect(m.editor.getState().store.records.get("t")!.props.open).toBeUndefined();
    m.destroy();
  });

  it("collapsedToggleAncestors lists closed toggles hiding a block", () => {
    const m = mountEditor(doc([toggle("t", {}, "a", [toggle("u", { open: true }, "b", [para("k", "deep")])])]));
    expect(collapsedToggleAncestors(m.editor, "k")).toEqual(["t"]);
    m.destroy();
  });

  it("ToggleView mirrors open state onto the wrapper and toggles via the editor", () => {
    const m = mountEditor(doc([toggle("t", {}, "title", [para("k", "kid")])]));
    const wrapper = m.element.querySelector('[data-id="t"]') as HTMLElement;
    const host = document.createElement("div");
    wrapper.appendChild(host);
    const view = render(<ToggleView block={{ id: "t", type: "toggle", props: {} }} editor={m.editor} updateProps={() => {}} />, { container: host });
    expect(wrapper.getAttribute("data-jul-editor-open")).toBe("false");
    act(() => {
      fireEvent.click(view.container.querySelector("[data-toggle-chevron]")!);
    });
    expect(m.editor.getState().store.records.get("t")!.props.open).toBe(true);
    expect(wrapper.getAttribute("data-jul-editor-open")).toBe("true"); // core wrapperAttrs follows the model
    m.destroy();
  });

  it("toggleBlock.wrapperAttrs mirrors open/level onto the wrapper through core", () => {
    const m = mountEditor(doc([toggle("t", { level: 2 }, "title", [para("k", "kid")])]));
    const wrapper = m.element.querySelector('[data-id="t"]') as HTMLElement;
    expect(wrapper.getAttribute("data-jul-editor-open")).toBe("false");
    expect(wrapper.getAttribute("data-toggle-level")).toBe("2");
    m.editor.update((tx) => tx.setProps("t", { open: true }));
    expect(wrapper.getAttribute("data-jul-editor-open")).toBe("true");
    m.destroy();
  });
});

describe("ToggleView read-only + adapter", () => {
  it("collapses and expands locally and exposes aria-expanded", () => {
    const { container } = render(
      <ToggleView block={{ id: "t", type: "toggle", props: {} }} readOnly>
        <div data-jul-editor-content>title</div>
        <div data-jul-editor-children>kid</div>
      </ToggleView>,
    );
    const root = container.querySelector("[data-jul-toggle]")!;
    const chevron = container.querySelector("[data-toggle-chevron]")!;
    expect(root.getAttribute("data-jul-editor-open")).toBe("false");
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);
    expect(root.getAttribute("data-jul-editor-open")).toBe("true");
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
  });

  it("an openStore adapter overrides the document prop and is written instead of the doc", () => {
    const store = createMemoryOpenStore({ t: true });
    const updateProps = vi.fn();
    const { container } = render(<ToggleView block={{ id: "t", type: "toggle", props: {} }} readOnly openStore={store} updateProps={updateProps} />);
    const root = container.querySelector("[data-jul-toggle]")!;
    expect(root.getAttribute("data-jul-editor-open")).toBe("true");
    fireEvent.click(container.querySelector("[data-toggle-chevron]")!);
    expect(store.get("t")).toBe(false);
    expect(root.getAttribute("data-jul-editor-open")).toBe("false");
    expect(updateProps).not.toHaveBeenCalled();
  });
});
