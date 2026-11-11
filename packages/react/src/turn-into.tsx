// useTurnInto / Editor.TurnInto: Notion's "Turn into" dropdown, for
// use inside a BubbleMenu. A fixed, curated item list (not the full
// slash-menu inventory -- editorcn's own node-selector.tsx is the same
// curated shape: Text/H1-H3/Bullet/Numbered/Todo/Quote/Code, not every block
// type). Nothing here adds editing behavior: `turnInto` is a single
// `commands.setBlockType` call, same as toolbar.tsx's own heading/list/quote/
// codeBlock buttons; `current`/`active` just read @jul-editor/core's own
// `getBlockType()` (already the "uniform type+props across every touched
// block, or null" computation, cached there for reference stability).
import { blockTypeTargets, canAdmit, containerInfo, textSelectionBlockIds } from "@jul-editor/core";
import type { Editor as CoreEditor, Json, Registry, Store } from "@jul-editor/core";
import type { ReactNode } from "react";
import { useContext } from "react";
import { LabelsContext, LocaleContext, useEditorContext } from "./context.js";
import { useEditor, useEditorState } from "./hooks.js";
import type { Labels } from "./labels.js";
import { resolveLabel } from "./plugin-menu.js";

export interface TurnIntoItem {
  id: string;
  type: string;
  props?: Record<string, Json>;
  label: string;
  keywords: string[];
  active: boolean;
}

export interface UseTurnIntoResult {
  items: TurnIntoItem[];
  current: TurnIntoItem | null;
  turnInto(item: TurnIntoItem): void;
}

interface ItemSpec {
  id: string;
  type: string;
  props?: Record<string, Json>;
  label: string;
  keywords: string[];
}

// Labels come from `<Editor locale>`/`<Editor labels>`; `keywords`
// stay fixed English constants regardless of locale (same "search matches
// either language" rule as menus/slashItems.ts's BUILTIN_ITEMS).
function itemSpecs(labels: Labels): ItemSpec[] {
  return [
    { id: "paragraph", type: "paragraph", label: labels.turnIntoText, keywords: ["text", "paragraph"] },
    { id: "heading-1", type: "heading", props: { level: 1 }, label: labels.turnIntoHeading1, keywords: ["heading", "h1"] },
    { id: "heading-2", type: "heading", props: { level: 2 }, label: labels.turnIntoHeading2, keywords: ["heading", "h2"] },
    { id: "heading-3", type: "heading", props: { level: 3 }, label: labels.turnIntoHeading3, keywords: ["heading", "h3"] },
    { id: "bulletListItem", type: "bulletListItem", label: labels.turnIntoBulletList, keywords: ["bullet", "list"] },
    { id: "orderedListItem", type: "orderedListItem", label: labels.turnIntoOrderedList, keywords: ["numbered", "ordered", "list"] },
    { id: "todoListItem", type: "todoListItem", label: labels.turnIntoTodoList, keywords: ["todo", "checkbox"] },
    { id: "quote", type: "quote", label: labels.turnIntoQuote, keywords: ["quote"] },
    { id: "codeBlock", type: "codeBlock", label: labels.turnIntoCode, keywords: ["code"] },
  ];
}

// heading's own schema default (level 1) is omitted from stored/effective
// props by @jul-editor/core's default-prop-omission convention -- getBlockType()'s
// `props` is already filled in with every schema default (editor.ts's
// effectiveProps), so this only needs a plain equality check, no special
// "undefined means the default" case of its own.
function isActive(spec: ItemSpec, current: { type: string; props: Record<string, Json> } | null): boolean {
  if (!current || current.type !== spec.type) return false;
  if (!spec.props) return true;
  return Object.entries(spec.props).every(([k, v]) => current.props[k] === v);
}

/** The blocks a 'block'/'text' selection would convert, in doc order (same targets as
 * `commands.setBlockType`). A 'cells' selection has no single curated block type to turn into
 * and is left empty. */
function selectionBlockIds(editor: CoreEditor, registry: Registry): string[] {
  const { selection: sel, store } = editor.getState();
  if (!sel || sel.type === "cells") return [];
  return blockTypeTargets(store, registry, sel.type === "block" ? sel.ids : textSelectionBlockIds(store, sel));
}

/** Predicts core's own opSetType noop rule (store/ops.ts) without applying
 * anything: content:'none' + existing content, children:'none' + existing
 * children, or the new type simply not admitted by its container. */
function canConvert(store: Store, registry: Registry, id: string, blockType: string): boolean {
  const rec = store.records.get(id);
  const spec = registry.blocks.get(blockType);
  if (!rec || !spec) return false;
  if (spec.content === "none" && (rec.content ?? []).length > 0) return false;
  if (spec.children === "none" && rec.childIds.length > 0) return false;
  const container = containerInfo(store, rec.parentId, registry);
  return canAdmit(registry, blockType, container.type, container.children);
}

/** {items, current, turnInto} -- `current` is the item (if any) matching the
 * touched block(s)' shared type/props; null when there's no selection, the
 * touched blocks disagree, or the current type isn't one of the curated
 * items (e.g. a table or image is selected). */
export function useTurnInto(): UseTurnIntoResult {
  const ctx = useEditorContext("useTurnInto");
  const editor = useEditor();
  const labels = useContext(LabelsContext);
  const locale = useContext(LocaleContext);
  const blockType = useEditorState(() => editor?.getBlockType() ?? null);
  // plugin entries (callout, toggle ...) follow the built-ins; an id already taken is skipped
  const specs = itemSpecs(labels);
  for (const extra of ctx.pluginTurnIntoItems) {
    if (specs.some((s) => s.id === extra.id) || !ctx.registry.blocks.has(extra.type)) continue;
    specs.push({ id: extra.id, type: extra.type, props: extra.props, label: resolveLabel(extra.label, locale), keywords: extra.keywords ?? [extra.type] });
  }
  // A prop-less entry matches every block of its type; when a more specific sibling (same type,
  // more pinned props) also matches, only that one is active (toggle level 2 is not also "Toggle").
  const matching = specs.filter((spec) => isActive(spec, blockType));
  const specificity = (spec: ItemSpec) => Object.keys(spec.props ?? {}).length;
  const best = matching.reduce((m, spec) => Math.max(m, specificity(spec)), -1);
  const items: TurnIntoItem[] = specs.map((spec) => ({ ...spec, active: matching.includes(spec) && specificity(spec) === best }));
  const current = items.find((item) => item.active) ?? null;
  return {
    items,
    current,
    turnInto(item) {
      if (!editor) return;
      const ids = selectionBlockIds(editor, ctx.registry);
      if (ids.length === 0) return;
      const store = editor.getState().store;
      // A multi-block selection converts ALL touched blocks or NONE --
      // never a half-converted mix silently left mid-selection (e.g. a list
      // item with nested children can't become a codeBlock, core's own
      // opSetType noops it and nothing tells the user).
      if (!ids.every((id) => canConvert(store, ctx.registry, id, item.type))) return;
      editor.update((tx) => tx.setBlockType(ids, item.type, item.props));
    },
  };
}

export interface TurnIntoRenderArgs extends UseTurnIntoResult {}

export interface TurnIntoProps {
  children: (args: TurnIntoRenderArgs) => ReactNode;
}

/** `<Editor.TurnInto>`: a render-prop wrapper over `useTurnInto()`, for use
 * inside `<Editor.BubbleMenu>` -- no markup/positioning of its own, same
 * convention as BubbleMenu itself. */
export function TurnInto({ children }: TurnIntoProps): ReactNode {
  return <>{children(useTurnInto())}</>;
}
