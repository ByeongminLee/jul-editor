// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Json } from "@jul-editor/core";
import type { CodeWorkspaceFile } from "./block.js";
import { CodeWorkspaceIDEView } from "./";

afterEach(cleanup);

const sampleFiles = [
  { path: "src/A.ts", language: "ts", code: "const a = 1;" },
  { path: "src/B.ts", language: "ts", code: "const b = 2;" },
  { path: "docs/readme.md", language: "markdown", code: "# Docs" },
];

function workspace(initialFiles: CodeWorkspaceFile[] = sampleFiles, theme?: { background?: string }, initialProps: Record<string, Json> = {}) {
  let current: Record<string, Json> = { files: initialFiles as unknown as Json, ...initialProps };
  function Harness() {
    const [props, setProps] = useState(current);
    current = props;
    return <CodeWorkspaceIDEView block={{ id: "w", type: "codeWorkspace", props }} selected updateProps={(patch) => setProps((previous) => ({ ...previous, ...patch } as Record<string, Json>))} theme={theme} />;
  }
  return { ...render(<Harness />), current: () => current };
}

it("opens files in IDE tabs and edits code directly with a preset theme", () => {
  const view = workspace(sampleFiles, { background: "#123456" });
  const root = view.container.querySelector('[data-jul-editor-plugin="code-workspace-ide"]') as HTMLElement;
  expect(root.style.getPropertyValue("--jul-editor-code-bg")).toBe("#123456");
  expect(view.getByRole("tablist", { name: "Open files" })).toBeTruthy();
  expect(view.container.querySelector("[data-jul-editor-code-gutter]")).toBeTruthy();
  expect(view.queryByRole("group", { name: "Code Workspace settings" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "src/B.ts" }));
  expect(view.getByRole("tab", { name: "src/B.ts" }).getAttribute("aria-selected")).toBe("true");
  const code = view.getByRole("textbox", { name: "Code" }) as HTMLTextAreaElement;
  fireEvent.change(code, { target: { value: "const b = 3;" } });
  expect((view.current().files as unknown as CodeWorkspaceFile[])[1]?.code).toBe("const b = 3;");
});

it("creates a folder then a file inline, infers language, and persists a pinned tab", () => {
  const view = workspace();
  fireEvent.click(view.getByRole("button", { name: "New folder" }));
  const folderName = view.getByRole("textbox", { name: "New folder name" });
  fireEvent.change(folderName, { target: { value: "assets" } });
  fireEvent.keyDown(folderName, { key: "Enter" });
  expect(view.current().folders).toEqual(["assets"]);

  fireEvent.click(view.getByRole("button", { name: "New file" }));
  const fileName = view.getByRole("textbox", { name: "New file name" });
  fireEvent.change(fileName, { target: { value: "main.tsx" } });
  fireEvent.keyDown(fileName, { key: "Enter" });
  expect((view.current().files as unknown as CodeWorkspaceFile[]).at(-1)).toMatchObject({ path: "main.tsx", language: "tsx", code: "" });
  expect(view.getByRole("tab", { name: "main.tsx" }).getAttribute("aria-selected")).toBe("true");

  fireEvent.click(view.getByRole("checkbox", { name: "Pin main.tsx" }));
  expect(view.current().pinnedPaths).toEqual(["main.tsx"]);
});

it("returns keyboard focus to the created or renamed tree item", async () => {
  const view = workspace();
  fireEvent.click(view.getByRole("button", { name: "New folder" }));
  const create = view.getByRole("textbox", { name: "New folder name" });
  fireEvent.change(create, { target: { value: "assets" } });
  fireEvent.keyDown(create, { key: "Enter" });
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "assets" })));

  fireEvent.keyDown(view.getByRole("button", { name: "assets" }), { key: "F2" });
  const rename = view.getByRole("textbox", { name: "Rename assets" });
  fireEvent.change(rename, { target: { value: "images" } });
  fireEvent.keyDown(rename, { key: "Enter" });
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "images" })));
});

