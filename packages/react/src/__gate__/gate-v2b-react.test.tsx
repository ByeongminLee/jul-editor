// Adversarial tests: React UI defects. Every test asserts the
// CORRECT behavior and fails on current code.
import type { Doc } from "@jul-editor/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, EmbedView, ImageView, InsertTable, MergeCells, createCodeBlockRenderer, useColorPicker, useEditor, useLinkEditor, useTableHover, useTurnInto } from "..";
import type { VoidRendererProps } from "..";

{
  const rp = Range.prototype as unknown as { getClientRects?: () => unknown[]; getBoundingClientRect?: () => DOMRect };
  rp.getClientRects ??= () => [];
  rp.getBoundingClientRect ??= () => new DOMRect();
}

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
afterEach(() => {
  cleanup();
  for (const k of ["__ed", "__cp", "__le", "__ti", "__hv"]) delete g[k];
});

function Probe() {
  g.__ed = useEditor();
  g.__cp = useColorPicker({ recentKey: "gate-v2b" });
  g.__le = useLinkEditor();
  g.__ti = useTurnInto();
  return null;
}
const ed = () => g.__ed as NonNullable<ReturnType<typeof useEditor>>;
const cp = () => g.__cp as ReturnType<typeof useColorPicker>;
const le = () => g.__le as ReturnType<typeof useLinkEditor>;
const ti = () => g.__ti as ReturnType<typeof useTurnInto>;

const textOfDoc = (d: Doc) => (d.blocks[0]!.content ?? []).map((i) => ("text" in i ? i.text : "")).join("");
function mount(doc: Doc) {
  render(
    <Editor defaultValue={doc}>
      <Editor.Content />
      <Probe />
    </Editor>,
  );
}
function sel(blockId: string, from: number, to: number, focusBlock = blockId) {
  act(() => ed().update((tx) => tx.setSelection({ type: "text", anchor: { blockId, offset: from }, focus: { blockId: focusBlock, offset: to } })));
}

