// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginViewProps } from "../view-props.js";
import { CodeWorkspaceView } from "./code-workspace-view.js";

const editor = null as unknown as PluginViewProps["editor"];
const files = ["A", "B", "C"].map((path) => ({ path, language: "ts", code: path }));
afterEach(cleanup);

it("keeps the fallback file in the tablist after deleting the active file", () => {
  function Harness() {
    const [current, setCurrent] = useState(files);
    return <CodeWorkspaceView editor={editor} selected block={{ id: "w", type: "codeWorkspace", props: { files: current } }} updateProps={(patch) => setCurrent(patch.files as typeof files)} />;
  }
  const { getByRole, container } = render(<Harness />);
  fireEvent.click(getByRole("button", { name: "C" }));
  fireEvent.click(getByRole("button", { name: "A" }));
  fireEvent.click(getByRole("button", { name: "Remove file" }));
  const active = getByRole("tab", { name: "B" });
  expect(active.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector("[data-jul-editor-code-panel]")?.getAttribute("aria-labelledby")).toBe(active.id);
});

it("refreshes line marker inputs after an external document change without eating comma typing", () => {
  const updateProps = vi.fn();
  const view = (addedLines: number[]) => <CodeWorkspaceView editor={editor} selected block={{ id: "w", type: "codeWorkspace", props: { files: [{ path: "A", language: "ts", code: "A", addedLines }] } }} updateProps={updateProps} />;
  const { getByLabelText, rerender } = render(view([1]));
  const input = getByLabelText("Added lines") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "1, " } });
  expect(input.value).toBe("1, ");
  rerender(view([3]));
  expect(input.value).toBe("3");
});

it("keeps file navigation but hides mutation controls in read-only mode", () => {
  const { getByRole, queryByRole, container } = render(<CodeWorkspaceView readOnly selected block={{ id: "w", type: "codeWorkspace", props: { files } }} />);
  expect(queryByRole("group", { name: "Code Workspace settings" })).toBeNull();
  fireEvent.click(getByRole("button", { name: "C" }));
  expect(container.querySelector("[data-jul-editor-code-path]")?.textContent).toBe("C");
  expect(getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true");
});

it("keeps pinned paths valid when a pinned file is renamed then deleted", () => {
  function Harness() {
    const [props, setProps] = useState({ files, pinnedPaths: ["A"] });
    return <CodeWorkspaceView selected block={{id: "w", type: "codeWorkspace", props}} updateProps={(patch) => setProps((current) => ({...current, ...patch} as typeof current))} />;
  }
  const {getByLabelText, getByRole, queryByRole} = render(<Harness />);
  fireEvent.blur(getByLabelText("File path"), {target: {value: "Renamed.ts"}});
  expect(getByRole("tab", {name: "Renamed.ts"}).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(getByRole("button", {name: "Remove file"}));
  expect(queryByRole("tab", {name: "Renamed.ts"})).toBeNull();
  expect(getByRole("tab", {name: "B"}).getAttribute("aria-selected")).toBe("true");
});

it("rejects invalid paths and file renames that collide with folders", () => {
  const updateProps = vi.fn();
  const {getByLabelText, getByRole} = render(<CodeWorkspaceView selected block={{id: "w", type: "codeWorkspace", props: {files: [{path: "a.ts", language: "ts", code: "a"}, {path: "src/b.ts", language: "ts", code: "b"}]}}} updateProps={updateProps} />);
  const input = getByLabelText("File path") as HTMLInputElement;
  for (const path of ["../oops.ts", "src//oops.ts", "src"]) {
    fireEvent.change(input, {target: {value: path}});
    fireEvent.blur(input);
    expect(updateProps).not.toHaveBeenCalled();
    expect(input.value).toBe("a.ts");
    expect(getByRole("tab", {name: "a.ts"})).toBeTruthy();
  }
});

it("skips explicit and implied folder names when adding a default file", () => {
  function Harness() {
    const [props, setProps] = useState({
      folders: ["untitled.ts"],
      files: [{ path: "untitled-2.ts/a.ts", language: "ts", code: "a" }],
    });
    return <CodeWorkspaceView selected block={{ id: "w", type: "codeWorkspace", props }} updateProps={(patch) => setProps((current) => ({ ...current, ...patch } as typeof current))} />;
  }
  const { getByRole } = render(<Harness />);
  fireEvent.click(getByRole("button", { name: "Add file" }));
  expect(getByRole("tab", { name: "untitled-3.ts" })).toBeTruthy();
  expect(getByRole("button", { name: "untitled-2.ts/a.ts" })).toBeTruthy();
});

it("shows no edit controls until selected and keeps +/- exclusive", () => {
  const updateProps = vi.fn();
  const block = { id: "w", type: "codeWorkspace", props: { files: [{ path: "A", language: "ts", code: "a\nb", addedLines: [1], removedLines: [1] }] } };
  const { queryByLabelText, getByLabelText, container, rerender } = render(<CodeWorkspaceView editor={editor} block={block} updateProps={updateProps} />);
  expect(container.querySelector("[data-jul-editor-code-controls]")).toBeNull();
  expect(queryByLabelText("Added lines")).toBeNull();
  expect(container.querySelector('[data-change="added"]')).toBeTruthy();
  expect(container.querySelector('[data-change="modified"]')).toBeNull();
  rerender(<CodeWorkspaceView editor={editor} selected block={block} updateProps={updateProps} />);
  fireEvent.change(getByLabelText("Deleted lines"), { target: { value: "1, 2" } });
  expect(updateProps).toHaveBeenLastCalledWith({ files: [{ path: "A", language: "ts", code: "a\nb", addedLines: [], removedLines: [1, 2] }] });
});
