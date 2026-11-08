// paste-to-embed's own two-step undo (see embedPaste.ts's header
// comment) -- pasting a bare youtube/vimeo/x url into an empty paragraph
// must be undoable back to "the url as linked text" first, and only a
// SECOND undo back to the original empty paragraph (Notion's own behavior).
// @vitest-environment jsdom
// Same fakePasteEvent technique as clipboard.test.ts (jsdom has no real
// ClipboardEvent/DataTransfer) -- but driven through a real `createEditor`
// (not createView + a hand-rolled dispatch) so `editor.commands.undo()`
// exercises the real history stack, not just a single transaction.

import { beforeEach, describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { createEditor } from "./editor.js";

function oneEmptyParagraph(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
}

function fakePasteEvent(text: string): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (format: string) => (format === "text/plain" ? text : ""), files: [] } });
  return ev;
}

function mount(doc: Doc) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: doc });
  editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } }));
  return { element, editor };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("paste-to-embed: two-step undo (Notion)", () => {
  it("pasting a bare youtube url into an empty paragraph converts it to an embed; one undo returns to the url as a LINK, a second undo reaches the original empty paragraph", () => {
    const { element, editor } = mount(oneEmptyParagraph());
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    element.dispatchEvent(fakePasteEvent(url));

    let doc = editor.getDoc();
    expect(doc.blocks[0]).toMatchObject({ id: "p1", type: "embed", props: { provider: "youtube", id: "dQw4w9WgXcQ", url } });

    editor.commands.undo();
    doc = editor.getDoc();
    expect(doc.blocks[0]).toMatchObject({
      id: "p1",
      type: "paragraph",
      content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }],
    });

    editor.commands.undo();
    doc = editor.getDoc();
    expect(doc.blocks[0]).toMatchObject({ id: "p1", type: "paragraph", content: [] });

    editor.destroy();
  });

  it("redo replays both steps back to the embed", () => {
    const { element, editor } = mount(oneEmptyParagraph());
    const url = "https://vimeo.com/123456789";
    element.dispatchEvent(fakePasteEvent(url));
    editor.commands.undo();
    editor.commands.undo();
    expect(editor.getDoc().blocks[0]).toMatchObject({ type: "paragraph", content: [] });

    editor.commands.redo();
    expect(editor.getDoc().blocks[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: url }] });

    editor.commands.redo();
    expect(editor.getDoc().blocks[0]).toMatchObject({ type: "embed", props: { provider: "vimeo", id: "123456789" } });

    editor.destroy();
  });

  it("a non-embeddable url still only autolinks (one undo step, never becomes an embed)", () => {
    const { element, editor } = mount(oneEmptyParagraph());
    const url = "https://example.com/page";
    element.dispatchEvent(fakePasteEvent(url));

    expect(editor.getDoc().blocks[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: url, marks: [{ type: "link" }] }] });

    editor.commands.undo();
    expect(editor.getDoc().blocks[0]).toMatchObject({ type: "paragraph", content: [] });

    editor.destroy();
  });
});
