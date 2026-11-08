// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DiagramView } from "./diagram-view.js";
import { DataTableView } from "./data-table-view.js";
import { CodeWorkspaceView } from "./code-workspace/code-workspace-view.js";
import { CodeWorkspaceIDEView } from "./code-workspace/code-workspace-ide-view.js";
afterEach(cleanup);
const block = { id: "w", type: "codeWorkspace", props: { files: [{path: "a.ts", language: "ts", code: "x"}] } };
it("maps workspace classes to real regions in both renderers", () => {
  for (const View of [CodeWorkspaceView, CodeWorkspaceIDEView]) {
    const {container, unmount} = render(<View block={block} className={{container: "root", tree: "tree", tabs: "tabs", code: "code", gutter: "gutter"}} />);
    for (const name of ["root", "tree", "tabs", "code", "gutter"]) expect(container.querySelector(`.${name}`)).not.toBeNull();
    unmount();
  }
});
it("accepts root strings and diagram controls", () => {
  const {container, unmount} = render(<DiagramView block={{id: "d", type: "diagram", props: {code: ""}}} selected updateProps={() => {}} className={{container: "diagram", source: "source"}} />);
  expect(container.querySelector(".diagram .source")).not.toBeNull();
  unmount();
  const table = render(<DataTableView block={{id: "t", type: "dataTable", props: {source: {type: "inline", csv: "A\n1"}}}} className="table-root" />);
  expect(table.container.querySelector(".table-root")).not.toBeNull();
});
it("keeps IDE theme overrides alongside a root class", () => {
  const {container} = render(<CodeWorkspaceIDEView block={block} className="rounded-lg" theme={{background: "#fff"}} />);
  const root = container.querySelector<HTMLElement>(".rounded-lg");
  expect(root?.style.getPropertyValue("--jul-editor-code-bg")).toBe("#fff");
});
