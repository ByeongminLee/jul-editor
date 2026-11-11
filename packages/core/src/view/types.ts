import type { Registry } from "../model/schema.js";
import type { Block } from "../model/types.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState } from "../store/types.js";
import type { Extensions } from "./interaction.js";
import type { Decoration } from "./inline-decorations.js";
import type { RenderVoidFn } from "./render.js";
import type { UploadFn, UploadState, PendingUploadInfo } from "./upload.js";

export type { RenderVoidFn };
export type { UploadFn, UploadState, PendingUploadInfo } from "./upload.js";

/** `editor.update(fn)`-style: the view calls this with a builder closure and
 * gets the committed result back synchronously. The state OWNER (whoever
 * calls createView) is responsible for actually running createTransaction+
 * commit and persisting the resulting EditorState -- the view only mirrors
 * whatever TransactionResult.state it's handed back. */
export type Dispatch = (build: (tx: Transaction) => Transaction) => TransactionResult;

export interface CreateViewOptions {
  element: HTMLElement;
  state: EditorState;
  registry: Registry;
  dispatch: Dispatch;
  /** A SEPARATE dispatch used only for an upload's own completion patch (fill
   * in `src`/`assetId` once `onUpload` resolves) -- must update state/render
   * WITHOUT pushing its own undo step, so one undo of the insertion removes
   * the whole (uploading-or-not) image rather than leaving an empty-src ghost
   * behind as a second step. Omitted: falls back to `dispatch` (a bare
   * createView has no history to protect either way). `createEditor` supplies
   * its own history-skipping version. */
  dispatchSystem?: Dispatch;
  renderVoid?: RenderVoidFn;
  /** Extension points (keymaps/inputRules/suggestions/stored marks).
   * Omitted for a bare createView (e.g. unit tests) -- a fresh no-op set is
   * created internally so the interaction layer always has one to read. */
  extensions?: Extensions;
  /** beforeinput's historyUndo/historyRedo (native Cmd+Z/Cmd+Shift+Z on the
   * contenteditable root) are routed here instead of being handled by the
   * view itself -- createView never owns history; a
   * `createEditor` facade supplies this to wire its own createHistory(). */
  onHistory?: (direction: "undo" | "redo") => void;
  /** Pasted/dropped image files (and pasted `data:` images) are uploaded
   * through this hook -- see view/clipboard.ts/upload.ts. Omitted: `data:`
   * images are dropped (their block keeps its permanent empty src, already
   * lossy-noted by fromHTML) and real file drops/pastes are ignored entirely. */
  onUpload?: UploadFn;
  /** Deferred mode keeps files and previews in memory until uploadPending(). */
  uploadMode?: "immediate" | "deferred";
  /** Optional non-image file mapping; its block type must be registered. Return null to reject. */
  createFileBlock?: (file: File) => Block | null;
  /** A pasted external (http/https) `<img>`'s src is kept as-is by default;
   * this optionally re-hosts it (e.g. mirrors it into the same storage
   * `onUpload` uses) once the image is already in the doc. */
  rehostExternalImages?: (url: string) => Promise<{ src: string; assetId?: string }>;
  /** a text block's placeholder text (Notion's "Type '/' for
   * commands"), written as `data-placeholder` on its content element -- see
   * render.ts's EMPTY_ATTR/FOCUSED_ATTR doc comments for the CSS recipe. */
  placeholder?: string | ((block: Block) => string);
}

export interface CommitInfo {
  state: EditorState;
  changedIds: Set<string>;
}

export interface View {
  getState(): EditorState;
  /** Sets an arbitrary EditorState directly (not via a Transaction) and
   * re-renders + restores selection -- the seam a history-owning caller
   * (`createEditor`'s undo/redo) uses, since undo/redo replay a past state
   * rather than apply a new Op. `changedIds` now also drives HOW much
   * gets rendered: a real Set (undo/redo pass the history entry's own
   * recorded changedIds) renders only those blocks + their ancestor chain;
   * omitting it entirely (e.g. `setDoc`'s fresh, unrelated store) falls back
   * to a full walk of the whole tree. It's still passed through to
   * `onCommit` either way (an empty Set there when omitted).
   * `opts.requireFocus` (collaboration's remote apply) skips the DOM
   * selection write unless this editor already holds focus/selection, so a
   * remote commit never steals the caret from wherever the user actually is. */
  setState(state: EditorState, changedIds?: Set<string>, opts?: { requireFocus?: boolean }): void;
  /** Forces any pending (compositionend-fired-but-not-yet-flushed) composition
   * sync to run immediately -- see Interaction.flush's doc comment. A bare
   * createView caller doesn't need this (createView's own event handling
   * already calls it internally at the right times); createEditor's
   * `commitAndSync` calls it before every programmatic command. */
  flushPendingComposition(): void;
  /** True while `blockId` is the block actively under IME composition --
   * mirrors `ViewRenderCtx.isComposing` (render.ts), exposed here for a
   * consumer outside the view (e.g. P2's highlight controller, editor.ts)
   * that must not touch that block's DOM/selection mid-composition either. */
  isComposing(blockId: string): boolean;
  /** Instrumentation hook: fires once per committed
   * dispatch (input-driven or IME-absorbed), after DOM patch + selection
   * restore have both completed. */
  onCommit(listener: (info: CommitInfo) => void): () => void;
  /** Transient (non-doc-model) upload status for a pasted/dropped image block
   * -- undefined means "not tracked" (either never an upload, or already
   * succeeded: "ready" has no state of its own). See view/upload.ts. */
  getUploadState(blockId: string): UploadState | undefined;
  /** Re-attempts a failed upload with the SAME File (still held in memory) --
   * a no-op if `blockId` never had a tracked upload (nothing to retry). */
  retryUpload(blockId: string): void;
  insertFiles(files: File[]): string[];
  /** Stages `file` as the pending upload of an image/file block that is already in the doc. */
  attachUpload(blockId: string, file: File): boolean;
  getUploadPreview(blockId: string): string | undefined;
  getPendingUploads(): PendingUploadInfo[];
  uploadPending(): Promise<{uploaded: string[]; failed: string[]}>;
  /** Fires whenever `getUploadState(blockId)` would return something new
   * (start/success/failure) -- a React (or other) consumer's re-render seam,
   * since upload status changes never go through onCommit (it's not part of
   * EditorState by design). */
  onUpload(listener: (blockId: string) => void): () => void;
  /** Replaces the inline decorations registered under `key` (an empty list clears them); see
   * view/inline-decorations.ts. Re-renders only the affected blocks, never touches the model. */
  setDecorations(key: string, decorations: readonly Decoration[]): void;
  getDecorations(key: string): readonly Decoration[];
  destroy(): void;
}
