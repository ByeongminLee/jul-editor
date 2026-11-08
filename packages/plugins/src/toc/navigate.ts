// "Go to heading": shared by the TOC block and the sidebar. Expands any collapsed toggle that hides
// the heading, puts the caret at the heading start (editing) and scrolls it into view. Hosts that
// want different behavior (router hash, analytics) pass `onNavigate` to the views instead.
import type { Editor } from "@jul-editor/core";
import { collapsedToggleAncestors, setToggleOpen } from "../toggle/block.js";

/** The rendered wrapper of block `id` under `root`, matched on the data-id attribute. */
export function findBlockEl(root: ParentNode, id: string): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-jul-editor-block]"))) if (el.getAttribute("data-id") === id) return el;
  return null;
}

export interface NavigateOptions {
  scroll?: boolean;
  behavior?: ScrollBehavior;
}

export function navigateToHeading(editor: Editor, id: string, opts: NavigateOptions = {}): void {
  for (const toggleId of collapsedToggleAncestors(editor, id)) setToggleOpen(editor, toggleId, true);
  const caret = { blockId: id, offset: 0 };
  if (editor.getState().store.records.has(id)) editor.update((tx) => tx.setSelection({ type: "text", anchor: caret, focus: caret }));
  if (opts.scroll === false) return;
  // Wait a frame so a just-expanded toggle has been laid out before measuring.
  const run = () => findBlockEl(editor.getRoot(), id)?.scrollIntoView?.({ behavior: opts.behavior ?? "smooth", block: "start" });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
}

/** Read-only variant (no editor): scrolls the heading wrapper inside `root` into view. */
export function scrollToHeading(root: ParentNode, id: string, behavior: ScrollBehavior = "smooth"): void {
  findBlockEl(root, id)?.scrollIntoView?.({ behavior, block: "start" });
}
