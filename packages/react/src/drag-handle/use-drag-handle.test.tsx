// Component-level tests for the pick-up/step/drop STATE MACHINE only --
// jsdom never lays out real geometry (elementFromPoint always returns null),
// so `editor.getBlockAtPoint`/`getBlockRect` are stubbed here to simulate
// what a real pointermove would have hit-tested; the real hit-testing +
// pointer-drag geometry is exercised for real by e2e/drag.spec.ts in an
// actual browser (Playwright).
import type { Doc, Editor as CoreEditor } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, useEditor } from "..";
import { useDragHandle } from "./use-drag-handle.js";
import type { UseDragHandleResult } from "./use-drag-handle.js";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-jul-editor-root") ? ROOT_RECT : FAKE_RECT;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as { __testEditor?: unknown }).__testEditor;
  delete (globalThis as { __testState?: unknown }).__testState;
});

function twoParas(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "one" }] },
      { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "two" }] },
    ],
  };
}

const FAKE_RECT = { top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const ROOT_RECT = { ...FAKE_RECT, bottom: 400, right: 500, width: 500, height: 400 } as DOMRect;

function Probe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const state = useDragHandle();
  (globalThis as { __testState?: unknown }).__testState = state;
  const handleProps = state.getHandleProps();
  return <button {...handleProps} data-testid="handle" />;
}

function testEditor(): CoreEditor {
  return (globalThis as { __testEditor?: CoreEditor }).__testEditor!;
}
function testState(): UseDragHandleResult {
  return (globalThis as { __testState?: UseDragHandleResult }).__testState!;
}

/** Stubs the point/rect hit-testing so the hover-tracking effect (a real
 * pointermove -> `editor.getBlockAtPoint`) can be simulated without real
 * layout, then fires the pointermove itself. */
function hoverOver(blockId: string): void {
  const editor = testEditor();
  editor.getBlockAtPoint = () => ({ id: blockId, rect: FAKE_RECT });
  editor.getBlockRect = () => FAKE_RECT;
  fireEvent.pointerMove(document.querySelector("[data-jul-editor-root]")!, { clientX: 5, clientY: 5 });
}

function PortalProbe() {
  const state = useDragHandle();
  (globalThis as { __testState?: unknown }).__testState = state;
  return createPortal(<button {...state.getHandleProps()} data-testid="portal-handle" />, document.body);
}

describe("useDragHandle handle rendered outside the Content parent", () => {
  it("a pointerdown on the handle (portal into body) still counts as inside the editor", () => {
    // jsdom has no pointer capture; the handle's own pointerdown starts a drag and calls it
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture = () => {};
    proto.hasPointerCapture = () => false;
    proto.releasePointerCapture = () => {};
    render(<Editor defaultValue={twoParas()}><Editor.Content /><PortalProbe /></Editor>);
    const root = document.querySelector("[data-jul-editor-root]")!;
    act(() => fireEvent.focusIn(root));
    expect(testState().blockId).toBe("p1");
    act(() => fireEvent.pointerDown(document.querySelector("[data-testid=portal-handle]")!));
    expect(testState().blockId).toBe("p1");
  });
});

