// Callout block: a highlighted box with an icon (emoji) and a color variant, like Notion's
// callout. It is an ordinary text block (inline content + free children), so everything the
// editor does for a paragraph (marks, mentions, nesting, drag, history) works unchanged; only the
// icon/color chrome is a "decorated" renderer slot (see callout-view.tsx).
//
// Serde forms:
//   markdown  GitHub alert:  `> [!NOTE]` + quoted body lines (+ quoted children). The five
//             GitHub types map 1:1 to the five colors (IMPORTANT=default, NOTE=info, TIP=success,
//             WARNING=warning, CAUTION=danger). A custom icon rides on the marker line
//             (`> [!NOTE] 🔥`), which GitHub renders as a plain quote but which round-trips here.
//   html      `<aside data-jul-editor-type="callout" data-color data-icon>`.
// Reading `> [!NOTE]` back goes through BlockSpec.fromMarkdownBlock (core intercepts the
// blockquote token, so fromMarkdown, paste and nested quotes all work); see `quoteToCallout`.
import { defineBlock, getProp, isText, newId } from "@jul-editor/core";
import type { Block, Inline, InputRuleEntry, Json, Keymap } from "@jul-editor/core";
import { enterOpensBody, prefixRule } from "../notion-shared/behaviors.js";
import { blocksFromHTML, inlinesFromHTML } from "../notion-shared/html-parse.js";
import { quotePrefix } from "../notion-shared/md-prefix.js";
import type { SlashItem } from "../slash.js";

export const CALLOUT_COLORS = ["default", "info", "success", "warning", "danger"] as const;
export type CalloutColor = (typeof CALLOUT_COLORS)[number];

/** Icon shown when the block's own `icon` prop is empty. */
export const CALLOUT_DEFAULT_ICONS: Record<CalloutColor, string> = {
  default: "\u{1F4A1}",
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  danger: "\u{1F6AB}",
};

/** GitHub alert marker per color (the 5 GitHub types, one per color). */
export const CALLOUT_MARKERS: Record<CalloutColor, string> = {
  default: "IMPORTANT",
  info: "NOTE",
  success: "TIP",
  warning: "WARNING",
  danger: "CAUTION",
};

const MARKER_TO_COLOR: Record<string, CalloutColor> = {
  IMPORTANT: "default",
  DEFAULT: "default",
  NOTE: "info",
  INFO: "info",
  TIP: "success",
  SUCCESS: "success",
  WARNING: "warning",
  WARN: "warning",
  CAUTION: "danger",
  DANGER: "danger",
  ERROR: "danger",
};

export interface CalloutProps {
  /** "" = the color's default icon. */
  icon: string;
  color: CalloutColor;
}

export function isCalloutColor(value: unknown): value is CalloutColor {
  return typeof value === "string" && (CALLOUT_COLORS as readonly string[]).includes(value);
}

/** Effective (validated, default-filled) props of a callout-like record/block. */
export function readCallout(props: Record<string, Json>): CalloutProps & { resolvedIcon: string } {
  const color = isCalloutColor(props.color) ? props.color : "default";
  const icon = typeof props.icon === "string" ? props.icon : "";
  return { icon, color, resolvedIcon: icon || CALLOUT_DEFAULT_ICONS[color] };
}

const MARKER_LINE = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)(?:\n|$)/;

/** True for an emoji-ish token (no ASCII letters/digits, short), used to tell an icon from a title. */
function looksLikeIcon(text: string): boolean {
  return text.length > 0 && text.length <= 16 && !/[A-Za-z0-9]/.test(text);
}

/** Turns a parsed `quote` block whose first line is `[!TYPE]` into a callout (recursively for
 * children). Returns the block unchanged when it is not an alert. */
export function quoteToCallout(block: Block): Block {
  const children = block.children?.map(quoteToCallout);
  if (block.type !== "quote") return children ? { ...block, children } : block;
  const content = block.content ?? [];
  const first = content[0];
  const m = first && isText(first) ? MARKER_LINE.exec(first.text) : null;
  const color = m ? MARKER_TO_COLOR[m[1]!.toUpperCase()] : undefined;
  if (!m || !color) return children ? { ...block, children } : block;
  let icon = "";
  let rest = (first as { text: string }).text.slice(m[0].length);
  const tail = m[2]!.trim();
  if (tail) {
    if (looksLikeIcon(tail)) icon = tail;
    else rest = tail + (rest ? "\n" + rest : ""); // Obsidian-style title: keep it as the first content line
  }
  const next: Inline[] = [...content.slice(1)];
  if (rest) next.unshift({ ...(first as object), text: rest } as Inline);
  const props: Record<string, Json> = {};
  if (color !== "default") props.color = color;
  if (icon) props.icon = icon;
  const out: Block = { id: block.id, type: "callout", props, content: next };
  if (children?.length) out.children = children;
  return out;
}

