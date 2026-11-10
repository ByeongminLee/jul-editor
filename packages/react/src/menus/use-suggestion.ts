// useSuggestion: the headless engine behind Editor.SlashMenu/Editor.MentionMenu
// Wraps core's char-triggered
// `editor.registerSuggestion` (packages/core/src/view/suggestion.ts) with:
//  - async `items(query)` resolution, debounced 100ms, with race protection
//    (a `requestId` counter -- a stale response from an earlier query is
//    dropped even if it resolves after a newer one already landed);
//  - keyboard nav (ArrowUp/Down/Enter/Tab/Escape) via core's `onKey` seam
//    (interaction.ts gives an open suggestion first crack at every keydown,
//    calling e.preventDefault() itself when this returns true);
//  - ARIA: listbox/option roles are the consumer's own markup (getListboxProps/
//    getOptionProps just supply ids+role+aria-selected); aria-expanded/
//    -controls/-autocomplete/-activedescendant are written onto the editor's
//    contenteditable root directly, since core has no dedicated API for that
//    (see aria.ts) and doing it from React is allowed (not a style write).
//
// No floating-ui/positioning dependency: `rect` (the caret's DOMRect, from
// core's getCaretRect()) is exposed as-is; the consumer positions the menu.
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Editor as CoreEditor, SuggestionOpenContext } from "@jul-editor/core";
import { EditorContext } from "../context.js";
import { useEditor } from "../hooks.js";

export interface SuggestionRange {
  blockId: string;
  from: number;
  to: number;
}

export interface UseSuggestionSelectCtx {
  editor: CoreEditor;
  range: SuggestionRange;
  close: () => void;
}

export interface UseSuggestionOptions<Item> {
  char: string;
  /** Memoize this (e.g. `useCallback`), the same way SlashMenu/MentionMenu do
   * -- its IDENTITY is a fetch trigger (so a data source that depends on more
   * than the query text, e.g. MentionMenu's Tab-toggled kind, can force a
   * refetch by changing it), not just its result. An inline, unmemoized
   * function is recreated every render, which after its own result lands
   * (and re-renders this component) recreates it again -- an infinite loop,
   * not a bug in this hook. */
  items: (query: string) => Item[] | Promise<Item[]>;
  onSelect: (item: Item, ctx: UseSuggestionSelectCtx) => void;
  allowSpaces?: boolean;
  startOfLine?: boolean;
  /** Vetoes opening in a given context (read fresh on every trigger). */
  allow?: (ctx: SuggestionOpenContext) => boolean;
  /** Tab selects the active item by default (same as Enter). Provide this to
   * repurpose Tab for something else instead (e.g. MentionMenu's user/post
   * kind toggle) -- Tab no longer selects when this is set. */
  onTab?: () => void;
}

export interface OptionProps {
  role: "option";
  id: string;
  "aria-selected": boolean;
  onMouseDown: (e: { preventDefault(): void }) => void;
}

export interface UseSuggestionResult<Item> {
  open: boolean;
  query: string;
  items: Item[];
  activeIndex: number;
  loading: boolean;
  rect: DOMRect | null;
  select(i: number): void;
  close(): void;
  getListboxProps(): { role: "listbox"; id: string; "data-jul-editor-keep-selection": "" };
  getOptionProps(i: number): OptionProps;
}

const DEBOUNCE_MS = 100;
let idSeq = 0;
const ariaOwners = new WeakMap<HTMLElement, { owner: string; original: Map<string, string | null> }>();
const ariaAttributes = ["role", "aria-multiline", "aria-expanded", "aria-controls", "aria-autocomplete", "aria-activedescendant"];