describe("useDragHandle keyboard pick-up/step/drop", () => {
  it("dismisses controls outside the editor and after scrolling, then restores them on return", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const root = document.querySelector("[data-jul-editor-root]")!;
    expect(testState().blockId).toBe("p1");

    // Navigation through earlier page controls must leave the first handle
    // available for Tab before the editor has been entered.
    act(() => fireEvent.focusIn(document.body));
    expect(testState().blockId).toBe("p1");
    act(() => fireEvent.focusIn(root));
    act(() => fireEvent.pointerDown(document.body));
    expect(testState().blockId).toBeNull();
    act(() => fireEvent.focusIn(root));
    expect(testState().blockId).toBe("p1");

    // A scroll must remeasure. Keep the keyboard handle if its block remains
    // visible, but remove it once that block has left the editor viewport.
    act(() => fireEvent.scroll(window));
    expect(testState().blockId).toBe("p1");
    const editor = testEditor();
    editor.getBlockRect = () => ({ ...FAKE_RECT, top: 450, bottom: 470, y: 450 } as DOMRect);
    act(() => fireEvent.scroll(window));
    expect(testState().blockId).toBeNull();
    await act(async () => {
      hoverOver("p1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(testState().blockId).toBe("p1");

    // Crossing the gutter must keep the handle available for pointer pickup.
    act(() => fireEvent.pointerMove(document.body, { clientX: -20, clientY: 10 }));
    expect(testState().blockId).toBe("p1");
    act(() => fireEvent.pointerMove(document.body, { clientX: 600, clientY: 410 }));
    expect(testState().blockId).toBeNull();
  });

  it("does not restore controls from a pending hover frame after an outside click", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const root = document.querySelector("[data-jul-editor-root]")!;
    const editor = testEditor();
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });
    editor.getBlockRect = () => FAKE_RECT;

    await act(async () => {
      fireEvent.focusIn(root);
      fireEvent.pointerMove(root, { clientX: 5, clientY: 5 });
      fireEvent.pointerDown(document.body);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(testState().blockId).toBeNull();
  });

  it("keeps a fresh hover when the canvas scrolls before its frame runs", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const root = document.querySelector("[data-jul-editor-root]")!;
    const editor = testEditor();
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });
    editor.getBlockRect = () => FAKE_RECT;

    await act(async () => {
      fireEvent.focusIn(root);
      fireEvent.pointerDown(document.body);
      fireEvent.pointerMove(root, { clientX: 5, clientY: 5 });
      fireEvent.scroll(window);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(testState().blockId).toBe("p2");
  });

  it("does not expose fixed controls for a block clipped below the editor canvas", () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const editor = testEditor();
    editor.getBlockRect = () => ({ ...FAKE_RECT, top: 390, bottom: 410, y: 390 } as DOMRect);
    act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p2", offset: 1 }, focus: { blockId: "p2", offset: 1 } })));
    expect(testState().blockId).toBeNull();
  });

  it("exposes the first block before any selection or pointer activity", () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    expect(testState().blockId).toBe("p1");
    expect(testState().rect).not.toBeNull();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(handle, { key: " " }));
    act(() => fireEvent.keyDown(handle, { key: "ArrowDown" }));
    expect(testEditor().getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
  });

  it("hides the block id until its wrapper rect exists", () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const editor = testEditor();
    editor.getBlockRect = () => null;
    act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p2", offset: 1 }, focus: { blockId: "p2", offset: 1 } })));
    expect(testState().rect).toBeNull();
    expect(testState().blockId).toBeNull();
  });

  it("exposes the selected block before any pointer hover so the handle is keyboard reachable", () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    const editor = testEditor();
    act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } })));

    expect(testState().blockId).toBe("p1");
    expect(testState().rect).not.toBeNull();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(handle, { key: " " }));
    act(() => fireEvent.keyDown(handle, { key: "ArrowDown" }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
  });

  it("moves the handle to a keyboard-selected block after an earlier pointer hover", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(testState().blockId).toBe("p1");

    const editor = testEditor();
    act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p2", offset: 1 }, focus: { blockId: "p2", offset: 1 } })));
    expect(testState().blockId).toBe("p2");
  });

  it("prefers a new keyboard selection over hover even when it selects the initial fallback block", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p2");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(testState().blockId).toBe("p2");

    const editor = testEditor();
    act(() => editor.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 1 }, focus: { blockId: "p1", offset: 1 } })));
    expect(testState().blockId).toBe("p1");
  });

  it("Space picks up the hovered block, ArrowDown commits one sibling-swap step, Space drops (no leftover state)", async () => {
    render(
      <Editor defaultValue={twoParas()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );

    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20)); // let the rAF-throttled hover update land
    });
    expect(testState().blockId).toBe("p1");
    expect(testState().dragging).toBe(false);

    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(handle, { key: " " }));
    expect(testState().dragging).toBe(true);
    expect(testState().announcement).toMatch(/picked up/i);

    act(() => fireEvent.keyDown(handle, { key: "ArrowDown" }));
    expect(testEditor()
      .getDoc()
      .blocks.map((b) => b.id)).toEqual(["p2", "p1"]);

    act(() => fireEvent.keyDown(handle, { key: " " }));
    expect(testState().dragging).toBe(false);
    // The one committed step stays -- dropping keeps the moves, unlike Escape.
    expect(testEditor()
      .getDoc()
      .blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
  });

  it("Escape undoes every step taken since pick-up", async () => {
    render(
      <Editor defaultValue={twoParas()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(handle, { key: " " }));
    act(() => fireEvent.keyDown(handle, { key: "ArrowDown" }));
    expect(testEditor()
      .getDoc()
      .blocks.map((b) => b.id)).toEqual(["p2", "p1"]);

    act(() => fireEvent.keyDown(handle, { key: "Escape" }));
    expect(testState().dragging).toBe(false);
    expect(testEditor()
      .getDoc()
      .blocks.map((b) => b.id)).toEqual(["p1", "p2"]); // fully restored
  });

  it("Enter also drops (same as Space) while picked up via keyboard", async () => {
    render(
      <Editor defaultValue={twoParas()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(handle, { key: " " }));
    expect(testState().dragging).toBe(true);
    act(() => fireEvent.keyDown(handle, { key: "Enter" }));
    expect(testState().dragging).toBe(false);
  });
});

// A host that re-creates the handle element whenever the block order changes (a conditionally rendered handle swapped by the re-render a move causes).
function RemountingProbe() {
  const editor = useEditor();
  (globalThis as { __testEditor?: unknown }).__testEditor = editor;
  const state = useDragHandle();
  (globalThis as { __testState?: unknown }).__testState = state;
  return <button key={editor?.getDoc().blocks.map((b) => b.id).join()} {...state.getHandleProps()} data-testid="handle" />;
}

