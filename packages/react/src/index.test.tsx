import type { Doc } from "@jul-editor/core";
import { cleanup, render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, useEditor, VERSION } from "./";
import type { VoidRendererProps } from "./";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
});

function makeDoc(text: string): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text }] }] };
}

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}

describe("@jul-editor/react", () => {
  it("exposes a VERSION string (kept for the playground's existing demo page)", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("mounts Editor.Content and reflects the initial doc through useEditor()", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    expect(testEditor().getDoc().blocks[0]?.content?.[0]).toMatchObject({ text: "hello" });
  });

  it("re-passing the exact object last emitted via onChange does not reset selection (anti feedback-loop)", () => {
    function ControlledHarness() {
      const [value, setValue] = useState<Doc>(() => makeDoc("hello"));
      return (
        <Editor value={value} onChange={setValue}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    render(<ControlledHarness />);
    const editor = testEditor();

    act(() => {
      editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } }));
    });
    act(() => {
      // Fires onChange(newDoc); the harness's setValue(newDoc) re-renders with
      // the *exact* object this Editor itself just produced.
      editor.update((tx) => tx.insertText({ blockId: "p1", offset: 1 }, "X"));
    });

    expect(editor.getState().selection).not.toBeNull();
    expect(editor.getDoc().blocks[0]?.content?.[0]).toMatchObject({ text: "hXello" });
  });

  it("ignores an older onChange value that arrives after a newer edit", () => {
    const emitted: Doc[] = [];
    function Harness({ value }: { value: Doc }) {
      return <Editor value={value} onChange={(doc) => emitted.push(doc)}><Editor.Content /><Probe /></Editor>;
    }
    const { rerender } = render(<Harness value={makeDoc("hello")} />);
    const editor = testEditor();

    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "A").setSelection({ type: "text", anchor: { blockId: "p1", offset: 6 }, focus: { blockId: "p1", offset: 6 } })));
    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 6 }, "B").setSelection({ type: "text", anchor: { blockId: "p1", offset: 7 }, focus: { blockId: "p1", offset: 7 } })));
    expect(emitted).toHaveLength(2);

    act(() => rerender(<Harness value={emitted[0]!} />));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "helloAB" }]);
    expect(editor.getState().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 7 }, focus: { blockId: "p1", offset: 7 } });
  });

  it("accepts an older document as an intentional reset after the latest value catches up", () => {
    const emitted: Doc[] = [];
    function Harness({ value }: { value: Doc }) {
      return <Editor value={value} onChange={(doc) => emitted.push(doc)}><Editor.Content /><Probe /></Editor>;
    }
    const { rerender } = render(<Harness value={makeDoc("hello")} />);
    const editor = testEditor();
    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "A")));
    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 6 }, "B")));

    act(() => rerender(<Harness value={emitted[1]!} />));
    act(() => rerender(<Harness value={emitted[0]!} />));
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "helloA" }]);
  });

  it("keeps the current controlled value pending while a newer edit awaits its echo", () => {
    const emitted: Doc[] = [];
    function Harness({ value }: { value: Doc }) {
      return <Editor value={value} onChange={(doc) => emitted.push(doc)}><Editor.Content /><Probe /></Editor>;
    }
    const { rerender } = render(<Harness value={makeDoc("hello")} />);
    const editor = testEditor();
    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "A")));
    act(() => rerender(<Harness value={emitted[0]!} />)); // parent caught up to A

    act(() => editor.update((tx) => tx.insertText({ blockId: "p1", offset: 6 }, "B")));
    act(() => rerender(<Harness value={emitted[0]!} />)); // same prop during B's pending round trip
    expect(editor.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "helloAB" }]);
  });

  it("passing a brand-new value object resets the doc and clears selection", () => {
    function Harness({ value }: { value: Doc }) {
      return (
        <Editor value={value}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    const doc1 = makeDoc("a");
    const { rerender } = render(<Harness value={doc1} />);
    const editor = testEditor();

    act(() => {
      editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } }));
    });
    expect(editor.getState().selection).not.toBeNull();

    const doc2 = makeDoc("b");
    act(() => rerender(<Harness value={doc2} />));

    expect(editor.getState().selection).toBeNull();
    expect(editor.getDoc().blocks[0]?.content?.[0]).toMatchObject({ text: "b" });
  });

  it("Editor.Toolbar renders role=toolbar with an aria-label and roving tabindex", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Toolbar>
          <Editor.Bold />
          <Editor.Italic />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.getAttribute("tabindex")).toBe("0");
    expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");
  });

  it("clicking Editor.Bold over a selection sets the bold mark in the model", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Toolbar>
          <Editor.Bold />
        </Editor.Toolbar>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const editor = testEditor();
    act(() => {
      editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
    });

    act(() => screen.getByRole("button", { name: "Bold" }).click());

    const content = editor.getDoc().blocks[0]?.content;
    expect(content?.[0]).toMatchObject({ marks: [{ type: "bold" }] });
  });

  it("toolbar Bold at a collapsed caret shows pressed (stored mark), and Mod-b/caret moves keep it in sync", () => {
    render(
      <Editor defaultValue={{ version: 1, blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] },
        { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "world" }] },
      ] }}>
        <Editor.Toolbar>
          <Editor.Bold />
        </Editor.Toolbar>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const editor = testEditor();
    const caret = (blockId: string, offset: number) => ({ type: "text" as const, anchor: { blockId, offset }, focus: { blockId, offset } });
    act(() => {
      editor.update((tx) => tx.setSelection(caret("p1", 2)));
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    act(() => bold.click());
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      editor.update((tx) => tx.setSelection(caret("p2", 2)));
    });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      editor.getRoot().dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(bold.getAttribute("aria-pressed")).toBe("true");
  });

  it("toolbar buttons prevent mousedown's default (focus stays in the editor)", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Toolbar>
          <Editor.Bold />
          <Editor.Heading level={1} />
          <Editor.BulletList />
          <Editor.Undo />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    for (const button of screen.getAllByRole("button")) {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      button.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it("a pointer click on a toolbar button hands focus back to the editor at its selection", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Toolbar>
          <Editor.Heading level={1} />
        </Editor.Toolbar>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const editor = testEditor();
    const sel = { type: "text" as const, anchor: { blockId: "p1", offset: 3 }, focus: { blockId: "p1", offset: 3 } };
    act(() => {
      editor.update((tx) => tx.setSelection(sel));
    });
    const h1 = screen.getByRole("button", { name: "Heading 1" });
    h1.focus();
    act(() => {
      h1.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(editor.getDoc().blocks[0]?.type).toBe("heading");
    expect(editor.getRoot().contains(document.activeElement)).toBe(true);
    expect(editor.getState().selection).toEqual(sel);
  });

  it("clicking a pressed block-type button toggles the block back to a paragraph", () => {
    render(
      <Editor defaultValue={makeDoc("hello")}>
        <Editor.Toolbar>
          <Editor.Heading level={1} />
          <Editor.BulletList />
          <Editor.Quote />
        </Editor.Toolbar>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const editor = testEditor();
    act(() => {
      editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } }));
    });
    for (const name of ["Heading 1", "Bullet list", "Quote"]) {
      const button = screen.getByRole("button", { name });
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(editor.getDoc().blocks[0]?.type).toBe("paragraph");
    }
  });

  it("heading button reflects the full selection when levels differ", () => {
    const value = { version: 1 as const, blocks: [
      { id: "a", type: "heading", props: { level: 1 }, content: [{ type: "text" as const, text: "one" }] },
      { id: "b", type: "heading", props: { level: 2 }, content: [{ type: "text" as const, text: "two" }] },
    ] };
    render(<Editor defaultValue={value}><Editor.Toolbar><Editor.Heading level={1} /></Editor.Toolbar><Editor.Content /><Probe /></Editor>);
    act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "a", offset: 0 }, focus: { blockId: "b", offset: 3 } })));
    expect(screen.getByRole("button", { name: "Heading 1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("heading button reflects a selected heading block", () => {
    const value = { version: 1 as const, blocks: [{ id: "a", type: "heading", props: { level: 2 }, content: [{ type: "text" as const, text: "one" }] }] };
    render(<Editor defaultValue={value}><Editor.Toolbar><Editor.Heading level={2} /></Editor.Toolbar><Editor.Content /><Probe /></Editor>);
    act(() => testEditor().update((tx) => tx.setSelection({ type: "block", ids: ["a"] })));
    expect(screen.getByRole("button", { name: "Heading 2" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("toolbar roving focus includes custom buttons and skips disabled items", () => {
    render(<Editor defaultValue={makeDoc("hello")}><Editor.Toolbar>
      <button disabled>Unavailable</button><button>Custom</button><Editor.Bold />
    </Editor.Toolbar><Editor.Content /></Editor>);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    buttons[1]!.focus();
    act(() => buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[2]);
    act(() => buttons[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("leaves input navigation keys and popover buttons outside toolbar roving", () => {
    render(<Editor defaultValue={makeDoc("hello")}><Editor.Toolbar>
      <button>Link</button><form><input aria-label="URL" /><button>Apply</button></form><Editor.Bold />
    </Editor.Toolbar><Editor.Content /></Editor>);
    const input = screen.getByRole("textbox", { name: "URL" });
    input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Apply" }).getAttribute("tabindex")).toBeNull();
  });

  it("roves toolbar buttons when the editor is inside a form", () => {
    render(<form><Editor defaultValue={makeDoc("hello")}><Editor.Toolbar><Editor.Bold /><Editor.Italic /></Editor.Toolbar><Editor.Content /></Editor></form>);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("tabindex"))).toEqual(["0", "-1"]);
  });

  it("a press on a disabled toolbar button does not take focus from the editor", () => {
    render(<Editor defaultValue={makeDoc("hello")}><Editor.Toolbar><button disabled><span>Unavailable</span></button><Editor.Bold /></Editor.Toolbar><Editor.Content /></Editor>);
    const press = (target: Element) => {
      const event = new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(screen.getByText("Unavailable"))).toBe(true);
    expect(press(screen.getByRole("button", { name: "Bold" }))).toBe(false);
  });

  it("toolbar roving tabindex survives a re-render", () => {
    const doc = makeDoc("hello");
    const tree = (extra: string) => (
      <Editor defaultValue={doc}>
        <Editor.Toolbar data-extra={extra}>
          <Editor.Bold />
          <Editor.Italic />
          <Editor.Strike />
        </Editor.Toolbar>
        <Editor.Content />
        <Probe />
      </Editor>
    );
    const { rerender } = render(tree("a"));
    const editor = testEditor();
    const buttons = screen.getAllByRole("button");
    buttons[0]!.focus();
    act(() => {
      buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
    // a commit that changes the active marks re-renders the toolbar atoms
    act(() => {
      editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 5 } }));
    });
    act(() => {
      editor.commands.toggleMark("bold");
    });
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    rerender(tree("b")); // the parent re-renders the toolbar itself
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
  });

  // Locale/labels flow into the toolbar atoms' visible text AND
  // aria-label default (both from the same resolved Labels key), and into
  // the toolbar's own default aria-label ("Formatting"/"서식").
  it("<Editor locale=\"ko\"> localizes toolbar atoms' default text/aria-label and the toolbar's own aria-label", () => {
    render(
      <Editor defaultValue={makeDoc("hello")} locale="ko">
        <Editor.Toolbar>
          <Editor.Bold />
          <Editor.Heading level={2} />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    expect(screen.getByRole("toolbar").getAttribute("aria-label")).toBe("서식");
    const bold = screen.getByRole("button", { name: "굵게" });
    expect(bold.textContent).toBe("굵게");
    expect(screen.getByRole("button", { name: "제목 2" })).toBeDefined();
  });

  it("<Editor labels={{toolbarBold: '...'}}> overrides just that key on top of the (en) default preset", () => {
    render(
      <Editor defaultValue={makeDoc("hello")} labels={{ toolbarBold: "Strong" }}>
        <Editor.Toolbar>
          <Editor.Bold />
          <Editor.Italic />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    expect(screen.getByRole("button", { name: "Strong" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Italic" })).toBeDefined(); // untouched
  });

  it("passing an explicit aria-label/children on a toolbar atom overrides the localized default", () => {
    render(
      <Editor defaultValue={makeDoc("hello")} locale="ko">
        <Editor.Toolbar>
          <Editor.Bold aria-label="my-bold" />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    expect(screen.getByRole("button", { name: "my-bold" })).toBeDefined();
  });

  it("void renderers mount via a portal, receive live props, and an error in one is contained by its own ErrorBoundary", () => {
    function Boom(): never {
      throw new Error("boom");
    }
    function Pic({ block, selected, updateProps }: VoidRendererProps) {
      return (
        <button data-testid="void-btn" data-selected={selected} onClick={() => updateProps({ alt: "changed" })}>
          {String(block.props.alt)}
        </button>
      );
    }
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] },
        { id: "v1", type: "image", props: { src: "x.png", alt: "pic" } },
        { id: "v2", type: "diagram", props: { code: "x" } },
      ],
    };
    render(
      <Editor defaultValue={doc} renderers={{ image: Pic, diagram: Boom as unknown as typeof Pic }}>
        <Editor.Content />
      </Editor>,
    );

    const button = screen.getByTestId("void-btn");
    expect(button.textContent).toBe("pic");
    expect(button.getAttribute("data-selected")).toBe("false");

    act(() => button.click());
    expect(screen.getByTestId("void-btn").textContent).toBe("changed");
  });

  // BUG (found while building a consumer demo of <Editor onUpload>): the
  // prop was captured into a ref for hooks/context but never actually
  // reached the underlying `createEditor({ onUpload })` call in
  // EditorContent's mount effect, so a pasted/dropped image File was always
  // silently ignored no matter what `onUpload` was passed -- see Editor.tsx.
  // jsdom has neither ClipboardEvent nor DataTransfer -- a plain, cancelable
  // Event with `.clipboardData` monkey-patched on drives the same code path
  // (packages/core/src/view/clipboard.test.ts's own `fakePasteEvent`).
  it("<Editor onUpload> is actually wired: pasting an image File uploads it and fills in the image block's src", async () => {
    const onUpload = vi.fn(async (file: File) => `https://cdn.example/${file.name}`);
    render(
      <Editor defaultValue={makeDoc("hello")} onUpload={onUpload}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const editor = testEditor();
    act(() => {
      const at = { blockId: "p1", offset: 0 };
      editor.update((tx) => tx.setSelection({ type: "text", anchor: at, focus: at }));
    });

    const root = document.querySelector("[data-jul-editor-root]")!;
    const file = new File(["x"], "photo.png", { type: "image/png" });
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: () => "", files: [file] } });
    await act(async () => {
      root.dispatchEvent(ev);
      await Promise.resolve(); // let the mocked onUpload's promise settle
    });

    expect(onUpload).toHaveBeenCalledWith(file, expect.objectContaining({kind: "image"}));
    const image = editor.getDoc().blocks.find((b) => b.type === "image");
    expect(image?.props.src).toBe("https://cdn.example/photo.png");
  });
  it("exposes deferred upload and structured asset results through React", async () => {
    const onUpload = vi.fn(async () => ({src: "/assets/photo.png", assetId: "photo-1"}));
    render(<Editor defaultValue={makeDoc("hello")} uploadMode="deferred" onUpload={onUpload}><Editor.Content/><Probe/></Editor>);
    const editor = testEditor();
    let ids: string[] = [];
    act(() => { ids = editor.insertFiles([new File(["photo"], "photo.png", {type: "image/png"})]); });
    expect(onUpload).not.toHaveBeenCalled();
    expect(editor.getPendingUploads()).toHaveLength(1);
    await act(async () => { expect(await editor.uploadPending()).toEqual({uploaded: ids, failed: []}); });
    expect(editor.getDoc().blocks.find(block => block.id === ids[0])?.props).toMatchObject({src: "/assets/photo.png", assetId: "photo-1"});
  });

});
