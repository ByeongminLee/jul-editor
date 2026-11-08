// @vitest-environment jsdom
import { createTransaction, decodeClipboard, runInputRules } from "@jul-editor/core";
import type { Keymap, KeymapCtx, Transaction } from "@jul-editor/core";
import { fromHTML, fromMarkdown, toHTML, toMarkdown, toText } from "@jul-editor/core/serde";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { caretAt, doc, mountEditor, para, registry, stateOf, stripIds, text } from "../notion-shared/test-helpers.js";
import { calloutBlock, calloutInputRules, calloutPlugin, calloutSlashItem, calloutVariantSlashItems, CALLOUT_COLORS, CalloutView, fromMarkdownExt, readCallout } from "./index.js";

afterEach(cleanup);

const callout = (id: string, props: Record<string, unknown>, t = "", children?: ReturnType<typeof para>[]) => ({
  id,
  type: "callout",
  props: props as Record<string, never>,
  content: t ? text(t) : [],
  ...(children ? { children } : {}),
});

describe("callout block: create", () => {
  it("slash items create valid callouts and the plugin bundles block, renderer and rules", () => {
    expect(calloutSlashItem.create()).toMatchObject({ type: "callout", props: {} });
    expect(calloutVariantSlashItems.map((i) => i.create().props.color)).toEqual(["info", "success", "warning", "danger"]);
    expect(calloutVariantSlashItems.map((i) => i.id)).toEqual(["callout-info", "callout-success", "callout-warning", "callout-danger"]);
    expect(calloutPlugin.blocks[0]).toBe(calloutBlock);
    expect(typeof calloutPlugin.renderers.callout).toBe("function");
    expect(calloutBlock.children).toBe("any");
  });

  it("readCallout validates color and resolves the default icon", () => {
    expect(readCallout({})).toEqual({ icon: "", color: "default", resolvedIcon: "\u{1F4A1}" });
    expect(readCallout({ color: "nope" }).color).toBe("default");
    expect(readCallout({ color: "warning", icon: "X" }).resolvedIcon).toBe("X");
  });
});

describe("callout serde", () => {
  it("writes GitHub alerts, one marker per color", () => {
    const expected = { default: "IMPORTANT", info: "NOTE", success: "TIP", warning: "WARNING", danger: "CAUTION" };
    for (const color of CALLOUT_COLORS) {
      const d = doc([callout("c", color === "default" ? {} : { color }, "hello")]);
      expect(toMarkdown(d, { registry }).markdown).toBe(`> [!${expected[color]}]\n> hello`);
    }
  });

  it("round-trips every color, a custom icon, empty body and children through markdown", () => {
    const cases = [
      callout("a", { color: "info" }, "plain"),
      callout("b", { color: "danger", icon: "\u{1F525}" }, "hot"),
      callout("c", {}),
      callout("d", { color: "success" }, "parent", [para("k1", "child one"), para("k2", "child two")]),
      callout("e", { color: "warning" }, "", [para("k3", "only child")]),
    ];
    for (const block of cases) {
      const d = doc([block]);
      const { markdown, lossy } = toMarkdown(d, { registry });
      expect(lossy).toEqual([]);
      const back = fromMarkdownExt(markdown, { registry });
      expect(stripIds(back.doc.blocks)).toEqual(stripIds(d.blocks));
    }
  });

  it("keeps inline marks in the body and leaves plain quotes and unknown markers alone", () => {
    const md = "> [!TIP]\n> use **bold** here\n\n> just a quote\n\n> [!BOGUS]\n> nope";
    const { doc: d } = fromMarkdownExt(md, { registry });
    expect(d.blocks.map((b) => b.type)).toEqual(["callout", "quote", "quote"]);
    expect(d.blocks[0]!.content).toEqual([
      { type: "text", text: "use " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " here" },
    ]);
    // plain core parser with the registry now understands the alert too (BlockSpec.fromMarkdownBlock)
    expect(fromMarkdown(md, { registry }).doc.blocks[0]!.type).toBe("callout");
    // and without the callout block registered it stays a quote
    expect(fromMarkdown(md).doc.blocks[0]!.type).toBe("quote");
  });

  it("pasting `> [!NOTE]` text creates a callout (decodeClipboard with the editor registry)", () => {
    const data = { getData: (f: string) => (f === "text/plain" ? "> [!NOTE]\n> hi" : "") };
    const r = decodeClipboard(data, { registry });
    expect(r.doc.blocks).toHaveLength(1);
    expect(r.doc.blocks[0]).toMatchObject({ type: "callout", props: { color: "info" }, content: text("hi") });
  });

  it("accepts Obsidian style aliases and a title line", () => {
    const { doc: d } = fromMarkdownExt("> [!info] Heads up\n> body", { registry });
    expect(d.blocks[0]).toMatchObject({ type: "callout", props: { color: "info" } });
    expect(d.blocks[0]!.content).toEqual(text("Heads up\nbody"));
  });

  it("emits and reads <aside> HTML", () => {
    const d = doc([callout("c", { color: "warning", icon: "\u{1F525}" }, "careful", [para("k", "kid")])]);
    const html = toHTML(d, { registry });
    expect(html).toContain('<aside data-jul-editor-type="callout" data-color="warning" data-icon="\u{1F525}">');
    expect(html).toContain("careful");
    const back = fromHTML(html, { registry });
    expect(stripIds(back.doc.blocks)).toEqual(stripIds(d.blocks));
  });

  it("escapes hostile icon/text in HTML and renders plain text", () => {
    const d = doc([callout("c", { icon: '"><script>x</script>' }, "<b>")]);
    const html = toHTML(d, { registry });
    expect(html).not.toContain("<script>");
    expect(toText(doc([callout("c", { color: "info" }, "hi")]), { registry })).toBe("ℹ️ hi");
  });
});

