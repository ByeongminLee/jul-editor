// Store -> DOM. Wrapper/content/children/void containers are created once per
// block id and never replaced afterwards; re-render targets
// only a text block's `data-jul-editor-content` children, or repositions existing
// wrapper elements inside a `data-jul-editor-children` container.

import { getProp, isText } from "../model/canonical.js";
import { isVoidBlockSpec } from "../model/schema.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline, MentionInline } from "../model/types.js";
import { contentLength, recordToBlock } from "../store/store.js";
import type { Store } from "../store/types.js";
import { ensureDecoration, teardownDecoration } from "./decorations.js";
import { BLOCK_ATTR, BLOCK_BG_ATTR, BLOCK_COLOR_ATTR, CHILDREN_ATTR, COLSPAN_ATTR, CONTENT_ATTR, DEPTH_ATTR, EMPTY_ATTR, FOCUSED_ATTR, ID_ATTR, INDEX_ATTR, LEVEL_ATTR, PLACEHOLDER_TEXT_ATTR, RESERVED_WRAPPER_ATTRS, ROWSPAN_ATTR, TEXT_ALIGN_ATTR, TYPE_ATTR, VOID_ATTR, WIDGET_ATTR } from "./dom.js";
import { applyDecorations } from "./inline-decorations.js";
import type { DecorationSet } from "./inline-decorations.js";
import { buildContentDOM, displayMention, plainTextOf, runKey } from "./inline-dom.js";

export type RenderVoidFn = (block: Block, container: HTMLElement) => (() => void) | void;

export interface BlockEls {
  wrapper: HTMLElement;
  content?: HTMLElement;
  children?: HTMLElement;
  voidEl?: HTMLElement;
  voidDestroy?: () => void;
  /** a non-void block's "decorated" sibling container next to `content`
   * -- see view/decorations.ts. */
  decorationEl?: HTMLElement;
  decorationDestroy?: () => void;
  /** The exact Inline[] reference last rendered into `content` -- identity
   * equality with a BlockRecord's (immutable) content array is a free "this
   * block didn't change" check across an entire commitPatch path-copy tree. */
  lastContent?: Block["content"];
  runNodes?: (Text | HTMLElement)[];
  /** The exact childIds array reference last used to render `children`'s
   * contents -- identity equality is a free "this block's own child LIST
   * didn't change" check, same idea as `lastContent` but for
   * structure (insert/remove/move) instead of text. */
  lastChildIds?: readonly string[];
  /** Attribute names last written from BlockSpec.wrapperAttrs, so a name that
   * disappears from the next result is removed again (core never removes an attr it did not write). */
  wrapperAttrNames?: Set<string>;
  /** The merged decoration list (identity) currently reflected in `content`, and whether
   * decoration DOM (split text nodes, wrapper spans, widgets) is present -- see inline-decorations.ts. */
  decoApplied?: readonly unknown[];
  decoDOM?: boolean;
}

export interface ViewRenderCtx {
  registry: Registry;
  renderVoid?: RenderVoidFn;
  blockEls: Map<string, BlockEls>;
  /** True while `id` is the block actively under IME composition -- render
   * must not touch its DOM at all (it would cancel composition). */
  isComposing(id: string): boolean;
  /** Block ids to force-rebuild this pass, bypassing every "already matches"
   * shortcut -- set by the MutationObserver's structural-mutation revert
   * (index.ts), where the DOM can no longer be trusted. */
  forceIds?: ReadonlySet<string>;
  /** True only during `renderChanged`'s commit-driven partial pass:
   * gates renderBlock's children recursion on `lastChildIds` identity
   * instead of always recursing. Unset/false for a full `renderAll` walk
   * (setDoc/undo-of-large-ops/mutation-revert), which always recurses,
   * matching the original behavior exactly. */
  partial?: boolean;
  /** `store.rootIds` reference as of the last render pass -- lets
   * `renderChanged` detect a root-level structural change (insert/remove/
   * move of a top-level block) the same way `lastChildIds` does for a
   * non-root parent, since the root itself has no block id/BlockEls of its
   * own to hang that field on. */
  lastRootIds?: readonly string[];
  /** a text block's placeholder (Notion-style "Type '/' for commands"),
   * resolved per block when set. Written as `data-placeholder` on the
   * block's own content element -- a host's CSS decides when/how to show it
   * (see EMPTY_ATTR/FOCUSED_ATTR's own doc comments for the recipe). */
  placeholder?: string | ((block: Block) => string);
  /** the id `applyFocusedAttr` last marked FOCUSED_ATTR on (or null) --
   * internal bookkeeping, set only by that function. */
  focusedId?: string | null;
  /** View-only inline decorations (view/inline-decorations.ts), set via View.setDecorations. */
  decorations?: DecorationSet;
}

