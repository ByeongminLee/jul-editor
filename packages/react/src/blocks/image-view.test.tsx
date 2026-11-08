// Unit tests for the default `image` void renderer against a minimal mock
// editor (just the getUploadState/onUpload/retryUpload surface ImageView
// actually uses) -- no need for a full <Editor>/createEditor mount here,
// ImageView is a plain function component taking explicit VoidRendererProps.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor as CoreEditor } from "@jul-editor/core";
import type { UploadState } from "@jul-editor/core";
import type { VoidRendererProps } from "../context.js";
import { ImageView } from "./image-view.js";

afterEach(cleanup);

function mockEditor(initial?: UploadState): { editor: CoreEditor; setUploadState: (s: UploadState | undefined) => void; retryUpload: ReturnType<typeof vi.fn> } {
  let state = initial;
  const listeners = new Set<(blockId: string) => void>();
  const retryUpload = vi.fn();
  const editor = {
    getUploadState: () => state,
    getUploadPreview: () => undefined,
    onUpload: (listener: (blockId: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retryUpload,
  } as unknown as CoreEditor;
  return {
    editor,
    setUploadState(next) {
      state = next;
      for (const l of listeners) l("img1");
    },
    retryUpload,
  };
}

function baseProps(overrides: Partial<VoidRendererProps> = {}, editor: CoreEditor): VoidRendererProps {
  return {
    block: { id: "img1", type: "image", props: { src: "https://x/pic.png", alt: "a cat" } },
    editor,
    selected: false,
    updateProps: vi.fn(),
    ...overrides,
  };
}

describe("ImageView (default image renderer)", () => {
  it("renders a headless figure with the block's src/alt, state=ready when no upload is tracked", () => {
    const { editor } = mockEditor();
    render(<ImageView {...baseProps({}, editor)} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    const fig = img.closest("figure")!;
    expect(fig.getAttribute("data-state")).toBe("ready");
    expect(img.getAttribute("src")).toBe("https://x/pic.png");
    expect(img.getAttribute("alt")).toBe("a cat");
  });

  it("reflects an 'uploading' upload state via data-state", () => {
    const { editor } = mockEditor({ status: "uploading" });
    render(<ImageView {...baseProps({}, editor)} />);
    expect(screen.getByRole("img").closest("figure")!.getAttribute("data-state")).toBe("uploading");
  });

  it("reflects an 'error' upload state and shows a retry button that calls editor.retryUpload", () => {
    const { editor, retryUpload } = mockEditor({ status: "error", message: "boom" });
    render(<ImageView {...baseProps({}, editor)} />);
    expect(screen.getByRole("img").closest("figure")!.getAttribute("data-state")).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retryUpload).toHaveBeenCalledWith("img1");
  });

  it("live-updates when the upload state changes after mount (useSyncExternalStore subscription)", () => {
    const { editor, setUploadState } = mockEditor({ status: "uploading" });
    render(<ImageView {...baseProps({}, editor)} />);
    expect(screen.getByRole("img").closest("figure")!.getAttribute("data-state")).toBe("uploading");
    act(() => setUploadState(undefined));
    expect(screen.getByRole("img").closest("figure")!.getAttribute("data-state")).toBe("ready");
  });

  it("shows an alt-text input only when selected, and typing in it calls updateProps (not doc text)", () => {
    const { editor } = mockEditor();
    const updateProps = vi.fn();
    const { rerender } = render(<ImageView {...baseProps({ selected: false, updateProps }, editor)} />);
    expect(screen.queryByRole("textbox", { name: /alt text/i })).toBeNull();

    rerender(<ImageView {...baseProps({ selected: true, updateProps }, editor)} />);
    const input = screen.getByRole("textbox", { name: /alt text/i });
    fireEvent.change(input, { target: { value: "new alt" } });
    expect(updateProps).toHaveBeenCalledWith({ alt: "new alt" });
    expect(updateProps).not.toHaveBeenCalledWith(expect.objectContaining({ src: expect.anything() }));
  });

  it("defaults to align=center, and shows align buttons (aria-pressed) only when selected", () => {
    const { editor } = mockEditor();
    render(<ImageView {...baseProps({ selected: false }, editor)} />);
    expect(screen.getByRole("img").closest("figure")!.getAttribute("data-align")).toBe("center");
    expect(screen.queryByRole("button", { name: /align left/i })).toBeNull();
  });

  it("clicking an align button calls updateProps with that align and reflects aria-pressed", () => {
    const { editor } = mockEditor();
    const updateProps = vi.fn();
    render(<ImageView {...baseProps({ selected: true, updateProps }, editor)} />);
    expect(screen.getByRole("button", { name: /align center/i }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /align left/i }));
    expect(updateProps).toHaveBeenCalledWith({ align: "left" });
  });

  it("shows a caption input only when selected, and typing calls updateProps({ caption })", () => {
    const { editor } = mockEditor();
    const updateProps = vi.fn();
    const { rerender } = render(<ImageView {...baseProps({ selected: false, updateProps }, editor)} />);
    expect(screen.queryByRole("textbox", { name: /caption/i })).toBeNull();

    rerender(<ImageView {...baseProps({ selected: true, updateProps }, editor)} />);
    const input = screen.getByRole("textbox", { name: /caption/i });
    fireEvent.change(input, { target: { value: "a nice caption" } });
    expect(updateProps).toHaveBeenCalledWith({ caption: "a nice caption" });
  });

  it("renders a plain (non-input) caption when not selected but a caption is set", () => {
    const { editor } = mockEditor();
    render(<ImageView {...baseProps({ selected: false, block: { id: "img1", type: "image", props: { src: "https://x/pic.png", caption: "already captioned" } } }, editor)} />);
    expect(screen.queryByRole("textbox", { name: /caption/i })).toBeNull();
    expect(screen.getByText("already captioned")).not.toBeNull();
  });

  it("sets the img width attribute from a numeric width prop", () => {
    const { editor } = mockEditor();
    render(<ImageView {...baseProps({ block: { id: "img1", type: "image", props: { src: "https://x/pic.png", alt: "a cat", width: 240 } } }, editor)} />);
    expect(screen.getByRole("img").getAttribute("width")).toBe("240");
  });

  it("resize handles are present only when selected, and one drag commits ONE updateProps call at pointerup (not per pointermove)", () => {
    const { editor } = mockEditor();
    const updateProps = vi.fn();
    const { rerender } = render(<ImageView {...baseProps({ selected: false, updateProps }, editor)} />);
    expect(screen.queryByRole("button", { name: /resize from right/i })).toBeNull();

    rerender(<ImageView {...baseProps({ selected: true, updateProps }, editor)} />);
    const handle = screen.getByRole("button", { name: /resize from right/i });
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 1 });
    expect(updateProps).not.toHaveBeenCalled(); // no commit yet, only local preview
    fireEvent.pointerUp(handle, { clientX: 180, pointerId: 1 });
    expect(updateProps).toHaveBeenCalledTimes(1);
    expect(updateProps).toHaveBeenCalledWith({ width: expect.any(Number) });
  });
});