it("returns focus to the prior tree control when creation or rename is canceled", async () => {
  const view = workspace();
  const addFile = view.getByRole("button", { name: "New file" });
  fireEvent.click(addFile);
  fireEvent.keyDown(view.getByRole("textbox", { name: "New file name" }), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(addFile));

  const folder = view.getByRole("button", { name: "src" });
  fireEvent.keyDown(folder, { key: "F2" });
  fireEvent.keyDown(view.getByRole("textbox", { name: "Rename src" }), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "src" })));
});

it("does not create a file over an implied parent folder", () => {
  const view = workspace([], undefined, { folders: ["assets/icons"] });
  fireEvent.click(view.getByRole("button", { name: "New file" }));
  const fileName = view.getByRole("textbox", { name: "New file name" });
  fireEvent.change(fileName, { target: { value: "assets" } });
  fireEvent.keyDown(fileName, { key: "Enter" });
  expect(view.current().files).toEqual([]);
  expect(view.getByRole("alert").textContent).toMatch(/already in use/i);
});

it("renames files and folders, remaps tabs and pins, and drags a file into another folder", () => {
  const view = workspace(sampleFiles, undefined, { pinnedPaths: ["src/A.ts"] });
  fireEvent.doubleClick(view.getByRole("button", { name: "src/A.ts" }));
  const fileName = view.getByRole("textbox", { name: "Rename src/A.ts" });
  fireEvent.change(fileName, { target: { value: "Renamed.py" } });
  fireEvent.keyDown(fileName, { key: "Enter" });
  expect((view.current().files as unknown as CodeWorkspaceFile[])[0]).toMatchObject({ path: "src/Renamed.py", language: "python" });
  expect(view.current().pinnedPaths).toEqual(["src/Renamed.py"]);
  expect(view.getByRole("tab", { name: "src/Renamed.py" }).getAttribute("aria-selected")).toBe("true");

  fireEvent.keyDown(view.getByRole("button", { name: "src" }), { key: "F2" });
  const folderName = view.getByRole("textbox", { name: "Rename src" });
  fireEvent.change(folderName, { target: { value: "lib" } });
  fireEvent.keyDown(folderName, { key: "Enter" });
  expect((view.current().files as unknown as CodeWorkspaceFile[]).map((file) => file.path)).toEqual(["lib/Renamed.py", "lib/B.ts", "docs/readme.md"]);
  expect(view.current().pinnedPaths).toEqual(["lib/Renamed.py"]);

  const data = new Map<string, string>();
  const transfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", effectAllowed: "none" };
  fireEvent.dragStart(view.getByRole("button", { name: "lib/B.ts" }), { dataTransfer: transfer });
  fireEvent.dragOver(view.getByRole("button", { name: "docs" }), { dataTransfer: transfer });
  fireEvent.drop(view.getByRole("button", { name: "docs" }), { dataTransfer: transfer });
  expect((view.current().files as unknown as CodeWorkspaceFile[]).map((file) => file.path)).toEqual(["lib/Renamed.py", "docs/B.ts", "docs/readme.md"]);
});

