// paste + drop: decodeClipboard/fromHTML -> Transaction.pasteFragment,
// plus image-file upload orchestration. Copy/cut live in interaction.ts (they
// reuse its own delete-selection helpers -- see its onCopy/onCut) since they
// don't need any of the NEW decode+insert+upload machinery this module owns.

import { decodeClipboard } from "../clipboard";
import type { PendingUpload } from "../clipboard";
import { isText } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";
import { contentLength, sliceContent, siblingsOf } from "../store/store.js";
import type { Transaction, TransactionResult } from "../store/transaction.js";
import type { EditorState, Selection } from "../store/types.js";
import { BLOCK_ATTR, ID_ATTR, closestBlockId, isInsideVoidEvent } from "./dom.js";
import { tryEmbedPaste } from "./embed-paste.js";
import { trimAutolinkTrailing } from "./input-rules.js";
import type { MarksRef } from "./marks.js";
import { pointFromDOM, promoteSelection, readDOMSelection } from "./selection.js";
import { createUploadRegistry, dataUrlToFile, performUpload } from "./upload.js";
import type { UploadFn, UploadRegistry, PendingUploadInfo } from "./upload.js";

export interface ClipboardDeps {
  root: HTMLElement;
  registry: Registry;
  getState: () => EditorState;
  /** The history-recording dispatch (typing/deleting go through the same one
   * everywhere else in the view) -- used for the actual doc-content changes
   * a paste/drop makes. */
  runDispatch: (build: (tx: Transaction) => Transaction) => TransactionResult;
  /** A SEPARATE dispatch that updates state (and re-renders) WITHOUT pushing
   * a new undo step -- an upload's own completion patches `src`/`assetId`
   * onto the block the insertion already made undoable; undoing once must
   * remove the whole image, not leave an "empty src" ghost behind as a
   * second undo step. createEditor supplies its own history-skipping
   * version (see editor.ts's `dispatchSystem`); a bare createView falls back
   * to `runDispatch` (it has no history to protect either way). */
  runDispatchSystem: (build: (tx: Transaction) => Transaction) => TransactionResult;
  onUpload?: UploadFn;
  uploadMode?: "immediate" | "deferred";
  createFileBlock?: (file: File) => Block | null;
  rehostExternalImages?: (url: string) => Promise<{ src: string; assetId?: string }>;
  /** cleared to `[]` right after a paste-autolink so text typed
   * immediately after isn't swallowed into the link (same non-inclusive
   * convention as inputRules.ts's own inline `code`/autolink rules). */
  marksRef: MarksRef;
}

export interface ClipboardHandle {
  uploadRegistry: UploadRegistry;
  retryUpload(blockId: string): void;
  insertFiles(files: File[]): string[];
  attachUpload(blockId: string, file: File): boolean;
  uploadPending(): Promise<{ uploaded: string[]; failed: string[] }>;
  getPendingUploads(): PendingUploadInfo[];
  destroy(): void;
}

const EXTERNAL_IMAGE_RE = /^https?:\/\//i;

