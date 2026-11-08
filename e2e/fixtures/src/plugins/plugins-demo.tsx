// "/plugins" route: @jul-editor/react's Editor wired with @jul-editor/plugins'
// renderers -- an inline-CSV bar chart, a line chart with an A1 range, a
// mermaid flowchart, and a dataTable. `?empty=1` renders a doc with none of
// these blocks (e2e/plugins.spec.ts uses it to assert the mermaid chunk is
// never requested when no diagram block exists).
import { useEffect, useMemo } from "react";
import type { Doc, Selection as ModelSelection } from "@jul-editor/core";
import { pluginRenderers } from "@jul-editor/plugins";
import { Editor, useEditor } from "@jul-editor/react";

declare global {
  interface Window {
    __julEditorPlugins?: {
      getDoc: () => Doc;
      setSelection: (selection: ModelSelection | null) => void;
      selectBlock: (id: string) => void;
    };
  }
}

function lineCsv(): string {
  const rows = Array.from({ length: 25 }, (_, i) => `d${i + 1},${(i * 7) % 50}`);
  return ["day,value", ...rows].join("\n");
}

function sampleDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "x-p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Plugins demo" }] },
      {
        id: "x-chart-bar",
        type: "chart",
        props: { kind: "bar", source: { type: "inline", csv: "month,sales\nJan,120\nFeb,90\nMar,150\nApr,80" }, range: null },
      },
      {
        id: "x-chart-line",
        type: "chart",
        props: { kind: "line", source: { type: "inline", csv: lineCsv() }, range: "A1:C20" },
      },
      {
        id: "x-diagram",
        type: "diagram",
        props: { code: "flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]" },
      },
      {
        id: "x-table",
        type: "dataTable",
        props: { source: { type: "inline", csv: "name,age,city\nalice,30,seoul\nbob,25,busan\ncarol,40,seoul" } },
      },
      // No <ResolveDataProvider> is wired up on this page, so a `view`
      // source falls back to defaultResolveData's MissingResolverError --
      // this block exercises DataTableView's headless "missing resolver"
      // state. e2e/plugins.spec.ts asserts on it directly.
      {
        id: "x-table-view",
        type: "dataTable",
        props: { source: { type: "view", viewId: "demo-view-1" } },
      },
      { id: "x-p2", type: "paragraph", props: {}, content: [] },
    ],
  };
}

function emptyDoc(): Doc {
  return {
    version: 1,
    blocks: [{ id: "x-empty-p1", type: "paragraph", props: {}, content: [{ type: "text", text: "no chart/diagram/dataTable blocks here" }] }],
  };
}

function Bridge() {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    function focusRoot(): void {
      document.querySelector<HTMLElement>("[data-jul-editor-root]")?.focus();
    }
    window.__julEditorPlugins = {
      getDoc: () => editor.getDoc(),
      setSelection: (selection) => {
        focusRoot();
        editor.update((tx) => tx.setSelection(selection));
      },
      selectBlock: (id) => {
        focusRoot();
        editor.update((tx) => tx.setSelection({ type: "block", ids: [id] }));
      },
    };
    return () => {
      delete window.__julEditorPlugins;
    };
  }, [editor]);

  return null;
}

export function PluginsDemo() {
  const empty = new URLSearchParams(window.location.search).get("empty") === "1";
  const doc = useMemo(() => (empty ? emptyDoc() : sampleDoc()), [empty]);

  return (
    <div data-testid="page-plugins">
      <Editor defaultValue={doc} renderers={pluginRenderers}>
        <Editor.Content />
        <Bridge />
      </Editor>
    </div>
  );
}
