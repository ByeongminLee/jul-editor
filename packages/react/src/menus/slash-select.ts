// What happens when a SlashMenu item is picked ("replaces the
// '/query' range and inserts/converts the block: convert current empty
// block, else insert after; void blocks get a trailing paragraph and block
// selection"). Kept separate from SlashMenu.tsx so it's plain, testable logic
// with no JSX.
import type { Block, Registry } from "@jul-editor/core";
import { buildTableBlock, contentLength, newId, siblingsOf } from "@jul-editor/core";
import type { UseSuggestionSelectCtx } from "./use-suggestion.js";
import type { SlashItem } from "./slash-items.js";

/** A block with no inline/code content slot of its own (image/divider/chart/
 * diagram/dataTable/table) can't hold a text caret -- selecting one of these
 * always inserts (never converts in place, since e.g. `table` also needs
 * tableRow/tableCell children setType can't create) and leaves a trailing
 * empty paragraph + a block-type selection on the new block, same as core's
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

export function selectSlashItem(item: SlashItem, ctx: UseSuggestionSelectCtx, registry: Registry): void {
  const { editor, range } = ctx;
  const state = editor.getState();
  const rec = state.store.records.get(range.blockId);
  if (!rec) return;

  const cursorSlot = hasCursorSlot(registry, item.type);
  // "Convert" only when the '/query' is the block's ENTIRE content (no other
  // text, no children) -- otherwise a slash typed mid-block (or one with
  // existing nested children) always inserts after instead.
  const canConvert = cursorSlot && rec.childIds.length === 0 && range.from === 0 && range.to === contentLength(rec.content);
  const { parentId, index } = siblingsOf(state.store, range.blockId);

  editor.update((tx) => {
    let t = tx.replaceContent(range.blockId, range.from, range.to, []);
    if (canConvert) {
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
    if (item.type === "table") {
      // A table's whole point is to be edited via its cells -- caret in the
      // first cell reads far better than the generic void-block-selection
      // every other cursor-slot-less item gets.
      const firstCellId = block.children![0]!.children![0]!.id;
      const point = { blockId: firstCellId, offset: 0 };
      return t.setSelection({ type: "text", anchor: point, focus: point });
    }
    return t.setSelection({ type: "block", ids: [block.id] });
  });
}
