"use client";

// @jul-editor/react public surface: the compound `<Editor>` API (PascalCase
// names, no aliases) plus the
// headless hooks. See Editor.tsx/toolbar.tsx/hooks.ts for the pieces; this
// file only assembles them.

export const VERSION = "0.1.0";

export { EditorContent, EditorPlugin } from "./editor.js";
export { EditorView } from "./editor-view.js";
export type { EditorViewProps, ViewRendererProps } from "./editor-view.js";
export { ImageView } from "./blocks/image-view.js";
export { EmbedView } from "./blocks/embed-view.js";
export { createCodeBlockRenderer } from "./blocks/code-block-view.js";
export type { CodeLanguageOption } from "./blocks/code-block-view.js";
export type { EditorProps, EditorContentProps, EditorPluginProps } from "./editor.js";
export type { VoidRendererProps } from "./context.js";
export { EN_LABELS, KO_LABELS, resolveLabels } from "./labels.js";
export type { Labels, Locale } from "./labels.js";
export {
  EditorBold,
  EditorBulletList,
  EditorCode,
  EditorCodeBlock,
  EditorHeading,
  EditorItalic,
  EditorLink,
  EditorOrderedList,
  EditorQuote,
  EditorRedo,
  EditorStrike,
  EditorSubscript,
  EditorSuperscript,
  EditorTodoList,
  EditorToolbar,
  EditorUnderline,
  EditorUndo,
} from "./toolbar.js";
export type { EditorToolbarProps, HeadingButtonProps, ToolbarButtonProps } from "./toolbar.js";
export { useActiveMarks, useBlockType, useCommands, useEditor, useEditorState } from "./hooks.js";
export { createAutosave, isDraftStale, restoreDraft, useAutosave } from "./autosave.js";
export type { AutosaveHandle, AutosaveOptions, AutosaveStatus, DraftRecord, UseAutosaveResult } from "./autosave.js";
export { renderInlineChars, renderPlainContent, toInlineChars } from "./inline-content.js";
export type { InlineChar } from "./inline-content.js";
export { Slot } from "./slot.js";
export { ErrorBoundary } from "./error-boundary.js";
export type { ErrorBoundaryProps } from "./error-boundary.js";
export { useSuggestion, SlashMenu, collectSlashItems, filterSlashItems, mergeSlashItems, MentionMenu, TagMenu, useSelectionRect, BubbleMenu } from "./menus";
export { DragHandle, useDragHandle, useBlockActions, computeDropTarget, dropIndicatorRect, CHILD_OFFSET_PX } from "./drag-handle";
export type {
  DragHandleRenderArgs,
  EditorDragHandleProps,
  DragHandleProps,
  DragIndicatorRect,
  UseDragHandleResult,
  BlockActions,
  BlockMenuEntry,
  DropTarget,
  MoveBlockPlacement,
  RectLike,
} from "./drag-handle";
export {
  useTableState,
  InsertTable,
  AddRowBefore,
  AddRowAfter,
  AddColumnBefore,
  AddColumnAfter,
  DeleteRow,
  DeleteColumn,
  DeleteTable,
  ToggleHeaderRow,
  MergeCells,
  SplitCell,
  MoveRowUp,
  MoveRowDown,
  MoveColumnLeft,
  MoveColumnRight,
  useTableGridPicker,
  useTableHover,
} from "./table";
export type { TableState, InsertTableButtonProps, TableButtonProps, TableGridPicker, TableHoverHandle, TableHoverRect } from "./table";
export type {
  OptionProps,
  SuggestionRange,
  UseSuggestionOptions,
  UseSuggestionResult,
  UseSuggestionSelectCtx,
  SlashMenuProps,
  SlashMenuRenderArgs,
  SlashItem,
  SlashSpec,
  MentionItem,
  MentionMenuProps,
  MentionMenuRenderArgs,
  TagItem,
  TagMenuProps,
  TagMenuRenderArgs,
  BubbleMenuProps,
  BubbleMenuRenderArgs,
} from "./menus";
export { resolveLabel } from "./plugin-menu.js";
export type { BlockMenuPluginItem, LocalizedLabel, TurnIntoPluginItem } from "./plugin-menu.js";
export { useTurnInto, TurnInto } from "./turn-into.js";
export type { TurnIntoItem, UseTurnIntoResult, TurnIntoProps, TurnIntoRenderArgs } from "./turn-into.js";
export { useLinkEditor } from "./use-link-editor.js";
export type { UseLinkEditorResult } from "./use-link-editor.js";
export { useColorPicker } from "./use-color-picker.js";
export type { UseColorPickerOptions, UseColorPickerResult } from "./use-color-picker.js";

import { Editor as EditorBase, EditorContent, EditorPlugin } from "./editor.js";
import { EditorView } from "./editor-view.js";
import { defaultRenderers as embedDefaultRenderers } from "./blocks/embed-view.js";
import { defaultRenderers as imageDefaultRenderers } from "./blocks/image-view.js";
import {
  EditorBold,
  EditorBulletList,
  EditorCode,
  EditorCodeBlock,
  EditorHeading,
  EditorItalic,
  EditorLink,
  EditorOrderedList,
  EditorQuote,
  EditorRedo,
  EditorStrike,
  EditorSubscript,
  EditorSuperscript,
  EditorTodoList,
  EditorToolbar,
  EditorUnderline,
  EditorUndo,
} from "./toolbar.js";
import { BubbleMenu, MentionMenu, SlashMenu, TagMenu } from "./menus";
import { DragHandle } from "./drag-handle";
import { TurnInto } from "./turn-into.js";
import {
  AddColumnAfter,
  AddColumnBefore,
  AddRowAfter,
  AddRowBefore,
  DeleteColumn,
  DeleteRow,
  DeleteTable,
  InsertTable,
  MergeCells,
  MoveColumnLeft,
  MoveColumnRight,
  MoveRowDown,
  MoveRowUp,
  SplitCell,
  ToggleHeaderRow,
} from "./table";

