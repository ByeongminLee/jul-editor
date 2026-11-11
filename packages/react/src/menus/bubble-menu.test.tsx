// @vitest-environment jsdom
// Regressions from the editor audit (round 1, batch 3): <Editor.BubbleMenu>'s rect used to be read
// once, when the selection first became non-collapsed, so it went stale on a backward drag,
// Shift+Arrow, scroll or resize; and it stayed open after a click outside the editor moved the
// DOM selection away (formatting text the user could no longer see).
import type { Doc } from "@jul-editor/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Editor, useEditor } from "..";
import type { Editor as CoreEditor } from "@jul-editor/core";

const doc: Doc = { version: 1, blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "hello world" }] }] };
let editor: CoreEditor | null = null;
function Probe() {
  editor = useEditor();
  return null;
}
let scrollY = 0;
const range = Range.prototype as Range & { getBoundingClientRect: () => DOMRect; getClientRects: () => DOMRectList };
const original = { rect: range.getBoundingClientRect, rects: range.getClientRects };
beforeEach(() => {
  scrollY = 0;
  // left follows the range start, top follows a fake scroll offset
  range.getBoundingClientRect = function (this: Range) {
    return new DOMRect(this.startOffset * 10, 100 - scrollY, (this.endOffset - this.startOffset) * 10, 20);
  };
  range.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(() => {
  cleanup();
  editor = null;
  range.getBoundingClientRect = original.rect;
  range.getClientRects = original.rects;
});

function mountBubble() {
  render(<>
    <button type="button" data-testid="outside">outside</button>
    <Editor defaultValue={doc}>
      <Editor.Content />
      <Editor.BubbleMenu>{({ rect }) => <div data-testid="bubble" data-left={rect.left} data-top={rect.top} />}</Editor.BubbleMenu>
      <Probe />
    </Editor>
  </>);
}
const setSel = (a: number, f: number) => act(() => editor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p", offset: a }, focus: { blockId: "p", offset: f } })));
const tick = () => act(() => new Promise((r) => setTimeout(r, 40)));

it("follows a range change while the selection stays non-collapsed", async () => {
  mountBubble();
  setSel(0, 3);
  expect(screen.getByTestId("bubble").dataset.left).toBe("0");
  setSel(6, 2); // a backward selection further along
  await tick();
  expect(screen.getByTestId("bubble").dataset.left).toBe("20");
});

it("re-measures on scroll", async () => {
  mountBubble();
  setSel(1, 4);
  expect(screen.getByTestId("bubble").dataset.top).toBe("100");
  scrollY = 60;
  act(() => { window.dispatchEvent(new Event("scroll")); });
  await tick();
  expect(screen.getByTestId("bubble").dataset.top).toBe("40");
});

it("hides once the DOM selection leaves the editor, though the model keeps its range", async () => {
  mountBubble();
  setSel(0, 5);
  expect(screen.queryByTestId("bubble")).not.toBeNull();
  const outside = screen.getByTestId("outside");
  act(() => {
    outside.focus();
    window.getSelection()!.setBaseAndExtent(outside, 0, outside, 0);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await tick();
  const sel = editor!.getState().selection;
  expect(sel?.type === "text" && sel.focus.offset).toBe(5);
  expect(screen.queryByTestId("bubble")).toBeNull();
});
