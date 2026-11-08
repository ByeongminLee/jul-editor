// Adversarial repros (React). Each test asserts CORRECT behavior and
// is expected to FAIL on the current code.
import type { Doc } from "@jul-editor/core";
import { defineBlock } from "@jul-editor/core";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor, useEditor } from "..";

afterEach(() => cleanup());

let current: ReturnType<typeof useEditor> = null;
function Probe() {
  current = useEditor();
  return null;
}

const callout = defineBlock({ type: "callout", content: "inline", children: "none", props: {} });

function doc(text: string): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text }] }] };
}

describe("react", () => {
  it("inline `blocks` array + onChange state update must not destroy the editor and wipe edits", () => {
    function App() {
      const [, setDoc] = useState<Doc | null>(null);
      return (
        // The idiomatic usage: an inline array literal, parent keeps the doc in state.
        <Editor defaultValue={doc("hello")} blocks={[callout]} onChange={setDoc}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    render(<App />);
    const first = current!;
    act(() => {
      first.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, " world"));
    });
    // After the parent re-rendered from onChange, the SAME editor must still hold the edit.
    const text = (current!.getDoc().blocks[0]!.content![0] as { text: string }).text;
    expect(text).toBe("hello world");
    expect(current).toBe(first);
  });
});

describe("react: controlled value", () => {
  it("a controlled parent that stores a structurally-equal copy of the emitted doc must not loop forever", () => {
    let renders = 0;
    function App() {
      const [v, setV] = useState<Doc>(() => doc("a"));
      renders++;
      if (renders > 50) throw new Error(`render loop: ${renders} renders`);
      // e.g. an immutable store / zod parse / JSON round-trip hands back a new object each time
      return (
        <Editor value={v} onChange={(d) => setV({ ...d })}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    render(<App />);
    act(() => {
      current!.update((tx) => tx.insertText({ blockId: "p1", offset: 1 }, "1"));
    });
    expect(renders).toBeLessThan(10);
    expect((current!.getDoc().blocks[0]!.content![0] as { text: string }).text).toBe("a1");
  });
});
