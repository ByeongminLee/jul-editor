// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { createEditor } from "./editor.js";

const doc: Doc = {
  version: 1,
  blocks: [
    { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] },
    { id: "d1", type: "divider", props: {} },
  ],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const element = document.createElement("div");
  const outside = document.createElement("button");
  document.body.append(element, outside);
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: doc });
  const inner = document.createElement("input");
  element.querySelector("[data-jul-editor-void]")?.appendChild(inner);
  editor.update((tx) => tx.setSelection({ type: "block", ids: ["d1"] }));
  element.focus();
  return { element, outside, inner, editor };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("block selection and focus", () => {
  it("does not clear a newer block selection when an earlier blur timer fires", async () => {
    const { element, outside, editor } = setup();
    outside.focus();
    editor.update((tx) => tx.setSelection({ type: "block", ids: ["d1"] }));
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
    editor.destroy();
    element.remove();
  });
  it("clears a block selection when focus moves outside the editor", async () => {
    const { outside, editor } = setup();
    outside.focus();
    await tick();
    expect(editor.getState().selection).toBeNull();
  });

  it("keeps the block selection while focus moves between the root and the block's own controls", async () => {
    const { element, inner, editor } = setup();
    inner.focus();
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
    element.focus();
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
  });

  it("clears the selection when focus leaves from inside a block control", async () => {
    const { inner, outside, editor } = setup();
    inner.focus();
    outside.focus();
    await tick();
    expect(editor.getState().selection).toBeNull();
  });

  it("does not touch a text selection on blur", async () => {
    const { outside, editor } = setup();
    editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } }));
    outside.focus();
    await tick();
    expect(editor.getState().selection?.type).toBe("text");
  });

  it("keeps the block selection when focus moves to editor-owned UI marked data-jul-editor-keep-selection", async () => {
    const { editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    expect(document.activeElement).toBe(handle);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
  });

  it("keeps the block selection when focus moves to a descendant of a keep-selection container", async () => {
    const { editor } = setup();
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-jul-editor-keep-selection", "");
    const button = document.createElement("button");
    toolbar.append(button);
    document.body.append(toolbar);
    button.focus();
    await tick();
    expect(document.activeElement).toBe(button);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
  });

  it("keeps a multi-block selection on keep-selection focus, then clears it once focus goes elsewhere", async () => {
    const { outside, editor } = setup();
    editor.update((tx) => tx.setSelection({ type: "block", ids: ["p1", "d1"] }));
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["p1", "d1"] });
    outside.focus();
    await tick();
    expect(editor.getState().selection).toBeNull();
  });

  it("clears the selection when focus leaves a keep-selection handle that unmounts as focus moves away", async () => {
    const { outside, editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
    // The handle unmounts as soon as focus goes outside (use-drag-handle onFocusOrDown).
    handle.addEventListener("focusout", () => handle.remove());
    outside.focus();
    await tick();
    expect(handle.isConnected).toBe(false);
    expect(editor.getState().selection).toBeNull();
  });

  it("keeps the selection when a focused keep-selection handle is unmounted by a re-render and nothing else takes focus", async () => {
    const { editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    // A keyboard move re-renders the block and the host swaps the handle: focus drops to the body, relatedTarget is null.
    handle.remove();
    handle.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await tick();
    expect(handle.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
  });

  it.each([["a pointerdown elsewhere clears the selection", "outside", null], ["a pointerdown inside the editor keeps it", "element", { type: "block", ids: ["d1"] }]] as const)("after an orphaned focus (handle unmounted), %s", async (_name, where, expected) => {
    const { element, outside, editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    handle.remove();
    handle.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await tick();
    (where === "outside" ? outside : element).dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(editor.getState().selection).toEqual(expected);
  });

  it("clears the selection when the handle unmounts because the user clicked elsewhere (pointerdown, focus falls to the body)", async () => {
    const { editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    handle.remove();
    handle.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await tick();
    expect(editor.getState().selection).toBeNull();
  });

  it("keeps watching a keep-selection handle across a window blur, so leaving it later still clears", async () => {
    const { outside, editor } = setup();
    const handle = document.createElement("button");
    handle.setAttribute("data-jul-editor-keep-selection", "");
    document.body.append(handle);
    handle.focus();
    await tick();
    const spy = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    handle.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null })); // window blur: activeElement stays the handle
    await tick();
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["d1"] });
    spy.mockReturnValue(true);
    outside.focus(); // jsdom fires focusout on the still-watched handle
    await tick();
    expect(editor.getState().selection).toBeNull();
    spy.mockRestore();
  });
});
