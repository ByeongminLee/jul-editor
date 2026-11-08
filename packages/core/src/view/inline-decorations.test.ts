// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry, createRegistry, defineBlock, coreBlocks, coreInlines, coreMarks } from "../model/index.js";
import type { Doc } from "../model/types.js";
import { createEditor } from "./editor.js";
import { domFromPoint, pointFromDOM } from "./selection.js";

const doc = (text = "hello world"): Doc => ({
  version: 1,
  blocks: [
    { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text }] },
    { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "other", marks: [{ type: "bold" }] }] },
  ],
});

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount(d: Doc = doc()) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: d });
  const content = (id: string) => element.querySelector(`[data-id="${id}"] [data-jul-editor-content]`) as HTMLElement;
  return { element, editor, content };
}

describe("inline decorations", () => {
  it("wraps a range in a span with sanitized class/attrs without changing the model", () => {
    const { editor, content } = mount();
    const before = JSON.stringify(editor.getDoc());
    editor.setDecorations("k", [{ blockId: "p1", from: 6, to: 11, class: "ins <bad> ok-1", attrs: { "data-x": "1", onclick: "boom", title: "t" } }]);
    const span = content("p1").querySelector("[data-jul-editor-deco]") as HTMLElement;
    expect(span.textContent).toBe("world");
    expect(span.className).toBe("ins bad ok-1");
    expect(span.getAttribute("data-x")).toBe("1");
    expect(span.getAttribute("title")).toBe("t");
    expect(span.hasAttribute("onclick")).toBe(false);
    expect(content("p1").textContent).toBe("hello world");
    expect(JSON.stringify(editor.getDoc())).toBe(before);
    editor.destroy();
  });

  it("clears with an empty list and restores pristine DOM", () => {
    const { editor, content } = mount();
    editor.setDecorations("k", [{ blockId: "p1", from: 0, to: 5 }]);
    expect(content("p1").querySelectorAll("[data-jul-editor-deco]")).toHaveLength(1);
    editor.setDecorations("k", []);
    expect(content("p1").querySelectorAll("[data-jul-editor-deco]")).toHaveLength(0);
    expect(content("p1").childNodes).toHaveLength(1);
    editor.destroy();
  });

  it("keys are independent and ranges clamp to the text", () => {
    const { editor, content } = mount();
    editor.setDecorations("a", [{ blockId: "p1", from: 0, to: 5, class: "a" }]);
    editor.setDecorations("b", [{ blockId: "p1", from: 3, to: 999, class: "b" }]);
    const got = Array.from(content("p1").querySelectorAll("[data-jul-editor-deco]")).map((s) => s.className + ":" + s.textContent).sort();
    expect(got).toEqual(["a:hel", "a:lo", "b: world", "b:lo"]); // overlapping pieces nest, "b" clamped to the end
    editor.setDecorations("a", []);
    expect(Array.from(content("p1").querySelectorAll("[data-jul-editor-deco]")).map((s) => s.className)).toEqual(["b"]);
    editor.destroy();
  });

  it("splits inside marks and keeps selection offset mapping exact", () => {
    const { element, editor, content } = mount();
    editor.setDecorations("k", [{ blockId: "p2", from: 1, to: 3 }, { blockId: "p1", from: 2, to: 4 }]);
    expect(content("p2").querySelector("strong [data-jul-editor-deco]")?.textContent).toBe("th");
    for (const [id, text] of [["p1", "hello world"], ["p2", "other"]] as const) {
      for (let o = 0; o <= text.length; o++) {
        const pos = domFromPoint(content(id), o);
        expect(pointFromDOM(element, pos.node, pos.offset)).toEqual({ blockId: id, offset: o });
      }
    }
    editor.destroy();
  });

  it("widgets are zero length for selection and reading, and inserted at their offset", () => {
    const { element, editor, content } = mount();
    editor.setDecorations("w", [{ blockId: "p1", offset: 5, render: () => Object.assign(document.createElement("del"), { textContent: "XXXX" }) }]);
    const widget = content("p1").querySelector("[data-jul-editor-widget]") as HTMLElement;
    expect(widget.getAttribute("contenteditable")).toBe("false");
    expect(widget.previousSibling?.textContent).toBe("hello");
    for (let o = 0; o <= 11; o++) {
      const pos = domFromPoint(content("p1"), o);
      expect(pointFromDOM(element, pos.node, pos.offset)).toEqual({ blockId: "p1", offset: o });
    }
    // an edit re-reads the DOM transparently: the widget text never leaks into the model
    editor.update((tx) => tx.replaceContent("p1", 11, 11, [{ type: "text", text: "!" }]));
    expect(editor.getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "hello world!" }]);
    expect(content("p1").querySelector("[data-jul-editor-widget]")).not.toBeNull(); // re-applied after the content change
    editor.destroy();
  });

  it("re-applies after a model edit and moves the caret correctly", () => {
    const { editor, content } = mount();
    editor.setDecorations("k", [{ blockId: "p1", from: 0, to: 5 }]);
    editor.update((tx) => tx.replaceContent("p1", 0, 0, [{ type: "text", text: ">> " }]).setSelection({ type: "text", anchor: { blockId: "p1", offset: 3 }, focus: { blockId: "p1", offset: 3 } }));
    expect(content("p1").textContent).toBe(">> hello world");
    expect(content("p1").querySelector("[data-jul-editor-deco]")?.textContent).toBe(">> he"); // decoration offsets are model offsets, the host re-sets them on change
    editor.destroy();
  });

  it("a widget at the end of an empty block goes before the placeholder br", () => {
    const { editor, content } = mount({ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] });
    editor.setDecorations("w", [{ blockId: "p1", offset: 0, render: () => document.createElement("i") }]);
    const kids = Array.from(content("p1").childNodes).map((n) => (n as HTMLElement).tagName);
    expect(kids).toEqual(["SPAN", "BR"]);
    editor.destroy();
  });
});

