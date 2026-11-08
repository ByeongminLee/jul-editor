# @jul-editor/react

React bindings for JulEditor: the compound `<Editor>` component, hooks, toolbar, slash/mention/tag/bubble menus, block drag handle, table controls, autosave, and a read-only document view. Headless: no CSS or icons.

## Install

```sh
pnpm add @jul-editor/react @jul-editor/core react react-dom
```

Supports React 18 and 19. `@jul-editor/core` and `react-dom` are peer dependencies, so install them alongside.

## Usage

```tsx
import { Editor } from "@jul-editor/react";

export function App({ doc }) {
  return (
    <Editor defaultValue={doc}>
      <Editor.Toolbar />
      <Editor.Content />
      <Editor.SlashMenu />
    </Editor>
  );
}
```

Optional blocks (chart, diagram, data table, code highlighting, Code Workspace, document diff) live in `@jul-editor/plugins`.

## Docs

See the [repository README](https://github.com/ByeongminLee/jul-editor#readme). Guides and live examples are in the docs site, which you can run from the repository (`pnpm --filter web dev`, then open `/docs`).

## Plugin menu items

`<Editor.Plugin>` accepts two extra lists, appended after the built-ins:

- `turnIntoItems: { id, type, props?, label, keywords? }[]` extends `useTurnInto()` / `<Editor.TurnInto>`.
  `props` are both the props applied and the active test, so list variants of one type (toggle
  headings, callout colors) with distinct ids; the most specific matching item is the active one.
  Items whose block type is not registered are skipped.
- `blockMenuItems: { id, label, icon?, isVisible?(block, registry), run(editor, blockId) }[]` shows up as
  `useBlockActions(blockId).menuItems` (label already localized, `run()` bound to the block) for the
  drag handle menu. `useBlockActions().turnInto(type, props?)` also takes props now.

`label` is a string or `{ en, ko }`. `calloutPlugin` and `togglePlugin` register their entries this way.

## Drag handle placement

`useDragHandle()` / `<Editor.DragHandle>` track whether the pointer is "inside the editor" by checking the parent element of `<Editor.Content>` (the frame) plus a short gutter to its left. Spread `getHandleProps()` (from `useDragHandle`) on your handle element: they carry `data-jul-editor-drag-handle`, which makes a pointerdown or hover on the handle count as inside the editor wherever it is rendered (for example in a portal or a fixed overlay). If you build the handle without those props, render it inside the same parent container as `<Editor.Content>`: a pointerdown outside that container counts as leaving the editor, which hides the handle and clears a block selection.
