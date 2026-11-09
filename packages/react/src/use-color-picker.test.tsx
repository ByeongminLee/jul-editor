import type { Doc } from "@jul-editor/core";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, useEditor } from "./";
import { useColorPicker } from "./use-color-picker.js";
import type { UseColorPickerResult } from "./use-color-picker.js";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testPicker?: unknown }).__testPicker;
});

const RECENT_KEY = "test:color-picker:recent";
beforeEach(() => localStorage.removeItem(RECENT_KEY));

function doc(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] };
}

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const picker = useColorPicker({ recentKey: RECENT_KEY });
  (globalThis as { __testPicker?: unknown }).__testPicker = picker;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}
function testPicker(): UseColorPickerResult {
  return (globalThis as { __testPicker?: UseColorPickerResult }).__testPicker!;
}

function selectAll() {
  act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } })));
}

describe("useColorPicker", () => {
  it("exposes the fixed 10-token palette", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    expect(testPicker().palette).toContain("red");
    expect(testPicker().palette).toContain("default");
  });

  it("setTextColor sets a textColor mark on the selected text, setHighlight sets highlight, clear removes both", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectAll();

    act(() => testPicker().setTextColor("red"));
    let content = testEditor().getDoc().blocks[0]!.content!;
    expect(content).toEqual([{ type: "text", text: "hello", marks: [{ type: "textColor", attrs: { color: "red" } }] }]);

    // switching color REPLACES it (not a toggle-off) -- the bug this hook exists to avoid
    selectAll();
    act(() => testPicker().setTextColor("blue"));
    content = testEditor().getDoc().blocks[0]!.content!;
    expect(content).toEqual([{ type: "text", text: "hello", marks: [{ type: "textColor", attrs: { color: "blue" } }] }]);

    selectAll();
    act(() => testPicker().setHighlight("yellow"));
    content = testEditor().getDoc().blocks[0]!.content!;
    expect(content).toEqual([
      { type: "text", text: "hello", marks: [{ type: "textColor", attrs: { color: "blue" } }, { type: "highlight", attrs: { color: "yellow" } }] },
    ]);

    selectAll();
    act(() => testPicker().clear());
    content = testEditor().getDoc().blocks[0]!.content!;
    expect(content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("works on a backward (right-to-left) selection too", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 4 }, focus: { blockId: "p1", offset: 1 } })));
    act(() => testPicker().setHighlight("yellow"));
    expect(testEditor().getDoc().blocks[0]!.content!).toEqual([
      { type: "text", text: "h" },
      { type: "text", text: "ell", marks: [{ type: "highlight", attrs: { color: "yellow" } }] },
      { type: "text", text: "o" },
    ]);
  });

  it("remembers recently used colors (most-recent-first, deduped) across remounts", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    selectAll();
    act(() => testPicker().setTextColor("red"));
    selectAll();
    act(() => testPicker().setHighlight("blue"));
    selectAll();
    act(() => testPicker().setTextColor("red")); // re-picking red doesn't duplicate it
    expect(testPicker().recent).toEqual(["red", "blue"]);

    cleanup();
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    expect(testPicker().recent).toEqual(["red", "blue"]);
  });
});
