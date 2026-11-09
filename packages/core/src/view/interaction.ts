// beforeinput/keydown/composition* handlers + MutationObserver guard
// (selection union + full editing surface).

import { encodeClipboard } from "../clipboard";
import { isText } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";
import { canAdmit, containerInfo, contentLength, orderPoints, extractFragment, nextBlockInPreOrder, prevBlockInPreOrder, siblingsOf, spannedTopBlocks } from "../store/store.js";
import { cellIdAt } from "../store/table.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState, Point, Selection, Store } from "../store/types.js";
import { BLOCK_ATTR, closestBlockId, CONTENT_ATTR, DECORATION_ATTR, ID_ATTR, isInsideVoid, isInsideVoidEvent } from "./dom.js";
import { syncBlockFromDOM } from "./ime.js";
import type { ComposeRef } from "./ime.js";
import { buildDefaultInputRules, clearCodeBlockLangGrab, currentBlockInputRules, runInputRules } from "./input-rules.js";
import type { InputRuleEntry } from "./input-rules.js";
import { comboFromEvent, currentBlockKeymap, dispatchKeymap } from "./keymap.js";
import type { KeymapCtx, KeymapEntry } from "./keymap.js";
import { consumeInsertMarks } from "./marks.js";
import type { MarksRef } from "./marks.js";
import { isVoidSpec } from "./render.js";
import type { BlockEls } from "./render.js";
import { pointFromDOM, promoteSelection, readDOMSelection } from "./selection.js";
import type { SuggestionController } from "./suggestion.js";

/** Extension-point state, owned by createEditor and shared with this
 * view's interaction layer (a bare createView gets an empty/no-op set --
 * these are "extension points on the core EDITOR"). */
export interface Extensions {
  keymaps: KeymapEntry[];
  inputRules: InputRuleEntry[];
  suggestions: SuggestionController;
  marksRef: MarksRef;
  onLinkRequest: (currentHref: string | null) => Promise<string | null>;
  /** a one-shot signal this interaction layer sets to `true` immediately
   * before a dispatch that's a genuine "typing burst" character (insertText/
   * deleteContent-equivalent -- ordinary typing, Backspace/Delete of one
   * unit, Shift+Enter's literal '\n', IME/absorbed composition text) --
   * createEditor's `dispatch` reads it to decide history mergeability, then
   * resets it to `false`, so it never leaks into a LATER, unrelated dispatch
   * (a mark toggle, paste, input-rule/suggestion conversion, or any
   * structural edit) and wrongly folds that into the preceding typing entry.
   * Optional: a bare createView has no history to protect either way, so its
   * own default (no-op) extensions object doesn't need to carry one. */
  mergeIntent?: { current: boolean };
}

export interface InteractionDeps {
  root: HTMLElement;
  registry: Registry;
  blockEls: Map<string, BlockEls>;
  compose: ComposeRef;
  extensions: Extensions;
  getState: () => EditorState;
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult;
  /** Full re-render + MutationObserver takeRecords() drain (render.ts's
   * renderAll wrapped by index.ts) -- called after every DOM-affecting step
   * that did NOT already happen inside runDispatch. `forceIds` bypasses
   * render's "already matches" shortcuts for those block ids. */
  render: (forceIds?: ReadonlySet<string>) => void;
  restoreSelection: () => void;
  /** beforeinput's historyUndo/historyRedo -> the state owner's injected
   * history (createEditor). Absent for a bare createView (no history). */
  onHistory?: (direction: "undo" | "redo") => void;
}

/** Marks editor-owned UI rendered outside the editable root (drag handle, toolbar, menus, portals): focus moving into it, or into its descendants, keeps a block selection. */
export const KEEP_SELECTION_ATTRIBUTE = "data-jul-editor-keep-selection";

const DELETE_TYPES = new Set([
  "deleteContentBackward",
  "deleteWordBackward",
  "deleteSoftLineBackward",
  "deleteContentForward",
  "deleteWordForward",
  "deleteByCut", // just delete here, clipboard data itself is handled in clipboard.ts
]);
const BACKWARD_TYPES = new Set(["deleteContentBackward", "deleteWordBackward", "deleteSoftLineBackward"]);
// A plain (non-word/line) delete's own getTargetRanges() is often NOT what we
// want here: Chromium reports a range spanning from the end of the PREVIOUS
// block into the start of the current one for a simple Backspace-at-offset-0
// (it has no concept of our block divs, only one flat editable region), which
// would skip our own block-boundary rules (convert-to-paragraph, select an
// adjacent void) entirely. deleteWord*/deleteSoftLineBackward still prefer
// getTargetRanges since we WANT the browser's word/line
// boundary math there; these three use the real, always-single-block-when-
// collapsed DOM selection instead.
const PREFER_DOM_SELECTION_TYPES = new Set(["deleteContentBackward", "deleteContentForward", "deleteByCut"]);
const LIST_ITEM_TYPES = new Set(["bulletListItem", "orderedListItem", "todoListItem"]);
// Notion behavior: Backspace at offset 0 on one of these converts to a plain
const CONVERT_TO_PARAGRAPH_ON_BACKSPACE = new Set(["heading", "quote", "bulletListItem", "orderedListItem", "todoListItem"]);

// Plain boolean, not a type predicate: every call site already has `sel`
// narrowed to the text variant by the time it calls this (typically via a
// preceding `sel.type !== "text"` guard) -- a predicate whose param type
// exactly equals its own asserted type makes TS narrow the "false" branch to
// `never` (a real, pre-existing DTS-build-blocking issue: rollup-plugin-dts
// only started fully type-checking this module once the Extensions type
// became part of the publicly exported type graph).
function collapsed(sel: Extract<Selection, { type: "text" }>): boolean {
  return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- grapheme-cluster-aware Backspace/Delete step -----------------------
// A naive point.offset +/- 1 steps one UTF-16 code UNIT -- it splits a
// surrogate-pair emoji in two (leaving a lone, invalid surrogate in the
// model) and only eats one code point of a ZWJ family/skin-tone sequence
// instead of the whole grapheme cluster a user perceives as "one character".

/** The block's own text, unit-for-unit aligned with `Point.offset` (which
 * counts a mention/other non-text inline as exactly ONE unit, regardless of
 * its label's length -- store/store.ts's `inlineLength`) -- every non-text
 * inline becomes one placeholder code unit (U+FFFC, the same "object
 * replacement" convention view/suggestion.ts's own plainTextOf already uses)
 * so a string index always equals the matching offset unit. */
function offsetAlignedText(content: Block["content"]): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : "￼")).join("");
}

/** Every grapheme-cluster boundary in `text` (0, every cluster start, and
 * text.length), ascending. Falls back to UTF-16 code-POINT boundaries
 * (surrogate-pair-safe, though not ZWJ-aware) when Intl.Segmenter isn't
 * available at all. */
function graphemeBoundaries(text: string): number[] {
  const bounds = new Set<number>([0, text.length]);
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    for (const seg of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) bounds.add(seg.index);
  } else {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xdc00 && code <= 0xdfff) continue; // low surrogate: belongs to the previous code point, not its own boundary
      bounds.add(i);
    }
  }
  return [...bounds].sort((a, b) => a - b);
}

/** The offset one whole grapheme cluster away from `offset`, in direction
 * `dir` (-1 backward/Backspace, 1 forward/Delete). Clamps to the string's
 * own ends. */
function graphemeStep(text: string, offset: number, dir: -1 | 1): number {
  const bounds = graphemeBoundaries(text);
  if (dir === 1) return bounds.find((b) => b > offset) ?? text.length;
  let prev = 0;
  for (const b of bounds) {
    if (b >= offset) break;
    prev = b;
  }
  return prev;
}

// Stateless (pure functions of a passed-in ctx) -- one shared instance for
// every view, same rationale as model/builtins.ts's coreBlocks array.
const defaultInputRules = buildDefaultInputRules();

export interface Interaction {
  /** Drains any MutationObserver records queued so far -- callers' own render()
   * must call this right after mutating the DOM ("자체 렌더 직후
   * observer.takeRecords()로 피드백 루프 차단"), so the observer callback never
   * sees (and tries to "revert") our own writes. */
  drainMutations(): void;
  /** Marks the NEXT shared-document selectionchange event for this view's
   * root as our own write ("우리가 selection을 쓸 때 발생하는 selectionchange는
   * 플래그로 무시") -- self-heals a few ms later even if that selectionchange
   * never actually fires (e.g. writing an unchanged selection). */
  suppressOwnWrite(): void;
  /** Forces the pending-composition safety net (flushComposition, normally
   * only run at the start of the next beforeinput/keydown) to run right now
   * -- for a PROGRAMMATIC caller (a toolbar button's click handler calling
   * `editor.commands.*`/`editor.update` directly: a command during composition
   * (toolbar Bold etc.) runs after the pending flush) that never fires a beforeinput/
   * keydown of its own and would otherwise bypass this entirely. A no-op
   * when there's nothing pending (compose.id is null, or composition is
   * still genuinely active -- can't force-end a live IME session). */
  flush(): void;
  /** True while a primary-button drag that started on this view's text is still held. */
  isPointerSelecting(): boolean;
  destroy(): void;
}

