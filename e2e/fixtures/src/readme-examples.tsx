// Every code sample in editor/README.md, kept here so `pnpm typecheck` (which
// typechecks this whole e2e/fixtures/src directory, see tsconfig.json's
// "include": ["src"]) catches a stale example the moment the public API
// changes. Nothing here is routed/rendered by the fixture app itself --
// see main.tsx/app.tsx for the actual routes.
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Doc, Inline, InputRuleEntry, Json, Keymap } from "@jul-editor/core";
import {
  coreBlocks,
  coreInlines,
  coreMarks,
  coreRegistry,
  createEditor,
  createRegistry,
  defineBlock,
  defineInline,
  defineMark,
  newId,
} from "@jul-editor/core";
import { diffDocs, DiffView } from "@jul-editor/plugins/diff";
import { fromHTML, fromMarkdown, toHTML, toMarkdown, toText } from "@jul-editor/core/serde";
import { createLowlightHighlighter, pluginCodeLanguages, pluginRenderers } from "@jul-editor/plugins";
import {
  createCodeBlockRenderer,
  defaultRenderers,
  Editor,
  useAutosave,
  useBlockActions,
  useColorPicker,
  useEditor,
  useLinkEditor,
  useTableGridPicker,
  useTableHover,
  useTableState,
  type VoidRendererProps,
} from "@jul-editor/react";
import { useEffect } from "react";

// ---------------------------------------------------------------------------
// 1. Vanilla: @jul-editor/core with no framework at all.
// ---------------------------------------------------------------------------

function initialDoc(): Doc {
  return { version: 1, blocks: [{ id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text: "Hello, JulEditor." }] }] };
}

export function mountVanillaEditor(element: HTMLElement): () => void {
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: initialDoc() });
  const unsubscribe = editor.on("change", (state) => {
    void state; // e.g. sync editor.getDoc() somewhere
  });
  return () => {
    unsubscribe();
    editor.destroy();
  };
}

// ---------------------------------------------------------------------------
// 2. React compound API: <Editor>, Editor.Toolbar atoms, Editor.Content,
//    SlashMenu/MentionMenu/BubbleMenu/DragHandle, renderers, onUpload,
//    useAutosave.
// ---------------------------------------------------------------------------

function CustomImageRenderer({ block, selected }: VoidRendererProps) {
  return (
    <div data-selected={selected}>
      {String(block.props.alt ?? "image")}
    </div>
  );
}

function AutosaveBadge() {
  // useAutosave reads the nearest <Editor>'s instance via context, so this
  // must render INSIDE <Editor>, same as any other hook from @jul-editor/react.
  const { status, flush } = useAutosave({
    key: "my-doc-1",
    save: async (doc, ctx) => {
      await fetch("/api/docs/1", { method: "PUT", body: JSON.stringify(doc), signal: ctx.signal });
    },
  });
  return (
    <button type="button" onClick={flush}>
      {status}
    </button>
  );
}