describe("callout editing behavior", () => {
  const keymap = calloutBlock.keymap as Keymap;
  function run(d: ReturnType<typeof doc>, sel: ReturnType<typeof caretAt>) {
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
    const handled = keymap.Enter!(ctx);
    return { handled, state };
  }

  it("Enter at the end creates the first child inside the callout", () => {
    const { handled, state } = run(doc([callout("c", {}, "abc")]), caretAt("c", 3));
    expect(handled).toBe(true);
    const rec = state.store.records.get("c")!;
    expect(rec.childIds).toHaveLength(1);
    expect(state.selection).toMatchObject({ type: "text", anchor: { blockId: rec.childIds[0], offset: 0 } });
  });

  it("Enter in an empty callout exits to a paragraph; mid-text falls through to the default split", () => {
    const exit = run(doc([callout("c", { color: "info" })]), caretAt("c", 0));
    expect(exit.handled).toBe(true);
    expect(exit.state.store.records.get("c")!.type).toBe("paragraph");
    expect(run(doc([callout("c", {}, "abc")]), caretAt("c", 1)).handled).toBe(false);
  });

  it("'!> ' converts a paragraph into a callout and drops the marker", () => {
    let state = stateOf(doc([para("p", "!> ")]), caretAt("p", 3));
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
    expect(runInputRules(ctx as never, { blockId: "p", offset: 3 }, [], calloutInputRules, [])).toEqual({ blockId: "p", offset: 0 });
    expect(state.store.records.get("p")).toMatchObject({ type: "callout", content: [] });
  });
});

describe("callout wrapperAttrs (core mirrors them onto the block wrapper)", () => {
  it("sets and updates data-callout-color / data-callout-icon without a renderer", () => {
    const m = mountEditor(doc([callout("c", { color: "info", icon: "🔥" }, "x")]));
    const wrapper = m.element.querySelector('[data-id="c"]') as HTMLElement;
    expect(wrapper.getAttribute("data-callout-color")).toBe("info");
    expect(wrapper.getAttribute("data-callout-icon")).toBe("🔥");
    m.editor.update((tx) => tx.setProps("c", { color: "danger", icon: undefined }));
    expect(wrapper.getAttribute("data-callout-color")).toBe("danger");
    expect(wrapper.hasAttribute("data-callout-icon")).toBe(false);
    m.destroy();
  });
});

describe("CalloutView", () => {
  it("editing mode: icon button, picker and color swatch", () => {
    const updateProps = vi.fn();
    const { container } = render(
      <div data-jul-editor-block="">
        <CalloutView block={{ id: "c", type: "callout", props: { color: "info" } }} updateProps={updateProps} />
      </div>,
    );
    const button = container.querySelector<HTMLButtonElement>("[data-callout-icon-button]")!;
    expect(button.textContent).toBe("ℹ️");
    fireEvent.click(button);
    // (jsdom's selector engine mishandles astral characters in attribute selectors, so match by text)
    fireEvent.click(Array.from(container.querySelectorAll("[data-emoji]")).find((b) => b.textContent === "\u{1F525}")!);
    expect(updateProps).toHaveBeenLastCalledWith({ icon: "\u{1F525}" });
    fireEvent.click(button);
    fireEvent.click(container.querySelector('[data-swatch="danger"]')!);
    expect(updateProps).toHaveBeenLastCalledWith({ color: "danger" });
    fireEvent.click(container.querySelector('[data-swatch="default"]')!);
    expect(updateProps).toHaveBeenLastCalledWith({ color: undefined });
  });

  it("read-only mode renders the aside around the body", () => {
    const { container } = render(
      <CalloutView block={{ id: "c", type: "callout", props: { color: "success" } }} readOnly>
        <p>body</p>
      </CalloutView>,
    );
    const aside = container.querySelector("aside[data-jul-callout]")!;
    expect(aside.getAttribute("data-color")).toBe("success");
    expect(aside.textContent).toContain("✅");
    expect(aside.textContent).toContain("body");
  });
});
