---
name: jul-editor
description: Add, configure, or style JulEditor (@jul-editor/core, @jul-editor/react, @jul-editor/plugins), a headless block editor for React. Use when a user wants a rich text, Notion-style, or Markdown editor built on JulEditor, or asks how to install it, wire the toolbar and slash menu, save or load documents, convert Markdown or HTML, add charts, diagrams, code highlighting, or diffs, or style it. Not for Tiptap, Lexical, Slate, or Editor.js projects.
---

# JulEditor

Headless block editor. `@jul-editor/core` holds the document model and Markdown/HTML conversion (no React). `@jul-editor/react` provides the compound `<Editor>` component. `@jul-editor/plugins` adds optional blocks. There is no bundled CSS or icons: the app styles everything.

## 1. Install

```sh
npm install @jul-editor/core @jul-editor/react
```

Requires React 18 or 19 (`react` and `react-dom` are peers). Use the project's package manager (`pnpm add`, `yarn add`). Basic editing needs no plugins. Add `@jul-editor/plugins` only for charts, diagrams, code highlighting and similar; each has its own peer (charts need `recharts`), listed in [plugins](references/plugins.md).

## 2. Minimal editor

```tsx
import { useState } from "react";
import type { Doc } from "@jul-editor/core";
import { Editor } from "@jul-editor/react";

export function MyEditor() {
  const [doc, setDoc] = useState<Doc>();
  return (
    <Editor onChange={setDoc}>
      <Editor.Toolbar aria-label="Formatting">
        <Editor.Bold />
        <Editor.Italic />
        <Editor.Heading level={2} />
        <Editor.BulletList />
        <Editor.Undo />
        <Editor.Redo />
      </Editor.Toolbar>
      <Editor.Content />
      <Editor.SlashMenu />
    </Editor>
  );
}
```

Rules that prevent most mistakes:

- `<Editor.Toolbar>` renders only its children. Always list the buttons you want; `<Editor.Toolbar />` alone is empty. Each button is a `type="button"` element that shows its localized label as text (pass children to use an icon) and sets `aria-pressed` when active.
- `onChange` is optional. To read the current document on demand (an export button), call `useEditor()?.getDoc()` from a component rendered inside `<Editor>`.
- Every `Editor.*` part and every hook (`useEditor`, `useAutosave`, ...) must render inside `<Editor>`.
- Mount-time props are read once: `blocks`, `renderers`, `onUpload`, `placeholder`, and `<Editor.Plugin>` children (their order does not matter). Changing them later has no effect. Keep them stable (module constants or `useMemo`).
- In Next.js App Router, put the editor in a file marked `"use client"`.

Toolbar parts: `Bold Italic Strike Underline Code Link Subscript Superscript Heading(level) BulletList OrderedList TodoList Quote CodeBlock Undo Redo`, plus table parts (`InsertTable`, `MergeCells`, ...). Menus: `SlashMenu` (type `/`), `BubbleMenu` (selection), `MentionMenu`, `TagMenu`, `DragHandle`, `TurnInto`. Without children each menu renders a minimal default.

Save what `onChange` gives you (it is plain JSON) and pass it back as `defaultValue` to restore. Nothing is styled by default; add CSS or `className`.

## Load when needed

Read only the file for the task at hand. Each is short.

| Task | Read |
| --- | --- |
| Save or load documents, controlled `value`, localStorage, autosave, Markdown/HTML/text conversion, block JSON shapes | [documents](references/documents.md) |
| Charts, diagrams, code highlighting, data tables, diffs, images and uploads | [plugins](references/plugins.md) |
| Custom slash, bubble, or mention menu markup | [menus](references/menus.md) |
| Styling (CSS hooks, Tailwind, class slots), test selectors, Korean or custom labels | [styling](references/styling.md) |

## Checklist before finishing

1. Packages installed with the project's package manager, plus peers for any plugin used.
2. Toolbar lists explicit buttons; `<Editor.Content />` is present.
3. `defaultRenderers` passed if the document can contain images.
4. Document saved from `onChange` (or `useAutosave`) and loaded through `defaultValue` or `value`.
5. Typecheck or build passes.

Docs and live examples: https://byeongminlee.github.io/jul-editor/docs/getting-started