export function ReadmeReactExample() {
  return (
    <Editor
      defaultValue={initialDoc()}
      onChange={(doc) => void doc}
      // pluginRenderers wires chart/diagram/dataTable's void blocks (added by
      // @jul-editor/plugins, see below) to their headless React views;
      // defaultRenderers.image is @jul-editor/react's own bundled image view --
      // spread both, then override/add your own last.
      renderers={{ ...pluginRenderers, ...defaultRenderers, image: CustomImageRenderer }}
      // Pasted/dropped image files (and pasted data: images) are uploaded
      // through this hook; the returned string becomes the image block's src.
      onUpload={async (file) => {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        const { url } = (await res.json()) as { url: string };
        return url;
      }}
    >
      <Editor.Toolbar aria-label="Formatting">
        <Editor.Bold />
        <Editor.Italic />
        <Editor.Strike />
        <Editor.Code />
        <Editor.Link />
        <Editor.Heading level={1} />
        <Editor.Heading level={2} />
        <Editor.BulletList />
        <Editor.OrderedList />
        <Editor.TodoList />
        <Editor.Quote />
        <Editor.CodeBlock />
        <Editor.Undo />
        <Editor.Redo />
      </Editor.Toolbar>

      <Editor.Content />

      {/* Notion-style "/" command menu -- headless: you own the markup and
       * positioning (rect is the caret's DOMRect), items come straight off
       * the registry (plus any extraItems, e.g. @jul-editor/plugins' own list). */}
      <Editor.SlashMenu>
        {({ items, activeIndex, rect, getListboxProps, getOptionProps }) => (
          <div {...getListboxProps()} style={rect ? { position: "fixed", left: rect.left, top: rect.bottom } : undefined}>
            {items.map((item, i) => (
              <div key={item.id} {...getOptionProps(i)} data-active={i === activeIndex || undefined}>
                {item.title}
              </div>
            ))}
          </div>
        )}
      </Editor.SlashMenu>

      {/* "@" mention/citation menu -- onSearch is your own async lookup. */}
      <Editor.MentionMenu onSearch={async (query) => [{ id: "u1", label: query || "Ada Lovelace", kind: "user" }]}>
        {({ items, rect, getListboxProps, getOptionProps }) => (
          <div {...getListboxProps()} style={rect ? { position: "fixed", left: rect.left, top: rect.bottom } : undefined}>
            {items.map((item, i) => (
              <div key={item.id} {...getOptionProps(i)}>
                {item.label}
              </div>
            ))}
          </div>
        )}
      </Editor.MentionMenu>

      {/* Floating menu over a real text selection -- reuses the same
       * Toolbar button atoms, just placed near the selection. */}
      <Editor.BubbleMenu>
        {({ rect }) => (
          <div style={{ position: "fixed", left: rect.left, top: rect.bottom }}>
            <Editor.Bold />
            <Editor.Italic />
            <Editor.Link />
          </div>
        )}
      </Editor.BubbleMenu>

      {/* Notion-style block drag handle -- headless drag/keyboard-move state
       * machine; you render the handle icon and drop indicator. */}
      <Editor.DragHandle>
        {({ blockId, rect, dragging, dropIndicatorRect, getHandleProps }) => (
          <>
            {rect && (
              <button type="button" {...getHandleProps()} data-block-id={blockId ?? undefined} style={{ position: "fixed", left: rect.left - 20, top: rect.top }}>
                {dragging ? "dragging" : "drag"}
              </button>
            )}
            {dropIndicatorRect && <div style={{ position: "fixed", ...dropIndicatorRect }} />}
          </>
        )}
      </Editor.DragHandle>

      <AutosaveBadge />
    </Editor>
  );
}

// ---------------------------------------------------------------------------
// 3. Extension guide: defineBlock/defineInline/defineMark.
// ---------------------------------------------------------------------------

// A custom void-adjacent block ("callout"): inline content + a decorated
// (non-editable) icon slot. `decorated` doesn't need to be set explicitly
// here -- passing a `renderers.callout` to <Editor> auto-flags any non-void
// block spec that has one (see Editor.tsx's buildRegistry). The markdown
// form mirrors chart/diagram/dataTable's own fenced convention.
const callout = defineBlock({
  type: "callout",
  content: "inline",
  children: "none",
  props: { emoji: "\u{1F4A1}" },
  toMarkdown(block, ctx) {
    const emoji = String(block.props.emoji ?? "");
    return "```callout\n" + emoji + "\n" + ctx.inlines(block.content) + "\n```";
  },
  toHTML(block, ctx) {
    return `<div data-jul-editor-type="callout">${ctx.escapeText(String(block.props.emoji ?? ""))}${ctx.inlines(block.content)}</div>`;
  },
  toText(block, ctx) {
    return `${String(block.props.emoji ?? "")} ${ctx.inlines(block.content)}`;
  },
  fromMarkdown: {
    fence: "callout",
    parse(token) {
      const nl = token.text.indexOf("\n");
      const emoji = nl === -1 ? token.text : token.text.slice(0, nl);
      const text = nl === -1 ? "" : token.text.slice(nl + 1);
      return { id: newId(), type: "callout", props: { emoji }, content: [{ type: "text", text }] };
    },
  },
  fromHTML: {
    selector: '[data-jul-editor-type="callout"]',
    parse(el) {
      return { id: newId(), type: "callout", props: {}, content: [{ type: "text", text: el.textContent ?? "" }] };
    },
  },
});

// `keymap`/`inputRules` are typed `unknown` on BlockSpec (model/ can't
// reference view/ types without a layering cycle) -- a per-block shortcut is
// attached with a cast after defineBlock, and dispatched before any
// editor-wide registerKeymap entry. For most extensions, editor-wide
// `editor.registerKeymap({...}, { priority })` (see below) is the simpler
// starting point.
(callout as { keymap?: Keymap }).keymap = {
  "Mod-Enter": () => true, // swallow Mod+Enter inside a callout, e.g. instead of exiting it
};

