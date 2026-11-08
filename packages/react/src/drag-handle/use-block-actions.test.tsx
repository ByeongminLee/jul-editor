import type { Doc } from "@jul-editor/core";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor, useEditor } from "..";
import { useBlockActions } from "./use-block-actions.js";
import type { BlockActions } from "./use-block-actions.js";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testActions?: unknown }).__testActions;
});

// jsdom has no layout: stub the two Range rect APIs getCaretRect() reads --
// insertBelow sets a real collapsed DOM selection; the range stubs also keep
// accidental suggestion opens observable without jsdom layout support.
{
  const rp = Range.prototype as unknown as { getClientRects?: () => unknown[]; getBoundingClientRect?: () => DOMRect };
  rp.getClientRects ??= () => [];
  rp.getBoundingClientRect ??= () => new DOMRect();
}

function threeParas(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "one" }] },
      { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "two" }] },
      { id: "p3", type: "paragraph", props: {}, content: [{ type: "text", text: "three" }] },
    ],
  };
}

function Probe({ blockId }: { blockId: string }) {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const actions = useBlockActions(blockId);
  (globalThis as { __testActions?: unknown }).__testActions = actions;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}
function testActions(): BlockActions {
  return (globalThis as { __testActions?: BlockActions }).__testActions!;
}

describe("useBlockActions", () => {
  it("duplicate inserts a copy right after the block with a freshly reissued id, and selects the copy", () => {
    render(
      <Editor defaultValue={threeParas()}>
        <Editor.Content />
        <Probe blockId="p2" />
      </Editor>,
    );

    act(() => testActions().duplicate());

    const doc = testEditor().getDoc();
    expect(doc.blocks.map((b) => b.id)).toHaveLength(4);
    expect(doc.blocks[1]!.id).toBe("p2");
    const copyId = doc.blocks[2]!.id;
    expect(copyId).not.toBe("p2"); // reissued, not aliased
    expect(doc.blocks[2]!.content).toEqual(doc.blocks[1]!.content);
    expect(doc.blocks.map((b) => b.id)).toEqual(["p1", "p2", copyId, "p3"]);
    expect(testEditor().getState().selection).toEqual({ type: "block", ids: [copyId] });
  });

  it("duplicate reissues every descendant id too, not just the top block's own id", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "parent",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "top" }],
          children: [{ id: "child", type: "paragraph", props: {}, content: [{ type: "text", text: "nested" }] }],
        },
      ],
    };
    render(
      <Editor defaultValue={doc}>
        <Editor.Content />
        <Probe blockId="parent" />
      </Editor>,
    );

    act(() => testActions().duplicate());

    const after = testEditor().getDoc();
    expect(after.blocks).toHaveLength(2);
    const copy = after.blocks[1]!;
    expect(copy.id).not.toBe("parent");
    expect(copy.children).toHaveLength(1);
    expect(copy.children![0]!.id).not.toBe("child");
    expect(copy.children![0]!.content).toEqual([{ type: "text", text: "nested" }]);
  });

  it("delete removes the block, one undo step restores it", () => {
    render(
      <Editor defaultValue={threeParas()}>
        <Editor.Content />
        <Probe blockId="p2" />
      </Editor>,
    );

    act(() => testActions().delete());
    expect(testEditor().getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p3"]);

    act(() => testEditor().commands.undo());
    expect(testEditor().getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("turnInto changes the block's type via setBlockType", () => {
    render(
      <Editor defaultValue={threeParas()}>
        <Editor.Content />
        <Probe blockId="p2" />
      </Editor>,
    );

    act(() => testActions().turnInto("heading"));
    expect(testEditor().getDoc().blocks[1]).toMatchObject({ id: "p2", type: "heading" });
  });

  it("the add action inserts an empty paragraph and keeps the slash menu closed", () => {
    render(
      <Editor defaultValue={threeParas()}>
        <Editor.Content />
        <Probe blockId="p2" />
        <Editor.SlashMenu>{(args) => <div data-testid="slash-open">{args.items.length}</div>}</Editor.SlashMenu>
      </Editor>,
    );

    act(() => testActions().insertBelow());

    const doc = testEditor().getDoc();
    expect(doc.blocks.map((b) => b.id)).toHaveLength(4);
    expect(doc.blocks[2]!.content).toEqual([]);
    expect(testEditor().getState().selection).toEqual({
      type: "text", anchor: { blockId: doc.blocks[2]!.id, offset: 0 }, focus: { blockId: doc.blocks[2]!.id, offset: 0 },
    });
    expect(screen.queryByTestId("slash-open")).toBeNull();
  });

  it("insertBelowAndOpenSlash is a no-op on a codeBlock source (editorcn's own drag-handle rule)", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: "x" }] }] };
    render(
      <Editor defaultValue={doc}>
        <Editor.Content />
        <Probe blockId="c1" />
      </Editor>,
    );

    act(() => testActions().insertBelowAndOpenSlash());
    expect(testEditor().getDoc().blocks).toHaveLength(1);
  });
});

describe("useBlockActions plugin menu items", () => {
  it("lists visible plugin entries with resolved labels and runs them against the editor", () => {
    let ran: string | null = null;
    render(
      <Editor defaultValue={threeParas()} locale="ko">
        <Editor.Plugin
          blockMenuItems={[
            { id: "mark", label: { en: "Mark", ko: "표시" }, run: (_e, id) => void (ran = id) },
            { id: "hidden", label: "Hidden", isVisible: () => false, run: () => {} },
          ]}
        />
        <Editor.Content />
        <Probe blockId="p2" />
      </Editor>,
    );
    expect(testActions().menuItems.map((m) => [m.id, m.label])).toEqual([["mark", "표시"]]);
    testActions().menuItems[0]!.run();
    expect(ran).toBe("p2");
  });
});
