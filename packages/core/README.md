# @jul-editor/core

Framework-agnostic core of JulEditor: block document model, editing store with transactions and history, DOM view, clipboard, and Markdown/HTML/text serialization (`@jul-editor/core/serde`). No React dependency and no CSS.

## Install

```sh
pnpm add @jul-editor/core
```

The workspace packages are not published to npm yet; inside this repository use `"@jul-editor/core": "workspace:*"`.

## Usage

```ts
import { coreRegistry, fromJSON } from "@jul-editor/core";
import { toMarkdown, fromMarkdown } from "@jul-editor/core/serde";

const doc = fromMarkdown("# Hello\n\nWorld", coreRegistry);
console.log(toMarkdown(doc, coreRegistry));
```

## Docs

See the [repository README](../../README.md) and the developer docs in `apps/web` (`/docs`).

## Extension points for block and inline plugins

### Markdown block hook: `BlockSpec.fromMarkdownBlock`

Lets a block claim a markdown block token that the parser has no native seam for. Hooks of every
registered block are tried in registry order, the first non-null result wins. It runs in
`fromMarkdown`, in the paste path (`decodeClipboard` uses `fromMarkdown` with the editor registry)
and for nested tokens (quote children, list item bodies).

```ts
defineBlock({
  type: "callout", /* ... */
  fromMarkdownBlock(token, ctx) {
    if (token.type !== "blockquote" || !/^\s*\[!\w+\]/.test(token.text)) return null;
    return toCallout(ctx.default()[0]!); // ctx.default() is core's own conversion of this token
  },
});
```

`token` is `{ type, raw, text }`. `ctx` extends the fence hook's `ParseCtx` with `default()`,
`following` (the next sibling tokens, for a `<details>` split by blank lines), `parseMarkdown(md)`
and `parseInline(md)`. Return a `Block`, a `Block[]`, or `{ blocks, consumed }` to also swallow
`consumed` following tokens. Returning `null` keeps the default conversion (and its lossy report).

### Wrapper attributes: `BlockSpec.wrapperAttrs(block)`

Returns `data-*` / `aria-*` attributes that the renderer mirrors onto the block wrapper on every
update (a value of `undefined` removes the attribute; reserved core attributes are ignored). Use it
for presentational props (callout color, toggle open state) instead of a custom renderer.

Core also mirrors three built-in block props on any text block: `textAlign`
(`left | center | right | justify`, attribute `data-jul-editor-text-align`), `textColor` and
`backgroundColor` (palette tokens, `data-jul-editor-block-color` / `-block-bg`). Out-of-whitelist
values are dropped by normalization. `toHTML` writes them (`style="text-align:..."` plus the data
attributes) and `fromHTML` reads them back, including Word / Google Docs `text-align`.

### Inline decorations: `editor.setDecorations(key, decorations)`

View-only visuals that never touch the model, history or serialization. An empty list clears a key;
keys are independent.

```ts
editor.setDecorations("search", [
  { blockId, from: 4, to: 9, class: "hit", attrs: { "data-hit": "1" } },        // range highlight
  { blockId, offset: 9, render: () => document.createElement("button") },        // widget
]);
```

Ranges are `<span data-jul-editor-deco>` wrappers (class tokens and `data-*`/`aria-*`/`title`/`role`
attributes only), widgets are non-editable zero-length hosts (`data-jul-editor-widget`). Both are
transparent to selection mapping and to reading the DOM back, a block under IME composition is never
touched (it is decorated after composition ends), and a decorated block is rebuilt from the model
instead of patched in place. Offsets are model offsets (a mention counts as 1), so a host recomputes
its decorations on `editor.on("change")`.

### Font marks

`fontFamily` `{ family }` and `fontSize` `{ size }` are in `coreMarks`. Values are sanitized
(`sanitizeFontFamily`, `sanitizeFontSize`: a single font name, or `<number><px|pt|em|rem|%>`), rendered as
an inline style, written and parsed as `<span style="font-family:..;font-size:..">` in HTML and omitted
from markdown without a lossy report. `editor.commands.toggleMark("fontSize", { size: "14pt" })`.
