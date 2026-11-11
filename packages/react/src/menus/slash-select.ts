// What happens when a SlashMenu item is picked ("replaces the
// '/query' range and inserts/converts the block: convert or replace the
// current empty block, else insert after; blocks without a text slot get a
// trailing paragraph that takes the caret"). Kept separate from SlashMenu.tsx so it's plain, testable logic
// with no JSX.
import type { Block, BlockRecord, ChildrenKind, EditorState, Registry } from "@jul-editor/core";
import { admit, buildTableBlock, contentLength, newId, siblingsOf } from "@jul-editor/core";
import type { UseSuggestionSelectCtx } from "./use-suggestion.js";
import type { SlashItem } from "./slash-items.js";

/** A block with no inline/code content slot of its own (image/divider/chart/
 * diagram/dataTable/table) can't hold a text caret -- selecting one of these
 * always inserts (never converts in place, since e.g. `table` also needs
 * tableRow/tableCell children setType can't create) and leaves a trailing
 * empty paragraph holding the caret, same as core's
 * own "doc must not end in a block with no cursor slot" rule
 * (model/canonical.ts's `endsWithoutCursorSlot`). `table` is the one
 * exception (see selectSlashItem below): it gets a real text caret in its
 * own first cell instead, via the SAME `buildTableBlock` that
 * `editor.commands.insertTable` itself builds from. */
function hasCursorSlot(registry: Registry, type: string): boolean {
  const spec = registry.blocks.get(type);
  return spec?.content === "inline" || spec?.content === "code";
}

function buildBlockForItem(registry: Registry, item: SlashItem): Block {
  if (item.create) return item.create();
  if (item.type === "table") return buildTableBlock(3, 3, { headerRow: true });
  const block: Block = { id: newId(), type: item.type, props: item.props ?? {} };
  if (hasCursorSlot(registry, item.type)) block.content = [];
  return block;
}

interface SlashContext {
  rec: BlockRecord;
  parentId: string | null;
  index: number;
  parentType: string | null;
  parentChildren: ChildrenKind;
}

function slashContext(state: EditorState, blockId: string, registry: Registry): SlashContext | null {
  const rec = state.store.records.get(blockId);
  if (!rec) return null;
  const { parentId, index } = siblingsOf(state.store, blockId);
  const parentType = parentId ? state.store.records.get(parentId)?.type ?? null : null;
  const parentChildren: ChildrenKind = parentType ? registry.blocks.get(parentType)?.children ?? "any" : "any";
  return { rec, parentId, index, parentType, parentChildren };
}

function admits(ctx: SlashContext, registry: Registry, type: string): boolean {
  return admit(type, registry.blocks.get(type), ctx.parentType, ctx.parentChildren);
}

/** Whether picking `item` with the caret in `blockId` can actually change
 * the document: the new block (and, for a block without a text slot, its
 * trailing paragraph) must be allowed where it would land. A table cell,
 * for one, admits none of them, so the slash menu shows nothing there. */
export function canInsertSlashItem(item: SlashItem, state: EditorState, blockId: string, registry: Registry): boolean {
  const ctx = slashContext(state, blockId, registry);
  if (!ctx) return false;
  if (registry.blocks.get(ctx.rec.type)?.content === "code") return false;
  if (!admits(ctx, registry, item.type)) return false;
  return hasCursorSlot(registry, item.type) || admits(ctx, registry, "paragraph");
}

export function selectSlashItem(item: SlashItem, ctx: UseSuggestionSelectCtx, registry: Registry): void {
  const { editor, range } = ctx;
  const state = editor.getState();
  const where = slashContext(state, range.blockId, registry);
  if (!where || !canInsertSlashItem(item, state, range.blockId, registry)) return;
  const { rec, parentId, index } = where;

  const cursorSlot = hasCursorSlot(registry, item.type);
  // The '/query' is the block's ENTIRE content (no other text, no children):
  // that block is replaced -- converted in place when the item has a text
  // slot, otherwise swapped for the new block. A slash typed after other
  // text (or in a block with nested children) inserts after instead.
  const wholeBlock = rec.childIds.length === 0 && range.from === 0 && range.to === contentLength(rec.content);

  editor.update((tx) => {
    let t = tx.replaceContent(range.blockId, range.from, range.to, []);
    if (cursorSlot && wholeBlock) {
      t = t.setType(range.blockId, item.type, item.props);
      const point = { blockId: range.blockId, offset: 0 };
      return t.setSelection({ type: "text", anchor: point, focus: point });
    }
    const block = buildBlockForItem(registry, item);
    t = t.insertBlock(parentId, index + 1, block);
    if (cursorSlot) {
      const point = { blockId: block.id, offset: 0 };
      return t.setSelection({ type: "text", anchor: point, focus: point });
    }
    const after: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
    t = t.insertBlock(parentId, index + 2, after);
    // The now-empty '/' line is replaced by the block, not left above it.
    if (wholeBlock) t = t.removeBlock(range.blockId);
    // A table's whole point is to be edited via its cells; everything else
    // without a text slot puts the caret on the line below it (Notion), so
    // the next keystroke types there instead of replacing the new block.
    const caretId = item.type === "table" ? block.children![0]!.children![0]!.id : after.id;
    const point = { blockId: caretId, offset: 0 };
    return t.setSelection({ type: "text", anchor: point, focus: point });
  });
}
