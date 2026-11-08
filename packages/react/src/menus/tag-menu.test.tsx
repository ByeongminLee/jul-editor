// @vitest-environment jsdom
import type { Doc, Editor as CoreEditor } from "@jul-editor/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Editor, useEditor } from "..";

const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
let editor: CoreEditor | null = null;
function Probe() { editor = useEditor(); return null; }
afterEach(() => { cleanup(); editor = null; });

it("Editor.TagMenu inserts a selected #tag as an atomic inline", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc}>
    <Editor.Content />
    <Editor.TagMenu onSearch={() => [{ id: "t1", label: "research" }]}>
      {({ items, getOptionProps }) => <div data-testid="tags">{items.map((item, index) => <button key={item.id} {...getOptionProps(index)}>{item.label}</button>)}</div>}
    </Editor.TagMenu>
    <Probe />
  </Editor>);
  act(() => editor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
  const root = document.querySelector("[data-jul-editor-root]")!;
  for (const char of "#re") act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true })));
  await waitFor(() => expect(screen.getByText("research")).toBeTruthy());
  fireEvent.mouseDown(screen.getByText("research"));
  expect(editor!.getDoc().blocks[0]?.content).toEqual([
    { type: "mention", attrs: { kind: "tag", id: "t1", label: "research" } },
    { type: "text", text: " " },
  ]);
  expect(screen.queryByTestId("tags")).toBeNull();
});
