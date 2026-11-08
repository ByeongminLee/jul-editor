// @vitest-environment jsdom
import { coreRegistry, createEditor } from "@jul-editor/core";
import type { Block, Doc, Editor } from "@jul-editor/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEditorSuggestions, reconcileDoc, useEditorSuggestions } from "./index.js";

const doc = (blocks: Block[]): Doc => ({ version: 1, blocks });
const p = (id: string, text: string): Block => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }] });

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function mount(d: Doc) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: d });
  return { element, editor };
}
const texts = (e: Editor) => e.getDoc().blocks.map((b) => (b.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "?")).join(""));
const hover = (el: HTMLElement, id: string, sel: string): void => {
  content(el, id).querySelector(sel)!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
};
const content = (el: HTMLElement, id: string) => el.querySelector(`[data-id="${id}"] [data-jul-editor-content]`) as HTMLElement;

describe("reconcileDoc", () => {
  it("applies insert, move, remove, content and prop changes as one undo step", () => {
    const { editor } = mount(doc([p("a", "one"), p("b", "two"), p("c", "three")]));
    const target = doc([p("c", "three!"), p("d", "new"), { ...p("a", "one"), type: "heading", props: { level: 2 } }]);
    editor.update((tx) => reconcileDoc(tx, editor.getDoc(), target, coreRegistry));
    const after = editor.getDoc();
    expect(after.blocks.map((b) => b.id)).toEqual(["c", "d", "a"]);
    expect(texts(editor)).toEqual(["three!", "new", "one"]);
    expect(after.blocks[2]).toMatchObject({ type: "heading", props: { level: 2 } });
    editor.commands.undo();
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    editor.destroy();
  });
});

describe("in-editor suggestions (perspective base)", () => {
  it("shows an insertion as a ghost widget and a deletion as a struck range; the model is untouched", () => {
    const { element, editor } = mount(doc([p("a", "I like cats and tea")]));
    const before = JSON.stringify(editor.getDoc());
    const s = createEditorSuggestions(editor, doc([p("a", "I like dogs and tea")]));
    expect(s.changes.map((c) => c.id)).toEqual(["text:a:0"]);
    expect(content(element, "a").querySelector(".jul-editor-suggest-del")?.textContent).toBe("cats"); // word granularity (default): the whole edited word is one hunk
    expect(content(element, "a").querySelector("[data-jul-editor-suggest-ghost=ins]")?.textContent).toBe("dogs");
    // one floating control per change, outside the contenteditable, hidden until hover / caret
    const ctl = document.querySelector<HTMLElement>("[data-jul-editor-suggest-control]")!;
    expect(ctl.hidden).toBe(true);
    expect(element.contains(ctl)).toBe(false);
    expect(document.querySelectorAll("[data-jul-editor-suggest-control]")).toHaveLength(1);
    hover(element, "a", ".jul-editor-suggest-del");
    expect(ctl.querySelector("[data-action=accept]")?.getAttribute("aria-label") ?? "").toMatch(/^Accept: /);
    expect(ctl.querySelector("[data-action=reject]")?.getAttribute("aria-label") ?? "").toMatch(/^Reject: /);
    expect(content(element, "a").querySelector("[data-jul-editor-diff-actions]")).toBeNull();
    expect(JSON.stringify(editor.getDoc())).toBe(before);
    s.destroy();
    expect(content(element, "a").querySelector("[data-jul-editor-deco], [data-jul-editor-widget]")).toBeNull();
    editor.destroy();
  });

  it("accept applies the change to the editor via a transaction (undoable); decorations clear", () => {
    const { element, editor } = mount(doc([p("a", "I like cats and tea")]));
    const s = createEditorSuggestions(editor, doc([p("a", "I like dogs and tea")]));
    hover(element, "a", ".jul-editor-suggest-del");
    const ctl = document.querySelector<HTMLElement>("[data-jul-editor-suggest-control]")!;
    expect(ctl.hidden).toBe(false);
    (ctl.querySelector("[data-action=accept]") as HTMLButtonElement).click();
    expect(texts(editor)).toEqual(["I like dogs and tea"]);
    expect(s.changes).toEqual([]);
    expect(content(element, "a").querySelector("[data-jul-editor-widget]")).toBeNull();
    editor.commands.undo();
    expect(texts(editor)).toEqual(["I like cats and tea"]);
    s.destroy();
    editor.destroy();
  });

  it("reject drops only that change from the suggestion and leaves the editor text alone", () => {
    const { editor } = mount(doc([p("a", "alpha beta"), p("b", "gamma")]));
    const s = createEditorSuggestions(editor, doc([p("a", "alpha BETA"), p("b", "gamma delta")]));
    expect(s.changes).toHaveLength(2);
    s.reject(s.changes[0]!.id);
    expect(texts(editor)).toEqual(["alpha beta", "gamma"]);
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]!.blockId).toBe("b");
    s.acceptAll();
    expect(texts(editor)).toEqual(["alpha beta", "gamma delta"]);
    expect(s.changes).toEqual([]);
    s.destroy();
    editor.destroy();
  });

  it("previews an inserted block as a ghost line and accept inserts it", () => {
    const { element, editor } = mount(doc([p("a", "first")]));
    const s = createEditorSuggestions(editor, doc([p("a", "first"), p("n", "brand new")]));
    expect(s.changes.map((c) => c.kind)).toEqual(["insert"]);
    expect(content(element, "a").querySelector("[data-jul-editor-suggest-ghost=ins]")?.textContent).toContain("brand new");
    s.accept(s.changes[0]!.id);
    expect(texts(editor)).toEqual(["first", "brand new"]);
    s.destroy();
    editor.destroy();
  });

  it("keeps recomputing while the user edits the editor", () => {
    const { editor } = mount(doc([p("a", "abc")]));
    const s = createEditorSuggestions(editor, doc([p("a", "abcd")]));
    expect(s.changes).toHaveLength(1);
    editor.update((tx) => tx.replaceContent("a", 3, 3, [{ type: "text", text: "d" }]));
    expect(s.changes).toEqual([]); // the editor caught up with the suggestion
    s.destroy();
    editor.destroy();
  });
});

