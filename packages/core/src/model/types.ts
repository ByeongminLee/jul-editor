// Pure document model types. No DOM, no React.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

export interface Mark {
  type: string;
  attrs?: Record<string, Json>;
}

export interface TextInline {
  type: "text";
  text: string;
  marks?: Mark[];
}

export interface MentionInline {
  type: "mention";
  attrs: { kind: string; id: string; label: string };
}

// Any other inline registered via defineInline (e.g. future custom inlines).
export interface GenericInline {
  type: string;
  attrs?: Record<string, Json>;
}

export type Inline = TextInline | MentionInline | GenericInline;

export interface Block {
  id: string;
  type: string;
  props: Record<string, Json>;
  content?: Inline[];
  children?: Block[];
}

export interface Doc {
  version: number;
  blocks: Block[];
}
