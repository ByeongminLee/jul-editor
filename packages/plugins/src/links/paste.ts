// Notion style "paste a URL" menu, hooked into core's paste path through
// addPasteUrlInterceptor (view/embed-paste.ts), which runs BEFORE the built-in
// youtube/vimeo/x conversion and the autolink fallback.
//
// Flow for a bare URL pasted at a collapsed caret:
//   1. The url is inserted as linked text (one history step), exactly what
//      autolink does, so "Link" needs no further work and Escape/dismiss keeps it.
//   2. According to `defaultChoice`:
//        "menu"     -> host's `onMenu(request)` shows the UI; request.choose(...) converts.
//        "link"     -> done (plain autolink behavior).
//        "bookmark" | "embed" | "mention" -> converted right away (second history
//                      step, so one undo returns to the link, a second to before the paste).
//        "native"   -> the interceptor declines and core's existing behavior runs untouched.
//      "menu" without an `onMenu` also declines (nothing could show the menu).
//   3. Conversions are staleness safe: they re-check the pasted text is still
//      where it was before touching the document.
import {
  addPasteUrlInterceptor,
  newId,
  siblingsOf,
  type Block,
  type EditorState,
  type Inline,
  type PasteUrlContext,
  type Transaction,
  type TransactionResult,
} from "@jul-editor/core";
import { providerIframe } from "./iframe.js";
import { resolveCard, type FetchMetadata } from "./metadata.js";
import { parseLink } from "./providers.js";

export type PasteChoice = "link" | "bookmark" | "embed" | "mention";
export type PasteDefault = PasteChoice | "menu" | "native";

export interface PasteMenuRequest {
  url: string;
  blockId: string;
  /** Entries to show, in order. "embed" is present only when the url is embeddable. */
  options: PasteChoice[];
  /** Apply a choice. Resolves false when the pasted text is gone (user kept typing/undid). */
  choose(choice: PasteChoice): Promise<boolean>;
  /** The user dismissed the menu: the url stays a plain link. */
  dismiss(): void;
}

export interface UrlPasteOptions {
  /** Default "menu". */
  defaultChoice?: PasteDefault;
  /** Host UI hook for the "menu" mode. */
  onMenu?: (req: PasteMenuRequest) => void;
  /** Used to give a mention / bookmark real titles; the card view also fetches on its own. */
  fetchMetadata?: FetchMetadata;
  /** Only paste into these block types trigger conversions of the menu. Default: every text block. */
  skip?: (blockType: string) => boolean;
}

export function pasteChoicesFor(url: string): PasteChoice[] {
  const out: PasteChoice[] = ["link", "bookmark"];
  if (providerIframe(url)) out.push("embed");
  out.push("mention");
  return out;
}

type Dispatch = (build: (tx: Transaction) => Transaction) => TransactionResult;

function plainOf(content: Inline[] | undefined): string {
  return (content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "￼")).join("");
}

/** The block a choice inserts for `url` (never the iframe src itself: the iframe block stores the page url). */
export function blockForChoice(choice: "bookmark" | "embed", url: string): Block {
  if (choice === "bookmark") {
    const info = parseLink(url);
    return { id: newId(), type: "bookmark", props: { url, title: info.title, description: info.subtitle, siteName: info.domain } };
  }
  const info = parseLink(url);
  // youtube/vimeo already have core's own embed block (the renderer, serde and
  // paste handling for it exist); every other provider uses the iframe block.
  if (info.provider === "youtube" || info.provider === "vimeo") return { id: newId(), type: "embed", props: { provider: info.provider, url, id: info.ids.videoId ?? "", title: "" } };
  return { id: newId(), type: "iframe", props: { url, title: info.title } };
}

