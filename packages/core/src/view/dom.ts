// DOM attribute constants + structural guards shared by render/selection/
// interaction.

/** Marks a block's persistent wrapper. Created once per block id, never
 * replaced -- only `data-id`/`data-type` are patched afterwards. */
export const BLOCK_ATTR = "data-jul-editor-block";
export const ID_ATTR = "data-id";
export const TYPE_ATTR = "data-type";
/** Effective heading level for host CSS (1 when the model omits its default). */
export const LEVEL_ATTR = "data-jul-editor-level";
/** A text/code block's editable run container. Re-render targets THIS
 * element's children only -- wrapper/children containers are untouched. */
export const CONTENT_ATTR = "data-jul-editor-content";
/** A block's nested-children container (Notion-style arbitrary nesting). */
export const CHILDREN_ATTR = "data-jul-editor-children";
/** A void block's persistent, contenteditable=false container. Its subtree is
 * owned by `renderVoid` and is excluded from the MutationObserver / all root
 * event handlers. */
export const VOID_ATTR = "data-jul-editor-void";
/** A "decorated" (non-void) block's persistent, contenteditable=false sibling
 * container next to its content div -- e.g. a callout's icon. Owned by
 * the same `renderVoid`-style callback as VOID_ATTR; see view/decorations.ts. */
export const DECORATION_ATTR = "data-jul-editor-decoration";
/** An inline range decoration's wrapper span (view-only, transparent to selection/reading; see
 * view/inline-decorations.ts). */
export const DECORATION_SPAN_ATTR = "data-jul-editor-deco";
/** An inline widget decoration's host: non-editable, zero length for the model and for selection. */
export const WIDGET_ATTR = "data-jul-editor-widget";
/** An editable mention span (NOT contenteditable=false). */
export const MENTION_ATTR = "data-mention";
export const MENTION_KIND_ATTR = "data-mention-kind";
export const MENTION_ID_ATTR = "data-mention-id";
/** The mention's model label, so the DOM reader can diff "what changed"
 * against it without needing the model on hand. */
export const LABEL_ATTR = "data-jul-editor-label";
/** Marks a `<br>` that exists only for empty-block / trailing-newline
 * rendering. DOM readers must ignore it, not treat it as content. */
export const PLACEHOLDER_ATTR = "data-jul-editor-placeholder";
/** Nesting depth (0 = root level), attr-only patch, never triggers a rebuild. */
export const DEPTH_ATTR = "data-jul-editor-depth";
/** 1-based position among a run of consecutive same-parent orderedListItem
 * siblings (resets at a non-orderedListItem break or a new parent) -- attr-only
 * patch (a numbered list renumbers without recreating siblings). */
export const INDEX_ATTR = "data-jul-editor-index";
/** Presence-only marker for a block-type (or cells-type) Selection (T5ab
 * section A). No styles are implied by this attribute ("no styles"). */
export const SELECTED_ATTR = "data-jul-editor-selected";
/** presence-only marker on a text/code block's wrapper whose own
 * content is empty (attr-only, toggled only on an empty<->non-empty
 * transition -- see render.ts's renderBlock). Combined with FOCUSED_ATTR by a
 * host's own CSS to show a placeholder (see PLACEHOLDER_TEXT_ATTR). */
export const EMPTY_ATTR = "data-jul-editor-empty";
/** presence-only marker on the block wrapper containing the current
 * collapsed text caret -- see render.ts's applyFocusedAttr, called from
 * view/index.ts's restoreSelection (every selection change, not just content
 * commits). */
export const FOCUSED_ATTR = "data-jul-editor-focused";
/** the resolved placeholder STRING for a text block's content element
 * (no "jul-editor-" prefix -- read directly by a host's own CSS via
 * `content: attr(data-placeholder)`, not an internal bookkeeping attr). */
export const PLACEHOLDER_TEXT_ATTR = "data-placeholder";
/** Presence-only marker on each tableCell covered by a `cells` Selection's
 * rectangle. No styles implied, same convention as SELECTED_ATTR. */
export const CELL_SELECTED_ATTR = "data-jul-editor-cell-selected";
/** a merged tableCell's own colspan/rowspan (>= 2 -- omitted, same as
 * every other attr-only-when-non-default convention here, when exactly 1).
 * No layout of its own -- a host's CSS decides how to lay out a real grid
 * from these (see the README table recipe). */
export const COLSPAN_ATTR = "data-jul-editor-colspan";
export const ROWSPAN_ATTR = "data-jul-editor-rowspan";