// A custom inline ("hashtag") -- reuses the same markdown-link-as-carrier
// trick @jul-editor/core's own `mention` inline uses.
const hashtag = defineInline({
  type: "hashtag",
  attrs: { tag: "" },
  toMarkdown(inline, ctx) {
    const tag = String((inline as unknown as { attrs: { tag: string } }).attrs.tag);
    return `[#${ctx.escapeText(tag)}](hashtag:${encodeURIComponent(tag)})`;
  },
  toHTML(inline, ctx) {
    const tag = String((inline as unknown as { attrs: { tag: string } }).attrs.tag);
    return `<a data-hashtag="${ctx.escapeAttr(tag)}">#${ctx.escapeText(tag)}</a>`;
  },
  fromMarkdownLink(href): Inline | null {
    if (!href.startsWith("hashtag:")) return null;
    return { type: "hashtag", attrs: { tag: decodeURIComponent(href.slice("hashtag:".length)) } } as unknown as Inline;
  },
});

// A custom mark ("highlight", `==text==`) -- `markdown.parse` registers the
// syntax with fromMarkdown (without it, `==text==` only round-trips one way,
// through toMarkdown; typed text containing literal "==" would come back as
// plain text on the next parse).
const highlight = defineMark({
  type: "highlight",
  markdown: { open: "==", close: "==", parse: { start: "==", tokenizer: /^==([^=\n]+)==/ } },
  html: { tag: "mark" },
});

export const extendedRegistry = createRegistry({
  blocks: [...coreBlocks, callout],
  inlines: [...coreInlines, hashtag],
  marks: [...coreMarks, highlight],
});

// ---------------------------------------------------------------------------
// 4. registerKeymap: the editor-wide extension point (as opposed to a single
//    block's own BlockSpec.keymap above).
// ---------------------------------------------------------------------------

function RegisterCustomShortcut() {
  const editor = useEditor();
  useEffect(() => {
    if (!editor) return;
    return editor.registerKeymap(
      {
        "Mod-Shift-h": (ctx) => {
          ctx.dispatch((tx) => tx.toggleMark(ctx.state.selection!, "highlight"));
          return true;
        },
      },
      { priority: 100 },
    );
  }, [editor]);
  return null;
}

// ---------------------------------------------------------------------------
// 5. Serde: toMarkdown / fromMarkdown / toHTML / fromHTML / toText, lossy.
// ---------------------------------------------------------------------------

export function serdeRoundTrip(doc: Doc): void {
  const { markdown, lossy } = toMarkdown(doc);
  if (lossy.length > 0) {
    // Each entry: { blockId, type, reason } -- something didn't round-trip
    // byte-for-byte (e.g. an unknown block type, or the diagram/codeBlock
    // "mermaid" fence collision documented in the README).
    console.warn("lossy on export:", lossy);
  }
  const back = fromMarkdown(markdown).doc;
  void back;

  const html = toHTML(doc);
  const fromPaste = fromHTML(html).doc;
  void fromPaste;

  const plain = toText(doc);
  void plain;
}

// ---------------------------------------------------------------------------
// 6. Diff: diffDocs (pure, for e.g. a change-summary) + <DiffView> (rendered).
// ---------------------------------------------------------------------------

export function summarizeChange(before: Doc, after: Doc): Json {
  const { stats } = diffDocs(before, after, coreRegistry);
  return { inserted: stats.inserted, deleted: stats.deleted, modified: stats.modified, moved: stats.moved };
}

export function ReadmeDiffExample({ before, after }: { before: Doc; after: Doc }) {
  return <DiffView before={before} after={after} mode="changes" />;
}

// ---------------------------------------------------------------------------
// 7. Marks: force-set color/link via useColorPicker/useLinkEditor (unlike
//    toggleMark, which toggles by TYPE and would just remove an already-set
//    mark instead of updating its color/href).
// ---------------------------------------------------------------------------

export function ColorSwatches() {
  const { palette, recent, current, setTextColor, setHighlight, clear } = useColorPicker();
  return (
    <div>
      {palette.map((color) => (
        <button key={color} type="button" data-active={current.highlight === color || undefined} onClick={() => setHighlight(color)}>
          {color}
        </button>
      ))}
      {recent.length > 0 && <span>recent: {recent.join(", ")}</span>}
      <button type="button" onClick={() => setTextColor("blue")}>Blue text</button>
      <button type="button" onClick={clear}>Clear colors</button>
    </div>
  );
}

