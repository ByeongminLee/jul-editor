import type { SuggestionMenuClassNames } from "./types.js";
// <Editor.SlashMenu>: Notion-style "/" command menu. Headless --
// either give it render-prop children, or take its default minimal
// `<div role="listbox">` markup (no styles either way; the playground skins
// it via plain CSS selectors on the data-jul-editor-slash-* hooks).
import type { ReactNode } from "react";
import { useCallback, useContext, useMemo } from "react";
import { isVoidBlockSpec } from "@jul-editor/core";
import type { SuggestionOpenContext } from "@jul-editor/core";
import { LabelsContext, useEditorContext } from "../context.js";
import { useEditor } from "../hooks.js";
import { useSuggestion } from "./use-suggestion.js";
import type { UseSuggestionResult } from "./use-suggestion.js";
import { collectSlashItems, filterSlashItems, localizeSlashItems, mergeSlashItems } from "./slash-items.js";
import type { SlashItem } from "./slash-items.js";
import { canInsertSlashItem, selectSlashItem } from "./slash-select.js";

export interface SlashMenuRenderArgs {
  items: SlashItem[];
  activeIndex: number;
  loading: boolean;
  rect: DOMRect | null;
  getListboxProps: UseSuggestionResult<SlashItem>["getListboxProps"];
  getOptionProps: UseSuggestionResult<SlashItem>["getOptionProps"];
}

export interface SlashMenuProps {
  className?: string | SuggestionMenuClassNames;
  /** Extra items layered on top of the registry-collected list (built-ins +
   * any `BlockSpec.slash`) -- an item here whose `type` matches one already
   * in that list REPLACES it. This is how an app that also uses
   * `@jul-editor/plugins` gets chart/diagram/dataTable's real starter content
   * instead of the generic empty-props version: `extraItems={pluginSlashItems
   * .map(i => ({ id: i.type, ...i }))}` (menus/ itself has no dependency on
   * @jul-editor/plugins). */
  extraItems?: SlashItem[];
  /** Final list after built-ins and plugin items are collected. Supply an
   * array to replace all entries, or a function to filter, reorder, relabel,
   * and append them while preserving their existing create callbacks. */
  items?: SlashItem[] | ((defaults: SlashItem[]) => SlashItem[]);
  children?: (args: SlashMenuRenderArgs) => ReactNode;
}

export function SlashMenu({ className, extraItems, items: configureItems, children }: SlashMenuProps): ReactNode {
  const ctx = useEditorContext("Editor.SlashMenu");
  const registry = ctx.registry;
  const labels = useContext(LabelsContext);
  const editor = useEditor();

  const allItems = useMemo(() => {
    const defaults = localizeSlashItems(mergeSlashItems(collectSlashItems(registry, labels), [...ctx.pluginSlashItems, ...(extraItems ?? [])]), labels);
    return typeof configureItems === "function" ? configureItems(defaults) : configureItems ?? defaults;
  }, [registry, labels, ctx.pluginSlashItems, extraItems, configureItems]);
  const renderable = useCallback((item: SlashItem) => {
    const spec = registry.blocks.get(item.type);
    return !!spec && (item.type === "divider" || !isVoidBlockSpec(spec) || Boolean(ctx.renderersRef.current[item.type]));
  }, [registry, ctx.renderersRef]);
  // Only items that can land where the caret is (a table cell admits none).
  const fits = useCallback((item: SlashItem) => {
    const state = editor?.getState();
    const blockId = state?.selection?.type === "text" ? state.selection.anchor.blockId : null;
    return !state || !blockId || canInsertSlashItem(item, state, blockId, registry);
  }, [editor, registry]);
  const items = useCallback((query: string) => filterSlashItems(allItems, query).filter((item) => renderable(item) && fits(item)), [allItems, renderable, fits]);
  const allow = useCallback(
    ({ state, blockId }: SuggestionOpenContext) => allItems.some((item) => renderable(item) && canInsertSlashItem(item, state, blockId, registry)),
    [allItems, renderable, registry],
  );
  const onSelect = useCallback((item: SlashItem, sctx: Parameters<typeof selectSlashItem>[1]) => selectSlashItem(item, sctx, registry), [registry]);

  const suggestion = useSuggestion<SlashItem>({ char: "/", startOfLine: true, allowSpaces: true, items, onSelect, allow });

  if (!suggestion.open) return null;

  const args: SlashMenuRenderArgs = {
    items: suggestion.items,
    activeIndex: suggestion.activeIndex,
    loading: suggestion.loading,
    rect: suggestion.rect,
    getListboxProps: suggestion.getListboxProps,
    getOptionProps: suggestion.getOptionProps,
  };

  if (children) return <>{children(args)}</>;
  const classes = typeof className === "object" ? className : {};

  return (
    <div className={typeof className === "string" ? className : classes.container} data-jul-editor-slash-menu="" data-jul-editor-keep-selection="">
      <div {...suggestion.getListboxProps()} aria-label={labels.slashMenuLabel}>
        {suggestion.items.map((item, i) => (
          <div key={item.id} className={classes.item} data-jul-editor-slash-item="" {...suggestion.getOptionProps(i)}>
            {classes.text ? <span className={classes.text}>{item.title}</span> : item.title}
            {item.description && <small className={classes.description}>{item.description}</small>}
          </div>
        ))}
      </div>
      {/* Mounted before it has text: a live region inserted together with its message is not reliably announced. */}
      <div role="status">
        {suggestion.items.length === 0 && (suggestion.loading
          ? <div className={classes.loading} data-jul-editor-slash-loading="">{labels.slashLoading}</div>
          : <div className={classes.empty} data-jul-editor-slash-empty="">{labels.slashNoResults}</div>)}
      </div>
    </div>
  );
}
