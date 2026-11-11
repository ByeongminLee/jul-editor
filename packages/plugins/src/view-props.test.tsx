// @vitest-environment jsdom
import type { Editor, Json } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagramView } from "./diagram-view.js";
import { DataTableView } from "./data-table-view.js";
import { CodeWorkspaceView } from "./code-workspace/code-workspace-view.js";
import { CodeWorkspaceIDEView } from "./code-workspace/code-workspace-ide-view.js";

afterEach(cleanup);

it("Escape closes the edit controls and refocuses the editor on the same block selection", () => {
  const root = document.body.appendChild(document.createElement("div"));
  root.tabIndex = 0;
  const selection = { type: "block", ids: ["d"] };
  const setSelection = vi.fn();
  const editor = { getRoot: () => root, getState: () => ({ selection }), update: (fn: (tx: { setSelection: typeof setSelection }) => void) => fn({ setSelection }) } as unknown as Editor;
  const view = render(<DiagramView editor={editor} block={{ id: "d", type: "diagram", props: { code: "" } }} selected updateProps={() => {}} />, { container: root });
  const source = view.getByRole("textbox");
  source.focus();

  fireEvent.keyDown(source, { key: "Escape", isComposing: true });
  expect(view.queryByRole("textbox")).not.toBeNull();

  fireEvent.keyDown(source, { key: "Escape" });
  expect(view.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(root);
  expect(setSelection).toHaveBeenCalledWith(selection);

  fireEvent.pointerDown(root.querySelector("[data-jul-editor-plugin=diagram]")!);
  expect(view.queryByRole("textbox")).not.toBeNull();
  root.remove();
});

it.each([
  ["data table", DataTableView, { source: { type: "inline", csv: "x\n1" } }, "Table CSV data"],
  ["code workspace", CodeWorkspaceView, { files: [{ path: "a.ts", language: "ts", code: "x" }] }, "Code"],
  ["IDE", CodeWorkspaceIDEView, { files: [{ path: "a.ts", language: "ts", code: "x" }] }, "Code"],
] as const)("Escape closes %s controls and keeps block selection", (_name, View, props, label) => {
  const root = document.body.appendChild(document.createElement("div"));
  root.tabIndex = 0;
  const selection = { type: "block", ids: ["w"] };
  const setSelection = vi.fn();
  const editor = { getRoot: () => root, getState: () => ({ selection }), update: (fn: (tx: { setSelection: typeof setSelection }) => void) => fn({ setSelection }) } as unknown as Editor;
  const view = render(<View editor={editor} block={{ id: "w", type: "codeWorkspace", props: props as unknown as Record<string, Json> }} selected updateProps={() => {}} />, { container: root });
  const input = view.getByRole("textbox", { name: label });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(view.queryByRole("textbox", { name: label })).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(view.queryByRole("textbox", { name: label })).toBeNull();
  expect(document.activeElement).toBe(root);
  expect(setSelection).toHaveBeenCalledWith(selection);
  root.remove();
});

it("Escape in the rename input cancels rename only", () => {
  const root = document.body.appendChild(document.createElement("div"));
  const selection = { type: "block", ids: ["w"] };
  const setSelection = vi.fn();
  const editor = { getRoot: () => root, getState: () => ({ selection }), update: (fn: (tx: { setSelection: typeof setSelection }) => void) => fn({ setSelection }) } as unknown as Editor;
  const view = render(<CodeWorkspaceIDEView editor={editor} block={{ id: "w", type: "codeWorkspace", props: { files: [{ path: "a.ts", language: "ts", code: "x" }] } }} selected updateProps={() => {}} />, { container: root });
  fireEvent.doubleClick(view.getByRole("button", { name: "a.ts" }));
  const input = view.getByRole("textbox", { name: "Rename a.ts" });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(view.queryByRole("textbox", { name: "Rename a.ts" })).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(view.queryByRole("textbox", { name: "Rename a.ts" })).toBeNull();
  expect(view.getByRole("textbox", { name: "Code" })).toBeTruthy();
  expect(setSelection).not.toHaveBeenCalled();
  root.remove();
});

it("Escape in the new file input cancels creation only", () => {
  const root = document.body.appendChild(document.createElement("div"));
  const selection = { type: "block", ids: ["w"] };
  const setSelection = vi.fn();
  const editor = { getRoot: () => root, getState: () => ({ selection }), update: (fn: (tx: { setSelection: typeof setSelection }) => void) => fn({ setSelection }) } as unknown as Editor;
  const view = render(<CodeWorkspaceIDEView editor={editor} block={{ id: "w", type: "codeWorkspace", props: { files: [{ path: "a.ts", language: "ts", code: "x" }] } }} selected updateProps={() => {}} />, { container: root });
  fireEvent.click(view.getByRole("button", { name: "New file" }));
  const input = view.getByRole("textbox", { name: "New file name" });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(view.queryByRole("textbox", { name: "New file name" })).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(view.queryByRole("textbox", { name: "New file name" })).toBeNull();
  expect(view.getByRole("textbox", { name: "Code" })).toBeTruthy();
  expect(setSelection).not.toHaveBeenCalled();
  root.remove();
});

it("Escape in an unselected IDE does not steal focus", () => {
  const root = document.body.appendChild(document.createElement("div"));
  root.tabIndex = 0;
  const editor = { getRoot: () => root, getState: () => ({ selection: null }) } as unknown as Editor;
  const view = render(<CodeWorkspaceIDEView editor={editor} block={{ id: "w", type: "codeWorkspace", props: { files: [{ path: "a.ts", language: "ts", code: "x" }] } }} updateProps={() => {}} />, { container: root });
  const tab = view.getByRole("tab", { name: "a.ts" });
  tab.focus();
  expect(fireEvent.keyDown(tab, { key: "Escape" })).toBe(true);
  expect(document.activeElement).toBe(tab);
  root.remove();
});
