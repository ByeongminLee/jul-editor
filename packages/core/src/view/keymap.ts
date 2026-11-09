// Keymap extension points (block-specific behavior hooks; the core's own key
// behavior is the lowest-priority default handler). A `Keymap` is a
// combo-string -> handler map; `editor.registerKeymap(keymap, {priority})`
// adds one, `dispatchKeymap` runs (in this order, first handled wins):
//   1. the current block's own `BlockSpec.keymap` (always checked first)
//   2. every registered keymap, highest priority first
// The built-in default keymap is registered by createEditor at the LOWEST
// priority via the exact same `registerKeymap` mechanism (no special path).

import { isText } from "../model/canonical.js";
import { normalizeLinkHref, sanitizeUrl } from "../model/url.js";
import type { Registry } from "../model/schema.js";
import type { Json, Mark } from "../model/types.js";
import { canAdmit, containerInfo, siblingsOf } from "../store/store.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import type { MarksRef } from "./marks.js";
import { toggleMarkOrStore } from "./marks.js";
import type { Dispatch } from "./types.js";

export interface KeymapCtx {
  state: EditorState;
  registry: Registry;
  root: HTMLElement;
  event: KeyboardEvent;
  dispatch: Dispatch;
  marksRef: MarksRef;
  onLinkRequest: (currentHref: string | null) => Promise<string | null>;
}

export type KeymapFn = (ctx: KeymapCtx) => boolean;
export type Keymap = Record<string, KeymapFn>;

export interface KeymapEntry {
  keymap: Keymap;
  priority: number;
}

const MAC_RE = /Mac|iPhone|iPad|iPod/;

/** "'Mod' = Meta on mac, Ctrl elsewhere" -- reads `navigator` by
 * default, injectable for unit tests. */
export function isMac(nav: { platform?: string; userAgent?: string } = typeof navigator !== "undefined" ? navigator : {}): boolean {
  return MAC_RE.test(nav.platform ?? nav.userAgent ?? "");
}

/** Normalizes a KeyboardEvent to a combo string in a fixed Mod-Shift-Alt-key
 * order, e.g. "Mod-b", "Shift-Tab", "Mod-Shift-ArrowUp", "Enter". A
 * single-character key is lowercased so Shift-driven case changes don't
 * create a second combo string for the same physical key; named keys
 * (Enter/Tab/ArrowUp/Backspace/...) keep KeyboardEvent.key's own spelling. */
export function comboFromEvent(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac()): string {
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(key);
  return parts.join("-");
}

/** The `keymap` hook of the BlockSpec for the block containing the current
 * selection (its first block, for a 'block'/'cells' selection) -- cast from
 * its `unknown` model-layer placeholder (model/schema.ts's BlockHooks doc:
 * the view layer owns the concrete shape). */
export function currentBlockKeymap(state: EditorState, registry: Registry): Keymap | undefined {
  const sel = state.selection;
  if (!sel) return undefined;
  const blockId = sel.type === "text" ? sel.anchor.blockId : sel.type === "block" ? sel.ids[0] : sel.tableId;
  if (!blockId) return undefined;
  const rec = state.store.records.get(blockId);
  if (!rec) return undefined;
  return registry.blocks.get(rec.type)?.keymap as Keymap | undefined;
}

/** Runs the block-level keymap first, then every registered entry in
 * descending priority order; the first handler whose combo matches AND
 * returns true wins. Returns whether any handler handled the combo. */
export function dispatchKeymap(combo: string, ctx: KeymapCtx, blockKeymap: Keymap | undefined, entries: KeymapEntry[]): boolean {
  if (blockKeymap?.[combo]?.(ctx)) return true;
  for (const entry of [...entries].sort((a, b) => b.priority - a.priority)) {
    if (entry.keymap[combo]?.(ctx)) return true;
  }
  return false;
}

// ---- default keymap building blocks (shared with block-level overrides) ----

function commit(ctx: KeymapCtx, build: (tx: Transaction) => Transaction): TransactionResult {
  return ctx.dispatch(build);
}