export const calloutBlock = defineBlock({
  type: "callout",
  content: "inline",
  children: "any",
  decorated: true,
  props: { icon: "", color: "default" },
  keymap: {
    // Enter at the end opens the body (first child); Enter in an empty callout exits to a paragraph.
    Enter: enterOpensBody(),
  } satisfies Keymap,
  fromMarkdownBlock(token, ctx) {
    if (token.type !== "blockquote" || !/^\s*\[![A-Za-z]+\]/.test(token.text)) return null;
    const quote = ctx.default()[0];
    const out = quote && quoteToCallout(quote);
    return out && out.type === "callout" ? out : quote ? [quote] : null;
  },
  wrapperAttrs(block) {
    const { icon, color } = readCallout({ icon: block.props.icon as Json, color: block.props.color as Json });
    return { "data-callout-color": color, "data-callout-icon": icon || undefined };
  },
  toMarkdown(block, ctx) {
    const { icon, color } = readCallout({ icon: getProp(block, "icon", ctx.registry) as Json, color: getProp(block, "color", ctx.registry) as Json });
    const own = ctx.inlines(block.content);
    const kids = block.children && block.children.length ? ctx.children() : "";
    const head = `[!${CALLOUT_MARKERS[color]}]` + (icon ? ` ${icon}` : "");
    const first = own ? `${head}\n${own}` : head;
    return quotePrefix(kids ? `${first}\n\n${kids}` : first);
  },
  toHTML(block, ctx) {
    const { icon, color } = readCallout({ icon: getProp(block, "icon", ctx.registry) as Json, color: getProp(block, "color", ctx.registry) as Json });
    const kids = block.children && block.children.length ? `<div data-callout-children>${ctx.children()}</div>` : "";
    const iconAttr = icon ? ` data-icon="${ctx.escapeAttr(icon)}"` : "";
    return `<aside data-jul-editor-type="callout" data-color="${color}"${iconAttr}><span data-callout-icon aria-hidden="true">${ctx.escapeText(icon || CALLOUT_DEFAULT_ICONS[color])}</span><div data-callout-body><div data-callout-content>${ctx.inlines(block.content)}</div>${kids}</div></aside>`;
  },
  toText(block, ctx) {
    const { resolvedIcon } = readCallout({ icon: getProp(block, "icon", ctx.registry) as Json, color: getProp(block, "color", ctx.registry) as Json });
    const pad = "  ".repeat(ctx.indent);
    const own = `${pad}${resolvedIcon} ${ctx.inlines(block.content)}`;
    return block.children && block.children.length ? `${own}\n${ctx.children()}` : own;
  },
  fromHTML: {
    selector: 'aside[data-jul-editor-type="callout"]',
    parse(el, ctx): Block {
      const color = el.getAttribute("data-color");
      const icon = el.getAttribute("data-icon") ?? "";
      const props: Record<string, Json> = {};
      if (isCalloutColor(color) && color !== "default") props.color = color;
      if (icon) props.icon = icon.slice(0, 16);
      const block: Block = { id: newId(), type: "callout", props, content: inlinesFromHTML(el.querySelector("[data-callout-content]"), ctx) };
      const children = blocksFromHTML(el.querySelector("[data-callout-children]"), ctx);
      if (children.length) block.children = children;
      return block;
    },
  },
});

/** Slash menu entry; `/callout` plus Korean synonyms. */
export const calloutSlashItem: SlashItem = {
  type: "callout",
  title: "Callout",
  keywords: ["callout", "alert", "note", "info", "admonition", "콜아웃", "강조", "알림", "메모"],
  create: () => ({ id: newId(), type: "callout", props: {}, content: [] }),
};

/** Color-variant slash entries (`/info`, `/warning` ...), each with a distinct id. */
export const calloutVariantSlashItems: Array<SlashItem & { id: string }> = CALLOUT_COLORS.filter((c) => c !== "default").map((color) => ({
  id: `callout-${color}`,
  type: "callout",
  title: `Callout (${color})`,
  keywords: ["callout", color, "콜아웃"],
  create: () => ({ id: newId(), type: "callout", props: { color }, content: [] }),
}));

/** Optional typing shortcut: "!> " at the start of a text block turns it into a callout
 * (">" alone is the quote rule, so a distinct prefix is needed). Register with
 * `editor.use({ inputRules: calloutInputRules })` / `<Editor.Plugin inputRules>`. */
export const calloutInputRules: InputRuleEntry[] = [prefixRule(/^!> $/, "callout")];

/** Turn-into entries (`<Editor.Plugin turnIntoItems>`): plain callout plus one per color variant.
 * `props` double as the active test, so the plain entry pins `color: "default"`. */
export const calloutTurnIntoItems = CALLOUT_COLORS.map((color) => ({
  id: color === "default" ? "callout" : `callout-${color}`,
  type: "callout",
  props: { color } as Record<string, Json>,
  label: color === "default" ? { en: "Callout", ko: "콜아웃" } : { en: `Callout (${color})`, ko: `콜아웃 (${color})` },
  keywords: ["callout", color],
}));
