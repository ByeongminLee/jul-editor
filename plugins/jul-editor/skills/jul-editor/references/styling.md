# Styling and language

Nothing is styled by default. Use either approach:

- `className` on `Editor`, `Editor.Content`, and each button. `Editor.Toolbar` and `Editor.SlashMenu` also accept an object: `{ container, button, text }` and `{ container, item, text, description, empty }`.
- Plain CSS against stable attributes: `[data-jul-editor-root]` is the editable area (`contenteditable`, `role="textbox"`), each block is `[data-jul-editor-block][data-type="heading"]` (or `paragraph`, `quote`, `chart`, ...), and heading levels add `[data-jul-editor-level="1"]`. Active toolbar buttons have `aria-pressed="true"`.

```tsx
<Editor.Toolbar className={{ container: "flex gap-1 border-b p-2", button: "rounded px-2 aria-pressed:bg-gray-200" }}>
  <Editor.Bold />
</Editor.Toolbar>
<Editor.Content className="min-h-64 p-6 [&_[data-type=heading]]:font-bold" />
```

Plain CSS:

```css
.toolbar button[aria-pressed="true"] { background: #e5e7eb; }
[data-jul-editor-root] { min-height: 16rem; padding: 1.5rem; outline: none; }
[data-jul-editor-block][data-type="quote"] { border-left: 3px solid #ccc; padding-left: 1rem; }
```

Default English button names (useful for tests): Bold, Italic, Heading 2, Bullet list, Numbered list, Undo, Redo.

## Language

`<Editor locale="ko">` switches built-in labels to Korean. `labels={{ toolbarBold: "Strong" }}` overrides single labels. Plugin slash items (such as `chartSlashItem`) keep their own English titles; localize with a copy: `{ ...chartSlashItem, title: t("chart") }`.
