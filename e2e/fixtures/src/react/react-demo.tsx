// "/react" route: the @jul-editor/react compound API driving a real editor,
// with a simple (playground-only -- CSS is allowlisted here, never in
// packages/core or packages/react) skin. Exposes
// window.__julEditorReact = { getDoc, renderCounts, setCaret, setSelection } for
// e2e/react.spec.ts.
import type { Doc, Selection as ModelSelection } from "@jul-editor/core";
import { createLowlightHighlighter, pluginCodeLanguages, pluginRenderers, pluginSlashItems } from "@jul-editor/plugins";
import {
  Editor,
  EmbedView,
  createCodeBlockRenderer,
  useAutosave,
  useBlockActions,
  useColorPicker,
  useEditor,
  useLinkEditor,
  useTableGridPicker,
  useTableHover,
  useTableState,
  type MentionItem,
  type SlashItem,
  type VoidRendererProps,
} from "@jul-editor/react";
import type { ProfilerOnRenderCallback } from "react";
import { Profiler, useCallback, useEffect, useRef } from "react";

// Slash menu/plugins integration: @jul-editor/plugins' chart/dataTable get the SlashMenu's
// richer, real-starter-content treatment (pluginSlashItems' own `create()`,
// per its own header comment: "the slash menu owns the trigger/UI") instead of the
// generic empty-props one the built-in `chart`/`dataTable` slash items would
// otherwise insert. `diagram` is deliberately left out here -- this demo's
// own `diagram` renderer (below) intentionally throws, to exercise the
// per-portal ErrorBoundary test, so offering a working "Diagram" slash item
// pointed at plugins' real DiagramView would be a confusing mismatch.
const PLUGIN_SLASH_ITEMS: SlashItem[] = pluginSlashItems.filter((item) => item.type !== "diagram").map((item) => ({ id: item.type, ...item }));

declare global {
  interface Window {
    __julEditorReact?: {
      getDoc: () => Doc;
      renderCounts: { toolbar: number };
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: ModelSelection | null) => void;
      getSelection: () => ModelSelection | null;
    };
  }
}

function sampleDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "r-p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello from the React demo." }] },
      { id: "r-h1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { id: "r-img1", type: "image", props: { src: "spike.png", alt: "pic" } },
      // An embed block, rendered by @jul-editor/react's own EmbedView
      // (see the `embed: EmbedView` renderer below).
      { id: "r-embed1", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } },
      // A second void block whose renderer intentionally throws, to exercise
      // the per-portal ErrorBoundary: the image renderer above must keep
      // working regardless.
      { id: "r-diagram1", type: "diagram", props: { code: "graph TD; a-->b;" } },
      { id: "r-p2", type: "paragraph", props: {}, content: [] },
      // P2: code block syntax highlighting + language picker + copy button
      // demo -- see CodeHighlighter below (registers @jul-editor/plugins' lowlight
      // adapter) and Editor.CodeBlock's decoration chrome (renderers.codeBlock).
      { id: "r-code1", type: "codeBlock", props: { language: "ts" }, content: [{ type: "text", text: "const greet = (name: string) => `Hello, ${name}!`;" }] },
    ],
  };
}

const codeBlockRenderer = createCodeBlockRenderer({ languages: pluginCodeLanguages });

/** Registers @jul-editor/plugins' lowlight-backed highlighter once the core editor
 * exists -- P2's `editor.registerHighlighter` is a core API, nothing
 * React-specific about it; this is just the effect that calls it once. */
function CodeHighlighter() {
  const editor = useEditor();
  useEffect(() => {
    if (!editor) return;
    return editor.registerHighlighter(createLowlightHighlighter());
  }, [editor]);
  return null;
}

function ImageRenderer({ block, selected }: VoidRendererProps) {
  return (
    <div data-testid="void-image" data-selected={selected} className="jul-editor-react-void-image">
      {String(block.props.alt ?? "image")}
    </div>
  );
}

function BrokenDiagramRenderer(): never {
  throw new Error("[demo] diagram renderer intentionally throws");
}

