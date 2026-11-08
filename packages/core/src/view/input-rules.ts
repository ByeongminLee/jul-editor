// Markdown-shortcut input rules. A rule's `match` regex is tested
// against the CURRENT LINE's text up to the caret (the substring after the
// last '\n' in the block's own text before the caret -- a block's content can
// contain a literal '\n' via Shift+Enter, and a rule like "# " should only
// fire at the start of its own line, not mid-paragraph). Regexes are expected
// to be anchored (`^...$`) by the caller; `runInputRules` doesn't add anchors
// itself so a custom rule can choose to match a suffix instead if it wants to.

import { isText } from "../model/canonical.js";
import { newId } from "../model/id.js";
import type { Registry } from "../model/schema.js";
import type { Block, Inline, Json } from "../model/types.js";
import { sanitizeUrl } from "../model/url.js";
import { contentLength, sliceContent } from "../store/store.js";
import type { EditorState, Point } from "../store/types.js";
import type { MarksRef } from "./marks.js";
import type { Dispatch } from "./types.js";

export interface InputRuleCtx {
  state: EditorState;
  registry: Registry;
  /** when set, a rule that produces a non-inclusive mark (inline `code`,
   * the autolink rule's `link`) clears `stored` right after so the text typed
   * next doesn't inherit it (marksAtPoint's normal "inherit the preceding
   * run" convention is only right for inclusive marks like bold/italic).
   * Optional -- inputRules.test.ts's bare harness never sets it, and every
   * rule that doesn't need it (headings, lists, dividers...) never reads it. */
  marksRef?: MarksRef;
  dispatch: Dispatch;
}

export interface InputRuleEntry {
  match: RegExp;
  handler: (ctx: InputRuleCtx, match: RegExpMatchArray) => boolean;
  /** Notion distinguishes two confirmation styles -- most markdown
   * shortcuts ("# ", "- ", "**x**"...) convert the instant their own trailing
   * character (a space, or a closing delimiter) is typed, but "---"/"***"/
   * "___" only convert when Enter confirms them (typing the bare dashes
   * alone leaves plain text, so a line of exactly "---" isn't silently eaten
   * mid-sentence). `runInputRules`' own `phase` argument runs `onEnter`-
   * flagged entries ONLY from Enter, and every other entry ONLY from an
   * ordinary typed character -- unset (the default) means "char phase" for
   * every existing rule, unchanged. */
  onEnter?: boolean;
}

function plainText(content: Inline[] | undefined): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : inl.type === "mention" ? "￼" : "")).join("");
}

function lineBeforeCaret(state: EditorState, point: Point): string {
  const text = plainText(state.store.records.get(point.blockId)?.content).slice(0, point.offset);
  const nl = text.lastIndexOf("\n");
  return nl === -1 ? text : text.slice(nl + 1);
}

/** true only when `point` sits on the block's OWN FIRST line (no literal
 * '\n' -- a Shift+Enter hard break -- anywhere before it). A block-level rule
 * (heading/list/quote/divider/codeBlock) always deletes/converts starting at
 * the WHOLE BLOCK's offset 0, which is only the same thing as "the current
 * line's start" on the first line; gating on this before running one of
 * those rules is what stops "foo<Shift+Enter># " from eating "foo". */
function isFirstLine(state: EditorState, point: Point): boolean {
  const text = plainText(state.store.records.get(point.blockId)?.content).slice(0, point.offset);
  return !text.includes("\n");
}

// ---- "```lang" one-shot arm/consume -------------------------------------
// A bare "```" conversion (codeBlockRule, below) arms this so the VERY NEXT
// Space/Enter in THAT SAME block may promote a lone typed word to its
// `language` prop (builtins-keymap.ts's trySetLanguageFromTyped) -- a
// codeBlock that already existed (loaded from JSON, or created by a slash
// command/setBlockType) never arms it, so it never silently eats a plain
// first word/line as a language. Module-level (not per-editor-instance) is
// fine: armed only ever holds the id of whichever block a "```" conversion
// JUST fired for, checked+cleared within the same synchronous event turn.
let armedCodeBlockId: string | null = null;

export function armCodeBlockLangGrab(blockId: string): void {
  armedCodeBlockId = blockId;
}

/** One-shot: true iff `blockId` is currently armed, and always clears the
 * flag (whether or not it matched) -- the first Space/Enter after a "```"
 * conversion closes the window whether or not it actually looked like a
 * language token. */