it("reinfers language when a renamed file changes extension after a folder move", () => {
  const view = workspace([{ path: "src/Button.tsx", language: "typescript", code: "export const Button = 1;" }], undefined, { folders: ["notes"] });
  const data = new Map<string, string>();
  const transfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", effectAllowed: "none" };
  fireEvent.dragStart(view.getByRole("button", { name: "src/Button.tsx" }), { dataTransfer: transfer });
  fireEvent.drop(view.getByRole("button", { name: "notes" }), { dataTransfer: transfer });
  fireEvent.doubleClick(view.getByRole("button", { name: "notes/Button.tsx" }));
  const input = view.getByRole("textbox", { name: "Rename notes/Button.tsx" });
  fireEvent.change(input, { target: { value: "Button.jsx" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect((view.current().files as unknown as CodeWorkspaceFile[])[0]).toMatchObject({ path: "notes/Button.jsx", language: "jsx" });
  expect(view.queryByRole("textbox", { name: "Language" })).toBeNull();
});

it("does not treat dropping on a file row as a move to workspace root", () => {
  const view = workspace();
  const data = new Map<string, string>();
  const transfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", effectAllowed: "none", types: ["application/x-jul-editor-workspace-path"] };
  fireEvent.dragStart(view.getByRole("button", { name: "src/A.ts" }), { dataTransfer: transfer });
  fireEvent.drop(view.getByRole("button", { name: "docs/readme.md" }), { dataTransfer: transfer });
  expect((view.current().files as unknown as CodeWorkspaceFile[]).map((file) => file.path)).toEqual(sampleFiles.map((file) => file.path));
});

it("distinguishes tabs whose files share a basename", () => {
  const files = [
    { path: "src/index.ts", language: "ts", code: "a" },
    { path: "tests/index.ts", language: "ts", code: "b" },
  ];
  const view = workspace(files);
  fireEvent.click(view.getByRole("button", { name: "tests/index.ts" }));
  expect(view.getByRole("tab", { name: "src/index.ts" }).textContent).toBe("index.ts");
  expect(view.getByRole("tab", { name: "tests/index.ts" }).textContent).toBe("index.ts");
});

it("treats legacy data with a line in both lists as added (+/- are exclusive)", () => {
  const view = workspace([{ path: "a.ts", language: "ts", code: "const a = 1;", addedLines: [1], removedLines: [1] }]);
  expect(view.container.querySelector('[data-jul-editor-code-gutter] [data-change="added"]')).toBeTruthy();
  expect(view.container.querySelector('[data-change="modified"]')).toBeNull();
  expect(view.getByRole("button", { name: "Mark line 1 deleted" }).getAttribute("aria-pressed")).toBe("false");
});

it("toggles + and - as a radio: choosing one clears the other", () => {
  const view = workspace([{ path: "a.ts", language: "ts", code: "a\nb" }]);
  const files = () => view.current().files as unknown as CodeWorkspaceFile[];
  fireEvent.click(view.getByRole("button", { name: "Mark line 1 added" }));
  expect(files()[0]?.addedLines).toEqual([1]);
  fireEvent.click(view.getByRole("button", { name: "Mark line 1 deleted" }));
  expect(files()[0]?.addedLines).toEqual([]);
  expect(files()[0]?.removedLines).toEqual([1]);
  fireEvent.click(view.getByRole("button", { name: "Mark line 1 added" }));
  expect(files()[0]?.removedLines).toEqual([]);
  expect(files()[0]?.addedLines).toEqual([1]);
  fireEvent.click(view.getByRole("button", { name: "Mark line 1 added" }));
  expect(files()[0]?.addedLines).toEqual([]);
});

it("shows the view appearance by default and edit controls only when selected", () => {
  const block = { id: "w", type: "codeWorkspace", props: { files: sampleFiles } };
  const view = render(<CodeWorkspaceIDEView block={block} updateProps={() => {}} />);
  expect(view.queryByRole("textbox", { name: "Code" })).toBeNull();
  expect(view.queryByRole("button", { name: "New file" })).toBeNull();
  expect(view.queryByRole("checkbox", { name: "Pin src/A.ts" })).toBeNull();
  expect(view.queryByRole("button", { name: "Mark line 1 added" })).toBeNull();
  view.rerender(<CodeWorkspaceIDEView block={block} selected updateProps={() => {}} />);
  expect(view.getByRole("textbox", { name: "Code" })).toBeTruthy();
});

it("edits added/deleted line ranges and gutter markers with syntax highlighting", async () => {
  const code = Array.from({ length: 12 }, (_, index) => `const x${index} = ${index};`).join("\n");
  const view = workspace([{ path: "a.ts", language: "ts", code }]);
  const added = view.getByRole("textbox", { name: "Added line ranges" });
  fireEvent.change(added, { target: { value: "3-7, 11" } });
  expect((view.current().files as unknown as CodeWorkspaceFile[])[0]?.addedLines).toEqual([3, 4, 5, 6, 7, 11]);
  expect((added as HTMLInputElement).value).toBe("3-7, 11");
  const deleted = view.getByRole("textbox", { name: "Deleted line ranges" });
  fireEvent.change(deleted, { target: { value: "9-3" } });
  expect(view.getByRole("alert").textContent).toMatch(/invalid/i);
  expect((view.current().files as unknown as CodeWorkspaceFile[])[0]?.removedLines).toBeUndefined();
  fireEvent.click(view.getByRole("button", { name: "Mark line 2 added" }));
  expect((view.current().files as unknown as CodeWorkspaceFile[])[0]?.addedLines).toEqual([2, 3, 4, 5, 6, 7, 11]);
  await waitFor(() => expect(view.container.querySelector('[data-jul-editor-token="keyword"]')).toBeTruthy());
});

it("keeps tree and tabs navigable but hides all editing controls in read-only mode", () => {
  const { getByRole, queryByRole, container } = render(<CodeWorkspaceIDEView block={{ id: "w", type: "codeWorkspace", props: { files: sampleFiles } }} readOnly />);
  expect(queryByRole("button", { name: "New folder" })).toBeNull();
  expect(queryByRole("checkbox", { name: "Pin src/A.ts" })).toBeNull();
  expect(queryByRole("textbox", { name: "Added line ranges" })).toBeNull();
  expect(queryByRole("textbox", { name: "Code" })).toBeNull();
  expect(getByRole("code").textContent).toContain("const a = 1;");
  fireEvent.click(getByRole("button", { name: "src/B.ts" }));
  expect(getByRole("tab", { name: "src/B.ts" }).getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector("[data-jul-editor-code-gutter]")).toBeTruthy();
});

it("allows container and code utilities to override inline radius and font defaults", () => {
  const view = render(<CodeWorkspaceIDEView readOnly block={{id: "w", type: "codeWorkspace", props: {files: sampleFiles}}} className={{container: "rounded-xl", code: "font-mono"}} />);
  expect((view.container.querySelector(".rounded-xl") as HTMLElement).style.borderRadius).toBe("");
  expect((view.container.querySelector(".font-mono") as HTMLElement).style.fontFamily).toBe("");
  const editing = render(<CodeWorkspaceIDEView selected block={{id: "edit", type: "codeWorkspace", props: {files: sampleFiles}}} updateProps={() => {}} className={{container: "rounded-xl", code: "font-mono"}} />);
  const textarea = editing.getByRole("textbox", {name: "Code"}) as HTMLTextAreaElement;
  expect(textarea.classList.contains("font-mono")).toBe(true);
  expect(textarea.style.fontFamily).toBe("");
});

it("shows both +/- toggles on every line in edit mode, styling the active one on changed lines", () => {
  const code = ":root {\n  --accent: #f97316;\n  --radius: 8px;\n}";
  const view = render(<CodeWorkspaceIDEView selected block={{ id: "d", type: "codeWorkspace", props: { files: [{ path: "a.css", language: "css", code, addedLines: [2], removedLines: [3] }] } }} updateProps={() => {}} />);
  const marker = (line: number, kind: "added" | "deleted") => view.container.querySelector(`[data-jul-editor-code-line="${line}"] [data-jul-editor-code-marker="${kind}"]`) as HTMLElement;
  for (const l of [1, 2, 3, 4]) for (const kind of ["added", "deleted"] as const) expect(marker(l, kind).style.opacity).toBe("1");
  expect([1, 2, 3, 4].map((l) => [marker(l, "added").getAttribute("aria-pressed"), marker(l, "deleted").getAttribute("aria-pressed")])).toEqual([["false", "false"], ["true", "false"], ["false", "true"], ["false", "false"]]);
  expect(marker(2, "added").style.fontWeight).toBe("700");
  expect(marker(2, "deleted").style.fontWeight).toBe("400");
});

it("renders every code row with its change kind so the whole row, not just the gutter, is tinted", () => {
  const code = ":root {\n  --accent: #f97316;\n  --radius: 8px;\n}";
  const view = render(<CodeWorkspaceIDEView selected block={{ id: "d", type: "codeWorkspace", props: { files: [{ path: "a.css", language: "css", code, addedLines: [2], removedLines: [3] }] } }} updateProps={() => {}} />);
  const rows = [...view.container.querySelectorAll("[data-jul-editor-code-preview] [data-jul-editor-code-row]")];
  expect(rows.map((row) => row.getAttribute("data-change"))).toEqual([null, "added", "deleted", null]);
  // The tint rules target the preview rows (the gutter rule alone was the original bug).
  const css = view.container.querySelector("style")!.textContent!;
  expect(css).toContain('[data-jul-editor-code-preview] [data-change="added"] { background');
  expect(css).toContain('[data-jul-editor-code-preview] [data-change="deleted"] { background');
});