/** Bridges `window.__julEditorReact` for e2e + counts Toolbar commits via
 * Profiler. Mod+b itself needs no wiring here -- core's own default keymap
 * (view/keymap.ts) already binds it to the same toggleMark("bold") the Bold
 * button calls, so this stays a pure "wraps core" demo, no added shortcut. */
function Bridge({ toolbarCounts }: { toolbarCounts: { toolbar: number } }) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    function focusRoot(): void {
      document.querySelector<HTMLElement>("[data-jul-editor-root]")?.focus();
    }

    window.__julEditorReact = {
      getDoc: () => editor.getDoc(),
      renderCounts: toolbarCounts,
      setCaret: (blockId, offset) => {
        focusRoot();
        const point = { blockId, offset };
        editor.update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
      },
      setSelection: (selection) => {
        focusRoot();
        editor.update((tx) => tx.setSelection(selection));
      },
      getSelection: () => editor.getState().selection,
    };

    return () => {
      delete window.__julEditorReact;
    };
  }, [editor, toolbarCounts]);

  return null;
}

// Notion-style "/" command menu -- consumer-owned markup + positioning
// (rect is the caret's DOMRect; the menu itself has zero styles/positioning
// opinion, per @jul-editor/react's headless rule). Reads the built-in items list
// (paragraph/heading/lists/quote/code/divider/image/table/chart/diagram/
// dataTable, incl. Korean keywords) straight off the registry -- nothing to
// configure here.
function SlashMenuUI() {
  return (
    <Editor.SlashMenu extraItems={PLUGIN_SLASH_ITEMS}>
      {({ items, activeIndex, rect, getListboxProps, getOptionProps }) => (
        <div
          {...getListboxProps()}
          data-testid="slash-menu"
          className="jul-editor-menu"
          style={rect ? { position: "fixed", left: rect.left, top: rect.bottom + 4 } : undefined}
        >
          {items.length === 0 ? (
            <div className="jul-editor-menu-empty">No results</div>
          ) : (
            items.map((item, i) => (
              <div key={item.id} {...getOptionProps(i)} className="jul-editor-menu-item" data-active={i === activeIndex || undefined}>
                {item.title}
              </div>
            ))
          )}
        </div>
      )}
    </Editor.SlashMenu>
  );
}

// '@' mention/citation menu -- mock onSearch with a 200ms artificial
// latency (on top of useSuggestion's own 100ms debounce) so the async-race
// and loading-state behavior is actually exercised, not just theoretical.
// kind starts at "user"; Tab (per useSuggestion's onTab) toggles to "post"
// (project-h.html's citation tag) and re-searches the same query.
const MOCK_USERS = ["김민준", "이서연", "박도윤", "최지우", "정하은"];
const MOCK_POSTS = ["분기 로드맵", "디자인 리뷰 노트", "배포 체크리스트", "성능 회고", "온보딩 가이드"];

async function mockMentionSearch(query: string, kind: "user" | "post"): Promise<MentionItem[]> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const pool = kind === "user" ? MOCK_USERS : MOCK_POSTS;
  return pool
    .filter((name) => !query || name.includes(query))
    .map((label, i) => ({ id: `${kind}-${i}`, label, kind }));
}

function MentionMenuUI() {
  return (
    <Editor.MentionMenu onSearch={mockMentionSearch}>
      {({ items, activeIndex, loading, kind, rect, getListboxProps, getOptionProps }) => (
        <div
          {...getListboxProps()}
          data-testid="mention-menu"
          data-kind={kind}
          className="jul-editor-menu"
          style={rect ? { position: "fixed", left: rect.left, top: rect.bottom + 4 } : undefined}
        >
          {loading && items.length === 0 ? (
            <div className="jul-editor-menu-empty">Loading...</div>
          ) : items.length === 0 ? (
            <div className="jul-editor-menu-empty">No results</div>
          ) : (
            items.map((item, i) => (
              <div key={item.id} {...getOptionProps(i)} className="jul-editor-menu-item" data-kind={item.kind} data-active={i === activeIndex || undefined}>
                {item.label}
              </div>
            ))
          )}
        </div>
      )}
    </Editor.MentionMenu>
  );
}

