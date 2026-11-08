// Editor.SlashMenu's default item list + filtering.
// Notion-style: title/keyword prefix match, plus a nice-to-have Korean
// 초성(choseong) search ("/ㅊㅌ" matches "차트"). Custom block types opt in by
// setting `BlockSpec.slash` (typed `unknown` in model/schema.ts; its
// shape is given by SlashSpec below) when they `defineBlock`;
// registry.blocks is walked once per registry to pick those up alongside the
// built-ins, so a consumer's own registerBlock-time slash item needs zero
// changes to this file.
import type { Block, Json, Registry } from "@jul-editor/core";
import { isChoseongQuery, matchesChoseong } from "./choseong.js";
import { EN_LABELS } from "../labels.js";
import type { Labels } from "../labels.js";

export interface SlashItem {
  /** Unique within the menu (NOT necessarily the same as `type` -- e.g. the
   * three heading levels share `type: "heading"` but need distinct ids). */
  id: string;
  type: string;
  title: string;
  /** Optional secondary copy for a consumer-rendered preview or hover card. */
  description?: string;
  keywords: string[];
  icon?: string;
  /** Non-default prop values only (convention: a default-equal prop
   * is omitted, never stored) -- e.g. `{ level: 2 }` for "Heading 2", nothing
   * for "Heading 1" (level's own schema default). */
  props?: Record<string, Json>;
  /** Overrides the generic (empty-content, `props`-only) block construction
   * with a richer one -- e.g. `@jul-editor/plugins`'s `pluginSlashItems` (chart/
   * diagram/dataTable with real starter props), adapted into this shape by
   * the consuming app and passed as `<Editor.SlashMenu extraItems>` (menus/
   * itself has no dependency on @jul-editor/plugins). */
  create?: () => Block;
}

/** The shape a custom block registers as `defineBlock({ slash: ... })`. */
export interface SlashSpec {
  title: string;
  description?: string;
  keywords?: string[];
  icon?: string;
  props?: Record<string, Json>;
}

// Titles come from `labels` (locale-aware); `keywords` stay fixed,
// bilingual constants regardless of locale (see this module's own header
// note in slashItems.ts's importer, labels.ts -- "/tex" and "/텍" must both
// find "Text"/"텍스트" no matter which title is currently displayed).
function builtinItems(labels: Labels): SlashItem[] {
  return [
    { id: "paragraph", type: "paragraph", title: labels.slashText, keywords: ["text", "paragraph", "본문", "텍스트"] },
    { id: "heading-1", type: "heading", title: labels.slashHeading1, keywords: ["heading", "h1", "제목", "제목1"] },
    { id: "heading-2", type: "heading", title: labels.slashHeading2, keywords: ["heading", "h2", "제목", "제목2"], props: { level: 2 } },
    { id: "heading-3", type: "heading", title: labels.slashHeading3, keywords: ["heading", "h3", "제목", "제목3"], props: { level: 3 } },
    // H4-H6 -- reachable the same way as H1-H3, just further down the
    // default list (Notion/editorcn parity: model/serde already support
    // level 1-6, see model/builtins.ts's heading spec).
    { id: "heading-4", type: "heading", title: labels.slashHeading4, keywords: ["heading", "h4", "제목", "제목4"], props: { level: 4 } },
    { id: "heading-5", type: "heading", title: labels.slashHeading5, keywords: ["heading", "h5", "제목", "제목5"], props: { level: 5 } },
    { id: "heading-6", type: "heading", title: labels.slashHeading6, keywords: ["heading", "h6", "제목", "제목6"], props: { level: 6 } },
    { id: "bulletListItem", type: "bulletListItem", title: labels.slashBulletList, keywords: ["bullet", "list", "목록", "불릿"] },
    { id: "orderedListItem", type: "orderedListItem", title: labels.slashOrderedList, keywords: ["numbered", "ordered", "list", "순서", "목록"] },
    { id: "todoListItem", type: "todoListItem", title: labels.slashTodoList, keywords: ["todo", "checkbox", "할일", "체크"] },
    { id: "quote", type: "quote", title: labels.slashQuote, keywords: ["quote", "인용"] },
    { id: "codeBlock", type: "codeBlock", title: labels.slashCode, keywords: ["code", "코드"] },
    { id: "divider", type: "divider", title: labels.slashDivider, keywords: ["divider", "hr", "구분선"] },
    { id: "image", type: "image", title: labels.slashImage, keywords: ["image", "img", "사진", "이미지"] },
    // Both insert an empty `embed` block -- EmbedView's own renderer
    // shows an inline URL input for it (no window.prompt); "YouTube" is a
    // separate, more-discoverable entry purely for search (typing "유튜브"/
    // "youtube" also matches the generic "Embed"/"임베드" entry via its own
    // keywords, this one just ranks it higher by title match too).
    { id: "embed-youtube", type: "embed", title: labels.slashEmbedYoutube, keywords: ["youtube", "유튜브", "영상", "video", "embed"] },
    { id: "embed", type: "embed", title: labels.slashEmbed, keywords: ["embed", "video", "링크카드", "유튜브", "영상"] },
    { id: "table", type: "table", title: labels.slashTable, keywords: ["table", "표"] },
    { id: "chart", type: "chart", title: labels.slashChart, keywords: ["chart", "그래프", "차트"] },
    { id: "diagram", type: "diagram", title: labels.slashDiagram, keywords: ["diagram", "mermaid", "도표", "다이어그램"] },
    { id: "dataTable", type: "dataTable", title: labels.slashDataTable, keywords: ["data table", "csv", "데이터", "표"] },
  ];
}

export function collectSlashItems(registry: Registry, labels: Labels = EN_LABELS): SlashItem[] {
  const custom: SlashItem[] = [];
  for (const spec of registry.blocks.values()) {
    const slash = spec.slash as SlashSpec | undefined;
    if (!slash) continue;
    custom.push({ id: spec.type, type: spec.type, title: slash.title, description: slash.description, keywords: slash.keywords ?? [], icon: slash.icon, props: slash.props });
  }
  return [...builtinItems(labels), ...custom];
}

/** Layers `extra` items (e.g. a consuming app's `@jul-editor/plugins` adapter) onto
 * `base` -- an extra item whose `type` matches a base item REPLACES it (a
 * richer chart/diagram/dataTable with real starter content beats the plain
 * empty-props built-in), everything else is appended, in `extra`'s order. */
export function mergeSlashItems(base: SlashItem[], extra: SlashItem[]): SlashItem[] {
  if (extra.length === 0) return base;
  const overriddenTypes = new Set(extra.map((item) => item.type));
  return [...base.filter((item) => !overriddenTypes.has(item.type)), ...extra];
}

function matchesItem(query: string, item: SlashItem): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (item.title.toLowerCase().startsWith(q)) return true;
  for (const k of item.keywords) {
    if (k.toLowerCase().startsWith(q)) return true;
  }
  if (isChoseongQuery(query)) {
    if (matchesChoseong(query, item.title)) return true;
    for (const k of item.keywords) if (matchesChoseong(query, k)) return true;
  }
  return false;
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  return items.filter((item) => matchesItem(query, item));
}
