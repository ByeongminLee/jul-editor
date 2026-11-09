// createView: renders an EditorState's Store into a single contenteditable
// root and wires up input/IME/mutation handling. Vanilla DOM, framework-free,
// no DOM access at module top level (only inside createView's body). This is
// the real beginning of @jul-editor/core's view layer; later additions extend it,
// they don't replace it.

import { createEmitter } from "../store/emitter.js";
import { attachClipboard } from "./clipboard.js";
import { isInsideVoid } from "./dom.js";
import type { ComposeRef } from "./ime.js";
import type { Extensions, Interaction } from "./interaction.js";
import { attachInteraction } from "./interaction.js";
import { createMarksRef } from "./marks.js";
import type { BlockEls, ViewRenderCtx } from "./render.js";
import { DecorationSet } from "./inline-decorations.js";
import { applyFocusedAttr, renderAll, renderChanged } from "./render.js";
import { applyRootStyle } from "./root-style.js";
import { getCaretRect, writeBlockSelectionAttrs, writeDOMSelection } from "./selection.js";
import { createSuggestionController } from "./suggestion.js";
import type { CommitInfo, CreateViewOptions, View } from "./types.js";

export { applyRootStyle } from "./root-style.js";
export { attachClipboard } from "./clipboard.js";
export type { ClipboardDeps, ClipboardHandle } from "./clipboard.js";
export { createUploadRegistry, dataUrlToFile, performUpload } from "./upload.js";
export type { UploadFn, UploadRegistry, UploadState, UploadContext, UploadResult, PendingUploadInfo } from "./upload.js";
export * from "./dom.js";
export { buildContentDOM, plainTextOf, readContentFromDOM, runKey } from "./inline-dom.js";
export type { Decoration, RangeDecoration, WidgetDecoration } from "./inline-decorations.js";
export { isWidgetDecoration } from "./inline-decorations.js";
export { renderAll, renderBlock, renderChildren, isVoidSpec } from "./render.js";
export type { BlockEls, ViewRenderCtx, RenderVoidFn } from "./render.js";
export { domFromPoint, getCaretRect, getSelectionRect, pointFromDOM, promoteSelection, readDOMSelection, writeBlockSelectionAttrs, writeDOMSelection } from "./selection.js";
export { syncBlockFromDOM } from "./ime.js";
export type { ComposeRef, SyncDeps } from "./ime.js";
export type { CommitInfo, CreateViewOptions, Dispatch, View } from "./types.js";
export type { Extensions } from "./interaction.js";
export { KEEP_SELECTION_ATTRIBUTE } from "./interaction.js";
export { comboFromEvent, currentBlockKeymap, dispatchKeymap, isMac } from "./keymap.js";
export type { Keymap, KeymapCtx, KeymapEntry, KeymapFn } from "./keymap.js";
export { currentBlockInputRules, runInputRules } from "./input-rules.js";
export type { InputRuleCtx, InputRuleEntry } from "./input-rules.js";
export { createSuggestionController } from "./suggestion.js";
export type { SuggestionConfig, SuggestionController, SuggestionHandle, SuggestionOpenContext, SuggestionRange, SuggestionState } from "./suggestion.js";
export { activeMarks, consumeInsertMarks, createMarksRef, marksAtPoint, textSelectionBlockIds, toggleMarkOrStore } from "./marks.js";
export type { MarksRef } from "./marks.js";
export { createEditor } from "./editor.js";
export type { CreateEditorOptions, Editor } from "./editor.js";
export { collectTextNodes, createHighlightController, HIGHLIGHT_TOKENS, mapRangeToDOM } from "./highlight.js";
export type { CreateHighlightControllerOptions, HighlightController, Highlighter, HighlightRange, HighlightToken, TextNodeSpan } from "./highlight.js";