// Notion's "Turn into" dropdown -- a plain <select> is enough to
// exercise/demo useTurnInto's {items, current, turnInto} surface; no styling
// opinion needed (headless).
function TurnIntoUI() {
  return (
    <Editor.TurnInto>
      {({ items, current, turnInto }) => (
        <select
          data-testid="turn-into-select"
          className="jul-editor-turn-into"
          value={current?.id ?? ""}
          onChange={(e) => {
            const item = items.find((i) => i.id === e.target.value);
            if (item) turnInto(item);
          }}
        >
          <option value="" disabled>
            Turn into...
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      )}
    </Editor.TurnInto>
  );
}

// The color-swatch row a BubbleMenu's color picker button opens.
function ColorPickerUI() {
  const picker = useColorPicker({ recentKey: "jul-editor-react-demo:recent-colors" });
  return (
    <div className="jul-editor-color-picker" data-testid="color-picker">
      {picker.recent.length > 0 && (
        <div className="jul-editor-color-picker-recent" data-testid="color-picker-recent">
          {picker.recent.map((c) => (
            <button key={c} type="button" data-testid={`color-recent-${c}`} onClick={() => picker.setTextColor(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {picker.palette.map((c) => (
        <button key={c} type="button" data-testid={`color-text-${c}`} data-active={picker.current.textColor === c || undefined} onClick={() => picker.setTextColor(c)}>
          A
        </button>
      ))}
      {picker.palette.map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`color-highlight-${c}`}
          data-active={picker.current.highlight === c || undefined}
          onClick={() => picker.setHighlight(c)}
        >
          H
        </button>
      ))}
      <button type="button" data-testid="color-clear" onClick={picker.clear}>
        Clear
      </button>
    </div>
  );
}

// The Mod+K link popover -- replaces core's own window.prompt default
// for as long as this component (and its useLinkEditor()) is mounted. Pinned
// to a fixed corner (not anchored to the selection rect like BubbleMenuUI)
// so the two never overlap and steal each other's clicks.
function LinkEditorUI() {
  const link = useLinkEditor();
  if (!link.open) return null;
  return (
    <form
      data-testid="link-editor"
      className="jul-editor-link-editor"
      style={{ position: "fixed", right: 16, bottom: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("href") as HTMLInputElement;
        link.apply(input.value);
      }}
    >
      <input data-testid="link-editor-input" name="href" defaultValue={link.href} autoFocus />
      <button type="submit" data-testid="link-editor-apply">
        Apply
      </button>
      <button type="button" data-testid="link-editor-remove" onClick={link.remove}>
        Remove
      </button>
      <button type="button" data-testid="link-editor-close" onClick={link.close}>
        Close
      </button>
    </form>
  );
}

// Bubble menu on a real text selection -- reuses the SAME Toolbar
// button atoms (Editor.Bold/Italic/Underline/Link), plus the new TurnInto
// dropdown and color picker, just placed near the selection instead of in a
// fixed toolbar. Nothing new to implement per atom; that's the point of
// "nothing in React adds editing behavior, it only wraps core".
function BubbleMenuUI() {
  return (
    <Editor.BubbleMenu>
      {({ rect }) => (
        // Below the selection (not above, per usual bubble-menu convention)
        // so it never overlaps -- and steals clicks from -- the fixed
        // Toolbar sitting right above the content in this demo's layout.
        <div data-testid="bubble-menu" data-jul-editor-keep-selection="" className="jul-editor-bubble-menu" style={{ position: "fixed", left: rect.left, top: rect.bottom + 8 }}>
          <TurnIntoUI />
          <Editor.Bold />
          <Editor.Italic />
          <Editor.Underline />
          <Editor.Link />
          <ColorPickerUI />
        </div>
      )}
    </Editor.BubbleMenu>
  );
}

// Notion-style drag handle -- @jul-editor/react's Editor.DragHandle is
// headless (tracks hover, computes the drop target/indicator geometry, runs
// the pointer/keyboard drag state machine); this is only the playground's
// own handle icon + drop-indicator line + a tiny actions menu markup/skin.
function BlockActionsMenu({ blockId, rect }: { blockId: string; rect: DOMRect }) {
  const actions = useBlockActions(blockId);
  return (
    <div className="jul-editor-drag-actions" style={{ position: "fixed", left: rect.left, top: rect.bottom + 4 }}>
      <button type="button" data-testid="drag-duplicate" onClick={actions.duplicate}>
        Duplicate
      </button>
      <button type="button" data-testid="drag-delete" onClick={actions.delete}>
        Delete
      </button>
      <button type="button" data-testid="drag-turn-into-heading" onClick={() => actions.turnInto("heading")}>
        Turn into heading
      </button>
      <button type="button" data-testid="drag-insert-slash" onClick={actions.insertBelowAndOpenSlash}>
        +
      </button>
    </div>
  );
}

function DragHandleUI() {
  return (
    <Editor.DragHandle>
      {({ blockId, rect, dragging, dropIndicatorRect, announcement, getHandleProps }) => (
        <>
          {rect && (
            <button
              type="button"
              {...getHandleProps()}
              data-testid="drag-handle"
              data-block-id={blockId ?? undefined}
              data-dragging={dragging || undefined}
              className="jul-editor-drag-handle"
              style={{ position: "fixed", left: rect.left - 22, top: rect.top }}
            >
              ⠿
            </button>
          )}
          {dropIndicatorRect && (
            <div
              data-testid="drop-indicator"
              className="jul-editor-drop-indicator"
              style={{ position: "fixed", left: dropIndicatorRect.left, top: dropIndicatorRect.top, width: dropIndicatorRect.width, height: Math.max(dropIndicatorRect.height, 2) }}
            />
          )}
          {blockId && !dragging && <BlockActionsMenu blockId={blockId} rect={rect!} />}
          <div role="status" aria-live="polite" data-testid="drag-announce" className="jul-editor-sr-only">
            {announcement}
          </div>
        </>
      )}
    </Editor.DragHandle>
  );
}

/** Wires @jul-editor/react's autosave hook into the demo -- a local draft in
 * localStorage plus (here, a no-op logging) periodic "server" save. */
// Notion-style grid picker (hover to size, click to insert) --
// exercises useTableGridPicker for e2e/table.spec.ts's own "grid picker
// inserts a 3x4 table" scenario.
function TableGridPickerUI() {
  const picker = useTableGridPicker({ maxRows: 5, maxCols: 5 });
  return (
    <div data-testid="table-grid-picker" className="jul-editor-grid-picker">
      {Array.from({ length: picker.maxRows }, (_v, row) => (
        <div key={row} className="jul-editor-grid-picker-row">
          {Array.from({ length: picker.maxCols }, (_v2, col) => {
            const { "data-active": active, ...rest } = picker.getCellProps(row, col);
            return (
              <button
                key={col}
                type="button"
                data-testid={`grid-picker-cell-${row}-${col}`}
                data-active={active}
                className="jul-editor-grid-picker-cell"
                onClick={() => picker.insert(row + 1, col + 1)}
                {...rest}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Row/column hover handles for whichever table the current selection
// is in -- exercises useTableHover for e2e/table.spec.ts's own "hover
// handles report row/col" scenario. A real product UI would position these
// over the table itself (via rowRect/colRect); this demo just needs to prove
// the hook reports the right row/col + a live rect once hovered.
function TableHoverUI() {
  const { tableId } = useTableState();
  const hover = useTableHover(tableId);
  if (!tableId) return null;
  return (
    <div data-testid="table-hover-info" className="jul-editor-table-hover">
      <button type="button" data-testid="hover-row-0" onMouseEnter={() => hover.setHoverRow(0)}>
        row 0
      </button>
      <button type="button" data-testid="hover-row-1" onMouseEnter={() => hover.setHoverRow(1)}>
        row 1
      </button>
      <button type="button" data-testid="hover-col-0" onMouseEnter={() => hover.setHoverColumn(0)}>
        col 0
      </button>
      <button type="button" data-testid="hover-col-1" onMouseEnter={() => hover.setHoverColumn(1)}>
        col 1
      </button>
      <span data-testid="hover-row-value">{hover.row ?? ""}</span>
      <span data-testid="hover-col-value">{hover.col ?? ""}</span>
      <span data-testid="hover-row-rect">{hover.rowRect ? "rect" : ""}</span>
    </div>
  );
}

function AutosaveStatus() {
  const { status } = useAutosave({ key: "jul-editor-react-demo-draft", save: async (doc) => void doc });
  return (
    <div data-testid="autosave-status" className="jul-editor-react-autosave">
      {status}
    </div>
  );
}

export function ReactDemo() {
  const toolbarCounts = useRef({ toolbar: 0 }).current;
  const onToolbarRender: ProfilerOnRenderCallback = useCallback(() => {
    toolbarCounts.toolbar += 1;
  }, [toolbarCounts]);

  return (
    <div className="jul-editor-react-demo" data-testid="page-react">
      <Editor
        defaultValue={sampleDoc()}
        // pluginRenderers is typed Record<string, ...> (deliberately, so
        // `{...pluginRenderers, ...yourOwn}` spreads freely for consumers) --
        // noUncheckedIndexedAccess makes a literal-key access on it come back
        // `| undefined` even though we know these two keys exist.
        renderers={{ image: ImageRenderer, embed: EmbedView, chart: pluginRenderers.chart!, dataTable: pluginRenderers.dataTable!, diagram: BrokenDiagramRenderer, codeBlock: codeBlockRenderer }}
      >
        <Profiler id="toolbar" onRender={onToolbarRender}>
          <Editor.Toolbar aria-label="Formatting" className="jul-editor-react-toolbar">
            <Editor.Bold />
            <Editor.Italic />
            <Editor.Strike />
            <Editor.Underline />
            <Editor.Subscript />
            <Editor.Superscript />
            <Editor.Code />
            <Editor.Link />
            <Editor.Heading level={1} />
            <Editor.Heading level={2} />
            <Editor.BulletList />
            <Editor.OrderedList />
            <Editor.TodoList />
            <Editor.Quote />
            <Editor.CodeBlock />
            <Editor.InsertTable data-testid="table-insert" />
            <Editor.AddRowBefore data-testid="table-add-row-before" />
            <Editor.AddRowAfter data-testid="table-add-row-after" />
            <Editor.AddColumnBefore data-testid="table-add-col-before" />
            <Editor.AddColumnAfter data-testid="table-add-col-after" />
            <Editor.DeleteRow data-testid="table-delete-row" />
            <Editor.DeleteColumn data-testid="table-delete-col" />
            <Editor.DeleteTable data-testid="table-delete-table" />
            <Editor.ToggleHeaderRow data-testid="table-toggle-header" />
            <Editor.MergeCells data-testid="table-merge-cells" />
            <Editor.SplitCell data-testid="table-split-cell" />
            <Editor.MoveRowUp data-testid="table-move-row-up" />
            <Editor.MoveRowDown data-testid="table-move-row-down" />
            <Editor.MoveColumnLeft data-testid="table-move-col-left" />
            <Editor.MoveColumnRight data-testid="table-move-col-right" />
            <Editor.Undo />
            <Editor.Redo />
          </Editor.Toolbar>
        </Profiler>
        <Editor.Content className="jul-editor-react-content" />
        <SlashMenuUI />
        <MentionMenuUI />
        <BubbleMenuUI />
        <LinkEditorUI />
        <DragHandleUI />
        <TableGridPickerUI />
        <TableHoverUI />
        <AutosaveStatus />
        <CodeHighlighter />
        <Bridge toolbarCounts={toolbarCounts} />
      </Editor>
    </div>
  );
}
