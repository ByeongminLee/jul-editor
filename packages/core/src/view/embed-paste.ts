// Pasting a bare
// YouTube/Vimeo/X URL into an EMPTY paragraph converts it straight into an
// `embed` block (editorcn/Notion behavior). Split out of view/clipboard.ts
// on purpose -- that file's `onPaste` also has P1's own bare-URL autolink
// check (tryAutolinkPaste, right below this one's call site) touching
// nearly the same lines; keeping this in its own file means the two
// features never collide on the same hunk.
//
// Notion's own paste-to-embed is actually TWO history-visible steps,
// not one -- the paste first inserts the url as ordinary linked text, THEN
// converts that paragraph to the embed, so one undo lands back on "the url
// as a link" and a second undo reaches the original empty paragraph. Two
// separate `runDispatch` calls below give exactly that for free: neither is
// a typing-burst (view/editor.ts's `mergeIntent` is never set for a paste),
// so `dispatch`'s own mergeInfo always reports `mergeable: false` for both,
// meaning each one is its own undo-stack entry with no extra plumbing here.
// Step 2 uses `tx.replaceBlock` (store/ops.ts), not `tx.setType` -- setType's
// opSetType rejects converting to a content:'none' spec (embed) when the
// block still HAS content (the just-inserted link text), by design (a
// guard against silently losing data); replaceBlock has no such guard (its
// whole purpose is this kind of deliberate, explicit-inverse swap) and its
// inverse restores the exact pre-conversion paragraph (link text and all).

import { parseEmbedUrl } from "../model/embed.js";
import { siblingsOf } from "../store/store.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState, Point, Selection } from "../store/types.js";

const BARE_URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const EMBEDDABLE = new Set(["youtube", "vimeo", "x"]);

// Additive extension point (plugins/links): a plugin can register an
// interceptor that sees a bare-URL paste BEFORE the built-in
// youtube/vimeo/x conversion and before the autolink fallback, to offer a
// Notion-style "Link / Bookmark / Embed / Mention" choice. Returning true
// means "handled, stop here"; false falls through to the unchanged built-in
// behavior. With no interceptor registered nothing here changes. The set is
// module-level (like a global paste policy); register returns an unsubscribe.
export interface PasteUrlContext {
  /** The trimmed pasted url, with `https://` prepended for a bare `www.` one. */
  url: string;
  /** Always a collapsed text selection (non-collapsed pastes never reach interceptors). */
  sel: Selection;
  getState: () => EditorState;
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult;
}
export type PasteUrlInterceptor = (ctx: PasteUrlContext) => boolean;
const pasteUrlInterceptors = new Set<PasteUrlInterceptor>();
export function addPasteUrlInterceptor(fn: PasteUrlInterceptor): () => void {
  pasteUrlInterceptors.add(fn);
  return () => {
    pasteUrlInterceptors.delete(fn);
  };
}

export function tryEmbedPaste(
  text: string,
  sel: Selection,
  getState: () => EditorState,
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult,
): boolean {
  const trimmed = text.trim();
  if (!BARE_URL_RE.test(trimmed)) return false;
  if (sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId || sel.anchor.offset !== sel.focus.offset) return false;
  const blockId = sel.anchor.blockId;
  if (pasteUrlInterceptors.size > 0) {
    const iurl = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
    for (const fn of [...pasteUrlInterceptors]) if (fn({ url: iurl, sel, getState, runDispatch })) return true;
  }
  const rec = getState().store.records.get(blockId);
  if (!rec || rec.type !== "paragraph" || (rec.content ?? []).length > 0) return false;
  const url = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  const parsed = parseEmbedUrl(url);
  if (!EMBEDDABLE.has(parsed.provider)) return false;

  const at = sel.anchor;
  const afterLink: Point = { blockId, offset: at.offset + url.length };
  runDispatch((tx) =>
    tx.insertText(at, url, [{ type: "link", attrs: { href: url } }]).setSelection({ type: "text", anchor: afterLink, focus: afterLink }),
  );
  // embed is content:'none'/children:'none' -- a paragraph with nested
  // children can't become one without somewhere for them to go. Move them
  // out as siblings right after this block (in original order) instead of
  // letting replaceBlock silently drop them.
  const childIds = getState().store.records.get(blockId)?.childIds ?? [];
  const { parentId, index } = siblingsOf(getState().store, blockId);
  runDispatch((tx) => {
    let t = tx;
    childIds.forEach((childId, i) => {
      t = t.moveBlock(childId, parentId, index + 1 + i);
    });
    return t
      .replaceBlock(blockId, { id: blockId, type: "embed", props: { provider: parsed.provider, url: parsed.url, id: parsed.id, title: "" }, content: [] })
      .setSelection({ type: "block", ids: [blockId] });
  });
  return true;
}
