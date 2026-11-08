// Inserting a picked mention ({kind,id,label} with a trailing
// space). `kind: 'post'` is the citation tag, `kind: 'user'` is
// the @-mention -- both are the same `mention` inline (model/types.ts's
// MentionInline), just tagged differently.
import { isText } from "@jul-editor/core";
import type { UseSuggestionSelectCtx } from "./use-suggestion.js";
import type { MentionItem } from "./types.js";

export function selectMentionItem(item: MentionItem, ctx: UseSuggestionSelectCtx): void {
  const { editor, range } = ctx;
  const content = [
    { type: "mention" as const, attrs: { kind: item.kind, id: item.id, label: item.label } },
    { type: "text" as const, text: " " },
  ];
  const caretOffset = range.from + content.reduce((n, inl) => n + (isText(inl) ? inl.text.length : 1), 0);
  const point = { blockId: range.blockId, offset: caretOffset };
  editor.update((tx) => tx.replaceContent(range.blockId, range.from, range.to, content).setSelection({ type: "text", anchor: point, focus: point }));
}