export function consumeCodeBlockLangGrab(blockId: string): boolean {
  const armed = armedCodeBlockId === blockId;
  armedCodeBlockId = null;
  return armed;
}

/** Closes the arm window on any OTHER edit (typing into a different block,
 * Backspace/Delete, Enter that didn't consume it, ...) -- never called for
 * plain continued typing inside the still-armed block itself. */
export function clearCodeBlockLangGrab(exceptBlockId?: string): void {
  if (armedCodeBlockId !== null && armedCodeBlockId !== exceptBlockId) armedCodeBlockId = null;
}

/** The current block's own `BlockSpec.inputRules` (cast from its `unknown`
 * model-layer placeholder, same convention as keymap.ts's currentBlockKeymap). */
export function currentBlockInputRules(state: EditorState, registry: Registry, blockId: string): InputRuleEntry[] {
  const rec = state.store.records.get(blockId);
  const spec = rec && registry.blocks.get(rec.type);
  return (spec?.inputRules as InputRuleEntry[] | undefined) ?? [];
}

/** Runs block-level rules, then registered (custom) rules, then the built-in
 * defaults, against the line up to `point` (which must be a collapsed
 * caret's position, checked by the caller) -- first match+handled wins.
 * Returns the point the caret should end up at (so the caller can record it
 * for the Backspace-undoes-an-auto-conversion feature), or null if nothing
 * matched. This is read back from the REAL post-dispatch selection (every
 * built-in handler ends its own commit with an explicit `.setSelection(...)`)
 * rather than computed from `point`/the match length: a rule whose handler
 * moves the caret somewhere other than "the match's own start" -- the divider
 * rule jumps to a brand-new following paragraph, not a position within the
 * original block -- would otherwise report the wrong point (a real bug: the
 * Backspace-undo feature checks this point against the live selection, so it
 * would just silently never trigger for such a rule). */
export function runInputRules(
  ctx: InputRuleCtx,
  point: Point,
  blockRules: InputRuleEntry[],
  registered: InputRuleEntry[],
  defaults: InputRuleEntry[],
  phase: "char" | "enter" = "char",
): Point | null {
  const line = lineBeforeCaret(ctx.state, point);
  for (const entry of [...blockRules, ...registered, ...defaults]) {
    if (Boolean(entry.onEnter) !== (phase === "enter")) continue; // onEnter entries only run from phase "enter", every other entry only from "char"
    const m = entry.match.exec(line);
    if (!m) continue;
    if (entry.handler(ctx, m)) {
      const sel = ctx.state.selection;
      if (sel && sel.type === "text" && sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset) return sel.anchor;
      return { blockId: point.blockId, offset: point.offset - m[0].length }; // fallback: handler didn't leave a collapsed text selection
    }
  }
  return null;
}

// ---- built-in default rules --------------------------------------------------

function clearAndSetType(ctx: InputRuleCtx, blockId: string, markerLen: number, type: string, props?: Record<string, Json>): void {
  const caret = { blockId, offset: 0 };
  ctx.dispatch((tx) => tx.setType(blockId, type, props).replaceContent(blockId, 0, markerLen, []).setSelection({ type: "text", anchor: caret, focus: caret }));
}

function markerRule(match: RegExp, type: string, props?: (m: RegExpMatchArray) => Record<string, Json> | undefined): InputRuleEntry {
  return {
    match,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      // clearAndSetType always deletes/converts starting at the whole
      // BLOCK's offset 0 -- only valid when the match is on the first line.
      if (!isFirstLine(ctx.state, sel.anchor)) return false;
      clearAndSetType(ctx, sel.anchor.blockId, m[0].length, type, props?.(m));
      return true;
    },
  };
}