// ---- shared document selectionchange listener ("여러 에디터가 한 페이지에
// 있으면 document 리스너 1개 공유") ----------------------------------------------

interface RegisteredView {
  root: HTMLElement;
  registry: Registry;
  compose: ComposeRef;
  getState: () => EditorState;
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult;
  suppressed: boolean;
  /** A primary-button press that started on this view's text is still held: the browser is
   * extending a drag selection, so the live DOM selection is authoritative even over a 'block'
   * selection (a drag over a void turns into one, and dragging back must turn it into text again). */
  pointerSelecting: boolean;
  /** The last input on the page was a pointer (not a key): see readDOMSelection's `pointer`. */
  lastInputWasPointer: () => boolean;
  /** The current press is a triple (paragraph) click: its selection may end on the next block's
   * wrapper, a void included, which never means "select that block too". */
  paragraphClick: boolean;
  restoreSelection: () => void;
}

const registeredViews = new Set<RegisteredView>();
let sharedListenerAttached = false;

function onDocumentSelectionChange(): void {
  const domSel = window.getSelection();
  if (!domSel || domSel.rangeCount === 0 || !domSel.anchorNode) return;
  for (const v of registeredViews) {
    if (v.suppressed) {
      v.suppressed = false;
      continue;
    }
    if (v.compose.active) continue; // never fight a live composition
    if (!v.root.contains(domSel.anchorNode)) continue;
    const cur = v.getState().selection;
    // Root-cause fix ("arrow keys into a
    // void block"): a 'block'/'cells' selection has no DOM correlate at all --
    // writeDOMSelection() deliberately no-ops for it, so the live DOM selection
    // can (and typically does) still show wherever the caret happened to be
    // BEFORE that selection was set. A selectionchange task is async and can be
    // delivered late (its queueing relative to our own suppressOwnWrite()
    // setTimeout(0) self-heal is not guaranteed), so a stale event describing
    // an EARLIER real write can arrive after the model has already moved on to
    // a deliberate block/cells selection. Recomputing "what the DOM shows" and
    // finding it differs from the current (intentionally DOM-less) selection
    // is expected, not a signal of an external change -- ignore it entirely
    // rather than racing a timing-based suppression flag.
    // A drag still in progress is not such a stale event: the browser is extending it right now.
    if (cur && cur.type !== "text" && !v.pointerSelecting) continue;
    const raw = readDOMSelection(v.root, { store: v.paragraphClick ? undefined : v.getState().store, registry: v.registry, pointer: v.lastInputWasPointer() });
    if (!raw) continue;
    // A drag that reaches a void becomes a 'block' selection only on release: selecting the void now
    // would reveal its edit controls mid-drag and shift the layout under the pointer.
    if (raw.type === "block" && v.pointerSelecting) continue; // outside a mapped content div (e.g. inside a void) -- leave model selection as-is
    const promoted = promoteSelection(v.getState().store, v.registry, raw);
    // Same for a text range promoted to blocks mid-drag (it left a table cell for the text around it).
    if (promoted.type === "block" && v.pointerSelecting) continue;
    if (sameSelection(cur, promoted)) {
      // The DOM may still show more than the model (a triple click's end on the next block, which the
      // pointer read clamped): rewrite it so the highlight and the next native edit match. A no-op
      // when the DOM already maps to the model.
      if (promoted.type === "text") v.restoreSelection();
      continue;
    }
    v.runDispatch((tx) => tx.setSelection(promoted));
  }
}

function ensureSharedListener(): void {
  if (sharedListenerAttached) return;
  sharedListenerAttached = true;
  document.addEventListener("selectionchange", onDocumentSelectionChange);
}

