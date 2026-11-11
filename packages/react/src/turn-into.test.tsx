import type { Doc } from "@jul-editor/core";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { defineBlock } from "@jul-editor/core";
import { Editor, useEditor } from "./";
import { useTurnInto } from "./turn-into.js";
import type { UseTurnIntoResult } from "./turn-into.js";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testTurnInto?: unknown }).__testTurnInto;
});

function doc(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] };
}

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const turnInto = useTurnInto();
  (globalThis as { __testTurnInto?: unknown }).__testTurnInto = turnInto;
  return null;
}

function testEditor(): NonNullable<ReturnType<typeof useEditor>> {
  return (globalThis as { __testEditor?: ReturnType<typeof useEditor> }).__testEditor!;
}
function testTurnInto(): UseTurnIntoResult {
  return (globalThis as { __testTurnInto?: UseTurnIntoResult }).__testTurnInto!;
}

function caret() {
  act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
}

describe("useTurnInto", () => {
  it("lists the curated Text/H1-H3/Bullet/Numbered/Todo/Quote/Code items", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    expect(testTurnInto().items.map((i) => i.id)).toEqual([
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "bulletListItem",
      "orderedListItem",
      "todoListItem",
      "quote",
      "codeBlock",
    ]);
  });

  it("current/active reflects the caret's own block (paragraph, by default)", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    caret();
    expect(testTurnInto().current?.id).toBe("paragraph");
    expect(testTurnInto().items.find((i) => i.id === "paragraph")!.active).toBe(true);
    expect(testTurnInto().items.find((i) => i.id === "heading-2")!.active).toBe(false);
  });

  it("turnInto converts the current block to H2, and to codeBlock, updating `active` each time", () => {
    render(
      <Editor defaultValue={doc()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    caret();
    const h2 = testTurnInto().items.find((i) => i.id === "heading-2")!;
    act(() => testTurnInto().turnInto(h2));
    expect(testEditor().getDoc().blocks[0]).toMatchObject({ type: "heading", props: { level: 2 } });
    expect(testTurnInto().current?.id).toBe("heading-2");

    const code = testTurnInto().items.find((i) => i.id === "codeBlock")!;
    act(() => testTurnInto().turnInto(code));
    expect(testEditor().getDoc().blocks[0]).toMatchObject({ type: "codeBlock" });
    expect(testTurnInto().current?.id).toBe("codeBlock");
  });

  it("<Editor locale=\"ko\"> localizes every curated item's label; ids/keywords stay the same", () => {
    render(
      <Editor defaultValue={doc()} locale="ko">
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    const byId = (id: string) => testTurnInto().items.find((i) => i.id === id)!;
    expect(byId("paragraph").label).toBe("텍스트");
    expect(byId("heading-2").label).toBe("제목 2");
    expect(byId("bulletListItem").label).toBe("글머리 기호 목록");
    expect(byId("codeBlock").label).toBe("코드");
    expect(byId("paragraph").keywords).toEqual(["text", "paragraph"]); // unaffected by locale
  });

  it("<Editor labels={{turnIntoCode: '...'}}> overrides just that one key, on top of the default (en) preset", () => {
    render(
      <Editor defaultValue={doc()} labels={{ turnIntoCode: "Snippet" }}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    expect(testTurnInto().items.find((i) => i.id === "codeBlock")!.label).toBe("Snippet");
    expect(testTurnInto().items.find((i) => i.id === "quote")!.label).toBe("Quote"); // every other key still the en default
  });
});

describe("turnInto over a range containing a void", () => {
  it("converts the text blocks and leaves the image alone", () => {
    const blocks: Doc["blocks"] = [...doc().blocks, { id: "img", type: "image", props: { src: "https://example.com/a.png" } }, { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "end" }] }];
    render(
      <Editor defaultValue={{ version: 1, blocks }}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    act(() => testEditor().update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p2", offset: 1 } })));
    act(() => testTurnInto().turnInto(testTurnInto().items.find((i) => i.id === "heading-2")!));
    expect(testEditor().getDoc().blocks.map((b) => b.type)).toEqual(["heading", "image", "heading"]);
    expect(testEditor().getDoc().blocks[1]!.props.src).toBe("https://example.com/a.png");
    expect(testTurnInto().current?.id).toBe("heading-2");
  });
});

describe("plugin turn-into items", () => {
  const box = defineBlock({ type: "box", content: "inline", children: "any", props: { tone: "plain" } });
  it("appends plugin entries, localizes the label, and converts with their props", () => {
    render(
      <Editor defaultValue={doc()} locale="ko">
        <Editor.Plugin
          blocks={[box]}
          turnIntoItems={[
            { id: "box", type: "box", label: { en: "Box", ko: "상자" } },
            { id: "box-loud", type: "box", props: { tone: "loud" }, label: "Loud box" },
            { id: "ghost", type: "notRegistered", label: "Ghost" },
          ]}
        />
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    caret();
    const items = testTurnInto().items;
    expect(items.slice(-2).map((i) => [i.id, i.label])).toEqual([["box", "상자"], ["box-loud", "Loud box"]]); // unregistered type skipped
    act(() => testTurnInto().turnInto(items.find((i) => i.id === "box-loud")!));
    expect(testEditor().getDoc().blocks[0]).toMatchObject({ type: "box", props: { tone: "loud" } });
    expect(testTurnInto().current?.id).toBe("box-loud");
  });
});