/** toggles FOCUSED_ATTR off the previously-focused block's wrapper (if
 * any) and onto `focusedId`'s (if any) -- a no-op when unchanged, so this is
 * safe to call on every selection change (view/index.ts's restoreSelection)
 * without ever producing a redundant DOM mutation. */
export function applyFocusedAttr(ctx: ViewRenderCtx, focusedId: string | null): void {
  if (ctx.focusedId === focusedId) return;
  if (ctx.focusedId) ctx.blockEls.get(ctx.focusedId)?.wrapper.removeAttribute(FOCUSED_ATTR);
  if (focusedId) ctx.blockEls.get(focusedId)?.wrapper.setAttribute(FOCUSED_ATTR, "");
  ctx.focusedId = focusedId;
}

function domPlainText(content: HTMLElement): string {
  let out = "";
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR" || el.hasAttribute(WIDGET_ATTR)) return; // placeholder / trailing-newline marker / decoration widget
      for (const c of Array.from(el.childNodes)) walk(c);
    }
  }
  for (const c of Array.from(content.childNodes)) walk(c);
  return out;
}

function rebuildContent(els: BlockEls, inlines: NonNullable<Block["content"]>): void {
  const content = els.content!;
  while (content.firstChild) content.removeChild(content.firstChild);
  const built = buildContentDOM(inlines);
  for (const n of built.nodes) content.appendChild(n);
  els.runNodes = built.runNodes;
}

interface RunGroup {
  key: string;
  start: number;
  end: number; // exclusive
}

/** Consecutive inline entries sharing the same `runKey` (in practice: a run
 * of adjacent plain-text or equally-marked text entries -- `runKey` doesn't
 * encode a text run's own string, only its marks) collapse into one group.
 * `reconcileRunGroups` matches old/new GROUPS instead of old/new
 * INDIVIDUAL entries, so a merge/split entirely within one group (the common
 * "adjacent unmerged plain-text runs" case) never has to
 * touch anything outside that group. */