describe("in-editor suggestions: granularity, floating control, remainingProposal", () => {
  it("fix-grammar style edits give one change per word, not per character", () => {
    const { editor } = mount(doc([p("a", "teh agent can recieve input")]));
    const target = doc([p("a", "The agent can receive input")]);
    const word = createEditorSuggestions(editor, target);
    expect(word.changes).toHaveLength(2);
    word.destroy();
    const chars = createEditorSuggestions(editor, target, { granularity: "char" });
    expect(chars.changes.length).toBeGreaterThan(2);
    chars.destroy();
    editor.destroy();
  });

  it("shows the control on hover (one per change), rejects via the control, and hides on Escape", () => {
    const { element, editor } = mount(doc([p("a", "alpha beta"), p("b", "gamma")]));
    const s = createEditorSuggestions(editor, doc([p("a", "alpha BETA"), p("b", "gamma delta")]));
    hover(element, "a", ".jul-editor-suggest-del");
    const ctl = document.querySelector<HTMLElement>("[data-jul-editor-suggest-control]")!;
    expect(ctl.hidden).toBe(false);
    expect(ctl.getAttribute("data-for")).toBe("text:a:0");
    expect(ctl.getAttribute("role")).toBe("toolbar");
    ctl.querySelector<HTMLElement>("[data-action=reject]")!.click();
    expect(s.changes.map((c) => c.blockId)).toEqual(["b"]);
    expect(ctl.hidden).toBe(true);
    s.destroy();
    expect(document.querySelector("[data-jul-editor-suggest-control]")).toBeNull();
    editor.destroy();
  });

  it("remainingProposal reflects partial accept / reject", () => {
    const { editor } = mount(doc([p("a", "one"), p("b", "two"), p("c", "three")]));
    const s = createEditorSuggestions(editor, doc([p("a", "ONE"), p("b", "TWO"), p("c", "THREE")]));
    s.reject("text:a:0");
    s.accept("text:b:0");
    expect(texts(editor)).toEqual(["one", "TWO", "three"]);
    const rem = s.remainingProposal!;
    expect(rem.blocks.map((b) => (b.content as { text: string }[])[0]!.text)).toEqual(["one", "TWO", "THREE"]);
    expect(s.changes).toHaveLength(1);
    s.destroy();
    editor.destroy();
  });
});

describe("in-editor suggestions (perspective proposed)", () => {
  it("highlights inserted text, strikes deleted text as a widget; reject reverts in the editor", () => {
    const { element, editor } = mount(doc([p("a", "I like dogs and tea")])); // the AI already wrote "dogs"
    const s = createEditorSuggestions(editor, doc([p("a", "I like cats and tea")]), { perspective: "proposed" });
    expect(content(element, "a").querySelector(".jul-editor-suggest-ins[data-jul-editor-deco]")?.textContent).toBe("dogs");
    expect(content(element, "a").querySelector("[data-jul-editor-suggest-ghost=del]")?.textContent).toBe("cats"); // word granularity (default): the whole edited word is one hunk
    s.reject(s.changes[0]!.id);
    expect(texts(editor)).toEqual(["I like cats and tea"]);
    expect(s.changes).toEqual([]);
    s.destroy();
    editor.destroy();
  });

  it("accept makes the original absorb the change and the editor is untouched", () => {
    const { editor } = mount(doc([p("a", "new text")]));
    const s = createEditorSuggestions(editor, doc([p("a", "old text")]), { perspective: "proposed" });
    s.acceptAll();
    expect(texts(editor)).toEqual(["new text"]);
    expect(s.changes).toEqual([]);
    s.destroy();
    editor.destroy();
  });
});

describe("useEditorSuggestions", () => {
  it("exposes pending changes and decisions through React state", () => {
    const { editor } = mount(doc([p("a", "one two")]));
    let result!: ReturnType<typeof useEditorSuggestions>;
    function Probe({ proposed }: { proposed: Doc | null }) {
      result = useEditorSuggestions(editor, proposed);
      return null;
    }
    const proposed = doc([p("a", "one three")]);
    const r = render(<Probe proposed={proposed} />);
    expect(result.changes).toHaveLength(1);
    act(() => result.acceptAll());
    expect(texts(editor)).toEqual(["one three"]);
    expect(result.changes).toHaveLength(0);
    r.rerender(<Probe proposed={doc([p("a", "one three four")])} />);
    expect(result.changes).toHaveLength(1);
    r.rerender(<Probe proposed={null} />);
    expect(result.changes).toHaveLength(0);
    editor.destroy();
  });
});
