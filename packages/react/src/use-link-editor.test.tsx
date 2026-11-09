import type { Doc } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor, useEditor } from "./";
import { useLinkEditor } from "./use-link-editor.js";
import type { UseLinkEditorResult } from "./use-link-editor.js";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testLinkEditor?: unknown }).__testLinkEditor;
});

// jsdom has no layout: stub the Range rect APIs getCaretRect()/getSelectionRect() read.
{
  const rp = Range.prototype as unknown as { getClientRects?: () => unknown[]; getBoundingClientRect?: () => DOMRect };
  rp.getClientRects ??= () => [];
  rp.getBoundingClientRect ??= () => new DOMRect();
}

function doc(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello world" }] }] };
}

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const linkEditor = useLinkEditor();
  (globalThis as { __testLinkEditor?: unknown }).__testLinkEditor = linkEditor;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}
function testLinkEditor(): UseLinkEditorResult {
  return (globalThis as { __testLinkEditor?: UseLinkEditorResult }).__testLinkEditor!;
}

function selectWord() {
  act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } })));
}

describe("useLinkEditor", () => {
  it("openEditor() opens with the current selection's rect, apply() links the selected text", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    act(() => testLinkEditor().openEditor());
    expect(testLinkEditor().open).toBe(true);
    expect(testLinkEditor().href).toBe(""); // no existing link yet

    act(() => testLinkEditor().apply("https://example.com/x"));
    expect(testLinkEditor().open).toBe(false);
    const content = testEditor().getDoc().blocks[0]!.content!;
    expect(content[0]).toEqual({ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://example.com/x" } }] });
  });

  it("apply() links a backward (right-to-left) selection too", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 5 }, focus: { blockId: "p1", offset: 0 } })));
    act(() => testLinkEditor().openEditor());
    act(() => testLinkEditor().apply("https://example.com/x"));
    expect(testEditor().getDoc().blocks[0]!.content![0]).toEqual({ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://example.com/x" } }] });
  });

  it("opening on already-linked text seeds href, and apply() with a NEW href replaces it (not a toggle-off)", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    act(() => testLinkEditor().apply("https://a.example"));

    selectWord();
    act(() => testLinkEditor().openEditor());
    expect(testLinkEditor().href).toBe("https://a.example");

    act(() => testLinkEditor().apply("https://b.example"));
    const content = testEditor().getDoc().blocks[0]!.content!;
    expect(content[0]).toEqual({ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://b.example" } }] });
  });

  it("remove() clears an existing link", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    act(() => testLinkEditor().apply("https://a.example"));
    selectWord();
    act(() => testLinkEditor().remove());
    expect(testEditor().getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("apply() with an empty href removes the link instead of applying an empty one", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    act(() => testLinkEditor().apply("https://a.example"));
    selectWord();
    act(() => testLinkEditor().apply("   "));
    expect(testEditor().getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("apply() adds https:// to a scheme-less domain instead of storing a relative URL", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    act(() => testLinkEditor().apply("example.com"));
    const content = testEditor().getDoc().blocks[0]!.content!;
    expect(content[0]).toEqual({ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://example.com" } }] });
  });

  it("Mod-k opens the popover instead of core's own window.prompt default", () => {
    const { container } = render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectWord();
    let promptCalled = false;
    const realPrompt = window.prompt;
    window.prompt = () => ((promptCalled = true), null);
    const root = container.querySelector("[data-jul-editor-root]")!;
    act(() => {
      fireEvent.keyDown(root, { key: "k", metaKey: true, ctrlKey: true }); // both -- isMac() detection is environment-dependent
    });
    expect(testLinkEditor().open).toBe(true);
    expect(promptCalled).toBe(false);
    window.prompt = realPrompt;
  });
});
