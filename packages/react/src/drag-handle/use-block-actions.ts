// useBlockActions(blockId) -> {duplicate, delete, turnInto} -- the drag
// handle's own context-menu actions. Every action is a single
// existing core Transaction call, same "nothing in React adds editing
// behavior" rule every other @jul-editor/react hook here follows (hooks.ts/
// toolbar.tsx). Read+write, but the writing is entirely core's own
// insertBlock/removeBlock/setBlockType -- this hook only decides *what*
// block tree to pass them.
import type { Block } from "@jul-editor/core";
import type { Json } from "@jul-editor/core";
import { newId, recordToBlock } from "@jul-editor/core";
import { useCallback, useContext } from "react";
import { LocaleContext, useEditorContext } from "../context.js";
import { useEditor } from "../hooks.js";
import { resolveLabel } from "../plugin-menu.js";

export interface BlockActions {
  /** Inserts a copy of the block (and its whole subtree) right after it,
   * every id in the copy reissued fresh (duplicate reissues ids) so
   * it's a real independent block, not an aliased one. Selects the copy. */
  duplicate(): void;
  /** Removes the block (and its subtree) -- one undo step. */
  delete(): void;
  /** `setBlockType([blockId], type)` -- a no-op if the schema doesn't admit
   * the block's current content/children under the new type (same rule
   * `Transaction.setBlockType` already enforces). */
  turnInto(type: string, props?: Record<string, Json>): void;
  /** Entries contributed by plugins (`<Editor.Plugin blockMenuItems>`) that apply to this block,
   * label already resolved for the current locale. `run()` calls the plugin's handler. */
  menuItems: BlockMenuEntry[];
  /** Inserts an empty paragraph below this block and places its caret at 0.
   * Only typing "/" opens the slash menu; codeBlock remains a no-op. */
  insertBelow(): void;
  /** @deprecated Use insertBelow; kept for existing apps. */
  insertBelowAndOpenSlash(): void;
}

export interface BlockMenuEntry {
  id: string;
  label: string;
  icon?: string;
  run(): void;
}

/** Recursively reissues every id in a Block subtree -- the same shape as
 * clipboard/index.ts's own (module-private) reissueAllIds, just over a
 * single Block instead of a whole Doc; small enough not to warrant exporting
 * that one across packages for reuse. */
function reissueIds(block: Block): Block {
  const next: Block = { ...block, id: newId() };
  if (block.children) next.children = block.children.map(reissueIds);
  return next;
}

export function useBlockActions(blockId: string): BlockActions {
  const editor = useEditor();
  const ctx = useEditorContext("useBlockActions");
  const locale = useContext(LocaleContext);

  const duplicate = useCallback(() => {
    if (!editor) return;
    const { store } = editor.getState();
    const rec = store.records.get(blockId);
    if (!rec) return;
    const copy = reissueIds(recordToBlock(store, blockId));
    const siblings = rec.parentId ? (store.records.get(rec.parentId)?.childIds ?? []) : store.rootIds;
    const index = siblings.indexOf(blockId) + 1;
    editor.update((tx) => tx.insertBlock(rec.parentId, index, copy).setSelection({ type: "block", ids: [copy.id] }));
  }, [editor, blockId]);

  const del = useCallback(() => {
    editor?.update((tx) => tx.removeBlock(blockId));
  }, [editor, blockId]);

  const turnInto = useCallback(
    (type: string, props?: Record<string, Json>) => {
      editor?.update((tx) => tx.setBlockType([blockId], type, props));
    },
    [editor, blockId],
  );

  const insertBelow = useCallback(() => {
    if (!editor) return;
    const { store } = editor.getState();
    const rec = store.records.get(blockId);
    if (!rec || rec.type === "codeBlock") return;
    const siblings = rec.parentId ? (store.records.get(rec.parentId)?.childIds ?? []) : store.rootIds;
    const index = siblings.indexOf(blockId) + 1;
    const newBlock: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
    const caret = { blockId: newBlock.id, offset: 0 };
    editor.update((tx) => tx.insertBlock(rec.parentId, index, newBlock).setSelection({ type: "text", anchor: caret, focus: caret }));
  }, [editor, blockId]);

  const rec = editor?.getState().store.records.get(blockId);
  const block = rec && editor ? recordToBlock(editor.getState().store, blockId) : null;
  const menuItems: BlockMenuEntry[] = [];
  if (editor && block) {
    for (const item of ctx.pluginBlockMenuItems) {
      if (item.isVisible && !item.isVisible(block, ctx.registry)) continue;
      menuItems.push({ id: item.id, label: resolveLabel(item.label, locale), icon: item.icon, run: () => item.run(editor, blockId) });
    }
  }

  return { duplicate, delete: del, turnInto, menuItems, insertBelow, insertBelowAndOpenSlash: insertBelow };
}
