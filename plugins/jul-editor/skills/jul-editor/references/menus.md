# Menus

Without children each menu renders a minimal default: `SlashMenu` (type `/`), `BubbleMenu` (over a selection), `MentionMenu` (`@`, needs `onSearch`), `TagMenu` (`#`), `DragHandle`, `TurnInto`.

Menus without children render a minimal default; pass a render function for full control. The function gets `rect` (the caret `DOMRect`, `null` while closed), so return `null` when there is no rect:

```tsx
<Editor.SlashMenu>
  {({ items, activeIndex, rect, getListboxProps, getOptionProps }) =>
    rect && (
      <ul {...getListboxProps()} style={{ position: "fixed", left: rect.left, top: rect.bottom + 4 }}>
        {items.map((item, i) => (
          <li key={item.id} {...getOptionProps(i)} data-active={i === activeIndex || undefined}>{item.title}</li>
        ))}
      </ul>
    )}
</Editor.SlashMenu>
```

`<Editor.BubbleMenu>` renders nothing without a selection, and its children get a non-null `({ rect })`. Position it yourself:

```tsx
<Editor.BubbleMenu>
  {({ rect }) => (
    <div style={{ position: "fixed", left: rect.left, top: rect.bottom + 4 }}>
      <Editor.Bold /><Editor.Italic /><Editor.Link />
    </div>
  )}
</Editor.BubbleMenu>
```