function inlineMarkRule(match: RegExp, markType: string): InputRuleEntry {
  return {
    match,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const blockId = sel.anchor.blockId;
      const rec = ctx.state.store.records.get(blockId);
      if (!rec) return false;
      const inner = m[1] ?? "";
      const to = sel.anchor.offset;
      const from = to - m[0].length;
      // reconstruct from the REAL underlying content, not `m[1]` (matched
      // against the plain-text-with-U+FFFC-placeholders line, see `plainText`
      // above) -- a mention caught inside the marked span must survive as
      // itself, not collapse into a literal placeholder text run. `inner`'s
      // own start offset within the match is wherever it first occurs (the
      // delimiter chars around it are excluded from `[^*]+`-style groups, so
      // this is unambiguous).
      const prefixLen = Math.max(0, m[0].indexOf(inner));
      const fromInner = from + prefixLen;
      const toInner = fromInner + inner.length;
      const marked = sliceContent(rec.content ?? [], fromInner, toInner).map((inl): Inline =>
        isText(inl) ? { type: "text", text: inl.text, marks: [...(inl.marks ?? []).filter((mk) => mk.type !== markType), { type: markType }] } : inl,
      );
      // The delimiters (everything in [from, fromInner) and [toInner, to)) are
      // dropped entirely -- `marked` lands starting at `from`, not `fromInner`.
      const caretOffset = from + contentLength(marked);
      ctx.dispatch((tx) => tx.replaceContent(blockId, from, to, marked).setSelection({ type: "text", anchor: { blockId, offset: caretOffset }, focus: { blockId, offset: caretOffset } }));
      // `code` is non-inclusive (Notion/ProseMirror convention) -- text
      // typed right after must not inherit it the way bold/italic/strike/
      // highlight (inclusive) legitimately do.
      if (markType === "code" && ctx.marksRef) ctx.marksRef.stored = [];
      return true;
    },
  };
}

/** "---"/"***"/"___" -> divider, plus a following paragraph (a divider has no
 * content slot of its own for the cursor -- mirrors normalizeDoc's
 * trailing-paragraph repair for a doc ending in a void). Any text already
 * typed after the caret on this line survives into that new paragraph
 * instead of being silently dropped.
 *
 * Converts the INSTANT the 3rd dash/asterisk/underscore lands (Notion does
 * the same; it used to be `onEnter: true`, which left a bare "---" sitting
 * there as plain text until Enter and surprised users). The regexes are
 * anchored `^---$` against the line BEFORE the caret, so only an exactly-3-char
 * line at the start of the block fires: "--" never matches, and "a---" /
 * "-- -" don't either. Conflicts with the other rules are benign: the bold
 * (`**x**`) / italic (`*x*`, `_x_`, `__x__`) rules all need non-delimiter
 * content between the delimiters, so none of them can match a line made only
 * of the delimiter char; the one real trade-off is that "***" can no longer
 * be typed as the start of a "***bold italic***" run at the very start of a
 * block (it becomes a divider first, same as Notion). `phase: "enter"` still
 * exists for registered rules that opt into `onEnter`. */
function dividerRule(match: RegExp): InputRuleEntry {
  return {
    match,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      // same first-line-only gate as markerRule -- this clears [0, len)
      // of the WHOLE block.
      if (!isFirstLine(ctx.state, sel.anchor)) return false;
      const blockId = sel.anchor.blockId;
      const rec = ctx.state.store.records.get(blockId);
      if (!rec) return false;
      const len = contentLength(rec.content);
      const tail = sliceContent(rec.content ?? [], m[0].length, len);
      const index = siblingIndex(ctx, blockId);
      const newPara: Block = { id: newId(), type: "paragraph", props: {}, content: tail };
      const caret = { blockId: newPara.id, offset: 0 };
      ctx.dispatch((tx) =>
        tx
          .replaceContent(blockId, 0, len, [])
          .setType(blockId, "divider")
          .insertBlock(rec.parentId, index + 1, newPara)
          .setSelection({ type: "text", anchor: caret, focus: caret }),
      );
      return true;
    },
  };
}

/** "```" (bare, no trailing space/lang needed -- Notion converts the
 * instant the 3rd backtick lands) converts the current paragraph to an empty
 * codeBlock, keeping any text already after the caret as the block's own
 * code content. Setting a language from typed text ("```ts" then a space) is
 * NOT done here (content:'code' blocks never run input rules at all, by
 * design -- see onInsertText's own guard comment in interaction.ts): it's
 * handled by codeBlock's own keymap instead (builtins-keymap.ts's " "/Enter
 * handlers), which fires regardless of content kind. */
