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

it("keeps slash suggestions open for multi-word queries", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc("slash")}><Editor.Content /><Editor.SlashMenu /><Probe id="slash" /></Editor>);
  const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
  act(() => editors.slash!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "slash", offset: 0 }, focus: { blockId: "slash", offset: 0 } })));
  for (const char of "/heading 2") act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true })));
  await waitFor(() => expect(root.getAttribute("aria-expanded")).toBe("true"));
  await waitFor(() => expect(document.querySelector('[role="option"]')?.textContent).toContain("Heading 2"));
});

it("labels slash results and announces an empty result separately", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc("empty-slash")}><Editor.Content /><Editor.SlashMenu /><Probe id="empty-slash" /></Editor>);
  const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
  act(() => editors["empty-slash"]!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "empty-slash", offset: 0 }, focus: { blockId: "empty-slash", offset: 0 } })));
  for (const char of "/no-such-result") act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true })));
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("No results"));
  const listbox = document.querySelector('[role="listbox"]')!;
  expect(listbox.getAttribute("aria-label")).toBe("Block commands");
  expect(listbox.querySelector('[role="status"]')).toBeNull();
});

it("exposes and restores valid suggestion semantics without other menus clearing them", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc("aria")}><Editor.Content aria-label="My editor" /><Editor.SlashMenu /><Editor.TagMenu onSearch={() => []} /><Probe id="aria" /></Editor>);
  const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
  act(() => editors.aria!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "aria", offset: 0 }, focus: { blockId: "aria", offset: 0 } })));
  act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true })));
  await waitFor(() => expect(root.getAttribute("role")).toBe("combobox"));
  expect(root.getAttribute("aria-expanded")).toBe("true");
  expect(root.getAttribute("aria-label")).toBe("My editor");
  act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await waitFor(() => expect(root.getAttribute("role")).toBe("textbox"));
  expect(root.hasAttribute("aria-expanded")).toBe(false);
  expect(root.getAttribute("aria-label")).toBe("My editor");
});

it("closes the slash menu once a multi-word query matches nothing", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc("path")}><Editor.Content /><Editor.SlashMenu /><Probe id="path" /></Editor>);
  const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
  act(() => editors.path!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "path", offset: 0 }, focus: { blockId: "path", offset: 0 } })));
  for (const char of "/usr") act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true })));
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("No results"));
  for (const char of " is") act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true })));
  await waitFor(() => expect(root.hasAttribute("aria-expanded")).toBe(false));
  expect(document.querySelector("[data-jul-editor-slash-menu]")).toBeNull();
});

it("announces an empty tag result outside the listbox", async () => {
  const range = Range.prototype as Range & { getClientRects: () => DOMRectList; getBoundingClientRect: () => DOMRect };
  range.getClientRects ??= () => [] as unknown as DOMRectList;
  range.getBoundingClientRect ??= () => new DOMRect();
  render(<Editor defaultValue={doc("tag")}><Editor.Content /><Editor.TagMenu onSearch={() => []} /><Probe id="tag" /></Editor>);
  const root = document.querySelector<HTMLElement>("[data-jul-editor-root]")!;
  act(() => editors.tag!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "tag", offset: 0 }, focus: { blockId: "tag", offset: 0 } })));
  act(() => root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "#", bubbles: true, cancelable: true })));
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("No results"));
  expect(document.querySelector('[role="listbox"] [role="status"]')).toBeNull();
});