export const MARK_TAG_TO_TYPE: Record<string, string> = {
  STRONG: "bold",
  EM: "italic",
  S: "strike",
  CODE: "code",
  A: "link",
  // underline/subscript/superscript/highlight get real semantic tags
  // in the LIVE EDITING DOM too (not just serde's toHTML output) -- textColor
  // has no such tag of its own and keeps using the generic `span[data-mark]`
  // fallback (inline-dom.ts).
  U: "underline",
  SUB: "subscript",
  SUP: "superscript",
  MARK: "highlight",
};

export const MARK_TYPE_TO_TAG: Record<string, string> = {
  bold: "strong",
  italic: "em",
  strike: "s",
  code: "code",
  link: "a",
  underline: "u",
  subscript: "sub",
  superscript: "sup",
  highlight: "mark",
};

// Every element inside the editor root is one we created ourselves (div/span),
// so treating `Element` as `HTMLElement` here is safe -- narrows the type once
// so callers don't each need their own cast.
function elementOf(node: Node | EventTarget | null): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  if (node instanceof Node) return node.parentElement;
  return null;
}

/** True when `target` is inside (or is) a void block's container, OR a
 * decorated block's non-editable chrome sibling (a code block's language
 * `<select>`/copy `<button>`). Every root event handler
 * (beforeinput/keydown/input/composition events/copy/cut/MutationObserver)
 * must guard on this FIRST: neither a void's own interactive DOM (e.g. an
 * `<input>` inside a chart's CSV editor) nor a decoration's chrome (e.g. that
 * language select) may ever reach our edit pipeline -- Tab/Backspace/typing in
 * either must behave like ordinary DOM, never indent/edit the model. */
export function isInsideVoid(target: Node | EventTarget | null): boolean {
  return !!elementOf(target)?.closest(`[${VOID_ATTR}], [${DECORATION_ATTR}], [${WIDGET_ATTR}]`);
}

/** Like isInsideVoid, but also true when the event's original dispatch path went through a void or
 * decoration container. A framework handler on the void's own container can remove the target
 * (for example an input that unmounts on Enter) before the event reaches the root, leaving a
 * detached target that no longer matches. */
export function isInsideVoidEvent(e: Event): boolean {
  if (isInsideVoid(e.target)) return true;
  return e.composedPath().some((node) => node instanceof Element && node.matches(`[${VOID_ATTR}], [${DECORATION_ATTR}], [${WIDGET_ATTR}]`));
}

function closestWithAttr(node: Node | EventTarget | null, attr: string, root: HTMLElement): HTMLElement | null {
  let el = elementOf(node);
  while (el) {
    if (el.hasAttribute(attr)) return el;
    if (el === root) return null;
    el = el.parentElement;
  }
  return null;
}

export function closestBlockId(node: Node | EventTarget | null, root: HTMLElement): string | null {
  return closestWithAttr(node, BLOCK_ATTR, root)?.getAttribute(ID_ATTR) ?? null;
}

export function closestContentEl(node: Node | EventTarget | null, root: HTMLElement): HTMLElement | null {
  return closestWithAttr(node, CONTENT_ATTR, root);
}

/** Looks up a block's content container by id, without going through the
 * view's internal element cache (selection restore runs from outside render). */
export function findContentEl(root: HTMLElement, blockId: string): HTMLElement | null {
  const wrapper = root.querySelector(`[${BLOCK_ATTR}][${ID_ATTR}="${blockId}"]`);
  return wrapper?.querySelector(`:scope > [${CONTENT_ATTR}]`) ?? null;
}

/** Block-level presentation props (any block with a wrapper), mirrored by render.ts as attrs so a
 * host stylesheet maps them: `textAlign` ("left" | "center" | "right" | "justify"), `textColor`
 * and `backgroundColor` (COLOR_PALETTE tokens). Whitelisted in model/canonical.ts's sanitizeBlockProps. */
export const TEXT_ALIGN_ATTR = "data-jul-editor-text-align";
export const BLOCK_COLOR_ATTR = "data-jul-editor-block-color";
export const BLOCK_BG_ATTR = "data-jul-editor-block-bg";

/** Wrapper attributes owned by core; BlockSpec.wrapperAttrs may not write these. */
export const RESERVED_WRAPPER_ATTRS: ReadonlySet<string> = new Set([
  BLOCK_ATTR, ID_ATTR, TYPE_ATTR, LEVEL_ATTR, DEPTH_ATTR, INDEX_ATTR, SELECTED_ATTR, EMPTY_ATTR, FOCUSED_ATTR, CELL_SELECTED_ATTR, COLSPAN_ATTR, ROWSPAN_ATTR,
  TEXT_ALIGN_ATTR, BLOCK_COLOR_ATTR, BLOCK_BG_ATTR,
]);