type EditorCompound = typeof EditorBase & {
  Content: typeof EditorContent;
  Plugin: typeof EditorPlugin;
  View: typeof EditorView;
  Toolbar: typeof EditorToolbar;
  SlashMenu: typeof SlashMenu;
  MentionMenu: typeof MentionMenu;
  TagMenu: typeof TagMenu;
  BubbleMenu: typeof BubbleMenu;
  DragHandle: typeof DragHandle;
  TurnInto: typeof TurnInto;
  Bold: typeof EditorBold;
  Italic: typeof EditorItalic;
  Strike: typeof EditorStrike;
  Underline: typeof EditorUnderline;
  Subscript: typeof EditorSubscript;
  Superscript: typeof EditorSuperscript;
  Code: typeof EditorCode;
  Link: typeof EditorLink;
  Heading: typeof EditorHeading;
  BulletList: typeof EditorBulletList;
  OrderedList: typeof EditorOrderedList;
  TodoList: typeof EditorTodoList;
  Quote: typeof EditorQuote;
  CodeBlock: typeof EditorCodeBlock;
  Undo: typeof EditorUndo;
  Redo: typeof EditorRedo;
  InsertTable: typeof InsertTable;
  AddRowBefore: typeof AddRowBefore;
  AddRowAfter: typeof AddRowAfter;
  AddColumnBefore: typeof AddColumnBefore;
  AddColumnAfter: typeof AddColumnAfter;
  DeleteRow: typeof DeleteRow;
  DeleteColumn: typeof DeleteColumn;
  DeleteTable: typeof DeleteTable;
  ToggleHeaderRow: typeof ToggleHeaderRow;
  MergeCells: typeof MergeCells;
  SplitCell: typeof SplitCell;
  MoveRowUp: typeof MoveRowUp;
  MoveRowDown: typeof MoveRowDown;
  MoveColumnLeft: typeof MoveColumnLeft;
  MoveColumnRight: typeof MoveColumnRight;
};

// `<Editor.Toolbar>` etc. and the plain named exports above (EditorToolbar,
// ...) are the SAME component, reached two ways. The statics are attached in
// one pure `Object.assign` expression rather than top-level `Editor.X = ...`
// statements: bundlers must keep property writes as side effects, which
// would drag every toolbar/table/menu component into a bundle that only
// imports a hook. Marked pure, the whole object is dropped unless `Editor`
// itself is imported.
const Editor: EditorCompound = /* @__PURE__ */ Object.assign(EditorBase, {
  Content: EditorContent,
  Plugin: EditorPlugin,
  View: EditorView,
  Toolbar: EditorToolbar,
  Bold: EditorBold,
  Italic: EditorItalic,
  Strike: EditorStrike,
  Underline: EditorUnderline,
  Subscript: EditorSubscript,
  Superscript: EditorSuperscript,
  Code: EditorCode,
  Link: EditorLink,
  Heading: EditorHeading,
  BulletList: EditorBulletList,
  OrderedList: EditorOrderedList,
  TodoList: EditorTodoList,
  Quote: EditorQuote,
  CodeBlock: EditorCodeBlock,
  Undo: EditorUndo,
  Redo: EditorRedo,
  SlashMenu: SlashMenu,
  MentionMenu: MentionMenu,
  TagMenu: TagMenu,
  BubbleMenu: BubbleMenu,
  DragHandle: DragHandle,
  TurnInto: TurnInto,
  InsertTable: InsertTable,
  AddRowBefore: AddRowBefore,
  AddRowAfter: AddRowAfter,
  AddColumnBefore: AddColumnBefore,
  AddColumnAfter: AddColumnAfter,
  DeleteRow: DeleteRow,
  DeleteColumn: DeleteColumn,
  DeleteTable: DeleteTable,
  ToggleHeaderRow: ToggleHeaderRow,
  MergeCells: MergeCells,
  SplitCell: SplitCell,
  MoveRowUp: MoveRowUp,
  MoveRowDown: MoveRowDown,
  MoveColumnLeft: MoveColumnLeft,
  MoveColumnRight: MoveColumnRight,
});

// The package's own bundled void renderers, one object -- every demo
// spreads it as `{...pluginRenderers, ...defaultRenderers}` (see
// e2e/fixtures/src/readme-examples.tsx), so
// `embed` joining `image` here (rather than staying two separately-named
// exports) is what actually makes it show up for existing consumers with no
// wiring change of their own.
export const defaultRenderers: typeof imageDefaultRenderers & typeof embedDefaultRenderers = /* @__PURE__ */ Object.assign({}, imageDefaultRenderers, embedDefaultRenderers);

export { Editor };

export { attachmentBlock, createAttachmentBlock, AttachmentView } from "./blocks/attachment-view.js";

export type { ToolbarClassNames } from "./toolbar.js";
export type { SuggestionMenuClassNames } from "./menus/types.js";