function groupRuns(inlines: readonly Inline[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (let i = 0; i < inlines.length; i++) {
    const key = runKey(inlines[i]!);
    const prev = groups[groups.length - 1];
    if (prev && prev.key === key && key.startsWith("t:")) prev.end = i + 1;
    else groups.push({ key, start: i, end: i + 1 });
  }
  return groups;
}

/** Minimal-reconciliation fallback for when `sameShape` fails only because
 * the RUN COUNT changed (e.g. several adjacent plain-text
 * runs coalescing on a block's first edit) -- reuses each group's own first
 * DOM node (patching its text to the whole group's concatenated content,
 * dropping any now-extra old nodes the group used to span) instead of
 * rebuilding the block's entire content div, so an untouched MARKED run
 * elsewhere never loses its node identity. Bails out (returns false, caller
 * falls through to a full rebuild) the moment old/new groups don't line up
 * key-for-key -- a genuine insert/delete/reorder of a non-text run, which
 * this simple positional walk doesn't attempt to diff further. */
function reconcileRunGroups(els: BlockEls, oldInlines: NonNullable<Block["content"]>, inlines: NonNullable<Block["content"]>): boolean {
  const oldNodes = els.runNodes;
  if (!oldNodes) return false;
  const oldGroups = groupRuns(oldInlines);
  const newGroups = groupRuns(inlines);
  if (oldGroups.length !== newGroups.length) return false;

  const newRunNodes: (Text | HTMLElement)[] = new Array(inlines.length);
  for (let g = 0; g < oldGroups.length; g++) {
    const og = oldGroups[g]!;
    const ng = newGroups[g]!;
    if (og.key !== ng.key) return false;
    const node = oldNodes[og.start];
    if (!node) return false;

    if (og.key.startsWith("t:")) {
      if (node.nodeType !== Node.TEXT_NODE) return false;
      const text = inlines
        .slice(ng.start, ng.end)
        .map((inl) => (isText(inl) ? inl.text : ""))
        .join("");
      if ((node as Text).data !== text) (node as Text).data = text;
      for (let k = og.start + 1; k < og.end; k++) oldNodes[k]?.parentNode?.removeChild(oldNodes[k]!);
    } else {
      // Atomic (mention/generic) runs are always size-1 groups on both sides.
      if (ng.end - ng.start !== 1 || og.end - og.start !== 1) return false;
      const inl = inlines[ng.start]!;
      if (inl.type === "mention" && node instanceof HTMLElement) {
        const label = displayMention(inl as MentionInline);
        if (node.textContent !== label) node.textContent = label;
      }
    }
    for (let n = ng.start; n < ng.end; n++) newRunNodes[n] = node;
  }
  els.runNodes = newRunNodes;
  return true;
}

/** if DOM text equals model no-op; if run structure is the same, patch text
 * nodes in place; else rebuild the content div's children.
 * `force` bypasses every shortcut and always rebuilds -- used by the
 * MutationObserver's structural-mutation revert, where the DOM (and anything
 * `els.runNodes` points at) can no longer be trusted at all. */
function patchContent(els: BlockEls, inlines: NonNullable<Block["content"]>, skipDom: boolean, force = false): void {
  if (force) {
    rebuildContent(els, inlines);
    els.lastContent = inlines;
    return;
  }
  if (els.lastContent === inlines) return; // identity fast path
  if (skipDom) {
    els.lastContent = inlines; // composing: model already reflects the DOM we must not touch
    return;
  }
  if (!els.runNodes) {
    // First render of this content div: it's a bare empty <div>, not yet
    // carrying even the empty-content placeholder <br> -- the domText/
    // modelText "already matches" shortcut below is only valid once the DOM
    // has actually been built at least once.
    rebuildContent(els, inlines);
    els.lastContent = inlines;
    return;
  }
  const content = els.content!;
  const oldInlines = els.lastContent;
  const domText = domPlainText(content);
  const modelText = plainTextOf(inlines);
  // Every shortcut below writes through (or trusts) `els.runNodes`, so first
  // check they still ARE the DOM: one live node per old run, and together they
  // account for all of the content's text. A composition (skipDom above only
  // records lastContent) can leave them stale -- in an empty block the browser
  // swaps the placeholder <br> for its own, never-registered text node -- and
  // a stray browser-created text node can sit next to them. Untrusted -> rebuild.
  const runNodes = els.runNodes;
  const trusted =
    !!oldInlines &&
    runNodes.length === oldInlines.length &&
    runNodes.every((n) => !!n && content.contains(n)) &&
    runNodes.map((n) => (n.nodeType === Node.TEXT_NODE ? (n as Text).data : (n.textContent ?? ""))).join("") === domText;
  if (!trusted) {
    rebuildContent(els, inlines);
    els.lastContent = inlines;
    return;
  }
  // Same PLAIN TEXT plus the same run keys still isn't "the DOM already
  // matches": a toggleMark that only MOVES a run boundary (bold extended over
  // the text before it, undo/redo of that) keeps both identical while
  // changing which characters each run holds. Compare each run's own DOM text
  // against the new model run too.
  const sameRunShape = oldInlines.length === inlines.length && oldInlines.every((o, i) => runKey(o) === runKey(inlines[i]!));
  const runTextMatches = sameRunShape && inlines.every((inl, i) => !isText(inl) || (runNodes[i] as Text).data === inl.text);
  if (domText === modelText && runTextMatches) {
    els.lastContent = inlines; // DOM already matches (typical absorb-echo case)
    return;
  }
  // A trailing '\n' needs an extra placeholder <br> after it -- if
  // whether the text ends in '\n' just changed, the in-place nodeValue patch
  // below can't add/remove that <br>, so a same-run-shape update alone isn't
  // enough here; fall through to a full rebuild instead. Found via e2e: a
  // codeBlock's own Enter handler (view/builtins-keymap.ts) inserting a
  // literal '\n' at the end of its text left the (missing) trailing <br>
  // unhandled, and the next character then measured as landing BEFORE the
  // '\n' instead of after it.
  const sameEndsWithNewline = !!oldInlines && plainTextOf(oldInlines).endsWith("\n") === modelText.endsWith("\n");
  const sameShape = sameRunShape && sameEndsWithNewline;
  if (sameShape) {
    // in place: each run's own (trusted, see above) node gets its new text --
    // also correct for a boundary-only shift, since every run keeps its marks.
    for (let i = 0; i < inlines.length; i++) {
      const inl = inlines[i]!;
      const node = runNodes[i]!;
      if (isText(inl) && node.nodeType === Node.TEXT_NODE) {
        if ((node as Text).data !== inl.text) (node as Text).data = inl.text;
      } else if (inl.type === "mention" && node instanceof HTMLElement) {
        const label = displayMention(inl as MentionInline);
        if (node.textContent !== label) node.textContent = label;
      }
    }
    els.lastContent = inlines;
    return;
  }
  // run COUNT changed (the only reason sameShape just failed, given
  // sameEndsWithNewline held) -- try the cheaper group-level reconciliation
  // before paying for a full rebuild.
  if (sameEndsWithNewline && reconcileRunGroups(els, oldInlines, inlines)) {
    els.lastContent = inlines;
    return;
  }
  rebuildContent(els, inlines);
  els.lastContent = inlines;
}

const WRAPPER_ATTR_NAME = /^(data|aria)-[a-z0-9-]+$/;

/** Mirrors BlockSpec.wrapperAttrs plus the core block-style props (textAlign, textColor,
 * backgroundColor) onto the wrapper. Attribute-only: the MutationObserver watches childList and
 * characterData, so this never triggers a structural revert. A no-op write is skipped. */
function syncWrapperAttrs(els: BlockEls, spec: ReturnType<Registry["blocks"]["get"]>, store: Store, id: string, props: Record<string, unknown>): void {
  const next: Record<string, string> = {};
  const align = props.textAlign;
  if (typeof align === "string" && align !== "left") next[TEXT_ALIGN_ATTR] = align;
  if (typeof props.textColor === "string" && props.textColor !== "default") next[BLOCK_COLOR_ATTR] = props.textColor;
  if (typeof props.backgroundColor === "string" && props.backgroundColor !== "default") next[BLOCK_BG_ATTR] = props.backgroundColor;
  if (spec?.wrapperAttrs) {
    let custom: Record<string, string | undefined>;
    try {
      custom = spec.wrapperAttrs(recordToBlock(store, id));
    } catch {
      custom = {}; // a plugin bug must not break rendering
    }
    for (const [name, value] of Object.entries(custom)) {
      if (value === undefined || !WRAPPER_ATTR_NAME.test(name) || RESERVED_WRAPPER_ATTRS.has(name)) continue;
      next[name] = String(value);
    }
  }
  const prev = els.wrapperAttrNames;
  if (prev) for (const name of prev) if (!(name in next)) els.wrapper.removeAttribute(name);
  for (const [name, value] of Object.entries(next)) if (els.wrapper.getAttribute(name) !== value) els.wrapper.setAttribute(name, value);
  els.wrapperAttrNames = Object.keys(next).length ? new Set(Object.keys(next)) : undefined;
}

export function isVoidSpec(spec: ReturnType<Registry["blocks"]["get"]>): boolean {
  // An unknown type (not in the registry at all) also renders as an opaque
  // void placeholder -- isVoidBlockSpec (model/schema.ts, shared with
  // @jul-editor/react's DiffView) only covers a KNOWN spec's own
  // content/children shape, so that case is OR'd in here on top.
  return !spec || isVoidBlockSpec(spec);
}

export function renderBlock(id: string, store: Store, ctx: ViewRenderCtx, seen: Set<string>, depth = 0): BlockEls {
  seen.add(id);
  const rec = store.records.get(id)!;
  const spec = ctx.registry.blocks.get(rec.type);
  let els = ctx.blockEls.get(id);
  if (!els) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(BLOCK_ATTR, "");
    els = { wrapper };
    ctx.blockEls.set(id, els);
  }
  // renderChildren (the caller) only sets DEPTH_ATTR to this pass's
  // `depth` AFTER renderBlock returns -- so whatever's on the wrapper right
  // now is still last pass's depth. A mismatch means this block itself moved
  // to a different depth (e.g. it got indented); its own childIds array
  // reference is untouched by that move, so the ordinary `lastChildIds`
  // partial-recursion gate below would otherwise skip walking its
  // descendants and leave their data-jul-editor-depth stale.
  const prevDepthAttr = els.wrapper.getAttribute(DEPTH_ATTR);
  const depthChanged = prevDepthAttr !== null && Number(prevDepthAttr) !== depth;
  els.wrapper.setAttribute(ID_ATTR, id);
  els.wrapper.setAttribute(TYPE_ATTR, rec.type);
  if (rec.type === "heading") {
    const level = String(getProp<number>({ id, type: rec.type, props: rec.props }, "level", ctx.registry) ?? 1);
    if (els.wrapper.getAttribute(LEVEL_ATTR) !== level) els.wrapper.setAttribute(LEVEL_ATTR, level);
  } else if (els.wrapper.hasAttribute(LEVEL_ATTR)) {
    els.wrapper.removeAttribute(LEVEL_ATTR);
  }

  // a merged tableCell's own colspan/rowspan (>= 2 -- omitted
  // otherwise, same convention as every other attr-only-when-non-default
  // attribute here). A host's CSS lays these out (see the README recipe);
  // this file never sets a layout style of its own (rootStyle.ts is the one
  // allowlisted exception, and this isn't it).
  if (rec.type === "tableCell") {
    const colspan = getProp<number>({ id: rec.id, type: rec.type, props: rec.props }, "colspan", ctx.registry) ?? 1;
    const rowspan = getProp<number>({ id: rec.id, type: rec.type, props: rec.props }, "rowspan", ctx.registry) ?? 1;
    if (colspan > 1) els.wrapper.setAttribute(COLSPAN_ATTR, String(colspan));
    else els.wrapper.removeAttribute(COLSPAN_ATTR);
    if (rowspan > 1) els.wrapper.setAttribute(ROWSPAN_ATTR, String(rowspan));
    else els.wrapper.removeAttribute(ROWSPAN_ATTR);
  }

  syncWrapperAttrs(els, spec, store, id, rec.props);

  if (isVoidSpec(spec)) {
    // this block used to be a text/container block (its type just
    // flipped, e.g. a "---" input rule turning a paragraph into a divider) --
    // tear down the stale content/children containers a text block leaves
    // behind, or a click into that stale content div would go on storing
    // typed text on a block whose schema has nowhere to render it.
    if (els.content) {
      els.content.remove();
      els.content = undefined;
      els.lastContent = undefined;
      els.runNodes = undefined;
      els.decoDOM = false;
      els.decoApplied = undefined;
    }
    if (els.children) {
      els.children.remove();
      els.children = undefined;
      els.lastChildIds = undefined;
    }
    teardownDecoration(els);
    // a void has no empty/non-empty TEXT state of its own -- an empty
    // paragraph converted to e.g. a divider must drop the stale attribute
    // its old content div left on the wrapper (this branch returns before
    // the ordinary EMPTY_ATTR toggle below ever runs again).
    els.wrapper.removeAttribute(EMPTY_ATTR);
    if (!els.voidEl) {
      const voidEl = document.createElement("div");
      voidEl.setAttribute(VOID_ATTR, "");
      voidEl.setAttribute("contenteditable", "false");
      els.wrapper.appendChild(voidEl);
      els.voidEl = voidEl;
      els.voidDestroy = ctx.renderVoid?.(recordToBlock(store, id), voidEl) ?? undefined;
    }
    return els; // renderVoid owns everything inside voidEl from here on
  }

  // the reverse transition -- this block used to be void (its own
  // persistent voidEl/voidDestroy from a previous render) but its type just
  // flipped to a text/container block (e.g. undo of the "---" conversion
  // above). Tear the void container down before building the content/children
  // containers below, so undo never leaves a stale [data-jul-editor-void] sitting
  // inside the restored block.
  if (els.voidEl) {
    els.voidDestroy?.();
    els.voidEl.remove();
    els.voidEl = undefined;
    els.voidDestroy = undefined;
  }

  if (spec!.content === "inline" || spec!.content === "code") {
    if (!els.content) {
      const content = document.createElement("div");
      content.setAttribute(CONTENT_ATTR, "");
      els.wrapper.appendChild(content);
      els.content = content;
    }
    const composing = ctx.isComposing(id);
    const inlines = rec.content ?? [];
    const decos = ctx.decorations?.forBlock(id);
    const decoDirty = !composing && els.decoApplied !== decos;
    const contentChanged = els.lastContent !== inlines || !!ctx.forceIds?.has(id);
    // A decorated content div is never patched in place (its text nodes are split, `runNodes` would
    // point at fragments): rebuild the pristine DOM from the model first, then re-apply.
    const rebuild = !composing && !!els.decoDOM && (decoDirty || contentChanged);
    patchContent(els, inlines, composing, rebuild || ctx.forceIds?.has(id));
    if (rebuild) els.decoDOM = false;
    if (decos && !composing && (decoDirty || (contentChanged && !els.decoDOM))) {
      applyDecorations(els.content!, inlines, decos);
      els.decoDOM = true;
    }
    if (!composing) els.decoApplied = decos;
    // EMPTY_ATTR only toggles on an actual empty<->non-empty
    // transition (guarded by the current attribute presence) -- an ordinary
    // keystroke in an already non-empty block never touches this attribute,
    // keeping the perf MutationObserver-scope budget untouched.
    const isEmpty = contentLength(rec.content) === 0;
    if (isEmpty !== els.wrapper.hasAttribute(EMPTY_ATTR)) {
      if (isEmpty) els.wrapper.setAttribute(EMPTY_ATTR, "");
      else els.wrapper.removeAttribute(EMPTY_ATTR);
    }
    if (ctx.placeholder) {
      const text = typeof ctx.placeholder === "function" ? ctx.placeholder(recordToBlock(store, id)) : ctx.placeholder;
      if (els.content!.getAttribute(PLACEHOLDER_TEXT_ATTR) !== text) els.content!.setAttribute(PLACEHOLDER_TEXT_ATTR, text);
    }
  } else if (els.content) {
    els.content.remove();
    els.content = undefined;
    els.lastContent = undefined;
    els.decoDOM = false;
    els.decoApplied = undefined;
  }

  // A non-void block can have editable content, children, or both. Give any
  // decorated one a renderer slot; the void path above owns its full subtree.
  if (spec!.decorated) ensureDecoration(els, recordToBlock(store, id), ctx.renderVoid);
  else if (els.decorationEl) teardownDecoration(els);

  if (spec!.children !== "none") {
    if (!els.children) {
      const childrenEl = document.createElement("div");
      childrenEl.setAttribute(CHILDREN_ATTR, "");
      els.wrapper.appendChild(childrenEl);
      els.children = childrenEl;
    }
    // during a partial (changedIds-driven) render, an unchanged
    // childIds reference means this commit didn't touch this block's own
    // child list at all -- skip the walk instead of re-visiting every
    // descendant. A full renderAll (ctx.partial unset) always recurses,
    // identical to the previous behavior.
    if (!ctx.partial || els.lastChildIds !== rec.childIds || depthChanged) {
      renderChildren(els.children, rec.childIds, store, ctx, seen, depth + 1);
      els.lastChildIds = rec.childIds;
    }
  } else if (els.children) {
    els.children.remove();
    els.children = undefined;
    els.lastChildIds = undefined;
  }
  return els;
}