function currentBlockId(ctx: KeymapCtx): string | null {
  const sel = ctx.state.selection;
  if (!sel) return null;
  if (sel.type === "text") return sel.anchor.blockId;
  if (sel.type === "block") return sel.ids[0] ?? null;
  return null;
}

function handleIndent(ctx: KeymapCtx, dir: 1 | -1): boolean {
  const id = currentBlockId(ctx);
  if (!id) return false;
  commit(ctx, (tx) => (dir === 1 ? tx.indent(id) : tx.outdent(id)));
  return true;
}

function handleToggleMark(markType: string, attrs?: Record<string, Json>): KeymapFn {
  return (ctx) => toggleMarkOrStore(ctx.state, ctx.marksRef, ctx.dispatch, markType, attrs, ctx.registry);
}

function handleLink(ctx: KeymapCtx): boolean {
  const sel = ctx.state.selection;
  if (!sel || sel.type !== "text") return false;
  const rec = ctx.state.store.records.get(sel.anchor.blockId);
  const currentHref = (() => {
    const content = rec?.content ?? [];
    for (const inl of content) {
      if (isText(inl)) {
        const link = (inl.marks ?? []).find((m: Mark) => m.type === "link");
        if (link) return String(link.attrs?.href ?? "");
      }
    }
    return null;
  })();
  void ctx.onLinkRequest(currentHref).then((href) => {
    if (href === null) return; // cancelled
    const cleaned = sanitizeUrl(normalizeLinkHref(href), "link"); // every model write of a link href goes through sanitizeUrl
    if (cleaned === null) return; // rejected scheme -- silently drop, same as fromMarkdown/fromHTML's link handling
    commit(ctx, (tx) => tx.toggleMark(sel, "link", { href: cleaned }));
  });
  return true;
}

/** Notion's Mod+Shift+Up/Down: move the current block among its siblings,
 * stepping out to become the parent's own sibling at a boundary. Entering a
 * neighboring sibling's subtree at the boundary (Notion's fuller drop-target
 * behavior) is NOT implemented (swap-with-sibling + step-out-of-
 * parent covers the common case; add drop-into-neighbor if it's ever asked for). */
function handleMove(ctx: KeymapCtx, dir: 1 | -1): boolean {
  const id = currentBlockId(ctx);
  if (!id) return false;
  const store = ctx.state.store;
  const { parentId, siblings, index } = siblingsOf(store, id);
  if (dir === -1 && index > 0) {
    commit(ctx, (tx) => tx.moveBlock(id, parentId, index - 1));
    return true;
  }
  if (dir === 1 && index < siblings.length - 1) {
    commit(ctx, (tx) => tx.moveBlock(id, parentId, index + 1));
    return true;
  }
  if (parentId === null) return true; // already at a top-level boundary: no-op, but handled
  const { parentId: grandParentId, index: parentIndex } = siblingsOf(store, parentId);
  const container = containerInfo(store, grandParentId, ctx.registry);
  const rec = store.records.get(id);
  if (!rec || !canAdmit(ctx.registry, rec.type, container.type, container.children)) return true;
  commit(ctx, (tx) => tx.moveBlock(id, grandParentId, dir === -1 ? parentIndex : parentIndex + 1));
  return true;
}

export function buildDefaultKeymap(): Keymap {
  return {
    Tab: (ctx) => handleIndent(ctx, 1),
    "Shift-Tab": (ctx) => handleIndent(ctx, -1),
    "Mod-b": handleToggleMark("bold"),
    "Mod-i": handleToggleMark("italic"),
    "Mod-u": handleToggleMark("underline"),
    "Mod-e": handleToggleMark("code"),
    "Mod-Shift-x": handleToggleMark("strike"),
    "Mod-k": handleLink,
    "Mod-Shift-ArrowUp": (ctx) => handleMove(ctx, -1),
    "Mod-Shift-ArrowDown": (ctx) => handleMove(ctx, 1),
  };
}
