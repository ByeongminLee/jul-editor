# Documents: load, save, convert

A document is plain JSON: `{ version: 1, blocks: Block[] }`. A block is `{ id, type, props, content? }`, with `content` as `[{ type: "text", text, marks? }]`.

```tsx
const initial: Doc = {
  version: 1,
  blocks: [
    { id: "h1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello" }] },
  ],
};

<Editor defaultValue={initial} onChange={(doc) => save(JSON.stringify(doc))} />
```

Persist to localStorage (read once at module scope, so the value is stable; the `window` check keeps SSR frameworks from crashing):

```tsx
function loadDoc(): Doc | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const saved = localStorage.getItem("doc");
    return saved ? (JSON.parse(saved) as Doc) : undefined;
  } catch {
    return undefined; // corrupted or blocked storage: start empty
  }
}
const initialDoc = loadDoc();

<Editor defaultValue={initialDoc} onChange={(doc) => localStorage.setItem("doc", JSON.stringify(doc))}>
  <Editor.Content />
</Editor>
```

- `defaultValue`: initial document (uncontrolled). `undefined` or omitted means an empty editor.
- `value` + `onChange`: controlled. Passing back the same object you got from `onChange` keeps the cursor; passing a different `Doc` resets the editor (use this to load another document).
- Block types: `paragraph heading bulletListItem orderedListItem todoListItem quote codeBlock divider image embed table chart diagram dataTable`. Generate ids with `newId()` from `@jul-editor/core`.

## Autosave

`useAutosave({ key, save })` saves for you. Call it in a small component rendered inside `<Editor>`. It writes a local draft to localStorage under `key` by itself (after 500 ms), then calls your `save(doc, { signal })` for the server (after 2000 ms; change with `localDebounceMs` / `serverDebounceMs`). Do not also write localStorage yourself. It returns `{ status, flush, lastSavedAt, restoreDraft }`, with `status` one of `idle dirty saving saved saved-local server-error local-error`.

```tsx
function SaveStatus() {
  const { status } = useAutosave({ key: "doc-1", save: (doc) => api.saveDoc(doc) });
  return <span>{status}</span>;
}
// <Editor ...><SaveStatus /><Editor.Content /></Editor>
```

## Markdown, HTML, text

```ts
import { fromMarkdown, toMarkdown, fromHTML, toHTML, toText } from "@jul-editor/core/serde";

const { doc } = fromMarkdown("# Hello\n\nWorld");   // returns { doc, lossy }
const { markdown } = toMarkdown(doc);              // returns { markdown, lossy }
const html = toHTML(doc);
```

`lossy` lists anything that could not be converted exactly. These functions work without React (server, scripts, tests).

Plugin blocks export as fenced JSON (for example a ```` ```jul-editor-chart ```` block) and read back the same way. An empty paragraph becomes a zero-width space (`\u200B`) in Markdown so it survives a round trip. When showing or exporting Markdown to people, clean it: `markdown.replace(/\u200B/g, "").trim()`.
