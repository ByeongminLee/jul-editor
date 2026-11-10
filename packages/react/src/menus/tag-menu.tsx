import type { SuggestionMenuClassNames } from "./types.js";
import type { ReactNode } from "react";
import { useCallback, useContext } from "react";
import { LabelsContext, useEditorContext } from "../context.js";
import { selectMentionItem } from "./mention-select.js";
import { useSuggestion } from "./use-suggestion.js";
import type { UseSuggestionResult } from "./use-suggestion.js";

export interface TagItem { id: string; label: string }
export interface TagMenuRenderArgs {
  items: TagItem[];
  activeIndex: number;
  loading: boolean;
  rect: DOMRect | null;
  getListboxProps: UseSuggestionResult<TagItem>["getListboxProps"];
  getOptionProps: UseSuggestionResult<TagItem>["getOptionProps"];
}
export interface TagMenuProps {
  onSearch(query: string): TagItem[] | Promise<TagItem[]>;
  className?: string | SuggestionMenuClassNames;
  children?: (args: TagMenuRenderArgs) => ReactNode;
}

/** Headless #tag picker backed by the existing atomic mention inline. */
export function TagMenu({ onSearch, className, children }: TagMenuProps): ReactNode {
  useEditorContext("Editor.TagMenu");
  const labels = useContext(LabelsContext);
  const items = useCallback((query: string) => onSearch(query), [onSearch]);
  const onSelect = useCallback((item: TagItem, ctx: Parameters<typeof selectMentionItem>[1]) => selectMentionItem({ ...item, kind: "tag" }, ctx), []);
  const suggestion = useSuggestion<TagItem>({ char: "#", items, onSelect });
  if (!suggestion.open) return null;

  const args: TagMenuRenderArgs = {
    items: suggestion.items,
    activeIndex: suggestion.activeIndex,
    loading: suggestion.loading,
    rect: suggestion.rect,
    getListboxProps: suggestion.getListboxProps,
    getOptionProps: suggestion.getOptionProps,
  };
  if (children) return <>{children(args)}</>;
  const classes = typeof className === "object" ? className : {};

  return <div className={typeof className === "string" ? className : classes.container} data-jul-editor-tag-menu="" data-jul-editor-keep-selection="">
    <div {...suggestion.getListboxProps()} aria-label={labels.tagLabel}>
      {suggestion.items.map((item, index) => <div key={item.id} className={classes.item} data-jul-editor-tag-item="" {...suggestion.getOptionProps(index)}>{classes.text ? <span className={classes.text}>#{item.label}</span> : `#${item.label}`}</div>)}
    </div>
    <div role="status">
      {suggestion.items.length === 0 && (suggestion.loading
        ? <div className={classes.loading} data-jul-editor-tag-loading="">{labels.mentionLoading}</div>
        : <div className={classes.empty} data-jul-editor-tag-empty="">{labels.mentionNoResults}</div>)}
    </div>
  </div>;
}
