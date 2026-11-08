// Editing behaviors shared by the container-like text blocks (callout, toggle):
// a markdown-style typed prefix that converts a paragraph, and an Enter key that
// opens the block's body instead of splitting it into a sibling.
import { contentLength, isText, newId } from "@jul-editor/core";
import type { Block, InputRuleEntry, Json, KeymapFn } from "@jul-editor/core";

/** "<prefix> " typed at the start of a block converts the block (first line only, same
 * gate as core's own markerRule) and drops the typed marker. The regex is matched against the
 * line up to the caret, so it must be anchored and end with the trailing space. */
export function prefixRule(match: RegExp, type: string, props?: (m: RegExpMatchArray) => Record<string, Json>): InputRuleEntry {
  return {
    match,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const blockId = sel.anchor.blockId;
      const rec = ctx.state.store.records.get(blockId);
      if (!rec || rec.type === type) return false;
      if (!ctx.registry.blocks.get(rec.type) || ctx.registry.blocks.get(rec.type)!.content !== "inline") return false;
      const text = (rec.content ?? []).map((i) => (isText(i) ? i.text : "\uFFFC")).join("");
      if (text.slice(0, sel.anchor.offset).includes("\n")) return false; // first line only
      const caret = { blockId, offset: 0 };
      ctx.dispatch((tx) => tx.setType(blockId, type, props?.(m)).replaceContent(blockId, 0, m[0].length, []).setSelection({ type: "text", anchor: caret, focus: caret }));
      return true;
    },
  };
}

export interface EnterBodyOptions {
  /** Whether a body (children) is currently visible/accepting. Default: always true. */
  isOpen?(props: Record<string, Json>): boolean;
  /** Extra props patch applied together with the first-child insert (toggle: open the block). */
  openPatch?: Record<string, Json>;
}

/** Enter keymap for a block with its own inline content plus children:
 *  - empty content and no children: converts the block to a plain paragraph ("exit");
 *  - collapsed caret at the end of the content while the body is open (or empty):
 *    inserts an empty paragraph as the FIRST child and moves the caret into it;
 *  - anything else returns false so core's default split-into-sibling runs. */
export function enterOpensBody(opts: EnterBodyOptions = {}): KeymapFn {
  return (ctx) => {
    const sel = ctx.state.selection;
    if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset) return false;
    const id = sel.anchor.blockId;
    const rec = ctx.state.store.records.get(id);
    if (!rec) return false;
    const len = contentLength(rec.content);
    if (len === 0 && rec.childIds.length === 0) {
      ctx.dispatch((tx) => tx.setType(id, "paragraph", {}));
      return true;
    }
    if (sel.anchor.offset !== len) return false;
    const open = opts.isOpen ? opts.isOpen(rec.props) : true;
    if (!open && rec.childIds.length > 0) return false;
    const child: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
    const caret = { blockId: child.id, offset: 0 };
    ctx.dispatch((tx) => {
      let t = tx;
      if (opts.openPatch) t = t.setProps(id, opts.openPatch);
      return t.insertBlock(id, 0, child).setSelection({ type: "text", anchor: caret, focus: caret });
    });
    return true;
  };
}