/** Reconciles `container`'s DOM children to match `ids` in order, reusing
 * each block's persistent wrapper element (created or moved, never recreated).
 * `data-jul-editor-depth` and (for orderedListItem runs) `data-jul-editor-index` are
 * patched as plain attributes every pass -- never a reason to rebuild/recreate
 * a sibling's DOM. */
export function renderChildren(container: HTMLElement, ids: string[], store: Store, ctx: ViewRenderCtx, seen: Set<string>, depth = 0): void {
  let olIndex = 0;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!;
    const rec = store.records.get(id)!;
    olIndex = rec.type === "orderedListItem" ? olIndex + 1 : 0;
    const els = renderBlock(id, store, ctx, seen, depth);
    els.wrapper.setAttribute(DEPTH_ATTR, String(depth));
    if (rec.type === "orderedListItem") els.wrapper.setAttribute(INDEX_ATTR, String(olIndex));
    else els.wrapper.removeAttribute(INDEX_ATTR);
    const current = container.children[index] ?? null;
    if (current !== els.wrapper) container.insertBefore(els.wrapper, current);
  }
  while (container.children.length > ids.length) container.children[ids.length]!.remove();
}

export function renderAll(root: HTMLElement, store: Store, ctx: ViewRenderCtx): void {
  const seen = new Set<string>();
  renderChildren(root, store.rootIds, store, ctx, seen, 0);
  // deleting the CURRENT entry mid-iteration is well-defined for a Map
  // iterator (ECMA-262 spec: already-visited/current entries are never
  // revisited) -- no need to spread the whole map into an array first just
  // to iterate it safely.
  for (const [id, els] of ctx.blockEls) {
    if (!seen.has(id)) {
      els.voidDestroy?.();
      els.decorationDestroy?.();
      els.wrapper.remove();
      ctx.blockEls.delete(id);
    }
  }
  ctx.lastRootIds = store.rootIds;
}