export function LinkPopover() {
  const { open, href, rect, apply, remove, close } = useLinkEditor();
  if (!open) return null;
  return (
    <form
      style={rect ? { position: "fixed", left: rect.left, top: rect.bottom } : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        apply((e.currentTarget.elements.namedItem("href") as HTMLInputElement).value);
      }}
    >
      <input name="href" defaultValue={href} />
      <button type="submit">Apply</button>
      <button type="button" onClick={remove}>Remove</button>
      <button type="button" onClick={close}>Cancel</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 8. Rich editing UI: Editor.TurnInto (inside a BubbleMenu) + the drag
//    handle's "+" button (useBlockActions().insertBelowAndOpenSlash).
// ---------------------------------------------------------------------------

export function TurnIntoSelect() {
  return (
    <Editor.BubbleMenu>
      {() => (
        <Editor.TurnInto>
          {({ items, current, turnInto }) => (
            <select
              value={current?.id ?? ""}
              onChange={(e) => {
                const item = items.find((i) => i.id === e.target.value);
                if (item) turnInto(item);
              }}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </Editor.TurnInto>
      )}
    </Editor.BubbleMenu>
  );
}

export function InsertBelowButton({ blockId }: { blockId: string }) {
  const actions = useBlockActions(blockId);
  return (
    <button type="button" onClick={actions.insertBelowAndOpenSlash}>
      +
    </button>
  );
}

// ---------------------------------------------------------------------------
// 9. Placeholder text -- createEditor({ placeholder }), CSS keyed off
//    data-jul-editor-empty/data-jul-editor-focused/data-placeholder.
// ---------------------------------------------------------------------------

export function mountEditorWithPlaceholder(element: HTMLElement): () => void {
  const editor = createEditor({
    element,
    registry: coreRegistry,
    defaultValue: initialDoc(),
    placeholder: (block) => (block.type === "heading" ? "Untitled" : "Type '/' for commands"),
  });
  return () => editor.destroy();
}

// ---------------------------------------------------------------------------
// 10. Code block syntax highlighting: registerHighlighter +
//     createLowlightHighlighter + createCodeBlockRenderer.
// ---------------------------------------------------------------------------

export function HighlighterSetup() {
  const editor = useEditor();
  useEffect(() => editor?.registerHighlighter(createLowlightHighlighter()), [editor]);
  return null;
}

export const ReadmeCodeBlockView = createCodeBlockRenderer({ languages: pluginCodeLanguages });

// ---------------------------------------------------------------------------
// 11. Tables: Transaction methods (via useCommands()/toolbar atoms), the
//     grid-aware useTableState/useTableHover hooks, and the grid picker.
// ---------------------------------------------------------------------------

export function TableGridPickerExample() {
  const picker = useTableGridPicker({ maxRows: 8, maxCols: 8 });
  return (
    <div>
      {Array.from({ length: picker.maxRows }, (_row, row) => (
        <div key={row}>
          {Array.from({ length: picker.maxCols }, (_col, col) => (
            <span key={col} {...picker.getCellProps(row, col)} onClick={() => picker.insert()} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableRowColumnHandles({ tableId }: { tableId: string }) {
  const hover = useTableHover(tableId);
  const state = useTableState();
  return (
    <>
      {state.inTable && hover.rowRect && (
        <button type="button" style={{ position: "fixed", ...hover.rowRect }} onClick={hover.insertRowBelow}>
          +
        </button>
      )}
    </>
  );
}

export function TableToolbar() {
  return (
    <Editor.Toolbar aria-label="Formatting">
      <Editor.InsertTable rows={3} cols={3} />
      <Editor.MergeCells />
      <Editor.SplitCell />
    </Editor.Toolbar>
  );
}

// ---------------------------------------------------------------------------
// 12. Internationalization: <Editor locale>/<Editor labels>.
// ---------------------------------------------------------------------------

export function ReadmeKoreanEditor(props: { doc: Doc }) {
  return (
    <Editor defaultValue={props.doc} locale="ko">
      <Editor.Content />
    </Editor>
  );
}

export function ReadmeLabelOverrideEditor(props: { doc: Doc }) {
  return (
    <Editor defaultValue={props.doc} labels={{ toolbarBold: "Strong" }}>
      <Editor.Toolbar aria-label="Formatting">
        <Editor.Bold />
      </Editor.Toolbar>
      <Editor.Content />
    </Editor>
  );
}

// ---------------------------------------------------------------------------
// 13. Input rules: editor.registerInputRule, incl. the `onEnter` phase.
// ---------------------------------------------------------------------------

export function RegisterCustomInputRule() {
  const editor = useEditor();
  useEffect(() => {
    if (!editor) return;
    const arrowRule: InputRuleEntry = {
      match: /->$/,
      handler(ctx) {
        const sel = ctx.state.selection;
        if (!sel || sel.type !== "text") return false;
        const at = sel.anchor;
        ctx.dispatch((tx) => tx.replaceContent(at.blockId, at.offset - 2, at.offset, [{ type: "text", text: "→" }]));
        return true;
      },
    };
    return editor.registerInputRule(arrowRule);
  }, [editor]);
  return null;
}