export function attachClipboard(deps: ClipboardDeps): ClipboardHandle {
  const { root, registry, getState, runDispatch, runDispatchSystem, onUpload, rehostExternalImages, marksRef } = deps;
  const uploadRegistry = createUploadRegistry();

  const inflight = new Map<string, Promise<boolean>>();
  const uploadTypes = new Map<string, string>();
  let destroyed = false;
  function beginUpload(blockId: string, file: File): Promise<boolean> {
    const active = inflight.get(blockId);
    if (active) return active.then((result) => uploadRegistry.getFile(blockId) === file && uploadRegistry.get(blockId)?.status === "queued" ? beginUpload(blockId, file) : result);
    if (destroyed || getState().store.records.get(blockId)?.type !== uploadTypes.get(blockId)) { uploadRegistry.succeed(blockId); return Promise.resolve(false); }
    if (!onUpload) { uploadRegistry.fail(blockId, "No upload handler configured."); return Promise.resolve(false); }
    const originalSrc = getState().store.records.get(blockId)?.props.src;
    const job = performUpload(uploadRegistry, blockId, file, onUpload, (result) => {
      const current = getState().store.records.get(blockId);
      if (destroyed || !current || current.type !== uploadTypes.get(blockId)) throw new Error("The upload target was removed or changed.");
      if (current.props.src !== originalSrc) return; // A URL entered by the user wins over an older upload.
      runDispatchSystem(tx => tx.setProps(blockId, { src: result.src, assetId: result.assetId }));
    }, uploadTypes.get(blockId) === "image" ? "image" : "file").finally(() => inflight.delete(blockId));
    inflight.set(blockId, job);
    return job;
  }
  function stageUpload(blockId: string, file: File): void {
    const record = getState().store.records.get(blockId);
    if (!record) return;
    uploadTypes.set(blockId, record.type);
    uploadRegistry.queue(blockId, file);
    if (deps.uploadMode !== "deferred") void beginUpload(blockId, file);
  }
  function retryUpload(blockId: string): void {
    const file = uploadRegistry.getFile(blockId);
    if (file) void beginUpload(blockId, file);
  }
  function getPendingUploads(): PendingUploadInfo[] {
    return uploadRegistry.pending().filter(item => getState().store.records.get(item.blockId)?.type === uploadTypes.get(item.blockId));
  }
  async function uploadPending(): Promise<{ uploaded: string[]; failed: string[] }> {
    const result = { uploaded: [] as string[], failed: [] as string[] };
    await Promise.all(getPendingUploads().map(async ({blockId, file}) => {
      const ok = await beginUpload(blockId, file);
      if (getState().store.records.has(blockId)) (ok ? result.uploaded : result.failed).push(blockId);
    }));
    // A file inserted while the first batch was in flight must block saving too.
    for (const {blockId} of getPendingUploads()) if (!result.failed.includes(blockId)) result.failed.push(blockId);
    return result;
  }
  function insertFiles(files: File[]): string[] {
    const before = new Set(getState().store.records.keys());
    const state = getState();
    const lastId = state.store.rootIds.at(-1);
    const target: InsertionTarget | undefined = state.selection ? {at: state.selection} : lastId ? {afterBlockId: lastId} : undefined;
    if (!target) return [];
    insertFragmentAndUploads(target, {version: 1, blocks: []}, [], files);
    return [...getState().store.records.keys()].filter(id => !before.has(id) && uploadRegistry.getFile(id));
  }

  /** Stages `file` as the pending upload of a block that is already in the doc (the same
   * pipeline insertFiles and paste use, minus the insertion). */
  function attachUpload(blockId: string, file: File): boolean {
    if (!onUpload && deps.uploadMode !== "deferred") return false;
    if (!getState().store.records.has(blockId)) return false;
    stageUpload(blockId, file);
    return true;
  }

  function rehostExternalImagesIn(fragment: Doc): void {
    if (!rehostExternalImages) return; // keep src by default when no hook is configured
    function walk(blocks: Block[]): void {
      for (const b of blocks) {
        const src = b.props?.src;
        if (b.type === "image" && typeof src === "string" && EXTERNAL_IMAGE_RE.test(src)) {
          const blockId = b.id;
          Promise.resolve().then(() => rehostExternalImages!(src)).then(
            (result) => {
              const current = getState().store.records.get(blockId);
              if (!destroyed && current?.props.src === src) runDispatchSystem((tx) => tx.setProps(blockId, { src: result.src, assetId: result.assetId }));
            },
            () => {}, // Rehost failure just leaves the original external src in place
          );
        }
        if (b.children) walk(b.children);
      }
    }
    walk(fragment.blocks);
  }

  /** Where a paste/drop's fragment blocks (and any file-derived image blocks)
   * get inserted: either "replace the current selection" (paste, and a drop
   * that landed on real text) or "insert as fresh siblings right after this
   * block id" (a drop that landed in the gap between/around blocks, or on a
   * void: a drop between blocks inserts after the nearest
   * block). The latter is a plain sibling insert, deliberately NOT routed
   * through Transaction.pasteFragment's selection-shaped merge rules (those
   * are for "replace what's selected", not "insert after, touching nothing
   * else" -- reusing them here would incorrectly splice into whatever
   * block/point happens to sit right after the target instead of leaving it
   * alone). */
  type InsertionTarget = { at: Selection } | { afterBlockId: string };

  /** Notion-style: a paste whose caret sits in an EMPTY text block
   * (paragraph, list item, quote, heading...) and whose first block is a
   * non-paragraph type different from the target's (heading, list item,
   * quote, code, divider...) REPLACES that block with the fragment, instead
   * of pasteFragment's merge (which would pour the first block's inline
   * content into the target and silently lose its type -- a pasted "# Title"
   * would land as plain "Title", or as a bullet in an empty bullet). Non-empty
   * targets, same-type and paragraph-first fragments keep the merge
   * behaviour, and so does a parent-restricted target (a table cell can't be
   * replaced by a heading). The caret ends at the end of the last pasted
   * block; if that block has no inline content slot (divider, table, image) a
   * fresh empty paragraph follows it so the caret has somewhere to live. */
  function replaceEmptyParagraph(at: Selection, blocks: Block[]): boolean {
    if (at.type !== "text" || at.anchor.blockId !== at.focus.blockId || at.anchor.offset !== at.focus.offset) return false;
    const first = blocks[0];
    if (!first || first.type === "paragraph") return false;
    const store = getState().store;
    const id = at.anchor.blockId;
    const rec = store.records.get(id);
    if (!rec || (rec.content ?? []).length > 0 || rec.childIds.length > 0 || rec.type === first.type) return false;
    const recSpec = registry.blocks.get(rec.type);
    if (recSpec?.content !== "inline" || recSpec.parent) return false;
    const { parentId, index } = siblingsOf(store, id);
    const last = blocks[blocks.length - 1]!;
    const lastHoldsCaret = registry.blocks.get(last.type)?.content === "inline";
    const tail: Block | null = lastHoldsCaret ? null : { id: newId(), type: "paragraph", props: {} };
    runDispatch((tx) => {
      let t = tx.removeBlock(id);
      [...blocks, ...(tail ? [tail] : [])].forEach((block, i) => {
        t = t.insertBlock(parentId, index + i, block);
      });
      const caret = tail ? { blockId: tail.id, offset: 0 } : { blockId: last.id, offset: contentLength(last.content) };
      return t.setSelection({ type: "text", anchor: caret, focus: caret });
    });
    return true;
  }

  function insertBlocksAt(target: InsertionTarget, blocks: Block[]): void {
    if (blocks.length === 0) return;
    if ("at" in target) {
      if (replaceEmptyParagraph(target.at, blocks)) return;
      runDispatch((tx) => tx.pasteFragment(target.at, blocks));
      return;
    }
    const store = getState().store;
    if (!store.records.has(target.afterBlockId)) return;
    const { parentId, index } = siblingsOf(store, target.afterBlockId);
    runDispatch((tx) => {
      let t = tx;
      blocks.forEach((block, i) => {
        t = t.insertBlock(parentId, index + 1 + i, block);
      });
      return t;
    });
  }

  /** A lone image-file paste/drop with no accompanying text/html still runs
   * through decodeClipboard's plain-text fallback (empty string -> one empty
   * paragraph "fragment") -- that synthetic block is a no-op to actually
   * insert (an empty single-paragraph fragment merges zero inline content,
   * see buildInsertFragmentOps), so treating it as "the fragment" here would
   * leave `cursor` pointing at a block id that was never really inserted. */
  function isEffectivelyEmpty(fragment: Doc): boolean {
    if (fragment.blocks.length === 0) return true;
    if (fragment.blocks.length > 1) return false;
    const only = fragment.blocks[0]!;
    return only.type === "paragraph" && (only.content ?? []).length === 0 && !only.children?.length;
  }

  /** Inserts `fragment` (if meaningfully non-empty) at `target`, then handles
   * every image the paste/drop also brought along: real Files (a direct
   * image-file paste/drop, e.g. a straight screenshot copy) each become their
   * own new image block + upload; `pendingUploads` are `data:` images that
   * fromHTML already turned into empty-src image blocks AT THEIR OWN
   * (preserved) id, so their upload just needs to be kicked off now that
   * they're actually in the doc. Every insertion after the first targets
   * "after whatever was just inserted", so a paste/drop that brought along
   * BOTH a fragment and loose image files ends up in a sensible reading order
   * instead of every image landing at the exact same original spot. */
  function insertFragmentAndUploads(target: InsertionTarget, fragment: Doc, pendingUploads: PendingUpload[], files: File[]): void {
    let cursor = target;
    if (!isEffectivelyEmpty(fragment)) {
      insertBlocksAt(cursor, fragment.blocks);
      rehostExternalImagesIn(fragment);
      const last = fragment.blocks[fragment.blocks.length - 1]!;
      cursor = { afterBlockId: last.id };
    }
    for (const file of files) {
      if (!onUpload && deps.uploadMode !== "deferred") continue;
      const block: Block | null = file.type.startsWith("image/")
        ? { id: newId(), type: "image", props: { src: "", alt: file.name } }
        : deps.createFileBlock?.(file) ?? null;
      if (!block) continue;
      insertBlocksAt(cursor, [block]);
      if (!getState().store.records.has(block.id)) continue;
      cursor = { afterBlockId: block.id };
      stageUpload(block.id, file);
    }
    for (const pending of pendingUploads) {
      if (!onUpload && deps.uploadMode !== "deferred") continue;
      const file = dataUrlToFile(pending.dataUrl);
      if (file) stageUpload(pending.blockId, file);
    }
  }

  // pasting a bare URL (nothing else in the clipboard's plain text --
  // no whitespace at all once trimmed) autolinks it instead of running the
  // ordinary markdown/HTML decode path: a collapsed caret gets the URL
  // inserted as linked text; a real (non-collapsed, same-block) selection
  // gets its own text wrapped in the link mark instead (its text is kept,
  // not replaced by the URL).
  const BARE_URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

  function tryAutolinkPaste(e: ClipboardEvent, sel: Selection): boolean {
    const raw = e.clipboardData?.getData("text/plain")?.trim() ?? "";
    if (!BARE_URL_RE.test(raw)) return false;
    // same trailing-punctuation trim as inputRules.ts's autolink-on-type
    // rule (a pasted "https://example.com." must not link the period).
    const text = trimAutolinkTrailing(raw);
    if (!text) return false;
    const href = sanitizeUrl(/^www\./i.test(text) ? `https://${text}` : text, "link");
    if (href === null) return false;
    if (sel.type === "text" && sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset) {
      const at = sel.anchor;
      const caret = { blockId: at.blockId, offset: at.offset + text.length };
      runDispatch((tx) => tx.insertText(at, text, [{ type: "link", attrs: { href } }]).setSelection({ type: "text", anchor: caret, focus: caret }));
      // `link` is non-inclusive -- text typed right after the pasted
      // autolink must not inherit it (marksAtPoint's default "inherit the
      // preceding run" convention only suits inclusive marks like bold).
      marksRef.stored = [];
      return true;
    }
    if (sel.type === "text" && sel.anchor.blockId === sel.focus.blockId) {
      // force-SET the link mark across the selection's overlapped runs
      // instead of `tx.toggleMark` -- toggling by mark TYPE only would just
      // REMOVE the link from an already-fully-linked selection instead of
      // updating its href (same fix shape as packages/react's useLinkEditor
      // setLinkMark).
      const blockId = sel.anchor.blockId;
      const from = Math.min(sel.anchor.offset, sel.focus.offset);
      const to = Math.max(sel.anchor.offset, sel.focus.offset);
      const content = getState().store.records.get(blockId)?.content ?? [];
      const next = sliceContent(content, from, to).map((inl) =>
        isText(inl) ? { ...inl, marks: [...(inl.marks ?? []).filter((m) => m.type !== "link"), { type: "link", attrs: { href } }] } : inl,
      );
      runDispatch((tx) => tx.replaceContent(blockId, from, to, next));
      return true;
    }
    return false;
  }

  // Cmd/Ctrl+Shift+V = "paste as plain text" (Notion): the `paste` event
  // itself carries no modifier state, so remember it from the keydown that
  // precedes it. Cleared by the paste itself, by keyup of V/Shift, and on blur
  // (a menu-driven paste never sets it, so it can't go stale-true).
  let shiftPaste = false;
  function onKeyDownForPaste(e: KeyboardEvent): void {
    shiftPaste = e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v";
  }
  function clearShiftPaste(): void {
    shiftPaste = false;
  }

  /** The selection a paste lands on. Block/cells selections have no DOM
   * correlate and stay model-owned; a text (or missing) model selection is
   * reconciled against the live DOM selection first, same as keydown's
   * syncedSelection: a click can place the caret before the async
   * selectionchange reaches the model -- e.g. right after a value
   * replacement (setDoc/Restore) cleared the model selection, clicking the
   * same empty block the caret was in before fires no selectionchange the
   * editor acts on, and the first paste was then ignored outright (left to
   * the browser's unmanaged native paste). */
  function pasteSelection(): Selection | null {
    const modelSel = getState().selection;
    if (modelSel && modelSel.type !== "text") return modelSel;
    const raw = readDOMSelection(root);
    if (!raw) return modelSel;
    return promoteSelection(getState().store, registry, raw);
  }

  function onPaste(e: ClipboardEvent): void {
    if (isInsideVoidEvent(e)) return;
    const sel = pasteSelection();
    if (!sel) return;
    e.preventDefault();
    const plain = shiftPaste;
    shiftPaste = false;
    // shift-paste skips embed/autolink/markdown/html conversion alike.
    if (!plain && tryEmbedPaste(e.clipboardData?.getData("text/plain") ?? "", sel, getState, runDispatch)) return;
    if (!plain && tryAutolinkPaste(e, sel)) return;
    const { doc, pendingUploads, files } = decodeClipboard(e.clipboardData ?? { getData: () => "" }, { registry, plain });
    insertFragmentAndUploads({ at: sel }, doc, pendingUploads, files);
  }

  /** Resolves a drop's client (x, y) to either a model Point (dropped right
   * on top of some text -- becomes a collapsed `text` selection to replace)
   * or the id of the nearest block to insert after (dropped in the gap
   * between/around blocks, or on a void). caretRangeFromPoint is Chromium/
   * WebKit; caretPositionFromPoint (Firefox) is the standard equivalent --
   * both are absent from the DOM lib's default types, so this reads them
   * dynamically rather than widening every caller's Document type. */
  function dropTarget(x: number, y: number): InsertionTarget | null {
    const doc = root.ownerDocument;
    const docAny = doc as unknown as {
      caretRangeFromPoint?(x: number, y: number): Range | null;
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (typeof docAny.caretRangeFromPoint === "function") {
      range = docAny.caretRangeFromPoint(x, y);
    } else if (typeof docAny.caretPositionFromPoint === "function") {
      const pos = docAny.caretPositionFromPoint(x, y);
      if (pos) {
        range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    if (range) {
      const point = pointFromDOM(root, range.startContainer, range.startOffset);
      if (point) return { at: { type: "text", anchor: point, focus: point } };
    }
    const el = doc.elementFromPoint?.(x, y);
    const blockId = el && closestBlockId(el, root);
    if (blockId) return {afterBlockId: blockId};
    // Editor padding is a valid file-drop target too. Use the nearest root block.
    let nearest: Element | undefined;
    let distance = Infinity;
    for (const child of root.children) {
      if (!child.hasAttribute(BLOCK_ATTR)) continue;
      const rect = child.getBoundingClientRect();
      const next = Math.max(rect.top - y, y - rect.bottom, 0);
      if (next < distance) { nearest = child; distance = next; }
    }
    const id = nearest?.getAttribute(ID_ATTR);
    return id ? {afterBlockId: id} : null;
  }

  /** A drop landing on a void's own interactive UI (e.g. an alt-text
   * <input>) should behave like an ordinary drop on that control, not
   * trigger our insertion pipeline -- everything else (including the void's
   * own non-interactive surface) is a legitimate drop target (
   * "between blocks" commonly means "on the nearest block", and in a
   * headless, zero-margin layout that's very often a void). */
  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest("input, textarea, select, button");
  }

  function onDragOver(e: DragEvent): void {
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault(); // required for `drop` to fire at all
  }

  function onDrop(e: DragEvent): void {
    if (isInteractiveTarget(e.target)) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const target = dropTarget(e.clientX, e.clientY);
    if (!target) return;
    if ("at" in target) runDispatch((tx) => tx.setSelection(target.at)); // selection-only: never pushed to history (mergeInfo)
    const { doc, pendingUploads, files } = decodeClipboard(dt, { registry });
    insertFragmentAndUploads(target, doc, pendingUploads, files);
  }

  root.addEventListener("keydown", onKeyDownForPaste as EventListener, true);
  root.addEventListener("keyup", clearShiftPaste);
  root.addEventListener("blur", clearShiftPaste, true);
  root.addEventListener("paste", onPaste as EventListener);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("drop", onDrop);

  return {
    uploadRegistry,
    retryUpload, insertFiles, attachUpload, uploadPending, getPendingUploads,
    destroy() {
      destroyed = true;
      uploadRegistry.destroy();
      root.removeEventListener("keydown", onKeyDownForPaste as EventListener, true);
      root.removeEventListener("keyup", clearShiftPaste);
      root.removeEventListener("blur", clearShiftPaste, true);
      root.removeEventListener("paste", onPaste as EventListener);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
    },
  };
}