/** Partial, commit-driven render: visits only `changedIds` --
 * exactly what store/store.ts's commitPatch returns, the touched block(s)
 * plus their full ancestor chain -- instead of walking the whole document on
 * every keystroke (the old `renderAll` on every commit). A structurally
 * changed parent (its own childIds array got a new reference: insert/
 * remove/move) gets its full child list reflowed via the ordinary
 * `renderChildren` -- order/depth/(ordered-list) index attrs, same as
 * before -- but an unaffected sibling's own subtree is never walked at all,
 * since `renderBlock`'s children branch (above) now skips recursing into an
 * unchanged childIds reference whenever `ctx.partial` is set.
 *
 * Root-level structural changes (insert/remove/move of a top-level block)
 * have no block id of their own to carry a "did this change" flag, so
 * they're detected via `ctx.lastRootIds` instead, exactly mirroring
 * `BlockEls.lastChildIds` for every other parent.
 *
 * An id present in `changedIds` but no longer in `store.records` was
 * deleted this commit (commitPatch adds every removed id too) -- its
 * wrapper (and any void renderer) is torn down directly; a still-live
 * sibling list's own length/order was already fixed by whichever parent's
 * structural reflow ran above. */
export function renderChanged(root: HTMLElement, store: Store, ctx: ViewRenderCtx, changedIds: ReadonlySet<string>): void {
  ctx.partial = true;
  const seen = new Set<string>(); // scoped to this pass only; renderAll owns the real prune-by-`seen` sweep
  if (ctx.lastRootIds !== store.rootIds) {
    renderChildren(root, store.rootIds, store, ctx, seen, 0);
    ctx.lastRootIds = store.rootIds;
  }
  for (const id of changedIds) {
    if (!store.records.has(id)) continue; // deleted -- handled by the sweep below
    const els = ctx.blockEls.get(id);
    if (!els) continue; // brand-new id: built by an ancestor's structural reflow (root, above, or another changedIds entry this same pass)
    const depth = Number(els.wrapper.getAttribute(DEPTH_ATTR) ?? "0");
    // a sibling list's own data-jul-editor-index (orderedListItem numbering)
    // is only assigned by renderChildren's own walk -- a plain renderBlock
    // never touches it. A block whose type just entered/left
    // "orderedListItem" (read off the wrapper's OWN attr, still last pass's
    // value at this point -- same trick as `depth` above) changes every
    // FOLLOWING sibling's number, not just its own, so reflow the whole
    // sibling list here instead of only re-rendering this one block.
    const prevType = els.wrapper.getAttribute(TYPE_ATTR);
    const rec = store.records.get(id)!;
    const listTransition = prevType !== null && prevType !== rec.type && (prevType === "orderedListItem" || rec.type === "orderedListItem");
    if (listTransition) {
      const parentId = rec.parentId;
      const siblingIds = parentId === null ? store.rootIds : (store.records.get(parentId)?.childIds ?? []);
      const container = parentId === null ? root : ctx.blockEls.get(parentId)?.children;
      if (container) {
        renderChildren(container, siblingIds, store, ctx, seen, depth);
        continue;
      }
    }
    renderBlock(id, store, ctx, seen, depth);
  }
  for (const id of changedIds) {
    if (store.records.has(id)) continue;
    const els = ctx.blockEls.get(id);
    if (!els) continue;
    els.voidDestroy?.();
    els.decorationDestroy?.();
    els.wrapper.remove();
    ctx.blockEls.delete(id);
  }
  ctx.partial = false;
}
