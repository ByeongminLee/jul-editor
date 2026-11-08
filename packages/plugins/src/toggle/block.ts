// Toggle block (HTML <details>): a summary line (inline content) that collapses/expands its
// children, plus the toggle-heading variant (`level` 1-3: the summary is styled/counted as an H1-H3
// and shows up in the table of contents, like Notion's toggle headings).
//
// The open state is an ordinary prop (`open`), so it is part of the document, undoable and shared
// across collaborators. A host that wants it per-viewer (Notion keeps it local) passes an
// `openStore` adapter to ToggleView instead (see toggle-view.tsx); the model still carries the
// initial/default state.
//
// Serde forms:
//   markdown  `<details open>\n<summary>Title</summary>\n\nbody...\n\n</details>` (a heading toggle
//             wraps the title: `<summary><h2>Title</h2></summary>`). Reading it back goes through
//             BlockSpec.fromMarkdownBlock (the html token(s) of one balanced `<details>`).
//   html      `<details data-jul-editor-type="toggle" open data-level>`; any foreign `<details>`
//             pasted from the web is accepted too.
//   typed     `>> ` (toggle), `>># ` / `>>## ` / `>>### ` (toggle heading 1-3). Plain `> ` is the
//             quote rule and fires first, so toggle needs a distinct prefix.
import { ancestorChain, defineBlock, getProp, newId } from "@jul-editor/core";
import type { Block, Editor, FromMarkdownBlockCtx, FromMarkdownBlockResult, InputRuleEntry, Json, Keymap, MarkdownBlockToken } from "@jul-editor/core";
import { enterOpensBody, prefixRule } from "../notion-shared/behaviors.js";
import { blocksFromHTML, inlinesFromHTML } from "../notion-shared/html-parse.js";
import type { SlashItem } from "../slash.js";

export interface ToggleProps {
  open: boolean;
  /** 0 = plain toggle, 1-3 = toggle heading. */
  level: 0 | 1 | 2 | 3;
}

export function readToggle(props: Record<string, Json>): ToggleProps {
  const level = props.level === 1 || props.level === 2 || props.level === 3 ? props.level : 0;
  return { open: props.open === true, level };
}

const OPEN_TAG = /<details(?:\s[^>]*)?>/gi;
const CLOSE_TAG = /<\/details>/gi;
const countMatches = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** `<details>` markdown import. marked splits one `<details>` at blank lines into several tokens
 * (html, body blocks, html), so this walks the following tokens until the open/close tags balance.
 * Only html tokens are counted, which makes tags inside fenced code harmless. Unbalanced: null
 * (core then keeps the raw-html paragraph and reports it as lossy). */
function detailsFromMarkdown(token: MarkdownBlockToken, ctx: FromMarkdownBlockCtx): FromMarkdownBlockResult {
  if (token.type !== "html" || !/^\s*<details(?:\s[^>]*)?>/i.test(token.raw)) return null;
  let depth = countMatches(token.raw, OPEN_TAG) - countMatches(token.raw, CLOSE_TAG);
  let raw = token.raw;
  let consumed = 0;
  while (depth > 0 && consumed < ctx.following.length) {
    const next = ctx.following[consumed++]!;
    raw += next.raw;
    if (next.type === "html") depth += countMatches(next.raw, OPEN_TAG) - countMatches(next.raw, CLOSE_TAG);
  }
  if (depth > 0) return null;
  const open = /^\s*<details((?:\s[^>]*)?)>/i.exec(raw)!;
  const closeAt = raw.toLowerCase().lastIndexOf("</details>");
  let body = raw.slice(open[0].length, closeAt);
  const trailing = raw.slice(closeAt + "</details>".length).trim();
  let title = "";
  let level = 0;
  const sm = /^\s*<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(body);
  if (sm) {
    title = sm[1]!.trim();
    body = body.slice(sm[0].length);
    const hm = /^<h([1-3])[^>]*>([\s\S]*?)<\/h\1>$/i.exec(title);
    if (hm) {
      level = Number(hm[1]);
      title = hm[2]!.trim();
    }
  }
  const props: Record<string, Json> = {};
  if (/(?:^|\s)open(?:\s|=|$)/i.test(open[1] ?? "")) props.open = true;
  if (level) props.level = level;
  const block: Block = { id: newId(), type: "toggle", props, content: title ? ctx.parseInline(title) : [] };
  const children = body.trim() ? ctx.parseMarkdown(body) : [];
  if (children.length) block.children = children;
  const after = trailing ? ctx.parseMarkdown(trailing) : [];
  return { blocks: [block, ...after], consumed };
}

