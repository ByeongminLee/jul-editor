# JulEditor

A headless block editor for the web, with React components and optional plugins. [한국어](docs/README.ko.md)

## Install

```sh
pnpm add @jul-editor/core @jul-editor/react
```

React 18 and 19 are supported. Optional blocks live in `@jul-editor/plugins`; install its renderers only for the plugins you use (`recharts` for charts, `mermaid` for diagrams, `lowlight` for code highlighting).

## Quick start

```tsx
import { Editor } from "@jul-editor/react";

export function App() {
  return (
    <Editor onChange={(doc) => console.log(doc)}>
      <Editor.Toolbar />
      <Editor.Content />
      <Editor.SlashMenu />
    </Editor>
  );
}
```

## Packages

| Package | Description |
| --- | --- |
| [`@jul-editor/core`](https://www.npmjs.com/package/@jul-editor/core) | Document model, transactions, history, and Markdown/HTML serialization. No React. |
| [`@jul-editor/react`](https://www.npmjs.com/package/@jul-editor/react) | Compound `<Editor>` components, hooks, toolbar, and menus. Headless, no CSS. |
| [`@jul-editor/plugins`](https://www.npmjs.com/package/@jul-editor/plugins) | Chart, diagram, data table, code highlighting, code workspace, and document diff. |

## Features

- **Block editing** — Rich text, headings, lists, tables, images, embeds, and drag handles.
- **Composable UI** — React editor components, toolbars, slash commands, and menus.
- **Portable content** — Markdown, HTML, JSON, and plain-text conversion.
- **Extensible** — Custom blocks, marks, input rules, and optional plugins.
- **Document tools** — Diff, comments, collaboration, charts, and paged documents.
- **Customizable** — Styling tokens and English or Korean labels.

## Playground

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/images/playground-editor.webp" width="400" height="250" alt="Playground editor view"><br>Editor</td>
    <td align="center" width="33%"><img src="docs/images/playground-markdown.webp" width="400" height="250" alt="Playground Markdown view"><br>Markdown</td>
    <td align="center" width="33%"><img src="docs/images/playground-diff.webp" width="400" height="250" alt="Playground diff view"><br>Diff</td>
  </tr>
</table>

## License

[MIT](LICENSE)