/** Applies a choice to the url text pasted at [from, to) of `blockId`. */
export async function applyPasteChoice(
  choice: PasteChoice,
  args: { url: string; blockId: string; from: number; getState: () => EditorState; runDispatch: Dispatch; fetchMetadata?: FetchMetadata },
): Promise<boolean> {
  const { url, blockId, from, getState, runDispatch } = args;
  const to = from + url.length;
  const rec = getState().store.records.get(blockId);
  if (!rec) return false;
  if (choice === "link") return plainOf(rec.content).slice(from, to) === url;
  if (plainOf(rec.content).slice(from, to) !== url) return false;
  const info = parseLink(url);

  if (choice === "mention") {
    const label = info.title || url;
    // kind "link": core's mention serde round-trips it as [@label](jul-editor:link/<url>).
    const mention: Inline = { type: "mention", attrs: { kind: "link", id: url, label } };
    runDispatch((tx) => tx.replaceContent(blockId, from, to, [mention]).setSelection({ type: "text", anchor: { blockId, offset: from + 1 }, focus: { blockId, offset: from + 1 } }));
    if (args.fetchMetadata) {
      // Upgrade the label with the real page title once it arrives (if the chip is still there).
      const state = await resolveCard(url, { fetchMetadata: args.fetchMetadata });
      const title = state.status === "ready" ? state.card.title : "";
      if (title && title !== label) {
        const cur = getState().store.records.get(blockId)?.content ?? [];
        let off = 0;
        for (const inl of cur) {
          const a = (inl as { attrs?: { kind?: string; id?: string; label?: string } }).attrs;
          if (inl.type === "mention" && a?.kind === "link" && a.id === url) {
            runDispatch((tx) => tx.replaceContent(blockId, off, off + 1, [{ type: "mention", attrs: { kind: "link", id: url, label: title } }]));
            break;
          }
          off += inl.type === "text" ? (inl as { text: string }).text.length : 1;
        }
      }
    }
    return true;
  }

  // bookmark / embed: a block. Embed only for embeddable providers.
  if (choice === "embed" && !providerIframe(url)) return false;
  const block = blockForChoice(choice, url);
  const whole = rec.type === "paragraph" && from === 0 && plainOf(rec.content) === url;
  if (whole) {
    // Same shape as core's paste-to-embed: nested children move out as following siblings.
    const childIds = rec.childIds ?? [];
    const { parentId, index } = siblingsOf(getState().store, blockId);
    runDispatch((tx) => {
      let t = tx;
      childIds.forEach((c, i) => {
        t = t.moveBlock(c, parentId, index + 1 + i);
      });
      return t.replaceBlock(blockId, { ...block, id: blockId, content: [] }).setSelection({ type: "block", ids: [blockId] });
    });
  } else {
    // url sits inside other text: remove it from the text, put the block right after.
    const { parentId, index } = siblingsOf(getState().store, blockId);
    runDispatch((tx) =>
      tx
        .replaceContent(blockId, from, to, [])
        .insertBlock(parentId, index + 1, block)
        .setSelection({ type: "block", ids: [block.id] }),
    );
  }
  return true;
}

/** Builds the interceptor function (exported for tests, which drive it without a DOM). */
export function createUrlPasteInterceptor(opts: UrlPasteOptions = {}): (ctx: PasteUrlContext) => boolean {
  const mode = opts.defaultChoice ?? "menu";
  return (ctx) => {
    if (mode === "native") return false;
    if (mode === "menu" && !opts.onMenu) return false;
    const { url, sel, getState, runDispatch } = ctx;
    if (sel.type !== "text") return false;
    const blockType = getState().store.records.get(sel.anchor.blockId)?.type ?? "";
    if (opts.skip?.(blockType)) return false;
    // Only plain http(s): sanitizeUrl-style gate via URL parse (javascript: etc. never reach a card).
    if (parseLink(url).url === "") return false;

    const blockId = sel.anchor.blockId;
    const from = sel.anchor.offset;
    const after = { blockId, offset: from + url.length };
    runDispatch((tx) => tx.insertText(sel.anchor, url, [{ type: "link", attrs: { href: url } }]).setSelection({ type: "text", anchor: after, focus: after }));
    const base = { url, blockId, from, getState, runDispatch, fetchMetadata: opts.fetchMetadata };
    if (mode === "menu") {
      let settled = false;
      opts.onMenu!({
        url,
        blockId,
        options: pasteChoicesFor(url),
        choose: async (choice) => {
          if (settled) return false;
          settled = true;
          return applyPasteChoice(choice, base);
        },
        dismiss: () => {
          settled = true;
        },
      });
    } else if (mode !== "link") {
      // A non-embeddable url with defaultChoice "embed" simply stays a link.
      void applyPasteChoice(mode, base);
    }
    return true;
  };
}

/** Registers the interceptor with core. Returns the unsubscribe. Module-level in core,
 * so it applies to every editor on the page. */
export function installUrlPaste(opts: UrlPasteOptions = {}): () => void {
  return addPasteUrlInterceptor(createUrlPasteInterceptor(opts));
}