export function attachInteraction(deps: InteractionDeps): Interaction {
  const { root, registry, compose, extensions, getState, render, restoreSelection } = deps;

  // Backspace-undoes-an-auto-conversion (Notion/Google Docs
  // behavior): the caret position an input rule's OWN single, non-mergeable
  // history commit left behind. A Backspace whose (freshly resynced) caret
  // still sits exactly there just calls history.undo() -- reverting that one
  // commit IS "revert to literal text", no separate undo-closure bookkeeping
  // needed. Cleared on any other edit (the window is "immediately after").
  let inputRuleUndo: Point | null = null;

  // Every dispatch (typing, deleting, IME absorb, selection-only) re-evaluates
  // every registered suggestion against the CURRENT selection/text -- this is
  // also how a suggestion's query updates mid-IME-composition
  // (syncBlockFromDOM's own dispatch, below, routes through here too).
  function runDispatch(build: (tx: Transaction) => Transaction, typedChar?: string): TransactionResult {
    const result = deps.runDispatch(build);
    extensions.suggestions.notifyTextChange(typedChar);
    return result;
  }

  function isVoidBlock(id: string): boolean {
    const rec = getState().store.records.get(id);
    return !!rec && isVoidSpec(registry.blocks.get(rec.type));
  }

  /** flags the NEXT dispatch as a typing-burst candidate for history's
   * merge window (createEditor's `dispatch` consumes+resets this one-shot
   * flag -- see Extensions.mergeIntent's own doc comment). Call immediately
   * before the `runDispatch` for an actual character insert/delete; never
   * for a mark toggle, paste, input-rule/suggestion conversion, or any other
   * structural edit. */
  function markTyping(): void {
    if (extensions.mergeIntent) extensions.mergeIntent.current = true;
  }

  /** a block-selection command (delete/type-replace/Enter) must never
   * act directly on an id that's pinned to a specific container (tableRow/
   * tableCell/column -- the registry `parent` rule) -- Escape's own
   * spannedTopBlocks (onEscape) or a drag across two columns can otherwise
   * hand one straight through, letting Backspace/typing/Enter tear a single
   * cell out of its row or drop a paragraph where only a tableRow may live.
   * Lifts `id` to the nearest ancestor with no `parent` restriction.
   *
   * An isolating block that is NOT parent-restricted (a table, a columns
   * block) is a whole, self-contained unit: when it is itself one of the
   * selected ids (Select All, a drag from a table cell into the next block)
   * it is admissible as-is and the command replaces the whole structure.
   * Reaching one only by LIFTING is admissible only when `allowLiftIntoIsolating`
   * (the selection spans several of its restricted children, e.g. a drag
   * across two columns selects the columns block); a single lifted id (Escape
   * with the caret inside one cell) returns null so the caller refuses the
   * command rather than destroy the whole table from inside one cell. */
  function admissibleUnit(store: Store, id: string, allowLiftIntoIsolating: boolean): string | null {
    let cur: string | null = id;
    while (cur !== null) {
      const rec = store.records.get(cur);
      if (!rec) return null;
      const spec = registry.blocks.get(rec.type);
      if (!spec?.parent) return cur !== id && spec?.isolating && !allowLiftIntoIsolating ? null : cur;
      cur = rec.parentId;
    }
    return null;
  }

  /** `admissibleUnit` over every id, deduped in order; null (refuse the whole
   * command) when ANY id has no admissible ancestor at all. */
  function admissibleUnits(store: Store, ids: string[]): string[] | null {
    const out: string[] = [];
    for (const id of ids) {
      const lifted = admissibleUnit(store, id, ids.length > 1);
      if (lifted === null) return null;
      if (!out.includes(lifted)) out.push(lifted);
    }
    return out;
  }

  function sync(blockId: string | null): void {
    markTyping(); // IME/absorbed composition text is a typing burst too
    syncBlockFromDOM(blockId, { root, registry, blockEls: deps.blockEls, getState, runDispatch, compose });
  }

  function flushComposition(): void {
    if (compose.id && !compose.active) {
      sync(compose.id);
      compose.id = null;
      compose.overrideMarks = null;
      compose.startContent = null;
      compose.startOffset = null;
    }
  }

  function targetRangesSelection(e: InputEvent): Selection | null {
    const ranges = e.getTargetRanges?.();
    if (!ranges || ranges.length === 0) return null;
    const r = ranges[0]!;
    const anchor = pointFromDOM(root, r.startContainer, r.startOffset);
    const focus = pointFromDOM(root, r.endContainer, r.endOffset);
    if (!anchor || !focus) return null;
    return { type: "text", anchor, focus };
  }

  function currentSelection(e?: InputEvent): Selection | null {
    const target = e ? targetRangesSelection(e) : null;
    const dom = readDOMSelection(root);
    // A COLLAPSED target range is just "where the caret is", and the live
    // DOM selection is authoritative for that. Chromium can hand back a
    // stale/canonicalized one right after we moved the caret ourselves: a
    // key typed with no delay after Enter reported offset 0 of the block
    // AFTER the new empty paragraph (whose only child is a <br>) while the
    // DOM caret sat correctly inside it, so the text landed in the wrong
    // block. A non-collapsed target range (spellcheck/autocorrect replacing
    // a word, a deletion's own extent) stays the source of truth.
    const raw = target?.type === "text" && dom?.type === "text" && collapsed(target) && collapsed(dom) ? dom : (target ?? dom);
    return raw ? promoteSelection(getState().store, registry, raw) : raw;
  }

  function preOrderStart(a: Point, b: Point): Point {
    return orderPoints(getState().store, a, b)[0]; // offset order within one block (backward drags)
  }

  function onInsertText(e: InputEvent): void {
    const sel = currentSelection(e);
    if (!sel) return;
    const text = e.data ?? "";
    if (!text) return;
    inputRuleUndo = null; // a fresh edit always closes the previous rule's "undo window"
    if (sel.type === "cells") {
      // typing over a cells rectangle replaces the ANCHOR cell's whole
      // content (not just its head) and collapses -- matches the
      // expected behavior ("typing replaces the anchor cell content and collapses"),
      // distinct from an ordinary multi-block text selection's delete+insert.
      const cellId = cellIdAt(getState().store, registry, sel.tableId, sel.anchor[0], sel.anchor[1]);
      if (!cellId) return;
      const len = contentLength(getState().store.records.get(cellId)?.content);
      const caret: Point = { blockId: cellId, offset: text.length };
      markTyping();
      runDispatch((tx) => tx.replaceContent(cellId, 0, len, [{ type: "text", text }]).setSelection({ type: "text", anchor: caret, focus: caret }), e.inputType === "insertText" ? text : undefined);
      return;
    }
    if (sel.type !== "text") return;
    let caret: Point;
    if (collapsed(sel)) {
      const at = sel.anchor;
      const marks = consumeInsertMarks(getState(), extensions.marksRef, at, registry);
      caret = { blockId: at.blockId, offset: at.offset + text.length };
      markTyping(); // a plain typed character merges with adjacent typing
      runDispatch((tx) => tx.insertText(at, text, marks).setSelection({ type: "text", anchor: caret, focus: caret }), e.inputType === "insertText" ? text : undefined);
    } else {
      const start = preOrderStart(sel.anchor, sel.focus);
      const marks = consumeInsertMarks(getState(), extensions.marksRef, start, registry);
      caret = { blockId: start.blockId, offset: start.offset + text.length };
      markTyping(); // typing over a (same-block) selection is still a typed character
      runDispatch((tx) => tx.deleteRange(sel).insertText(start, text, marks).setSelection({ type: "text", anchor: caret, focus: caret }), e.inputType === "insertText" ? text : undefined);
    }
    // a "```lang" arm only survives typing that stays inside the SAME
    // just-converted block -- typing anywhere else closes the window.
    clearCodeBlockLangGrab(caret.blockId);
    // codeBlock's content is literal (`content: "code"`, not "inline") --
    // markdown auto-conversion ("# ", "- ", "**x**"...) must never fire
    // inside one (Notion/GitHub convention);
    // runInputRules itself has no notion of block content kind, so the gate
    // lives here, at input rules' one and only caller.
    const typedIntoRec = getState().store.records.get(caret.blockId);
    if (registry.blocks.get(typedIntoRec?.type ?? "")?.content === "code") return;
    // `state` MUST be a live getter, not a one-time snapshot: runInputRules
    // reads ctx.state.selection AGAIN after the matched handler's own dispatch
    // has already run (to find where that handler actually left the caret --
    // see inputRules.ts's doc comment), and a plain `{ state: getState() }`
    // property would freeze the pre-dispatch value, silently breaking the
    // Backspace-undoes-an-auto-conversion feature (found via e2e: it fell
    // through to the unrelated "convert heading to paragraph" default instead).
    const ruleCtx = {
      get state() {
        return getState();
      },
      registry,
      dispatch: runDispatch,
      marksRef: extensions.marksRef, // a rule that fires a non-inclusive mark clears this right after
    };
    inputRuleUndo = runInputRules(ruleCtx, caret, currentBlockInputRules(ruleCtx.state, registry, caret.blockId), extensions.inputRules, defaultInputRules);
  }

  function onInsertLineBreak(e: InputEvent): void {
    // Shift+Enter: a literal '\n' inside the block's own text -- the root's
    // `white-space: pre-wrap` (rootStyle.ts) renders it as a visual line
    // break with no extra DOM structure needed.
    const sel = currentSelection(e);
    if (!sel || sel.type !== "text") return;
    markTyping(); // Shift+Enter's literal '\n' is a typed character too
    if (collapsed(sel)) {
      const at = sel.anchor;
      const caret: Point = { blockId: at.blockId, offset: at.offset + 1 };
      runDispatch((tx) => tx.insertText(at, "\n").setSelection({ type: "text", anchor: caret, focus: caret }));
    } else {
      const start = preOrderStart(sel.anchor, sel.focus);
      const caret: Point = { blockId: start.blockId, offset: start.offset + 1 };
      runDispatch((tx) => tx.deleteRange(sel).insertText(start, "\n").setSelection({ type: "text", anchor: caret, focus: caret }));
    }
  }

  /** Backspace with a collapsed caret at (blockId, 0): convert a heading/
   * quote/list item to a paragraph first (Notion -- a second Backspace is
   * what actually merges), select an adjacent void instead of merging into
   * it, or plain mergeBackward. Shared by the keydown-level boundary check
   * (authoritative, model-driven) and onDelete's beforeinput fallback. */
  function runBackwardBoundary(point: Point): void {
    const rec = getState().store.records.get(point.blockId);
    if (rec && CONVERT_TO_PARAGRAPH_ON_BACKSPACE.has(rec.type)) {
      runDispatch((tx) => tx.setType(point.blockId, "paragraph").setSelection({ type: "text", anchor: point, focus: point }));
      return;
    }
    const prevId = prevBlockInPreOrder(getState().store, point.blockId);
    if (!prevId) return;
    if (isVoidBlock(prevId)) {
      runDispatch((tx) => tx.setSelection({ type: "block", ids: [prevId] }));
      return;
    }
    // prevBlockInPreOrder resolves to `point.blockId`'s own PARENT when
    // it's the first child of its container (siblingsOf's index<=0 branch) --
    // for an ordinary nested block that parent has real inline content to
    // merge/land in, but for an isolating child with no content slot of its
    // own (a tableCell, whose parent is a content:'none' tableRow) it does
    // not: neither a real merge (buildMergeBackwardOps already refuses to
    // cross an isolating boundary) nor a valid text-caret target exist here.
    // Matches "Backspace at cell start doesn't merge" -- a true no-op, not a
    // caret landing on a contentless block.
    const prevSpec = registry.blocks.get(getState().store.records.get(prevId)?.type ?? "");
    if (prevSpec?.content !== "inline" && prevSpec?.content !== "code") return;
    const caret: Point = { blockId: prevId, offset: contentLength(getState().store.records.get(prevId)?.content) };
    runDispatch((tx) => tx.mergeBackward(point.blockId).setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  /** Delete/deleteContentForward with a collapsed caret at the block's own
   * end: select an adjacent void instead of merging into it, or plain
   * mergeBackward(next). Same sharing rationale as runBackwardBoundary. */
  function runForwardBoundary(point: Point): void {
    const nextId = nextBlockInPreOrder(getState().store, point.blockId);
    if (!nextId) return;
    if (isVoidBlock(nextId)) {
      runDispatch((tx) => tx.setSelection({ type: "block", ids: [nextId] }));
      return;
    }
    runDispatch((tx) => tx.mergeBackward(nextId).setSelection({ type: "text", anchor: point, focus: point }));
  }

  function onDelete(e: InputEvent, inputType: string): void {
    inputRuleUndo = null;
    clearCodeBlockLangGrab(); // Backspace/Delete always closes the "```lang" arm window
    const raw = PREFER_DOM_SELECTION_TYPES.has(inputType) ? readDOMSelection(root) : ((e && targetRangesSelection(e)) ?? readDOMSelection(root));
    const sel = raw ? promoteSelection(getState().store, registry, raw) : raw;
    if (!sel || sel.type !== "text") return;
    if (!collapsed(sel)) {
      const start = preOrderStart(sel.anchor, sel.focus);
      runDispatch((tx) => tx.deleteRange(sel).setSelection({ type: "text", anchor: start, focus: start }));
      return;
    }
    const point = sel.anchor;
    const backward = BACKWARD_TYPES.has(inputType);
    const len = contentLength(getState().store.records.get(point.blockId)?.content);
    if (backward && point.offset === 0) {
      runBackwardBoundary(point);
      return;
    }
    if (!backward && point.offset === len) {
      runForwardBoundary(point);
      return;
    }
    // one whole grapheme cluster, not one UTF-16 code unit (see
    // graphemeStep's own doc comment).
    const text = offsetAlignedText(getState().store.records.get(point.blockId)?.content);
    const otherOffset = graphemeStep(text, point.offset, backward ? -1 : 1);
    const range: Selection = { type: "text", anchor: point, focus: { blockId: point.blockId, offset: otherOffset } };
    const caret: Point = { blockId: point.blockId, offset: Math.min(point.offset, otherOffset) };
    markTyping(); // one grapheme of Backspace/Delete merges with adjacent typing
    runDispatch((tx) => tx.deleteRange(range).setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  function onInsertParagraph(e: InputEvent): void {
    inputRuleUndo = null;
    clearCodeBlockLangGrab(); // Enter always closes the "```lang" arm window unless it consumes it (trySetLanguageFromTyped, reached via the codeBlock keymap before beforeinput even fires)
    const sel = currentSelection(e);
    if (!sel) return;
    if (sel.type === "block") {
      onEnterOnBlockSelection(sel);
      return;
    }
    if (sel.type !== "text") return;
    if (collapsed(sel)) {
      const point = sel.anchor;
      const rec = getState().store.records.get(point.blockId);
      if (rec && LIST_ITEM_TYPES.has(rec.type) && contentLength(rec.content) === 0) {
        // Notion: Enter on an empty list item outdents it (if nested inside
        // another list item) or otherwise converts it to a paragraph.
        const { parentId } = siblingsOf(getState().store, point.blockId);
        const parentRec = parentId ? getState().store.records.get(parentId) : undefined;
        if (parentRec && LIST_ITEM_TYPES.has(parentRec.type)) runDispatch((tx) => tx.outdent(point.blockId));
        else runDispatch((tx) => tx.setType(point.blockId, "paragraph"));
        return;
      }
      // Same rule for an empty quote line: Enter ends the quote (becomes a
      // paragraph) instead of stacking empty quotes forever.
      if (rec && rec.type === "quote" && contentLength(rec.content) === 0 && rec.childIds.length === 0) {
        runDispatch((tx) => tx.setType(point.blockId, "paragraph"));
        return;
      }
      // Enter on an EMPTY last child of a text container (callout, toggle,
      // quote, list item, nested paragraph...) leaves the container: the
      // empty line moves out to become the container's next sibling (Notion).
      // Only where the line is admissible there and the container is a real
      // text block -- never out of a column/table cell structure.
      if (rec && rec.type === "paragraph" && contentLength(rec.content) === 0 && rec.childIds.length === 0 && canLeaveContainer(point.blockId)) {
        runDispatch((tx) => tx.outdent(point.blockId));
        return;
      }
      // the `onEnter`-flagged subset of input rules ("---"/"***"/
      // "___" -> divider -- see inputRules.ts's dividerRule doc comment)
      // confirms on Enter instead of the ordinary per-character phase
      // onInsertText runs below. Same content:'code' gate as onInsertText's
      // own (markdown auto-conversion never fires inside a codeBlock).
      if (rec && registry.blocks.get(rec.type)?.content === "inline") {
        const ruleCtx = {
          get state() {
            return getState();
          },
          registry,
          dispatch: runDispatch,
          marksRef: extensions.marksRef,
        };
        // capture the returned Point (not just whether it matched) --
        // this is the same Backspace-undoes-an-auto-conversion bookkeeping
        // onInsertText does below; discarding it left the Enter-confirmed
        // divider conversion with no recorded "undo window" at all.
        const result = runInputRules(ruleCtx, point, currentBlockInputRules(ruleCtx.state, registry, point.blockId), extensions.inputRules, defaultInputRules, "enter");
        if (result !== null) {
          inputRuleUndo = result;
          return;
        }
      }
    }
    const wasCollapsed = collapsed(sel);
    const point = wasCollapsed ? sel.anchor : preOrderStart(sel.anchor, sel.focus);
    const atStart = point.offset === 0;
    // Enter at the very END of a heading starts a plain paragraph, not
    // another heading (Notion/Google Docs/BlockNote); a split mid-heading
    // keeps both halves headings.
    const splitRec = getState().store.records.get(point.blockId);
    const len = contentLength(splitRec?.content);
    const backType = wasCollapsed && splitRec?.type === "heading" && len > 0 && point.offset === len ? "paragraph" : undefined;
    // Enter over a non-collapsed selection is ONE undo step -- the
    // delete and the split are the same user action, so they go in the same
    // transaction instead of two separate (separately-undoable) dispatches.
    runDispatch((tx) => (wasCollapsed ? tx : tx.deleteRange(sel)).splitBlock(point, backType ? { type: backType } : undefined));
    // offset 0 keeps `point` on the same (now-second) block; offset>0 moved
    // the remainder into a freshly-generated id we can only find post-commit.
    let caret: Point = point;
    if (!atStart) {
      const { siblings, index } = siblingsOf(getState().store, point.blockId);
      const backId = siblings[index + 1];
      if (backId) caret = { blockId: backId, offset: 0 };
    }
    runDispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  /** Whether the empty block `id` is the LAST child of a text container
   * (a parent with its own inline content: callout, toggle, quote, list
   * item, a nested paragraph) and may legally sit right after that parent
   * -- onInsertParagraph's "Enter on an empty last line leaves the
   * container" rule. A column/table cell parent (content: none, or a
   * parent-restricted structure) never qualifies. */
  function canLeaveContainer(id: string): boolean {
    const store = getState().store;
    const rec = store.records.get(id);
    if (!rec || rec.parentId === null) return false;
    const parent = store.records.get(rec.parentId);
    if (!parent || parent.childIds[parent.childIds.length - 1] !== id) return false;
    const parentSpec = registry.blocks.get(parent.type);
    if (parentSpec?.content !== "inline" || parentSpec.parent) return false;
    const grand = containerInfo(store, parent.parentId, registry);
    return canAdmit(registry, rec.type, grand.type, grand.children);
  }

  // ---- block/cells selection commands --------------------------

  function onEnterOnBlockSelection(sel: Extract<Selection, { type: "block" }>): void {
    const store = getState().store;
    const ids = admissibleUnits(store, sel.ids);
    if (!ids || ids.length === 0) return;
    const lastId = ids[ids.length - 1]!;
    const { parentId, index } = siblingsOf(store, lastId);
    const newBlock: Block = { id: newId(), type: "paragraph", props: {}, content: [] };
    const caret: Point = { blockId: newBlock.id, offset: 0 };
    runDispatch((tx) => tx.insertBlock(parentId, index + 1, newBlock).setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  function onDeleteBlockSelection(sel: Extract<Selection, { type: "block" }>): void {
    const store = getState().store;
    const ids = admissibleUnits(store, sel.ids);
    if (!ids || ids.length === 0) return;
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    const { siblings, index } = siblingsOf(store, first);
    const lastIndex = siblings.indexOf(last);
    const afterId = siblings[lastIndex + 1] ?? null;
    const beforeId = index > 0 ? siblings[index - 1]! : null;
    runDispatch((tx) => tx.deleteRange({ type: "block", ids }));
    // The transaction-level invariant guarantees the store never ends up
    // with zero blocks after this commits, but it may have inserted its OWN
    // trailing paragraph to make that true -- neither `afterId` nor
    // `beforeId` (computed from the PRE-delete sibling list) can know about
    // that new block, so fall back to whatever root block now exists before
    // giving up entirely.
    const store2 = getState().store;
    const targetId = afterId && store2.records.has(afterId) ? afterId : beforeId && store2.records.has(beforeId) ? beforeId : (store2.rootIds[0] ?? null);
    if (!targetId) {
      runDispatch((tx) => tx.setSelection(null));
      return;
    }
    const offset = targetId === beforeId ? contentLength(store2.records.get(targetId)?.content) : 0;
    const caret: Point = { blockId: targetId, offset };
    runDispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  function onTypeReplaceBlockSelection(sel: Extract<Selection, { type: "block" }>, char: string): void {
    const store = getState().store;
    const ids = admissibleUnits(store, sel.ids);
    if (!ids || ids.length === 0) return;
    const { parentId, index } = siblingsOf(store, ids[0]!);
    const newBlock: Block = { id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text: char }] };
    const caret: Point = { blockId: newBlock.id, offset: char.length };
    // one user action, one undo step -- delete + insert in a single tx.
    runDispatch((tx) => tx.deleteRange({ type: "block", ids }).insertBlock(parentId, index, newBlock).setSelection({ type: "text", anchor: caret, focus: caret }), char);
  }

  function extendBlockSelection(sel: Extract<Selection, { type: "block" }>, dir: 1 | -1): void {
    if (sel.ids.length === 0) return;
    const store = getState().store;
    const first = sel.ids[0]!;
    const last = sel.ids[sel.ids.length - 1]!;
    const { siblings } = siblingsOf(store, first);
    const iFirst = siblings.indexOf(first);
    const iLast = siblings.indexOf(last);
    if (dir === 1) {
      const next = iLast + 1;
      if (next >= siblings.length) return;
      runDispatch((tx) => tx.setSelection({ type: "block", ids: siblings.slice(iFirst, next + 1) }));
    } else {
      const prev = iFirst - 1;
      if (prev < 0) return;
      runDispatch((tx) => tx.setSelection({ type: "block", ids: siblings.slice(prev, iLast + 1) }));
    }
  }

  function moveOffBlockSelection(sel: Extract<Selection, { type: "block" }>, dir: 1 | -1): void {
    if (sel.ids.length === 0) return;
    const store = getState().store;
    const edgeId = dir === 1 ? sel.ids[sel.ids.length - 1]! : sel.ids[0]!;
    const targetId = dir === 1 ? nextBlockInPreOrder(store, edgeId) : prevBlockInPreOrder(store, edgeId);
    if (!targetId) return;
    if (isVoidBlock(targetId)) {
      runDispatch((tx) => tx.setSelection({ type: "block", ids: [targetId] }));
      return;
    }
    const offset = dir === 1 ? 0 : contentLength(store.records.get(targetId)?.content);
    const caret: Point = { blockId: targetId, offset };
    runDispatch((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
  }

  function onEscape(sel: Extract<Selection, { type: "text" }>): void {
    const store = getState().store;
    const ids = spannedTopBlocks(store, sel.anchor.blockId, sel.focus.blockId);
    runDispatch((tx) => tx.setSelection({ type: "block", ids }));
  }

  function onModA(): void {
    const store = getState().store;
    const sel = getState().selection;
    if (sel?.type === "text" && sel.anchor.blockId === sel.focus.blockId) {
      const { blockId } = sel.anchor;
      const len = contentLength(store.records.get(blockId)?.content);
      const fullySelected = Math.min(sel.anchor.offset, sel.focus.offset) === 0 && Math.max(sel.anchor.offset, sel.focus.offset) === len;
      if (!fullySelected) {
        runDispatch((tx) => tx.setSelection({ type: "text", anchor: { blockId, offset: 0 }, focus: { blockId, offset: len } }));
        return;
      }
    }
    runDispatch((tx) => tx.setSelection({ type: "block", ids: [...store.rootIds] }));
  }

  /** The adjacent (dir=1 next, dir=-1 prev) block id, if the collapsed caret
   * in `sel` sits right at its own block's boundary AND that neighbor is a
   * void -- shared by arrow-key entry and the Backspace/Delete keydown
   * fallback (delete-into-a-void never fires beforeinput at all). */
  function adjacentVoidAt(sel: Extract<Selection, { type: "text" }>, dir: 1 | -1): string | null {
    if (!collapsed(sel)) return null;
    const store = getState().store;
    const point = sel.anchor;
    if (dir === 1) {
      const len = contentLength(store.records.get(point.blockId)?.content);
      if (point.offset !== len) return null;
      const nextId = nextBlockInPreOrder(store, point.blockId);
      return nextId && isVoidBlock(nextId) ? nextId : null;
    }
    if (point.offset !== 0) return null;
    const prevId = prevBlockInPreOrder(store, point.blockId);
    return prevId && isVoidBlock(prevId) ? prevId : null;
  }

  // ---- copy/cut -------------------------------------------------
  // Paste/drop (the NEW decode+insert+upload machinery) live in
  // view/clipboard.ts; copy/cut stay here since they reuse this module's own
  // existing delete-selection helpers (onDeleteBlockSelection, preOrderStart)
  // instead of duplicating them.

  function writeClipboardData(dt: DataTransfer | null, fragment: Doc): void {
    if (!dt || fragment.blocks.length === 0) return;
    const encoded = encodeClipboard(fragment, { registry });
    dt.setData("text/plain", encoded["text/plain"]);
    dt.setData("text/html", encoded["text/html"]);
    dt.setData("application/x-jul-editor+json", encoded["application/x-jul-editor+json"]);
  }

  function onCopy(e: ClipboardEvent): void {
    if (isInsideVoidEvent(e)) return;
    const sel = syncedSelection(); // same live-DOM reconcile as keydown/paste (a click's selectionchange may not have landed yet)
    if (!sel) return;
    const fragment = extractFragment(getState().store, sel, registry);
    if (fragment.blocks.length === 0) return;
    e.preventDefault();
    writeClipboardData(e.clipboardData, fragment);
  }

  function onCut(e: ClipboardEvent): void {
    if (isInsideVoidEvent(e)) return;
    const sel = syncedSelection(); // same live-DOM reconcile as keydown/paste (a click's selectionchange may not have landed yet)
    if (!sel) return;
    const fragment = extractFragment(getState().store, sel, registry);
    if (fragment.blocks.length === 0) return;
    e.preventDefault();
    writeClipboardData(e.clipboardData, fragment);
    // One history entry: every branch below is a single dispatch.
    if (sel.type === "cells") {
      runDispatch((tx) => tx.deleteRange(sel));
      return;
    }
    if (sel.type === "block") {
      runDispatch((tx) => tx.deleteRange(sel));
      return;
    }
    const start = preOrderStart(sel.anchor, sel.focus);
    runDispatch((tx) => tx.deleteRange(sel).setSelection({ type: "text", anchor: start, focus: start }));
  }

  // ---- void-block click ---------------------------
  // A void's own inner interactive UI (e.g. an alt-text <input>, a retry
  // <button>) must keep working normally -- only a click OUTSIDE those
  // elements (but still inside the void's container) selects the block.
  // Clicking in ordinary text right after/before a void is untouched (target
  // is never inside a void container there, so this no-ops and the browser's
  // normal click -> selectionchange path runs as usual).

  // One-shot -- set the instant a void mousedown above selects
  // a block, consumed by the very next 'click' (see onClick's own doc
  // comment for why this exists: a real click's mouseup/click can land on a
  // totally different element than its own mousedown did). Never carried
  // past that one click.
  let justSelectedVoidId: string | null = null;

  function onMouseDown(e: MouseEvent): void {
    // Every new mousedown starts a fresh gesture -- clear
    // whatever the LAST one left behind first, unconditionally (even when
    // THIS mousedown isn't inside a void). A flag left set past its own
    // click is possible: when mousedown and mouseup land on different
    // elements (exactly the race this whole guard exists for), some
    // browsers skip firing 'click' entirely instead of firing it on their
    // common ancestor, so the one-shot flag would otherwise survive
    // untouched into a LATER, wholly unrelated click and wrongly swallow it
    // (e.g. a real "click elsewhere to deselect" a while after the fact).
    justSelectedVoidId = null;
    registered.paragraphClick = false;
    if (toggleTodoFromMarker(e)) return;
    if (!isInsideVoidEvent(e)) {
      if (e.button === 0) startPointerSelection(e.detail >= 3);
      return;
    }
    const target = e.target;
    // isInsideVoid also matches a decoration container now (chrome next
    // to an editable block, e.g. the code language select) -- that's not a
    // void block, so it must never be treated as a void-selection click; let
    // the browser handle the click on its own chrome normally.
    if (target instanceof Element && target.closest(`[${DECORATION_ATTR}]`)) return;
    if (target instanceof Element && target.closest("input, textarea, select, button")) return;
    const blockId = closestBlockId(e.target, root);
    if (!blockId) return;
    e.preventDefault(); // don't let the browser try to place a caret inside contenteditable=false
    // preventDefault on mousedown also cancels the browser's own focus-follows-
    // click behavior -- without an explicit focus() here, the root would stay
    // (or become) unfocused, so a subsequent Backspace/Delete/arrow keydown
    // would never even reach our own keydown listener.
    root.focus();
    justSelectedVoidId = blockId;
    runDispatch((tx) => tx.setSelection({ type: "block", ids: [blockId] }));
  }

  /** A primary press in a to-do's marker gutter -- on the block wrapper
   * itself (where a host's CSS draws the checkbox, e.g. a `::before`), left
   * of its content div and within the content's own line box -- toggles
   * `checked` instead of placing a caret. A press on the text, or anywhere
   * once the root is not editable, is left alone. */
  function toggleTodoFromMarker(e: MouseEvent): boolean {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || root.getAttribute("contenteditable") === "false") return false;
    const target = e.target;
    if (!(target instanceof Element) || !target.hasAttribute(BLOCK_ATTR) || !root.contains(target)) return false;
    const blockId = target.getAttribute(ID_ATTR);
    const rec = blockId ? getState().store.records.get(blockId) : undefined;
    if (!blockId || !rec || rec.type !== "todoListItem") return false;
    const content = target.querySelector(`:scope > [${CONTENT_ATTR}]`);
    if (!content) return false;
    const rect = content.getBoundingClientRect();
    if (rect.height === 0 || e.clientX >= rect.left || e.clientY < rect.top || e.clientY > rect.bottom) return false;
    e.preventDefault();
    const checked = rec.props.checked === true;
    runDispatch((tx) => tx.setProps(blockId, { checked: !checked }));
    return true;
  }

  /** A primary press on text starts a native drag selection: while it is held the shared
   * selectionchange listener follows the live DOM selection even over a 'block' selection (see
   * RegisteredView.pointerSelecting). The release ends it; a drag that ended as a 'block' selection
   * (over a void) then gets its leftover native highlight cleared by restoreSelection. */
  function startPointerSelection(paragraph: boolean): void {
    registered.pointerSelecting = true;
    registered.paragraphClick = paragraph;
    const doc = root.ownerDocument;
    const onRelease = (e?: Event): void => {
      // the block under the pointer, read now: selecting a void later reveals its controls and moves the layout
      const hit = e instanceof MouseEvent ? (doc.elementFromPoint?.(e.clientX, e.clientY) ?? null) : null;
      releaseBlockId = hit && root.contains(hit) ? closestBlockId(hit, root) : null;
      doc.removeEventListener("mouseup", onRelease, true);
      doc.defaultView?.removeEventListener("blur", onRelease);
      stopPointerSelection = null;
      if (!registered.pointerSelecting) return;
      registered.pointerSelecting = false;
      // Sync once the release's own selectionchange (if any) has landed. Not inside mouseup itself:
      // a selection write there makes Chrome treat the drag as a click and collapse it. A key pressed
      // before then (typing straight after a triple click) syncs first, in onKeyInput.
      pendingPointerSync = paragraph;
      setTimeout(flushPointerSync, 0);
    };
    stopPointerSelection?.();
    stopPointerSelection = () => {
      doc.removeEventListener("mouseup", onRelease, true);
      doc.defaultView?.removeEventListener("blur", onRelease);
      stopPointerSelection = null;
      registered.pointerSelecting = false;
    };
    doc.addEventListener("mouseup", onRelease, true);
    doc.defaultView?.addEventListener("blur", onRelease);
  }
  let stopPointerSelection: (() => void) | null = null;
  let pendingPointerSync: boolean | null = null;
  /** The block under the pointer where the last drag was released, for extendPastVoids. */
  let releaseBlockId: string | null = null;
  function flushPointerSync(): void {
    if (pendingPointerSync === null) return;
    const paragraph = pendingPointerSync;
    pendingPointerSync = null;
    syncPointerSelection(paragraph);
  }

  /** A drag that passes one or more void blocks (a chart, an image) spans whole blocks: the voids have
   * no text to put in a text range, so a range over them would select (and delete) blocks that never
   * show as selected. Chrome also often leaves the native selection stuck at or before the first void,
   * since it will not extend a selection across a contenteditable=false island. So when a void lies
   * between the press and the release (the block under the pointer on release, else the native
   * focus), the result is a 'block' selection over the top-level blocks from one to the other. Null
   * when no void stands in the way (the read selection is kept as it is). */
  function extendPastVoids(read: Selection | null, releaseId: string | null): Selection | null {
    const anchorNode = root.ownerDocument.getSelection()?.anchorNode ?? null;
    const anchorId = read?.type === "text" ? read.anchor.blockId : anchorNode && root.contains(anchorNode) ? closestBlockId(anchorNode, root) : null;
    const store = getState().store;
    const targetId = releaseId && store.records.has(releaseId) ? releaseId : read?.type === "text" ? read.focus.blockId : null;
    if (!anchorId || !targetId) return null;
    const span = spannedTopBlocks(store, anchorId, targetId);
    if (span.length < 2) return null;
    const anchorTop = topIn(store, anchorId, span);
    if (!anchorTop) return null;
    const blocked = span.some((id) => {
      if (id === anchorTop) return false;
      const type = store.records.get(id)?.type;
      return type !== undefined && isVoidSpec(registry.blocks.get(type));
    });
    return blocked ? { type: "block", ids: span } : null;
  }

  /** The member of `span` (sibling ids) that is `id` or one of its ancestors. */
  function topIn(store: Store, id: string, span: string[]): string | null {
    let cur: string | null = id;
    while (cur) {
      if (span.includes(cur)) return cur;
      cur = store.records.get(cur)?.parentId ?? null;
    }
    return null;
  }

  /** Takes the released pointer selection into the model (a drag that ended on a void becomes a
   * 'block' selection here) and rewrites the DOM to match it (clamped ends, cleared highlight). */
  function syncPointerSelection(paragraph: boolean): void {
    if (compose.active) return;
    const cur = getState().selection;
    const release = releaseBlockId;
    releaseBlockId = null;
    const read = readDOMSelection(root, { store: paragraph ? undefined : getState().store, registry, pointer: true });
    const raw = (!paragraph && extendPastVoids(read, release)) || read;
    if (!raw) {
      if (cur?.type === "block") restoreSelection();
      return;
    }
    const promoted = promoteSelection(getState().store, registry, raw);
    if (!sameSelection(cur, promoted)) runDispatch((tx) => tx.setSelection(promoted));
    else restoreSelection();
  }

  /** a plain click while the model selection is already 'block'/'cells'
   * (e.g. clicking into a different table cell right after a cells-rectangle
   * selection) has no other way back to 'text' -- the SHARED document
   * selectionchange listener deliberately
   * ignores every DOM/model mismatch whenever the current selection isn't
   * 'text' (a stale/delayed event from an EARLIER write racing against a
   * deliberate block/cells selection is expected there, not external -- see
   * that function's own comment); relaxing that guard broadly risks
   * reintroducing the exact async race it was written to fix. This is a
   * separate, synchronous 'click' listener instead: by the time 'click'
   * fires, the browser has already placed its own new native selection (no
   * delayed-task race to protect against here), so promoting the CURRENT
   * live DOM selection is always correct. No-ops for a void click (onMouseDown
   * above already owns that) or when the model is already 'text' (the shared
   * listener already handles that case).
   *
   * A real trusted click's own 'mouseup'/'click' can land on a
   * DIFFERENT element than its 'mousedown' did, if the mousedown's own
   * synchronous handler (onMouseDown above) already caused a layout shift by
   * the time mouseup is dispatched a few ms later -- e.g. selecting a void
   * block reveals new same-flow UI (a caption input, e.g. the
   * image view) that grows the page and pushes whatever WAS at that pixel
   * further down, so 'click' fires on an unrelated paragraph the user never
   * touched. Left unguarded, this function would then "correctly" (by its
   * own rule above) read that unrelated paragraph's now-real DOM caret and
   * promote it, silently undoing the void selection onMouseDown just made in
   * the very same physical gesture. justSelectedVoidId is a one-shot guard
   * against exactly that: this click is still part of that same gesture. */
  function onClick(e: MouseEvent): void {
    if (justSelectedVoidId !== null) {
      justSelectedVoidId = null;
      return;
    }
    if (isInsideVoidEvent(e)) return;
    // A press that started on text: take its selection now, before a control the user reaches
    // for next (a toolbar select) can act on the previous one. The browser has settled the
    // selection by 'click', so this never fights the drag.
    if (pendingPointerSync !== null) {
      flushPointerSync();
      return;
    }
    const cur = getState().selection;
    if (!cur || cur.type === "text") return;
    const raw = readDOMSelection(root, { store: getState().store, registry, pointer: true });
    if (!raw) return;
    const promoted = promoteSelection(getState().store, registry, raw);
    if (sameSelection(cur, promoted)) return;
    runDispatch((tx) => tx.setSelection(promoted));
  }

  function handleVoidArrowEntry(e: KeyboardEvent): void {
    const sel = getState().selection;
    if (!sel || sel.type !== "text" || e.shiftKey) return;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const voidId = adjacentVoidAt(sel, dir);
    if (voidId) {
      e.preventDefault();
      runDispatch((tx) => tx.setSelection({ type: "block", ids: [voidId] }));
    }
  }

  function onBeforeInput(e: InputEvent): void {
    if (isInsideVoidEvent(e)) return;
    if (e.isComposing) return; // composition owns the DOM; absorbed via 'input'/compositionend
    flushComposition();
    const type = e.inputType;
    if (type === "insertText" || type === "insertReplacementText") {
      e.preventDefault();
      onInsertText(e);
      return;
    }
    if (type === "insertLineBreak") {
      e.preventDefault();
      onInsertLineBreak(e);
      return;
    }
    if (DELETE_TYPES.has(type)) {
      e.preventDefault();
      onDelete(e, type);
      return;
    }
    if (type === "insertParagraph") {
      e.preventDefault();
      onInsertParagraph(e);
      return;
    }
    if (type === "historyUndo") {
      e.preventDefault();
      deps.onHistory?.("undo");
      return;
    }
    if (type === "historyRedo") {
      e.preventDefault();
      deps.onHistory?.("redo");
      return;
    }
    // Unhandled inputType (paste/drop/... -- later tasks): don't
    // preventDefault, let the browser edit the DOM, absorb it via 'input'.
  }

  function onInput(e: Event): void {
    if (isInsideVoidEvent(e)) return;
    if (compose.id) {
      sync(compose.id); // every input during composition
      return;
    }
    const blockId = closestBlockId(e.target, root);
    if (blockId) {
      sync(blockId); // absorb path for an unhandled/undefaulted beforeinput
      restoreSelection();
    }
  }

  function onCompositionStart(e: CompositionEvent): void {
    if (isInsideVoidEvent(e)) return;
    flushComposition();
    const sel = readDOMSelection(root);
    if (!sel || sel.type !== "text") return;
    let point: Point;
    if (!collapsed(sel)) {
      // a composition can't span our block boundaries -- collapse first.
      const start = preOrderStart(sel.anchor, sel.focus);
      runDispatch((tx) => tx.deleteRange(sel).setSelection({ type: "text", anchor: start, focus: start }));
      point = start;
    } else {
      point = sel.anchor;
    }
    compose.id = point.blockId;
    compose.active = true;
    // A stored-mark override (Mod+b with a collapsed caret) is consumed here,
    // exactly once, same one-shot contract as onInsertText's
    // consumeInsertMarks -- composed text has no marked DOM of its own to
    // physically sit inside of (unlike composing next to already-marked
    // text, which inherits for free), so ime.ts's syncBlockFromDOM needs the
    // pre-composition content + offset to know which substring to wrap.
    const override = extensions.marksRef.stored;
    extensions.marksRef.stored = null;
    if (override !== null) {
      compose.overrideMarks = override;
      compose.startContent = getState().store.records.get(point.blockId)?.content ?? [];
      compose.startOffset = point.offset;
    } else {
      compose.overrideMarks = null;
      compose.startContent = null;
      compose.startOffset = null;
    }
  }

  function onCompositionEnd(): void {
    compose.active = false;
    sync(compose.id); // best-effort immediate sync; compose.id stays set (pending)
    // until the next command's flushComposition(), in case the browser's
    // truly-final text arrives via a straggling 'input' after this event
    // (Safari ordering).
  }

  /** Recompute text selection from the live DOM before each keydown, including
   * the click→keydown gap before async selectionchange has reached the model.
   * Block/cells selections have no DOM correlate and remain model-owned. */
  function syncedSelection(): Selection | null {
    const modelSel = getState().selection;
    if (modelSel && modelSel.type !== "text") return modelSel;
    const raw = readDOMSelection(root);
    if (!raw) return modelSel; // no live DOM selection to reconcile against (e.g. not focused)
    const promoted = promoteSelection(getState().store, registry, raw);
    if (sameSelection(modelSel, promoted)) return modelSel;
    runDispatch((tx) => tx.setSelection(promoted));
    return promoted;
  }

  function moveLineBoundary(sel: Extract<Selection, { type: "text" }>, key: "Home" | "End", extend: boolean): void {
    const blockId = sel.focus.blockId;
    const native = root.ownerDocument.defaultView?.getSelection();
    // Let the browser locate the visual line edge (including soft wrapping),
    // but own the key's default so macOS End/Home cannot scroll the page.
    if (native && typeof native.modify === "function") {
      native.modify(extend ? "extend" : "move", key === "End" ? "forward" : "backward", "lineboundary");
      const moved = readDOMSelection(root);
      if (moved?.type === "text" && moved.focus.blockId === blockId) {
        runDispatch((tx) => tx.setSelection(moved));
        return;
      }
    }
    // Jsdom/older engines lack Selection.modify; logical newline
    // boundaries preserve keyboard navigation without a geometry engine.
    const text = (getState().store.records.get(blockId)?.content ?? []).map((inl) => isText(inl) ? inl.text : "\uFFFC").join("");
    const end = text.indexOf("\n", sel.focus.offset);
    const offset = key === "End" ? (end < 0 ? text.length : end) : text.lastIndexOf("\n", sel.focus.offset - 1) + 1;
    const point = { blockId, offset };
    runDispatch((tx) => tx.setSelection({ type: "text", anchor: extend ? sel.anchor : point, focus: point }));
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isInsideVoidEvent(e)) return;
    if (e.isComposing || e.keyCode === 229) return; // never double-process a composition-confirming key
    flushComposition();

    // An open suggestion menu (slash/mention) gets first crack at navigation
    // keys (ArrowUp/Down/Enter/Escape, typically) before anything else.
    if (extensions.suggestions.handleKey(e)) {
      e.preventDefault();
      return;
    }

    const sel = syncedSelection();
    const mod = e.metaKey || e.ctrlKey;

    // Backspace-undoes-an-auto-conversion: only when the caret sits exactly
    // where the rule left it (nothing else happened since) -- checked before
    // every other Backspace path (including the extension keymap chain and
    // the offset-0 boundary rules below), since it's strictly more specific.
    if (inputRuleUndo && !mod && e.key === "Backspace" && sel?.type === "text" && collapsed(sel) && sel.anchor.blockId === inputRuleUndo.blockId && sel.anchor.offset === inputRuleUndo.offset) {
      e.preventDefault();
      inputRuleUndo = null;
      deps.onHistory?.("undo");
      return;
    }
    inputRuleUndo = null; // any other key (or a non-matching Backspace) closes the "immediately after" window

    // Extension keymap priority chain: the current
    // block's own BlockSpec.keymap first, then every registerKeymap entry in
    // descending priority (the built-in default keymap is just another entry,
    // registered at the lowest priority by createEditor).
    {
      const combo = comboFromEvent(e);
      const state = getState();
      const keymapCtx: KeymapCtx = { state, registry, root, event: e, dispatch: runDispatch, marksRef: extensions.marksRef, onLinkRequest: extensions.onLinkRequest };
      if (dispatchKeymap(combo, keymapCtx, currentBlockKeymap(state, registry), extensions.keymaps)) {
        e.preventDefault();
        return;
      }
    }

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onModA();
      return;
    }

    // Cmd+Z/Cmd+Shift+Z: don't wait for the browser to fire beforeinput's
    // historyUndo/historyRedo -- since every edit here already preventDefaults
    // the native DOM mutation, Chromium's own undo manager has nothing
    // recorded and will NOT fire historyUndo at all (verified empirically).
    // The beforeinput historyUndo/historyRedo handler stays too, as a
    // harmless fallback for whatever unhandled/absorbed path DID let the
    // browser record something of its own.
    if (mod && !e.altKey && e.key.toLowerCase() === "z" && deps.onHistory) {
      e.preventDefault();
      deps.onHistory(e.shiftKey ? "redo" : "undo");
      return;
    }

    if (sel?.type === "text" && !mod && !e.altKey && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      moveLineBoundary(sel, e.key, e.shiftKey);
      return;
    }

    if (sel?.type === "text" && !mod && collapsed(sel) && (e.key === "Backspace" || e.key === "Delete")) {
      // Handled here (from the MODEL's own selection), not left to beforeinput
      // reading a fresh DOM selection: (1) a beforeinput deleteContentForward
      // never fires at all when "forward" would delete INTO a
      // contenteditable=false void -- Chromium gives up silently rather than
      // asking us; (2) empirically, Chromium's own default keydown handling
      // for Backspace/Delete can itself re-canonicalize (BEFORE beforeinput
      // even fires) a caret sitting at offset 0 of a block nested right after
      // a sibling's own text to the END of that sibling's text instead --
      // reading window.getSelection() at that point would then see the WRONG
      // block entirely. The model's own last-committed selection has neither
      // problem. onDelete (beforeinput) keeps the same boundary logic too,
      // for callers that dispatch beforeinput directly (e.g. jsdom tests).
      const point = sel.anchor;
      if (e.key === "Backspace" && point.offset === 0) {
        e.preventDefault();
        runBackwardBoundary(point);
        return;
      }
      if (e.key === "Delete" && point.offset === contentLength(getState().store.records.get(point.blockId)?.content)) {
        e.preventDefault();
        runForwardBoundary(point);
        return;
      }
    }

    if ((sel?.type === "block" || sel?.type === "cells") && (e.key === "Backspace" || e.key === "Delete") && !mod) {
      e.preventDefault();
      if (sel.type === "block") onDeleteBlockSelection(sel);
      else runDispatch((tx) => tx.deleteRange(sel));
      return;
    }

    if (sel?.type === "block") {
      if (e.key === "Enter") {
        e.preventDefault();
        onEnterOnBlockSelection(sel);
        return;
      }
      if (e.key === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        extendBlockSelection(sel, 1);
        return;
      }
      if (e.key === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        extendBlockSelection(sel, -1);
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowRight") && !e.shiftKey) {
        e.preventDefault();
        moveOffBlockSelection(sel, 1);
        return;
      }
      if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && !e.shiftKey) {
        e.preventDefault();
        moveOffBlockSelection(sel, -1);
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        onTypeReplaceBlockSelection(sel, e.key);
        return;
      }
      return; // swallow other keys while block-selected (safe default, no native caret to move)
    }

    if (e.key === "Escape" && sel?.type === "text") {
      e.preventDefault();
      onEscape(sel);
      return;
    }

    if (!mod && (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp")) {
      handleVoidArrowEntry(e);
    }
  }

  const mo = new MutationObserver((records) => {
    const reverted = new Set<string>();
    for (const rec of records) {
      if (isInsideVoid(rec.target)) continue;
      const blockId = closestBlockId(rec.target, root);
      if (rec.type === "characterData") {
        sync(blockId);
      } else if (rec.type === "childList" && blockId && blockId !== compose.id) {
        // Structural change outside our own render pass and outside the
        // actively-composing block: revert by re-rendering that block from
        // the model (force: the DOM, and anything render.ts cached about it,
        // can no longer be trusted).
        reverted.add(blockId);
      }
    }
    if (reverted.size > 0) {
      render(reverted);
      restoreSelection();
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });

  root.addEventListener("beforeinput", onBeforeInput as EventListener);
  root.addEventListener("input", onInput);
  root.addEventListener("compositionstart", onCompositionStart as EventListener);
  root.addEventListener("compositionend", onCompositionEnd);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("copy", onCopy as EventListener);
  root.addEventListener("cut", onCut as EventListener);
  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("click", onClick);

  // A 'block' selection is shown by block renderers as "selected" (edit controls
  // visible). It has no DOM correlate, so it would otherwise outlive the editor
  // losing focus. Clear it once focus has really left the root (a click on the page,
  // or focus moving to another editor or control). Focus moving between the root
  // and the block's own controls stays inside the root, so those interactions keep
  // the selection. A window blur keeps it (document.hasFocus() is false).
  // Editor-owned UI rendered outside the root (the drag handle, toolbar, menus,
  // portals) opts out by marking itself (or an ancestor) with
  // `data-jul-editor-keep-selection`: focus landing there keeps the selection.
  const keepSelectionSelector = `[${KEEP_SELECTION_ATTRIBUTE}]`;
  function isKeepSelectionTarget(node: unknown): boolean {
    return node instanceof Element && node.closest(keepSelectionSelector) !== null;
  }
  /** The element focused now, resolved through shadow roots. */
  function currentActiveElement(): Element | null {
    const rootNode = root.getRootNode();
    let active: Element | null = (rootNode instanceof ShadowRoot || rootNode instanceof Document ? rootNode.activeElement : null) ?? root.ownerDocument.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }
  // Focus parked on a keep-selection element no longer reaches the root's own focusout, so watch that
  // element until focus leaves it (back into the editor, or somewhere that should clear the selection).
  let watchedKeepTarget: Element | null = null;
  function watchKeepSelectionTarget(el: Element | null): void {
    if (watchedKeepTarget === el) return;
    watchedKeepTarget?.removeEventListener("focusout", onFocusOut as EventListener);
    watchedKeepTarget = el;
    el?.addEventListener("focusout", onFocusOut as EventListener);
  }
  let lastInputWasPointer = false;
  const onPointerInput = (): void => { lastInputWasPointer = true; };
  const onKeyInput = (): void => {
    flushPointerSync();
    lastInputWasPointer = false;
    registered.paragraphClick = false;
  };
  root.ownerDocument.addEventListener("pointerdown", onPointerInput, true);
  root.ownerDocument.addEventListener("keydown", onKeyInput, true);
  // Focus orphaned on the body (its keep-selection control unmounted) fires no further focusout, so the selection would
  // outlive a later click elsewhere. Until focus or a pointer lands somewhere, watch the document for that move.
  let disarmOrphanWatch: (() => void) | null = null;
  function armOrphanedFocusWatch(): void {
    if (disarmOrphanWatch) return;
    const doc = root.ownerDocument;
    const onMove = (e: Event): void => {
      const t = e.target;
      disarmOrphanWatch?.();
      if (t instanceof Node && root.contains(t)) return;
      if (isKeepSelectionTarget(t)) { if (e.type === "focusin") watchKeepSelectionTarget(t as Element); return; }
      if (getState().selection?.type === "block") runDispatch((tx) => tx.setSelection(null));
    };
    disarmOrphanWatch = () => {
      doc.removeEventListener("pointerdown", onMove, true);
      doc.removeEventListener("focusin", onMove, true);
      disarmOrphanWatch = null;
    };
    doc.addEventListener("pointerdown", onMove, true);
    doc.addEventListener("focusin", onMove, true);
  }
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  function onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget;
    if (next instanceof Node && root.contains(next)) { watchKeepSelectionTarget(null); return; }
    if (isKeepSelectionTarget(next)) { watchKeepSelectionTarget(next as Element); return; }
    const lost = e.target;
    // Only a control inside the root can be "swapped out" by its renderer; an external keep-selection
    // target (the drag handle) unmounting because focus left is the user leaving.
    const lostInsideRoot = lost instanceof Node && root.contains(lost);
    // An external keep-selection control that is already detached when its focusout fires was unmounted by its host
    // (a keyboard move re-renders the block, and the drag handle is rendered conditionally on the block's rect). That
    // is a re-render, not the user leaving: if nothing else took focus the selection stays.
    // Focusout fires before the control is detached, so only the last input tells a keyboard-driven re-render from a click
    // elsewhere (the host unmounts the handle right after a pointerdown outside too, and that is the user leaving).
    const lostKeepControl = isKeepSelectionTarget(lost) && !lostInsideRoot && !lastInputWasPointer;
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (getState().selection?.type !== "block") return;
      // A focused control that was unmounted (a renderer swapping its own controls) is not the user leaving.
      if (lostInsideRoot && lost instanceof Node && !lost.isConnected) return;
      const active = currentActiveElement();
      // An unmounted keep-selection control drops focus to the body; only a real focus move (to another element) leaves the editor.
      if (lostKeepControl && lost instanceof Node && !lost.isConnected && (!active || active === root.ownerDocument.body)) { armOrphanedFocusWatch(); return; }
      if (active && root.contains(active)) { watchKeepSelectionTarget(null); return; }
      // Window blur: keep the selection, and keep watching a keep-selection target so its later focusout still clears.
      if (!root.ownerDocument.hasFocus()) { watchKeepSelectionTarget(isKeepSelectionTarget(active) ? active : null); return; }
      // relatedTarget is null for some focus moves (e.g. a click on a non-focusable part of a keep-selection control); the settled activeElement is authoritative.
      if (isKeepSelectionTarget(active)) { watchKeepSelectionTarget(active); return; }
      watchKeepSelectionTarget(null);
      runDispatch((tx) => tx.setSelection(null));
    }, 0);
  }
  root.addEventListener("focusout", onFocusOut);

  const registered: RegisteredView = { root, registry, compose, getState, runDispatch, suppressed: false, pointerSelecting: false, lastInputWasPointer: () => lastInputWasPointer, paragraphClick: false, restoreSelection };
  registeredViews.add(registered);
  ensureSharedListener();

  return {
    drainMutations() {
      mo.takeRecords();
    },
    suppressOwnWrite() {
      registered.suppressed = true;
      // selectionchange is dispatched as its own task, not a microtask, so the
      // self-heal has to outlive at least one macrotask turn -- a
      // queueMicrotask() here clears the flag before the real event we're
      // suppressing even arrives, defeating the whole point (found via an
      // e2e flake: a moveOffBlockSelection write's own selectionchange came
      // back in as if it were an external one and re-dispatched a redundant
      // setSelection).
      setTimeout(() => {
        registered.suppressed = false;
      }, 0);
    },
    flush() {
      flushComposition();
    },
    isPointerSelecting: () => registered.pointerSelecting,
    destroy() {
      mo.disconnect();
      disarmOrphanWatch?.();
      stopPointerSelection?.();
      root.ownerDocument.removeEventListener("pointerdown", onPointerInput, true);
      root.ownerDocument.removeEventListener("keydown", onKeyInput, true);
      root.removeEventListener("beforeinput", onBeforeInput as EventListener);
      root.removeEventListener("input", onInput);
      root.removeEventListener("compositionstart", onCompositionStart as EventListener);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("copy", onCopy as EventListener);
      root.removeEventListener("cut", onCut as EventListener);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focusout", onFocusOut);
      watchKeepSelectionTarget(null);
      if (blurTimer !== null) clearTimeout(blurTimer);
      registeredViews.delete(registered);
      if (registeredViews.size === 0 && sharedListenerAttached) {
        document.removeEventListener("selectionchange", onDocumentSelectionChange);
        sharedListenerAttached = false;
      }
    },
  };
}