export function createView(options: CreateViewOptions): View {
  const { element: root, registry, renderVoid } = options;
  let currentState = options.state;

  const blockEls = new Map<string, BlockEls>();
  const compose: ComposeRef = { id: null, active: false, overrideMarks: null, startContent: null, startOffset: null };
  const emitter = createEmitter();
  let interaction: Interaction | undefined;

  const renderCtx: ViewRenderCtx = {
    registry,
    renderVoid,
    blockEls,
    isComposing: (id) => compose.active && compose.id === id,
    placeholder: options.placeholder,
  };

  const decorationSet = new DecorationSet();
  renderCtx.decorations = decorationSet;

  function render(forceIds?: ReadonlySet<string>): void {
    renderCtx.forceIds = forceIds;
    renderAll(root, currentState.store, renderCtx);
    renderCtx.forceIds = undefined;
    interaction?.drainMutations(); // drop mutation records our own render just generated
  }

  // the commit-driven hot path (runDispatch/runDispatchSystem/setState)
  // no longer walks the whole document every time -- `changedIds` (from
  // store/store.ts's commitPatch) says exactly which blocks + ancestors were
  // touched, so `renderChanged` visits only those. `changedIds === undefined`
  // means the caller has no such set at all (setDoc's `view.setState(state)`,
  // a fresh unrelated store) -- fall back to a full render there, same as
  // before this task. An empty (but defined) Set means a genuine no-op
  // commit (nothing changed) -- skip rendering entirely.
  function renderCommit(changedIds: ReadonlySet<string> | undefined): void {
    if (!changedIds) {
      render();
      return;
    }
    if (changedIds.size === 0) return;
    renderChanged(root, currentState.store, renderCtx, changedIds);
    interaction?.drainMutations();
  }

  // a background/system commit (an upload resolving, undo/redo, setDoc)
  // must never steal the DOM selection away from wherever the user actually
  // is -- another input, another editor instance on the page -- just because
  // THIS editor's state changed. `requireFocus` gates the actual DOM
  // selection write on the root either already holding focus or already
  // holding the live DOM selection; `writeBlockSelectionAttrs` (a presence
  // attribute only, no DOM selection involved) always still runs so the
  // model-level selection stays queryable/styleable either way.
  function restoreSelection(opts: { requireFocus?: boolean } = {}): void {
    writeBlockSelectionAttrs(blockEls, currentState.selection, currentState.store, registry); // presence-only attr, safe even mid-composition
    // FOCUSED_ATTR tracks a collapsed text caret's own block -- a
    // selection-only change (arrow keys, a click) never touches `changedIds`,
    // so this must run on every selection restore, not just a content commit.
    const sel = currentState.selection;
    applyFocusedAttr(renderCtx, sel?.type === "text" && sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset ? sel.anchor.blockId : null);
    if (compose.active) return; // never touch DOM selection while composing
    if (currentState.selection?.type === "block") {
      clearNativeHighlight();
      return;
    }
    if (currentState.selection?.type !== "text") return;
    if (opts.requireFocus) {
      const doc = root.ownerDocument;
      const domSel = doc.defaultView?.getSelection?.() ?? null;
      const selectionInRoot = !!domSel?.anchorNode && root.contains(domSel.anchorNode);
      if (!root.contains(doc.activeElement) && !selectionInRoot) return;
    }
    // only mark the next selectionchange as "our own write" to
    // ignore when we're actually ABOUT to write one -- writeDOMSelection
    // itself no-ops for a non-'text' selection (block/cells/null have no DOM
    // correlate), so suppressing unconditionally here previously ate the
    // NEXT real, externally-caused selectionchange too (found via a table
    // cells-selection test: clicking into a different cell right after a
    // cells-selection dispatch never reached onDocumentSelectionChange at
    // all, since this call's own suppress flag -- set for a write that never
    // happened -- silently swallowed the click's genuine event instead).
    // writeDOMSelection can ALSO now no-op for a 'text' selection (the
    // live DOM already maps to it) -- same bug, same fix, so the suppress
    // call moves inside writeDOMSelection's own `beforeWrite` seam, firing
    // only immediately before a real native selection write actually happens.
    writeDOMSelection(root, currentState.selection, () => interaction?.suppressOwnWrite());
  }

  // A 'block' selection has no DOM correlate, but the native selection it replaced (a partial text
  // range before Mod-a, a drag that ran onto a void) would otherwise stay painted next to the block
  // outlines. Collapse it to its focus, keeping focus (and the keyboard/clipboard target) in the
  // root. A drag still in progress is left alone: the browser is extending it.
  function clearNativeHighlight(): void {
    if (interaction?.isPointerSelecting()) return;
    const domSel = root.ownerDocument.defaultView?.getSelection?.() ?? null;
    if (!domSel || domSel.rangeCount === 0 || domSel.isCollapsed || !domSel.focusNode) return;
    if (!root.contains(domSel.anchorNode) || !root.contains(domSel.focusNode)) return;
    interaction?.suppressOwnWrite();
    // Never park the caret inside a void's non-editable UI (a drag that ended on a chart's labels).
    if (isInsideVoid(domSel.focusNode) && !isInsideVoid(domSel.anchorNode)) domSel.collapse(domSel.anchorNode!, domSel.anchorOffset);
    else domSel.collapse(domSel.focusNode, domSel.focusOffset);
  }

  function runDispatch(build: Parameters<CreateViewOptions["dispatch"]>[0]) {
    const result = options.dispatch(build);
    currentState = result.state;
    renderCommit(result.changedIds);
    restoreSelection();
    emitter.emit({ state: currentState, changedIds: result.changedIds });
    return result;
  }

  // Same render/restoreSelection/emit follow-up as runDispatch, but through
  // `dispatchSystem` (falls back to the regular `dispatch` when the caller
  // didn't supply one -- see CreateViewOptions.dispatchSystem's doc comment).
  function runDispatchSystem(build: Parameters<CreateViewOptions["dispatch"]>[0]) {
    const result = (options.dispatchSystem ?? options.dispatch)(build);
    currentState = result.state;
    renderCommit(result.changedIds);
    restoreSelection({ requireFocus: true });
    emitter.emit({ state: currentState, changedIds: result.changedIds });
    return result;
  }

  // A bare createView (no createEditor) still needs a real (if empty) set of
  // extension registries -- the interaction layer always reads one.
  const extensions: Extensions =
    options.extensions ??
    {
      keymaps: [],
      inputRules: [],
      marksRef: createMarksRef(),
      onLinkRequest: async () => (typeof window === "undefined" ? null : window.prompt("Link URL", "")),
      suggestions: createSuggestionController({ getState: () => currentState, dispatch: runDispatch, getCaretRect }),
    };

  applyRootStyle(root);
  root.setAttribute("contenteditable", "true");
  root.setAttribute("data-jul-editor-root", "");
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");

  render();
  restoreSelection();

  interaction = attachInteraction({
    root,
    registry,
    blockEls,
    compose,
    extensions,
    getState: () => currentState,
    runDispatch,
    render,
    restoreSelection,
    onHistory: options.onHistory,
  });

  const clipboard = attachClipboard({
    root,
    registry,
    getState: () => currentState,
    runDispatch,
    runDispatchSystem,
    onUpload: options.onUpload,
    uploadMode: options.uploadMode,
    createFileBlock: options.createFileBlock,
    rehostExternalImages: options.rehostExternalImages,
    marksRef: extensions.marksRef,
  });

  return {
    getState: () => currentState,
    setState(state, changedIds, opts) {
      currentState = state;
      renderCommit(changedIds);
      // NOTE: unlike dispatchSystem, this generic setState is also the
      // path commitAndSync uses for every ordinary programmatic command
      // (editor.update/commands.*, always genuinely interactive) as well as
      // undo/redo/setDoc -- gating it on focus would silently drop the DOM
      // selection write those commands' own callers (and every test that
      // positions a selection with editor.update before dispatching a real
      // DOM key/input event) depend on. dispatchSystem is the one path a
      // truly background/system commit (e.g. an upload finishing) actually
      // takes, so the focus guard lives there instead (see its own call).
      restoreSelection(opts?.requireFocus ? { requireFocus: true } : undefined);
      emitter.emit({ state: currentState, changedIds: changedIds ?? new Set() });
    },
    onCommit: (listener: (info: CommitInfo) => void) => emitter.onCommit(listener),
    flushPendingComposition() {
      interaction?.flush();
    },
    isComposing: (blockId) => renderCtx.isComposing(blockId),
    setDecorations(key, decorations) {
      const affected = decorationSet.set(key, decorations);
      if (affected.size === 0) return;
      renderChanged(root, currentState.store, renderCtx, affected);
      interaction?.drainMutations();
      // a rebuilt block lost its DOM selection nodes; rewrite from the model, but never steal focus
      restoreSelection({ requireFocus: true });
    },
    getDecorations: (key) => decorationSet.get(key),
    getUploadState: (blockId) => clipboard.uploadRegistry.get(blockId),
    retryUpload: (blockId) => clipboard.retryUpload(blockId),
    insertFiles: (files) => clipboard.insertFiles(files),
    attachUpload: (blockId, file) => clipboard.attachUpload(blockId, file),
    getUploadPreview: (id) => clipboard.uploadRegistry.getPreview(id),
    getPendingUploads: () => clipboard.getPendingUploads(),
    uploadPending: () => clipboard.uploadPending(),
    onUpload: (listener) => clipboard.uploadRegistry.onChange(listener),
    destroy() {
      interaction?.destroy();
      clipboard.destroy();
      // a void block's own renderVoid cleanup (React portal unmount, an
      // app-registered listener, ...) otherwise never runs when the editor
      // itself is torn down -- only individual block removal (renderAll's
      // prune) called voidDestroy before this fix.
      for (const els of blockEls.values()) els.voidDestroy?.();
      blockEls.clear();
      root.removeAttribute("contenteditable");
      root.removeAttribute("data-jul-editor-root");
      root.removeAttribute("role");
      root.removeAttribute("aria-multiline");
    },
  };
}
export { addPasteUrlInterceptor } from "./embed-paste.js";
export type { PasteUrlContext, PasteUrlInterceptor } from "./embed-paste.js";