export const toggleBlock = defineBlock({
  type: "toggle",
  content: "inline",
  children: "any",
  decorated: true,
  props: { open: false, level: 0 },
  keymap: {
    // Enter at the end of the summary: open block (or no children yet) gets a first child inside it;
    // a collapsed toggle that already has children falls through to the default split.
    Enter: enterOpensBody({ isOpen: (props) => props.open === true, openPatch: { open: true } }),
    "Mod-Enter": (ctx) => {
      const sel = ctx.state.selection;
      if (!sel || sel.type !== "text" || sel.anchor.blockId !== sel.focus.blockId) return false;
      const rec = ctx.state.store.records.get(sel.anchor.blockId);
      if (!rec || rec.type !== "toggle") return false;
      ctx.dispatch((tx) => tx.setProps(rec.id, { open: rec.props.open === true ? undefined : true }));
      return true;
    },
  } satisfies Keymap,
  fromMarkdownBlock: detailsFromMarkdown,
  wrapperAttrs(block) {
    const { open, level } = readToggle(block.props);
    return { "data-jul-editor-open": String(open), "data-toggle-level": level ? String(level) : undefined };
  },
  toMarkdown(block, ctx) {
    const { open, level } = readToggle({ open: getProp(block, "open", ctx.registry) as Json, level: getProp(block, "level", ctx.registry) as Json });
    // The summary is a single HTML line: inline markdown inside it, hard breaks as <br>.
    const own = ctx.inlines(block.content).replace(/\n/g, "<br>");
    const title = level ? `<h${level}>${own}</h${level}>` : own;
    const head = `<details${open ? " open" : ""}>\n<summary>${title}</summary>`;
    const kids = block.children && block.children.length ? ctx.children() : "";
    return kids ? `${head}\n\n${kids}\n\n</details>` : `${head}\n</details>`;
  },
  toHTML(block, ctx) {
    const { open, level } = readToggle({ open: getProp(block, "open", ctx.registry) as Json, level: getProp(block, "level", ctx.registry) as Json });
    const kids = block.children && block.children.length ? ctx.children() : "";
    return `<details data-jul-editor-type="toggle"${level ? ` data-level="${level}"` : ""}${open ? " open" : ""}><summary>${ctx.inlines(block.content)}</summary>${kids}</details>`;
  },
  toText(block, ctx) {
    const pad = "  ".repeat(ctx.indent);
    const own = `${pad}▸ ${ctx.inlines(block.content)}`;
    return block.children && block.children.length ? `${own}\n${ctx.children()}` : own;
  },
  fromHTML: {
    selector: "details",
    parse(el, ctx): Block {
      const summary = Array.from(el.children).find((c) => c.tagName === "SUMMARY") ?? null;
      let level: ToggleProps["level"] = 0;
      let titleEl: Element | null = summary;
      const heading = summary && Array.from(summary.children).find((c) => /^H[1-3]$/.test(c.tagName));
      if (heading) {
        level = Number(heading.tagName[1]) as 1 | 2 | 3;
        titleEl = heading;
      } else if (el.getAttribute("data-level")) {
        const n = Number(el.getAttribute("data-level"));
        if (n === 1 || n === 2 || n === 3) level = n;
      }
      const props: Record<string, Json> = {};
      if (el.hasAttribute("open")) props.open = true;
      if (level) props.level = level;
      const block: Block = { id: newId(), type: "toggle", props, content: inlinesFromHTML(titleEl, ctx) };
      const body = el.cloneNode(true) as Element;
      body.querySelector(":scope > summary")?.remove();
      const children = blocksFromHTML(body, ctx);
      if (children.length) block.children = children;
      return block;
    },
  },
});

/** Opens/closes a toggle. Collapsing while the caret is inside one of its descendants moves the caret
 * to the toggle's summary (the hidden children cannot hold a caret), all as ONE undo step. */
export function setToggleOpen(editor: Editor, id: string, open: boolean, opts: { persist?: boolean } = {}): void {
  editor.update((tx) => {
    const state = editor.getState();
    // persist:false (an openStore adapter owns the state) only repairs the selection.
    let next = opts.persist === false ? tx : tx.setProps(id, { open: open ? true : undefined });
    const sel = state.selection;
    if (!open && sel && sel.type === "text" && sel.anchor.blockId !== id && ancestorChain(state.store, sel.anchor.blockId).includes(id)) {
      const caret = { blockId: id, offset: 0 };
      next = next.setSelection({ type: "text", anchor: caret, focus: caret });
    }
    return next;
  });
}

/** True iff `id` is hidden inside a collapsed toggle ancestor (for scroll-to / TOC click: expand first). */
export function collapsedToggleAncestors(editor: Editor, id: string): string[] {
  const store = editor.getState().store;
  return ancestorChain(store, id).filter((a) => a !== id && store.records.get(a)?.type === "toggle" && store.records.get(a)?.props.open !== true);
}

export const toggleSlashItem: SlashItem = {
  type: "toggle",
  title: "Toggle",
  keywords: ["toggle", "details", "collapse", "accordion", "토글", "접기", "펼치기"],
  create: () => ({ id: newId(), type: "toggle", props: { open: true }, content: [] }),
};

/** `/toggle1` ... `/toggle3`: toggle headings. Distinct ids so the menu can list all three. */
export const toggleHeadingSlashItems: Array<SlashItem & { id: string }> = ([1, 2, 3] as const).map((level) => ({
  id: `toggle-heading-${level}`,
  type: "toggle",
  title: `Toggle heading ${level}`,
  keywords: ["toggle", "heading", `h${level}`, `toggle${level}`, "토글", "제목", `토글제목${level}`],
  create: () => ({ id: newId(), type: "toggle", props: { open: true, level }, content: [] }),
}));

export const toggleInputRules: InputRuleEntry[] = [
  prefixRule(/^>> $/, "toggle"),
  prefixRule(/^>>(#{1,3}) $/, "toggle", (m) => ({ level: m[1]!.length })),
];

/** Turn-into entries: plain toggle (level 0) and toggle headings 1-3. `level` is also the active test. */
export const toggleTurnIntoItems = ([0, 1, 2, 3] as const).map((level) => ({
  id: level ? `toggle-heading-${level}` : "toggle",
  type: "toggle",
  props: { level } as Record<string, Json>,
  label: level ? { en: `Toggle heading ${level}`, ko: `토글 제목 ${level}` } : { en: "Toggle", ko: "토글" },
  keywords: level ? ["toggle", "heading", `h${level}`] : ["toggle", "details"],
}));
