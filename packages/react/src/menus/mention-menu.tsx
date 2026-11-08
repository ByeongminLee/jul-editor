import type { SuggestionMenuClassNames } from "./types.js";
// <Editor.MentionMenu>: '@'-triggered mention/citation menu (mention = user tag, citation = post tag, same
// `mention` inline distinguished by `kind`). Core's `registerSuggestion` only
// matches a single trigger character, so both kinds share the one '@'
// trigger; Tab toggles which kind is being searched (re-running `onSearch`
// with the new kind), Enter/click inserts whichever item is highlighted.
import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useState } from "react";
import { LabelsContext, useEditorContext } from "../context.js";
import { useSuggestion } from "./use-suggestion.js";
import type { UseSuggestionResult } from "./use-suggestion.js";
import type { MentionItem } from "./types.js";
import { selectMentionItem } from "./mention-select.js";

export type { MentionItem };

export interface MentionMenuRenderArgs {
  items: MentionItem[];
  activeIndex: number;
  loading: boolean;
  kind: "user" | "post";
  /** `kind`'s localized display text ("User"/"Post", "사용자"/"게시물"
   * under `<Editor locale="ko">`) -- from `<Editor labels>`'s
   * `mentionUser`/`mentionPost`. */
  kindLabel: string;
  rect: DOMRect | null;
  getListboxProps: UseSuggestionResult<MentionItem>["getListboxProps"];
  getOptionProps: UseSuggestionResult<MentionItem>["getOptionProps"];
}

export interface MentionMenuProps {
  onSearch: (query: string, kind: "user" | "post") => Promise<MentionItem[]>;
  /** The trigger character. Default '@' (users); the post/
   * citation kind is reached by pressing Tab inside the open menu, not a
   * second trigger char (core's registerSuggestion is single-char only). */
  char?: string;
  className?: string | SuggestionMenuClassNames;
  children?: (args: MentionMenuRenderArgs) => ReactNode;
}

export function MentionMenu({ onSearch, char = "@", className, children }: MentionMenuProps): ReactNode {
  useEditorContext("Editor.MentionMenu");
  const labels = useContext(LabelsContext);
  const [kind, setKind] = useState<"user" | "post">("user");

  const items = useCallback((query: string) => onSearch(query, kind), [onSearch, kind]);
  const onTab = useCallback(() => setKind((k) => (k === "user" ? "post" : "user")), []);

  const suggestion = useSuggestion<MentionItem>({ char, items, onSelect: selectMentionItem, onTab });

  // Fresh menu = fresh kind (a leftover "post" toggle from a previous mention
  // shouldn't silently carry over to the next one).
  useEffect(() => {
    if (suggestion.open) setKind("user");
    // Only on the closed->open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion.open]);

  if (!suggestion.open) return null;

  const kindLabel = kind === "user" ? labels.mentionUser : labels.mentionPost;
  const args: MentionMenuRenderArgs = {
    items: suggestion.items,
    activeIndex: suggestion.activeIndex,
    loading: suggestion.loading,
    kind,
    kindLabel,
    rect: suggestion.rect,
    getListboxProps: suggestion.getListboxProps,
    getOptionProps: suggestion.getOptionProps,
  };

  if (children) return <>{children(args)}</>;
  const classes = typeof className === "object" ? className : {};

  return (
    <div className={typeof className === "string" ? className : classes.container} data-jul-editor-mention-menu="" data-jul-editor-mention-kind={kind} aria-label={kindLabel} {...suggestion.getListboxProps()}>
      {suggestion.loading && suggestion.items.length === 0 ? (
        <div className={classes.loading} data-jul-editor-mention-loading="">{labels.mentionLoading}</div>
      ) : suggestion.items.length === 0 ? (
        <div className={classes.empty} data-jul-editor-mention-empty="">{labels.mentionNoResults}</div>
      ) : (
        suggestion.items.map((item, i) => (
          <div key={item.id} className={classes.item} data-jul-editor-mention-item="" data-jul-editor-mention-item-kind={item.kind} {...suggestion.getOptionProps(i)}>
            {classes.text ? <span className={classes.text}>{item.label}</span> : item.label}
          </div>
        ))
      )}
    </div>
  );
}
