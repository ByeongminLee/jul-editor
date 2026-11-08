// @vitest-environment jsdom
import type { Doc, Editor as CoreEditor } from "@jul-editor/core";
import { coreRegistry, createEditor } from "@jul-editor/core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Editor, useEditor } from "..";
import { useDragHandle } from "../drag-handle/use-drag-handle.js";

const doc = (id: string): Doc => ({ version: 1, blocks: [{ id, type: "paragraph", props: {}, content: [] }] });
const editors: Record<string, CoreEditor | null> = {};
function Probe({ id }: { id: string }) { editors[id] = useEditor(); return null; }
let external: CoreEditor | null = null;
let externalRoot: HTMLElement | null = null;
afterEach(() => {
  cleanup();
  external?.destroy();
  externalRoot?.remove();
  external = null;
  externalRoot = null;
  for (const id of Object.keys(editors)) delete editors[id];
});

function makeExternal(value: Doc): CoreEditor {
  externalRoot = document.createElement("div");
  document.body.append(externalRoot);
  external = createEditor({ element: externalRoot, registry: coreRegistry, defaultValue: value });
  return external;
}

it("keeps suggestion ARIA on the editor that owns the open menu", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<>
    <Editor defaultValue={doc("first")}><Editor.Content /><Editor.TagMenu onSearch={() => [{ id: "tag", label: "tag" }]} /><Probe id="first" /></Editor>
    <Editor defaultValue={doc("second")}><Editor.Content /><Editor.TagMenu onSearch={() => [{ id: "tag", label: "tag" }]} /><Probe id="second" /></Editor>
  </>);
  act(() => editors.second!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "second", offset: 0 }, focus: { blockId: "second", offset: 0 } })));
  const roots = document.querySelectorAll<HTMLElement>("[data-jul-editor-root]");
  expect(roots).toHaveLength(2);
  act(() => roots[1]!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "#", bubbles: true, cancelable: true })));
  await waitFor(() => expect(roots[1]!.getAttribute("aria-expanded")).toBe("true"));
  expect(roots[0]!.getAttribute("aria-expanded")).toBeNull();
});

it("writes suggestion ARIA to an external editor's root beside an internal editor", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  const editor = makeExternal(doc("external"));
  render(<>
    <Editor editor={editor}><Editor.Content /><Editor.TagMenu onSearch={() => [{ id: "tag", label: "tag" }]} /></Editor>
    <Editor defaultValue={doc("internal")}><Editor.Content /><Editor.TagMenu onSearch={() => [{ id: "tag", label: "tag" }]} /></Editor>
  </>);
  const internalRoot = document.querySelectorAll<HTMLElement>("[data-jul-editor-root]")[1]!;
  act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "external", offset: 0 }, focus: { blockId: "external", offset: 0 } })));
  act(() => externalRoot!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "#", bubbles: true, cancelable: true })));
  await waitFor(() => expect(externalRoot!.getAttribute("aria-expanded")).toBe("true"));
  expect(externalRoot!.hasAttribute("aria-controls")).toBe(true);
  expect(internalRoot.getAttribute("aria-expanded")).toBeNull();
  expect(internalRoot.getAttribute("aria-controls")).toBeNull();
});

it("tracks external-root hover while an internal editor is mounted", async () => {
  const editor = makeExternal({ version: 1, blocks: [...doc("first").blocks, ...doc("hovered").blocks] });
  const rect = new DOMRect(0, 0, 100, 20);
  editor.getBlockRect = () => rect;
  editor.getBlockAtPoint = () => ({ id: "hovered", rect });
  let blockId: string | null = null;
  function DragProbe() {
    blockId = useDragHandle().blockId;
    return null;
  }
  render(<>
    <Editor editor={editor}><Editor.Content /><DragProbe /></Editor>
    <Editor defaultValue={doc("internal")}><Editor.Content /></Editor>
  </>);
  expect(blockId).toBe("first");
  await act(async () => {
    fireEvent.pointerMove(externalRoot!, { clientX: 5, clientY: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(blockId).toBe("hovered");
});