describe("react v2 UI", () => {
  it("useColorPicker.current reports the color of the SELECTED run, not the whole block", () => {
    mount({
      version: 1,
      blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "red", marks: [{ type: "textColor", attrs: { color: "red" } }] }, { type: "text", text: " plain" }] }],
    });
    sel("p1", 0, 3);
    expect(cp().current.textColor).toBe("red");
  });

  it("useColorPicker.clear() is ONE undo step", () => {
    mount({
      version: 1,
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "abc", marks: [{ type: "textColor", attrs: { color: "red" } }, { type: "highlight", attrs: { color: "yellow" } }] }],
        },
      ],
    });
    sel("p1", 0, 3);
    const before = JSON.stringify(ed().getDoc().blocks[0]!.content);
    act(() => cp().clear());
    expect(ed().getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "abc" }]);
    act(() => ed().commands.undo());
    expect(JSON.stringify(ed().getDoc().blocks[0]!.content)).toBe(before);
  });

  it("useLinkEditor with a collapsed caret inside a link: popover seeds the href, but apply()/remove() must act on that link", () => {
    mount({
      version: 1,
      blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://a.example/" } }] }, { type: "text", text: " tail" }] }],
    });
    sel("p1", 2, 2);
    act(() => le().openEditor());
    expect(le().href).toBe("https://a.example/");
    act(() => le().apply("https://b.example/"));
    const link = (ed().getDoc().blocks[0]!.content![0] as { marks?: { attrs?: { href?: string } }[] }).marks?.[0]?.attrs?.href;
    expect(link).toBe("https://b.example/");
  });

  it("TurnInto 'Code' on a multi-block selection converts all or none (never a half-converted mix)", () => {
    mount({
      version: 1,
      blocks: [
        { id: "a", type: "bulletListItem", props: {}, content: [{ type: "text", text: "one" }] },
        { id: "b", type: "bulletListItem", props: {}, content: [{ type: "text", text: "two" }], children: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "child" }] }] },
      ],
    });
    sel("a", 0, 3, "b");
    const code = ti().items.find((i) => i.id === "codeBlock")!;
    act(() => ti().turnInto(code));
    const types = ed()
      .getDoc()
      .blocks.map((b) => b.type);
    expect(new Set(types).size).toBe(1); // observed: ["codeBlock", "bulletListItem"]
  });

  it("TurnInto 'Code' on a paragraph with a mention keeps the text as plain code text", () => {
    mount({
      version: 1,
      blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi " }, { type: "mention", attrs: { kind: "user", id: "u1", label: "bob" } }] }],
    });
    sel("p1", 0, 0);
    act(() => ti().turnInto(ti().items.find((i) => i.id === "codeBlock")!));
    const b = ed().getDoc().blocks[0]!;
    expect(b.type).toBe("codeBlock");
    expect(b.content).toEqual([{ type: "text", text: "hi @bob" }]);
  });

  it("locale='ko' localizes the table atoms (README: every built-in UI string)", () => {
    render(
      <Editor locale="ko">
        <Editor.Content />
        <InsertTable data-testid="ins" />
        <MergeCells data-testid="merge" />
      </Editor>,
    );
    expect(screen.getByTestId("ins").textContent).not.toBe("Table");
    expect(screen.getByTestId("merge").textContent).not.toBe("Merge cells");
  });

  it("locale='ko' localizes ImageView/EmbedView labels", () => {
    const editor = { getUploadState: () => undefined, getUploadPreview: () => undefined, onUpload: () => () => {}, retryUpload: vi.fn() } as unknown as VoidRendererProps["editor"];
    render(
      <Editor locale="ko">
        <ImageView block={{ id: "i", type: "image", props: { src: "x.png" } }} editor={editor} selected updateProps={vi.fn()} />
        <EmbedView block={{ id: "e", type: "embed", props: {} }} editor={editor} selected updateProps={vi.fn()} />
      </Editor>,
    );
    expect(screen.queryByLabelText("Caption")).toBeNull();
    expect(screen.queryByLabelText("Embed URL")).toBeNull();
  });

  it("useTableHover.deleteRow on hovered row 1 deletes row 1, not the row-0 rowspan anchor's row", () => {
    function HoverProbe() {
      g.__hv = useTableHover("t1");
      return null;
    }
    const cell = (id: string, text: string, props: Record<string, number> = {}) => ({ id, type: "tableCell", props, content: [{ type: "text" as const, text }] });
    render(
      <Editor
        defaultValue={{
          version: 1,
          blocks: [
            {
              id: "t1",
              type: "table",
              props: {},
              children: [
                { id: "r1", type: "tableRow", props: {}, children: [cell("a1", "A1", { rowspan: 2 }), cell("b1", "B1")] },
                { id: "r2", type: "tableRow", props: {}, children: [cell("b2", "B2")] },
                { id: "r3", type: "tableRow", props: {}, children: [cell("a3", "A3"), cell("b3", "B3")] },
              ],
            },
          ],
        }}
      >
        <Editor.Content />
        <Probe />
        <HoverProbe />
      </Editor>,
    );
    const hv = () => g.__hv as ReturnType<typeof useTableHover>;
    act(() => hv().setHoverRow(1));
    act(() => hv().deleteRow());
    const rows = ed().getDoc().blocks[0]!.children!.map((r) => r.id);
    expect(rows).toContain("r1"); // observed: r1 (A1/B1) deleted instead of r2
    expect(rows).not.toContain("r2");
  });

  it("CodeBlockView copy falls back when navigator.clipboard.writeText rejects (no permission)", async () => {
    const writeText = vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const View = createCodeBlockRenderer({ languages: [{ value: "ts", label: "TS" }] });
      const editor = { getState: () => ({ store: { records: new Map([["c1", { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "x" }], childIds: [], parentId: null }]]) } }) };
      render(<View block={{ id: "c1", type: "codeBlock", props: { language: "ts" } }} editor={editor as never} selected={false} updateProps={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(unhandled).toEqual([]);
      expect(exec).toHaveBeenCalledWith("copy");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it("CodeBlockView language select shows the block's real language when it is not in the list (e.g. ```py)", () => {
    const View = createCodeBlockRenderer({
      languages: [
        { value: "plaintext", label: "Plain Text" },
        { value: "python", label: "Python" },
      ],
    });
    const editor = { getState: () => ({ store: { records: new Map() } }) };
    render(<View block={{ id: "c1", type: "codeBlock", props: { language: "py" } }} editor={editor as never} selected={false} updateProps={vi.fn()} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("py"); // observed: "plaintext" (UI claims Plain Text while lowlight highlights python)
  });

  it("typing a caption is not one undo step per keystroke", () => {
    function Img(p: VoidRendererProps) {
      return <ImageView {...p} selected />;
    }
    render(
      <Editor defaultValue={{ version: 1, blocks: [{ id: "i1", type: "image", props: { src: "https://x/a.png" } }, { id: "p", type: "paragraph", props: {}, content: [] }] }} renderers={{ image: Img }}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const input = screen.getByLabelText("Caption") as HTMLInputElement;
    for (const v of ["c", "ca", "cat"]) fireEvent.change(input, { target: { value: v } });
    expect(ed().getDoc().blocks[0]!.props.caption).toBe("cat");
    act(() => ed().commands.undo());
    expect(ed().getDoc().blocks[0]!.props.caption ?? "").toBe(""); // observed: "ca"
  });

  it("EmbedView rejects non-URL input instead of storing it as a link embed", () => {
    const updateProps = vi.fn();
    const editor = {} as VoidRendererProps["editor"];
    render(<EmbedView block={{ id: "e", type: "embed", props: {} }} editor={editor} selected updateProps={updateProps} />);
    const input = screen.getByLabelText("Embed URL");
    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateProps).not.toHaveBeenCalled(); // observed: {provider:"link", url:"hello world"}
  });

  it("text typed into an <input> inside a decorated block's chrome never reaches the doc", () => {
    function Chrome() {
      return <input aria-label="note" />;
    }
    render(
      <Editor defaultValue={{ version: 1, blocks: [{ id: "c1", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "x" }] }] }} renderers={{ codeBlock: Chrome }}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    sel("c1", 1, 1);
    const input = screen.getByLabelText("note");
    const ev = new InputEvent("beforeinput", { inputType: "insertText", data: "Z", bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(ev);
    });
    expect(ed().getDoc().blocks[0]!.content).toEqual([{ type: "text", text: "x" }]); // observed: "xZ"
    expect(ev.defaultPrevented).toBe(false); // the input's own native edit must go through
  });

  it("a table merged in the editor survives save + reload (getDoc -> <Editor defaultValue>) unchanged", () => {
    const c = (id: string) => ({ id, type: "tableCell", props: {}, content: [{ type: "text" as const, text: id }] });
    const rows = [0, 1, 2].map((r) => ({ id: `r${r}`, type: "tableRow", props: {}, children: [0, 1, 2].map((k) => c(`c${r}${k}`)) }));
    const first = render(
      <Editor defaultValue={{ version: 1, blocks: [{ id: "t1", type: "table", props: {}, children: rows }] }}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => ed().update((tx) => tx.setSelection({ type: "cells", tableId: "t1", anchor: [0, 0], focus: [1, 1] })));
    act(() => ed().commands.mergeCells());
    const saved = JSON.parse(JSON.stringify(ed().getDoc())) as Doc;
    const count = (d: Doc) => d.blocks[0]!.children!.map((r) => r.children!.length);
    const before = count(saved);
    first.unmount();
    mount(saved);
    expect(count(ed().getDoc())).toEqual(before); // observed: [2,1,3] -> [3,3,3] (padding cells shift the grid to 4-5 columns)
  });

  it("README's inline `labels={{...}}` must not recreate the editor on parent re-render (edits and history kept)", () => {
    function Host() {
      const [, setDoc] = useState<Doc | null>(null);
      return (
        <Editor defaultValue={{ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] }} labels={{ toolbarBold: "Strong" }} onChange={setDoc}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    render(<Host />);
    const firstEditor = ed();
    act(() => ed().update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, " world")));
    expect(textOfDoc(ed().getDoc())).toBe("hello world"); // observed: "hello" (edit wiped)
    expect(ed()).toBe(firstEditor); // observed: a fresh editor rebuilt from defaultValue
  });

  it("switching locale at runtime keeps the user's edits", () => {
    function Host({ locale }: { locale: "en" | "ko" }) {
      return (
        <Editor defaultValue={{ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] }} locale={locale}>
          <Editor.Content />
          <Probe />
        </Editor>
      );
    }
    const r = render(<Host locale="en" />);
    act(() => ed().update((tx) => tx.insertText({ blockId: "p1", offset: 5 }, "!")));
    r.rerender(<Host locale="ko" />);
    expect(textOfDoc(ed().getDoc())).toBe("hello!"); // observed: "hello"
  });
});