export function useSuggestion<Item>(opts: UseSuggestionOptions<Item>): UseSuggestionResult<Item> {
  const editor = useEditor();
  const rootRef = useContext(EditorContext)?.rootRef;
  const listboxId = useRef(`jul-editor-suggestion-${++idSeq}`).current;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<SuggestionRange | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Refs so the (stable, registered-once) core callbacks always see the
  // latest closures/state without re-registering on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const itemsValueRef = useRef<Item[]>(items);
  itemsValueRef.current = items;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const rangeRef = useRef<SuggestionRange | null>(range);
  rangeRef.current = range;
  const handleRef = useRef<{ closeSuggestion(): void } | null>(null);
  const openRef = useRef(false);
  const queryRef = useRef("");

  const close = useCallback(() => {
    handleRef.current?.closeSuggestion();
  }, []);

  /** The items for the current query: the fetched list once it has landed,
   * else a synchronous source read on the spot (null while an async one is
   * still in flight). */
  const flushItems = useCallback((): Item[] | null => {
    if (!loadingRef.current) return itemsValueRef.current;
    let result: Item[] | Promise<Item[]>;
    try {
      result = optsRef.current.items(queryRef.current);
    } catch {
      return [];
    }
    return Array.isArray(result) ? result : null;
  }, []);

  const select = useCallback(
    (i: number, list: Item[] = itemsValueRef.current) => {
      const item = list[i];
      const currentRange = rangeRef.current;
      if (!item || !currentRange || !editor) return;
      optsRef.current.onSelect(item, { editor, range: currentRange, close });
      close();
    },
    [editor, close],
  );

  useEffect(() => {
    if (!editor) return;
    const handle = editor.registerSuggestion({
      char: opts.char,
      allowSpaces: opts.allowSpaces,
      startOfLine: opts.startOfLine,
      allow: (ctx) => optsRef.current.allow?.(ctx) ?? true,
      onUpdate(state) {
        // A scroll/resize re-emits the same query with a fresh rect: keep the
        // highlighted item then, reset it only for a new menu or query.
        const fresh = state.open && (!openRef.current || state.query !== queryRef.current);
        openRef.current = state.open;
        queryRef.current = state.query;
        setOpen(state.open);
        setQuery(state.query);
        setRange(state.range);
        setRect(state.rect);
        if (fresh) setActiveIndex(0);
      },
      onKey(e) {
        if (e.key === "Escape") {
          close();
          return true;
        }
        if (e.key === "ArrowDown") {
          setActiveIndex((i) => Math.min(i + 1, Math.max(itemsValueRef.current.length - 1, 0)));
          return true;
        }
        if (e.key === "ArrowUp") {
          setActiveIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (e.key === "Enter" || (e.key === "Tab" && !optsRef.current.onTab)) {
          // A key pressed before the 100ms debounce lands acts on the CURRENT
          // query (a synchronous source is read right away) instead of being
          // lost; nothing to pick ("No results") closes the menu and lets the
          // key through (Enter splits the line).
          const pending = flushItems();
          if (pending === null) return true; // async source still loading
          if (pending.length === 0) {
            close();
            return false;
          }
          select(pending === itemsValueRef.current ? activeIndexRef.current : 0, pending);
          return true;
        }
        if (e.key === "Tab") {
          optsRef.current.onTab!();
          return true;
        }
        return false;
      },
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.destroy();
    };
    // char/allowSpaces/startOfLine changing re-registers with the new config;
    // onSelect/onTab are read fresh via optsRef, not dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, opts.char, opts.allowSpaces, opts.startOfLine, close, select, flushItems]);

  // Debounced (100ms), race-protected item fetch: a `requestId` counter bumps
  // on every open/query/items-source change, and only the response matching
  // the CURRENT requestId is ever applied -- an in-flight older request (sync
  // or async, doesn't matter) that resolves late is silently dropped, so the
  // latest query always wins even out of arrival order.
  const requestIdRef = useRef(0);
  useEffect(() => {
    if (!open) {
      setItems([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      let result: Item[] | Promise<Item[]>;
      try {
        result = optsRef.current.items(query);
      } catch {
        if (requestIdRef.current === requestId) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      Promise.resolve(result).then(
        (resolved) => {
          if (requestIdRef.current !== requestId) return; // stale: a newer query has since been requested
          // A multi-word query that matches nothing is ordinary text ("/usr/bin is a path"), not a search.
          if (optsRef.current.allowSpaces && resolved.length === 0 && /\s/.test(query)) {
            close();
            return;
          }
          setItems(resolved);
          setActiveIndex(0);
          setLoading(false);
        },
        () => {
          if (requestIdRef.current !== requestId) return;
          setItems([]);
          setLoading(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, opts.items]);

  // Only the open suggestion owns the editor's temporary combobox semantics.
  useEffect(() => {
    const root = rootRef ? rootRef.current : (typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-jul-editor-root]"));
    if (!root || !open) return;
    const prior = ariaOwners.get(root);
    const original = prior?.original ?? new Map(ariaAttributes.map((name) => [name, root.getAttribute(name)]));
    ariaOwners.set(root, { owner: listboxId, original });
    root.setAttribute("role", "combobox");
    root.removeAttribute("aria-multiline");
    root.setAttribute("aria-expanded", "true");
    root.setAttribute("aria-controls", listboxId);
    root.setAttribute("aria-autocomplete", "list");
    if (items.length > 0) root.setAttribute("aria-activedescendant", `${listboxId}-option-${activeIndex}`);
    else root.removeAttribute("aria-activedescendant");
    return () => {
      if (ariaOwners.get(root)?.owner !== listboxId) return;
      for (const [name, value] of original) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
      ariaOwners.delete(root);
    };
  }, [open, activeIndex, items.length, listboxId, rootRef]);

  // Keyboard navigation keeps the highlighted option visible in a scrollable
  // menu (the option ids are this hook's own, so consumers get it for free).
  useEffect(() => {
    if (!open || items.length === 0 || typeof document === "undefined") return;
    const el = document.getElementById(`${listboxId}-option-${activeIndex}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, items.length, listboxId]);

  const getListboxProps = useCallback(() => ({ role: "listbox" as const, id: listboxId, "data-jul-editor-keep-selection": "" as const }), [listboxId]);
  const getOptionProps = useCallback(
    (i: number): OptionProps => ({
      role: "option",
      id: `${listboxId}-option-${i}`,
      "aria-selected": i === activeIndex,
      onMouseDown: (e) => {
        e.preventDefault(); // keep focus/selection in the editor, not the menu
        select(i);
      },
    }),
    [listboxId, activeIndex, select],
  );

  return { open, query, items, activeIndex, loading, rect, select, close, getListboxProps, getOptionProps };
}
