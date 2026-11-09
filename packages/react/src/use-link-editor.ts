// useLinkEditor: a Mod+K popover that replaces @jul-editor/core's own
// `window.prompt` default -- as long as this hook is mounted, it registers a
// keymap entry for "Mod-k" at a priority ABOVE the built-in default keymap
// (editor.registerKeymap: highest priority wins, checked before the built-in
// entry), so pressing Mod+K opens THIS popover instead. Unmounting the hook
// (registerKeymap's own returned cleanup) restores the built-in behavior.
import { orderPoints, contentLength, inlineLength, isText, nextBlockInPreOrder, normalizeLinkHref, sanitizeUrl, sliceContent } from "@jul-editor/core";
import type { Editor as CoreEditor, Inline } from "@jul-editor/core";
import { useCallback, useEffect, useState } from "react";
import { useEditor } from "./hooks.js";

export interface UseLinkEditorResult {
  open: boolean;
  href: string;
  /** The selection's rect at the moment the popover opened -- for the
   * caller to position it (same convention as BubbleMenu's own `rect`). */
  rect: DOMRect | null;
  /** Opens the popover, seeded with the current selection's existing link
   * href (if any). Also callable directly (e.g. from a toolbar button), not
   * just via Mod+K. */
  openEditor(): void;
  /** Applies `href` (through normalizeLinkHref, so a bare "example.com"
   * becomes "https://example.com", then sanitizeUrl) to the current selection and
   * closes the popover. An empty/whitespace-only href removes the link
   * instead (same convention as editorcn's own link control). A rejected
   * scheme leaves the popover open (nothing applied). */
  apply(href: string): void;
  /** Removes the link mark from the current selection and closes. */
  remove(): void;
  /** Closes without applying anything. */
  close(): void;
}

function currentLinkHref(editor: CoreEditor): string {
  const link = editor.getActiveMarks().find((m) => m.type === "link");
  return link ? String(link.attrs?.href ?? "") : "";
}

/** A collapsed caret has no [from,to) of its own to overlap -- if it
 * sits inside (or exactly between two runs of) an existing link, expand to
 * that link's whole contiguous same-href run instead, so apply()/remove()
 * actually act on the link the popover was seeded from (openEditor's own
 * `currentLinkHref`) rather than silently no-oping. */
function collapsedLinkExpand(content: Inline[], offset: number): { from: number; to: number } | null {
  const runs: { from: number; to: number; href: string | null }[] = [];
  let pos = 0;
  for (const inl of content) {
    const len = inlineLength(inl);
    const href = isText(inl) ? ((inl.marks ?? []).find((m) => m.type === "link")?.attrs?.href as string | undefined) ?? null : null;
    runs.push({ from: pos, to: pos + len, href });
    pos += len;
  }
  // Prefer a run the caret is strictly inside; else one ending exactly at the
  // caret (caret right after a link); else one starting exactly at it.
  let idx = runs.findIndex((r) => r.href !== null && offset > r.from && offset < r.to);
  if (idx === -1) idx = runs.findIndex((r) => r.href !== null && r.to === offset);
  if (idx === -1) idx = runs.findIndex((r) => r.href !== null && r.from === offset);
  if (idx === -1) return null;
  const href = runs[idx]!.href;
  let from = runs[idx]!.from;
  let to = runs[idx]!.to;
  for (let i = idx - 1; i >= 0 && runs[i]!.href === href; i--) from = runs[i]!.from;
  for (let i = idx + 1; i < runs.length && runs[i]!.href === href; i++) to = runs[i]!.to;
  return { from, to };
}

/** Force-sets (`href` given) or removes (`href: null`) the `link` mark
 * across the current selection's overlapped runs -- NOT `commands.toggleMark`:
 * that toggles by mark TYPE only (view/marks.ts), so re-applying a DIFFERENT
 * href to an already-fully-linked selection would just remove the mark
 * instead of updating it. Mirrors useColorPicker.ts's own setColorMark (same
 * shape, one mark type) -- small enough that sharing it across two files
 * isn't worth a third module. */
function setLinkMark(editor: CoreEditor, href: string | null): void {
  const sel = editor.getState().selection;
  if (!sel || sel.type !== "text") return;
  const store = editor.getState().store;
  const [start, end] = orderPoints(store, sel.anchor, sel.focus);

  let ranges: { blockId: string; from: number; to: number }[];
  if (start.blockId === end.blockId && start.offset === end.offset) {
    const content = store.records.get(start.blockId)?.content ?? [];
    const expanded = collapsedLinkExpand(content, start.offset);
    if (!expanded) return;
    ranges = [{ blockId: start.blockId, ...expanded }];
  } else {
    const blockIds: string[] = [start.blockId];
    let cur: string | null = start.blockId;
    while (cur !== end.blockId) {
      cur = nextBlockInPreOrder(store, cur);
      if (cur === null) break;
      blockIds.push(cur);
    }
    ranges = blockIds.map((blockId) => {
      const content = store.records.get(blockId)?.content ?? [];
      const len = contentLength(content);
      const from = blockId === start.blockId ? start.offset : 0;
      const to = blockId === end.blockId ? end.offset : len;
      return { blockId, from, to };
    });
  }

  editor.update((tx) => {
    let t = tx;
    for (const { blockId, from, to } of ranges) {
      if (from >= to) continue;
      const content = store.records.get(blockId)?.content ?? [];
      const next = sliceContent(content, from, to).map((inl) => {
        if (!isText(inl)) return inl;
        const marks = (inl.marks ?? []).filter((m) => m.type !== "link");
        if (href) marks.push({ type: "link", attrs: { href } });
        return marks.length ? { ...inl, marks } : { type: "text" as const, text: inl.text };
      });
      t = t.replaceContent(blockId, from, to, next);
    }
    return t;
  });
}

export function useLinkEditor(): UseLinkEditorResult {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);

  const openEditor = useCallback(() => {
    if (!editor) return;
    setHref(currentLinkHref(editor));
    setRect(editor.getSelectionRect() ?? editor.getCaretRect());
    setOpen(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    // priority 1: any positive priority beats the built-in keymap's
    // DEFAULT_KEYMAP_PRIORITY (-Infinity, view/editor.ts) -- this is checked
    // BEFORE it, so the built-in handleLink/window.prompt path never runs
    // while this hook is mounted.
    return editor.registerKeymap(
      {
        "Mod-k": () => {
          openEditor();
          return true;
        },
      },
      { priority: 1 },
    );
  }, [editor, openEditor]);

  const apply = useCallback(
    (nextHref: string) => {
      if (!editor) return;
      const trimmed = nextHref.trim();
      if (!trimmed) {
        setLinkMark(editor, null);
        setOpen(false);
        return;
      }
      // "example.com" -> "https://example.com": a bare domain is never meant as a relative URL.
      const cleaned = sanitizeUrl(normalizeLinkHref(trimmed), "link");
      if (cleaned === null) return; // rejected scheme -- popover stays open
      setLinkMark(editor, cleaned);
      setOpen(false);
    },
    [editor],
  );

  const remove = useCallback(() => {
    if (editor) setLinkMark(editor, null);
    setOpen(false);
  }, [editor]);

  const close = useCallback(() => setOpen(false), []);

  return { open, href, rect, openEditor, apply, remove, close };
}