function codeBlockRule(): InputRuleEntry {
  return {
    match: /^```$/,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      // same first-line-only gate -- this clears [0, markerLen) of the
      // WHOLE block.
      if (!isFirstLine(ctx.state, sel.anchor)) return false;
      const blockId = sel.anchor.blockId;
      clearAndSetType(ctx, blockId, m[0].length, "codeBlock", { language: "" });
      // arms the "```lang" one-shot -- ONLY a real "```" conversion may
      // let the next Space/Enter in this block promote a bare typed word to
      // its language (see builtins-keymap.ts's trySetLanguageFromTyped).
      armCodeBlockLangGrab(blockId);
      return true;
    },
  };
}

const TRAILING_PUNCT_RE = /[.,;:!?]+$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** a URL typed/pasted at the end of a sentence keeps trailing sentence
 * punctuation OUT of the link (both the text and the href) -- also strips a
 * trailing quote/closing-bracket that ISN'T balanced by an opener earlier in
 * the same URL (a Wikipedia-style "...(disambiguation)" URL keeps its own
 * balanced closing paren; "(see https://example.com)"'s lone trailing ")"
 * has no matching "(" in the URL itself, so it's dropped). Exported so
 * clipboard.ts's own paste-autolink (same bug, same fix) can share it. */
export function trimAutolinkTrailing(url: string): string {
  let out = url.replace(TRAILING_PUNCT_RE, "");
  for (;;) {
    const last = out.slice(-1);
    if (last === "'" || last === '"') {
      out = out.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (!opener) break;
    const opens = out.split(opener).length - 1;
    const closes = out.split(last).length - 1;
    if (closes <= opens) break;
    out = out.slice(0, -1);
  }
  return out;
}

/** typing a bare URL (http(s):// or www.) then a space wraps just the
 * URL text in a `link` mark -- the trailing space stays a literal space,
 * untouched (Notion/GitHub "autolink on type" convention). Enter-confirm
 * isn't wired up (input rules only ever run from a typed character, see
 * interaction.ts's onInsertText -- Enter goes through a different, unrelated
 * path); space-confirm alone covers the common case. */
function autolinkRule(): InputRuleEntry {
  return {
    match: /(?:^|\s)(https?:\/\/\S+|www\.\S+) $/i,
    handler(ctx, m) {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text") return false;
      const raw = m[1]!;
      const trimmed = trimAutolinkTrailing(raw);
      if (!trimmed) return false;
      const href = sanitizeUrl(/^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed, "link");
      if (href === null) return false;
      const blockId = sel.anchor.blockId;
      const caretOffset = sel.anchor.offset; // unchanged: only the URL span (before the trailing space) is replaced
      const to = caretOffset - 1;
      const from = to - raw.length;
      const suffix = raw.slice(trimmed.length); // trailing punctuation excluded from the link, kept as plain text
      const marked: Inline = { type: "text", text: trimmed, marks: [{ type: "link", attrs: { href } }] };
      const content: Inline[] = suffix ? [marked, { type: "text", text: suffix }] : [marked];
      ctx.dispatch((tx) => tx.replaceContent(blockId, from, to, content).setSelection({ type: "text", anchor: { blockId, offset: caretOffset }, focus: { blockId, offset: caretOffset } }));
      return true;
    },
  };
}

export function buildDefaultInputRules(): InputRuleEntry[] {
  return [
    // widened from {1,3} to {1,6} -- model/serde already support a
    // heading level up to 6 (see model/builtins.ts, serde/builtins-serde.ts's
    // clampLevel), only this rule was still capped at H3.
    markerRule(/^(#{1,6}) $/, "heading", (m) => ({ level: m[1]!.length })),
    markerRule(/^[-*+] $/, "bulletListItem"),
    markerRule(/^\d+\. $/, "orderedListItem"),
    markerRule(/^\[([ xX]?)\] $/, "todoListItem", (m) => ({ checked: m[1]!.toLowerCase() === "x" })),
    markerRule(/^> $/, "quote"),
    dividerRule(/^---$/),
    dividerRule(/^\*\*\*$/),
    dividerRule(/^___$/),
    codeBlockRule(),
    inlineMarkRule(/\*\*([^*]+)\*\*$/, "bold"),
    inlineMarkRule(/(?:^|(?<=\s))__([^_]+)__$/, "bold"),
    inlineMarkRule(/(?:^|(?<=\s))_([^_]+)_$/, "italic"),
    inlineMarkRule(/(?:^|(?<=\s))\*([^*]+)\*$/, "italic"),
    inlineMarkRule(/`([^`]+)`$/, "code"),
    inlineMarkRule(/~~([^~]+)~~$/, "strike"),
    inlineMarkRule(/==([^=]+)==$/, "highlight"),
    autolinkRule(),
  ];
}

function siblingIndex(ctx: InputRuleCtx, blockId: string): number {
  const rec = ctx.state.store.records.get(blockId);
  const siblings = rec?.parentId ? (ctx.state.store.records.get(rec.parentId)?.childIds ?? []) : ctx.state.store.rootIds;
  return siblings.indexOf(blockId);
}