describe("useDragHandle handle unmounted by a keyboard move re-render", () => {
  it("focuses the replacement handle so the keyboard move keeps going", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><RemountingProbe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });
    const first = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => first.focus());
    expect(document.activeElement).toBe(first);
    act(() => fireEvent.keyDown(first, { key: " " }));
    act(() => fireEvent.keyDown(first, { key: "ArrowDown" }));
    expect(testEditor().getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
    const second = document.querySelector('[data-testid="handle"]') as HTMLElement;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(document.activeElement).toBe(second);
    // keeps driving the move from the new element
    act(() => fireEvent.keyDown(second, { key: "ArrowUp" }));
    expect(testEditor().getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("does not steal focus when the handle was not focused", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><RemountingProbe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });
    const first = document.querySelector('[data-testid="handle"]') as HTMLElement;
    act(() => fireEvent.keyDown(first, { key: " " }));
    act(() => fireEvent.keyDown(first, { key: "ArrowDown" }));
    const second = document.querySelector('[data-testid="handle"]') as HTMLElement;
    expect(second).not.toBe(first);
    expect(document.activeElement).not.toBe(second);
  });
});

describe("useDragHandle pointer drop", () => {
  it("remeasures the active drop indicator after scrolling", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    let targetTop = 0;
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });
    editor.getBlockRect = (id) => id === "p2" ? ({ ...FAKE_RECT, top: targetTop, bottom: targetTop + 20, y: targetTop } as DOMRect) : FAKE_RECT;

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    expect(testState().dropIndicatorRect?.top).toBe(20);
    targetTop = 100;
    act(() => fireEvent.scroll(window));
    expect(testState().dropIndicatorRect?.top).toBe(120);
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
  });

  it("clears an old target when the pointer returns over the dragged block", async () => {
    render(
      <Editor defaultValue={twoParas()}>
        <Editor.Content />
        <Probe />
      </Editor>,
    );
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = (x) => ({ id: x === 2 ? "p2" : "p1", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    expect(testState().dropTarget).toEqual({ targetId: "p2", placement: "after" });

    act(() => fireEvent.pointerMove(handle, { clientX: 1, clientY: 15 }));
    expect(testState().dropTarget).toBeNull();
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("commits the latest target when pointerup arrives before React renders", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => {
      fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 });
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
  });

  it("does not preview a drop into the dragged block's descendant", async () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [], children: [{ id: "child", type: "paragraph", props: {}, content: [] }] },
        { id: "p2", type: "paragraph", props: {}, content: [] },
      ],
    };
    render(<Editor defaultValue={doc}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = () => ({ id: "child", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    expect(testState().dropTarget).toBeNull();
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
    expect(editor.getDoc().blocks[0]?.children?.[0]?.id).toBe("child");
  });

  it("falls back to sibling placement when a block cannot contain children", async () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "code", type: "codeBlock", props: {}, content: [{ type: "text", text: "const x = 1" }] },
        { id: "p1", type: "paragraph", props: {}, content: [] },
      ],
    };
    render(<Editor defaultValue={doc}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = () => ({ id: "code", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 60, clientY: 5 }));
    expect(testState().dropTarget).toEqual({ targetId: "code", placement: "before" });
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "code"]);
  });
  it("returns focus to the editor after a pointer drop so Mod+Z undoes the move", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const root = document.querySelector("[data-jul-editor-root]") as HTMLElement;
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
    expect(document.activeElement).toBe(root);
    expect(editor.getState().selection).toEqual({ type: "block", ids: ["p1"] });
  });

  it("forwards Mod+Z / Mod+Shift+Z from a focused handle to editor history", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });
    const editor = testEditor();
    act(() => editor.moveBlockTo("p1", { targetId: "p2", placement: "after" }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.focus();
    act(() => { fireEvent.keyDown(handle, { key: "z", ctrlKey: true, metaKey: true }); });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);
    act(() => { fireEvent.keyDown(handle, { key: "z", ctrlKey: true, metaKey: true, shiftKey: true }); });
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
  });

  it("Escape cancels a pointer drag: the following pointerup does not move the block", async () => {
    render(<Editor defaultValue={twoParas()}><Editor.Content /><Probe /></Editor>);
    await act(async () => {
      hoverOver("p1");
      await new Promise((r) => setTimeout(r, 20));
    });

    const editor = testEditor();
    const handle = document.querySelector('[data-testid="handle"]') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};
    editor.getBlockAtPoint = () => ({ id: "p2", rect: FAKE_RECT });

    act(() => fireEvent.pointerDown(handle, { button: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    expect(testState().dropTarget).toEqual({ targetId: "p2", placement: "after" });
    act(() => { fireEvent.keyDown(handle, { key: "Escape" }); });
    expect(testState().dragging).toBe(false);
    expect(testState().dropIndicatorRect).toBeNull();
    expect(testState().announcement).toBe("Move cancelled.");
    act(() => fireEvent.pointerMove(handle, { clientX: 2, clientY: 15 }));
    act(() => fireEvent.pointerUp(handle, { pointerId: 1 }));
    expect(editor.getDoc().blocks.map((b) => b.id)).toEqual(["p1", "p2"]);
  });
});
