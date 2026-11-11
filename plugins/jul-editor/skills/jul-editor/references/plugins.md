# Plugins

```sh
npm install @jul-editor/plugins
npm install recharts   # only for charts
npm install mermaid    # only for diagrams
npm install lowlight   # only for code highlighting
```

Import from subpaths so unused plugins stay out of the bundle. Register renderers and slash items with `<Editor.Plugin>` as a direct child of `<Editor>`. Keep the `renderers` object stable (a module constant).

```tsx
import { ChartView, chartSlashItem } from "@jul-editor/plugins/chart";

<Editor>
  <Editor.Plugin renderers={{ chart: ChartView }} slashItems={[chartSlashItem]} />
  <Editor.Content />
  <Editor.SlashMenu />
</Editor>
```

| Subpath | Use |
| --- | --- |
| `@jul-editor/plugins/chart` | `ChartView`, `chartSlashItem` (needs `recharts`) |
| `@jul-editor/plugins/diagram` | `DiagramView`, `diagramSlashItem` (needs `mermaid`) |
| `@jul-editor/plugins/table` | Data table block |
| `@jul-editor/plugins/code` | `createLowlightHighlighter()` for code blocks (needs `lowlight`) |
| `@jul-editor/plugins/diff` | `<DiffView before={a} after={b} />` (unchanged blocks collapse; `mode="full"` shows all) and `diffDocs(a, b, coreRegistry)` for raw data (`coreRegistry` from `@jul-editor/core`) |
| `@jul-editor/plugins` | `pluginRenderers` and `pluginSlashItems` for chart, diagram, and data table at once |

A missing peer shows a short notice instead of crashing.

A chart block in a document. Data is inline CSV (or `{ type: "inline", format: "json", json: "[...]" }`); `x` is the label column and `y` one column or an array of columns:

```ts
import { newId, type Block } from "@jul-editor/core";

const chart: Block = { id: newId(), type: "chart", props: {
  kind: "bar",                     // "bar" | "line" | "area" | "pie" | "radar" | "radial"
  x: "month", y: "visitors",
  source: { type: "inline", csv: "month,visitors\nJan,120\nFeb,160\nMar,140" },
} };
```

`props` is loosely typed (`Record<string, Json>`), so a wrong shape compiles but renders an empty-state message. Copy the shapes here. Other plugin and code blocks:

```ts
const diagram: Block = { id: newId(), type: "diagram", props: { code: "graph TD; A-->B" } };   // render with DiagramView
const code: Block = { id: newId(), type: "codeBlock", props: { language: "typescript" }, content: [{ type: "text", text: "const a = 1;" }] };
```

Code highlighting is not a renderer. Register it from a component inside `<Editor>`:

```tsx
import { useEffect } from "react";
import { useEditor } from "@jul-editor/react";
import { createLowlightHighlighter } from "@jul-editor/plugins/code";

function CodeHighlighting() {
  const editor = useEditor();
  useEffect(() => editor?.registerHighlighter(createLowlightHighlighter()), [editor]);
  return null;
}
// <Editor ...><CodeHighlighting /><Editor.Content /></Editor>
```

Tokens are painted with the CSS Custom Highlight API, not spans. Style them with `::highlight(jul-editor-<token>)`, tokens: `keyword string comment number title function attr built_in type literal meta variable punctuation`.

```css
::highlight(jul-editor-keyword) { color: #c026d3; }
::highlight(jul-editor-string) { color: #16a34a; }
::highlight(jul-editor-comment) { color: #6b7280; }
```

## Everything together

```tsx
import { Editor, defaultRenderers } from "@jul-editor/react";
import { ChartView, chartSlashItem } from "@jul-editor/plugins/chart";
import { DiagramView, diagramSlashItem } from "@jul-editor/plugins/diagram";

const renderers = { ...defaultRenderers, chart: ChartView, diagram: DiagramView };
const slashItems = [chartSlashItem, diagramSlashItem];

<Editor defaultValue={doc}>
  <Editor.Plugin renderers={renderers} slashItems={slashItems} />
  <CodeHighlighting />
  <Editor.Content />
  <Editor.SlashMenu />
</Editor>
```

## Images and uploads

Image and embed blocks render only when you pass the bundled renderers. Pasted or dropped files go through `onUpload`, which returns the final URL.

```tsx
import { Editor, defaultRenderers } from "@jul-editor/react";

<Editor
  renderers={defaultRenderers}
  onUpload={async (file) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    return (await res.json()).url;
  }}
>
  <Editor.Content />
</Editor>
```

Renderers passed to `<Editor renderers>` and to any `<Editor.Plugin renderers>` are merged (the `<Editor>` prop wins on a clash), so images plus plugins needs no extra wiring.
