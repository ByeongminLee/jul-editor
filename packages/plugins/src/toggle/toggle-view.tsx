"use client";

// Toggle renderer. Editing mode: mounted in the block's decorated slot (chevron button only), and
// mirrors `data-jul-editor-open` / `data-toggle-level` onto the wrapper so CSS can hide the children
// container while collapsed (the children stay in the DOM and the model, only display changes, so
// selection/drag/search of the doc never loses them). Read-only mode (EditorView renderers):
// wraps the already rendered body and keeps its own local open state.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { syncWrapperAttrs } from "../notion-shared/wrapper-attrs.js";
import type { PluginViewProps } from "../view-props.js";
import { readToggle, setToggleOpen } from "./block.js";

/** Per-viewer open state adapter (Notion keeps it local). Without one the `open` prop in the doc is used. */
export interface ToggleOpenStore {
  get(blockId: string): boolean | undefined;
  set(blockId: string, open: boolean): void;
  subscribe?(listener: () => void): () => void;
}

/** In-memory default for demos/tests; a host persists to localStorage/server itself. */
export function createMemoryOpenStore(initial: Record<string, boolean> = {}): ToggleOpenStore {
  const map = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  return {
    get: (id) => map.get(id),
    set(id, open) {
      map.set(id, open);
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export interface ToggleClassNames {
  container?: string;
  chevron?: string;
}

export interface ToggleViewProps extends PluginViewProps {
  children?: ReactNode;
  className?: string | ToggleClassNames;
  openStore?: ToggleOpenStore;
}

const NOOP_SUBSCRIBE = () => () => {};

export function ToggleView({ block, editor, readOnly, children, className, openStore, updateProps, locale }: ToggleViewProps): ReactNode {
  const { open: propOpen, level } = readToggle(block.props);
  const classes = typeof className === "string" ? { container: className } : (className ?? {});
  const ref = useRef<HTMLSpanElement | null>(null);
  const [localOpen, setLocalOpen] = useState(propOpen);
  const storeOpen = useSyncExternalStore(
    openStore?.subscribe ?? NOOP_SUBSCRIBE,
    () => openStore?.get(block.id),
    () => openStore?.get(block.id),
  );
  const open = readOnly ? (storeOpen ?? localOpen) : (storeOpen ?? propOpen);
  const ko = locale === "ko";

  // The model's open state is mirrored onto the wrapper by core (toggleBlock.wrapperAttrs). Only a
  // per-viewer openStore can disagree with the model, so it alone overrides the attribute here.
  useLayoutEffect(() => {
    if (readOnly || storeOpen === undefined) return;
    syncWrapperAttrs(ref.current, { "data-jul-editor-open": String(open) });
  }, [readOnly, open, storeOpen]);

  const toggle = () => {
    const next = !open;
    if (openStore) openStore.set(block.id, next);
    if (readOnly) {
      setLocalOpen(next);
      return;
    }
    if (editor) setToggleOpen(editor, block.id, next, { persist: !openStore });
    else if (!openStore) updateProps?.({ open: next ? true : undefined });
  };

  const chevron = (
    <button
      type="button"
      data-toggle-chevron=""
      className={classes.chevron}
      aria-expanded={open}
      aria-label={open ? (ko ? "접기" : "Collapse") : ko ? "펼치기" : "Expand"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
    >
      {open ? "▾" : "▸"}
    </button>
  );

  if (readOnly) {
    return (
      <div data-jul-toggle="" data-jul-editor-open={String(open)} data-toggle-level={level || undefined} className={classes.container}>
        {chevron}
        {children}
      </div>
    );
  }
  return (
    <span ref={ref} data-jul-toggle-chrome="" className={classes.container}>
      {chevron}
    </span>
  );
}

/** Optional stylesheet: hides children of a collapsed toggle, indents, styles heading variants. */
export const TOGGLE_CSS = `
[data-type="toggle"],[data-jul-toggle]{position:relative}
[data-type="toggle"]>[data-jul-editor-decoration]{position:absolute;left:-24px;top:2px}
[data-jul-toggle]>[data-toggle-chevron]{position:absolute;left:-24px;top:2px}
[data-toggle-chevron]{border:0;background:transparent;cursor:pointer;width:22px;height:22px;border-radius:4px;color:inherit;opacity:.6}
[data-toggle-chevron]:hover{background:rgba(0,0,0,.06);opacity:1}
[data-type="toggle"][data-jul-editor-open="false"]>[data-jul-editor-children],
[data-jul-toggle][data-jul-editor-open="false"]>[data-jul-editor-children]{display:none}
[data-type="toggle"]>[data-jul-editor-children]{margin-left:24px}
[data-toggle-level="1"]>[data-jul-editor-content]{font-size:1.875em;font-weight:700}
[data-toggle-level="2"]>[data-jul-editor-content]{font-size:1.5em;font-weight:600}
[data-toggle-level="3"]>[data-jul-editor-content]{font-size:1.25em;font-weight:600}
`;
