// Shared item shapes for the menus.
export interface MentionItem {
  id: string;
  label: string;
  kind: "user" | "post" | "tag";
}

/** Classes for the default suggestion-menu markup; render props own their markup. */
export interface SuggestionMenuClassNames {
  container?: string;
  item?: string;
  text?: string;
  description?: string;
  empty?: string;
  loading?: string;
}