describe("decorations during IME composition", () => {
  it("never touches the composing block's DOM, and applies once composition ends", () => {
    const { element, editor, content } = mount();
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 5 } }));
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const textNode = content("p1").firstChild;
    editor.setDecorations("k", [{ blockId: "p1", from: 0, to: 5 }, { blockId: "p2", from: 0, to: 2 }]);
    expect(content("p1").firstChild).toBe(textNode); // same node: composition never cancelled
    expect(content("p1").querySelector("[data-jul-editor-deco]")).toBeNull();
    expect(content("p2").querySelector("[data-jul-editor-deco]")).not.toBeNull(); // other blocks are fine
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
    editor.setDecorations("k", [{ blockId: "p1", from: 0, to: 5 }, { blockId: "p2", from: 0, to: 2 }, { blockId: "p2", from: 3, to: 4 }]);
    expect(content("p1").querySelector("[data-jul-editor-deco]")?.textContent).toBe("hello");
    editor.destroy();
  });
});

describe("wrapperAttrs and block style props", () => {
  const spec = defineBlock({ type: "note", content: "inline", children: "any", props: { tone: "a" }, wrapperAttrs: (b) => ({ "data-tone": String(b.props.tone ?? "a"), "data-jul-editor-id": "evil", "onclick": "x", "data-gone": b.props.tone === "b" ? undefined : "yes" }) });
  const registry = createRegistry({ blocks: [...coreBlocks, spec], inlines: coreInlines, marks: coreMarks });

  it("mirrors wrapperAttrs, ignores invalid/reserved names, removes dropped attrs", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry, defaultValue: { version: 1, blocks: [{ id: "n", type: "note", props: {}, content: [] }] } });
    const w = element.querySelector('[data-id="n"]') as HTMLElement;
    expect(w.getAttribute("data-tone")).toBe("a");
    expect(w.hasAttribute("onclick")).toBe(false);
    expect(w.getAttribute("data-gone")).toBe("yes");
    editor.update((tx) => tx.setProps("n", { tone: "b" }));
    expect(w.getAttribute("data-tone")).toBe("b");
    expect(w.hasAttribute("data-gone")).toBe(false);
    editor.destroy();
  });

  it("textAlign/textColor/backgroundColor props mirror to attributes and invalid values are dropped", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({
      element,
      registry: coreRegistry,
      defaultValue: { version: 1, blocks: [{ id: "p", type: "paragraph", props: { textAlign: "center", backgroundColor: "yellow", textColor: "nope" }, content: [] }] },
    });
    const w = element.querySelector('[data-id="p"]') as HTMLElement;
    expect(w.getAttribute("data-jul-editor-text-align")).toBe("center");
    expect(w.getAttribute("data-jul-editor-block-bg")).toBe("yellow");
    expect(w.hasAttribute("data-jul-editor-block-color")).toBe(false);
    expect(editor.getDoc().blocks[0]!.props).toEqual({ textAlign: "center", backgroundColor: "yellow" });
    editor.update((tx) => tx.setProps("p", { textAlign: undefined }));
    expect(w.hasAttribute("data-jul-editor-text-align")).toBe(false);
    editor.destroy();
  });
});
