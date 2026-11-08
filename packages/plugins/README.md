# @jul-editor/plugins

Optional JulEditor plugins, imported per subpath so an app only pays for what it uses:

| Subpath | Provides |
| --- | --- |
| `@jul-editor/plugins/chart` | Chart block and Recharts view |
| `@jul-editor/plugins/diagram` | Mermaid diagram block |
| `@jul-editor/plugins/table` | Data table block and data resolver provider |
| `@jul-editor/plugins/code` | Lowlight syntax highlighting |
| `@jul-editor/plugins/code-workspace` | Multi-file code workspace block |
| `@jul-editor/plugins/data` | CSV/JSON parsing and data helpers (no React) |
| `@jul-editor/plugins/diff` | Document diff (`diffDocs`) and `<DiffView>` |

## Install

```sh
pnpm add @jul-editor/plugins @jul-editor/core @jul-editor/react react
```

The workspace packages are not published to npm yet; inside this repository use `"@jul-editor/plugins": "workspace:*"`.

## Usage

```tsx
import { Editor } from "@jul-editor/react";
import { ChartView, chartSlashItem } from "@jul-editor/plugins/chart";
import { diffDocs, DiffView } from "@jul-editor/plugins/diff";

<Editor defaultValue={doc}>
  <Editor.Plugin renderers={{ chart: ChartView }} slashItems={[chartSlashItem]} />
  <Editor.Content />
</Editor>;

<DiffView before={before} after={after} mode="changes" />;
```

## Docs

See the [repository README](../../README.md) and the developer docs in `apps/web` (`/docs`).

## Suggestion mode inside the live editor (`@jul-editor/plugins/diff`)

`useEditorSuggestions(editor, proposedDoc, opts?)` (or the framework-agnostic `createEditorSuggestions`)
draws a proposed change set inside the editor with core's `editor.setDecorations`: insertions and
deletions are highlighted (the side that is not real text becomes a widget), every change gets
Accept / Reject buttons, and each decision is applied as ONE undoable transaction (`reconcileDoc`).
`perspective: "base"` (default) means the editor holds the current text and `proposedDoc` is the
suggestion; `"proposed"` means the editor already holds the suggested text and the doc passed in is
the original. Style it with `SUGGESTION_CSS` or the `jul-editor-suggest-ins/del/fmt` classes.
`SuggestionView` stays as the read-only review panel.
