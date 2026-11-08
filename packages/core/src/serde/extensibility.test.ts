// Requirement: adding a custom block/inline/mark must not require
// touching serde source (to-markdown.ts/to-html.ts/to-text.ts/from-markdown.ts
// are unmodified by this file -- everything here is wired purely through
// defineBlock/defineInline/defineMark + createRegistry, exactly as a
// consumer of @jul-editor/core would do it).
import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks } from "../model/builtins.js";
import { getProp, isText } from "../model/canonical.js";
import { newId } from "../model/id.js";
import { createRegistry, defineBlock, defineInline, defineMark } from "../model/schema.js";
import type { Block, Doc, Inline } from "../model/types.js";
import { fromMarkdown } from "./from-markdown.js";
import { canonicalNoIds } from "./test-helpers.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";
import { toText } from "./to-text.js";

function plainText(content: Inline[] | undefined): string {
  return (content ?? []).map((inl) => (isText(inl) ? inl.text : "")).join("");
}

// Custom block: callout (props {emoji}, content: inline), a fenced markdown
// form like chart/diagram/dataTable use ("```callout\n<emoji>\n<text>\n```").
const callout = defineBlock({
  type: "callout",
  content: "inline",
  children: "none",
  props: { emoji: "\u{1F4A1}" }, // default lightbulb
  toMarkdown(block, ctx) {
    const emoji = String(getProp(block, "emoji", ctx.registry) ?? "");
    return "```callout\n" + emoji + "\n" + plainText(block.content) + "\n```";
  },
  toHTML(block, ctx) {
    const emoji = String(getProp(block, "emoji", ctx.registry) ?? "");
    return `<div data-jul-editor-type="callout"><span data-emoji>${ctx.escapeText(emoji)}</span>${ctx.inlines(block.content)}</div>`;
  },
  toText(block, ctx) {
    const emoji = String(getProp(block, "emoji", ctx.registry) ?? "");
    return `${emoji} ${ctx.inlines(block.content)}`;
  },
  fromMarkdown: {
    fence: "callout",
    parse(token) {
      const nl = token.text.indexOf("\n");
      const emoji = nl === -1 ? token.text : token.text.slice(0, nl);
      const text = nl === -1 ? "" : token.text.slice(nl + 1);
      const block: Block = { id: newId(), type: "callout", props: { emoji }, content: [{ type: "text", text }] };
      return block;
    },
  },
});

// Custom inline: hashtag. Reuses the exact same link-token mechanism mention
// uses (a markdown link whose href a registered InlineSpec recognizes).
const hashtag = defineInline({
  type: "hashtag",
  attrs: { tag: "" },
  toMarkdown(inl, ctx) {
    const tag = String((inl as unknown as { attrs: { tag: string } }).attrs.tag);
    return `[#${ctx.escapeText(tag)}](hashtag:${encodeURIComponent(tag)})`;
  },
  toHTML(inl, ctx) {
    const tag = String((inl as unknown as { attrs: { tag: string } }).attrs.tag);
    return `<a data-hashtag href="${ctx.escapeAttr("#" + tag)}">#${ctx.escapeText(tag)}</a>`;
  },
  toText(inl) {
    return `#${(inl as unknown as { attrs: { tag: string } }).attrs.tag}`;
  },
  fromMarkdownLink(href, _text) {
    const m = /^hashtag:(.+)$/.exec(href);
    if (!m) return null;
    return { type: "hashtag", attrs: { tag: decodeURIComponent(m[1]!) } } as unknown as Inline;
  },
});

// Custom mark: highlight, ==text== / <mark>text</mark>. Wraps generically
// through MarkSpec.markdown/html -- no special-casing needed (unlike code/link).
// `parse` is what makes the markdown direction round-trip too: marked's
// stock lexer has no built-in "==...==" syntax, so without it this one
// direction wasn't wired (a bare-text custom mark syntax needs its own marked
// extension) -- from-markdown.ts's lexerFor() wires this into one exactly as
// a real consumer would, purely through the registry.
const highlight = defineMark({
  type: "highlight",
  markdown: { open: "==", close: "==", parse: { start: "==", tokenizer: /^==([^=\n]+)==/ } },
  html: { tag: "mark" },
});

const registry = createRegistry({
  blocks: [...coreBlocks, callout],
  inlines: [...coreInlines, hashtag],
  marks: [...coreMarks, highlight],
});

function doc(blocks: Block[]): Doc {
  return { version: 1, blocks };
}

describe("registry-driven serde extensibility", () => {
  it("custom block (callout): toMarkdown/toHTML/toText all reflect it, and it round-trips through markdown", () => {
    const d = doc([{ id: "c1", type: "callout", props: { emoji: "⚠️" }, content: [{ type: "text", text: "careful now" }] }]);

    const { markdown, lossy } = toMarkdown(d, { registry });
    expect(lossy).toEqual([]);
    expect(markdown).toBe("```callout\n⚠️\ncareful now\n```");

    expect(toHTML(d, { registry })).toBe(
      '<div data-jul-editor-type="callout"><span data-emoji>⚠️</span>careful now</div>',
    );
    expect(toText(d, { registry })).toBe("⚠️ careful now");

    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown, { registry });
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, registry)).toBe(canonicalNoIds(d, registry));
  });

  it("custom block (callout) with the default emoji round-trips too (default-prop omission still applies)", () => {
    const d = doc([{ id: "c1", type: "callout", props: {}, content: [{ type: "text", text: "tip" }] }]);
    const { markdown, lossy } = toMarkdown(d, { registry });
    expect(lossy).toEqual([]);
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown, { registry });
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, registry)).toBe(canonicalNoIds(d, registry));
  });

  it("custom inline (hashtag): toMarkdown/toHTML/toText all reflect it, and it round-trips through markdown", () => {
    const d = doc([
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "see " }, { type: "hashtag", attrs: { tag: "jul-editor" } } as unknown as Inline],
      },
    ]);

    const { markdown, lossy } = toMarkdown(d, { registry });
    expect(lossy).toEqual([]);
    expect(markdown).toBe("see [#jul-editor](hashtag:jul-editor)");

    expect(toHTML(d, { registry })).toBe('<p data-jul-editor-type="paragraph">see <a data-hashtag href="#jul-editor">#jul-editor</a></p>');
    expect(toText(d, { registry })).toBe("see #jul-editor");

    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown, { registry });
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, registry)).toBe(canonicalNoIds(d, registry));
  });

  it("custom mark (highlight): toMarkdown/toHTML reflect ==text==/<mark>, plain in toText", () => {
    const d = doc([
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "important", marks: [{ type: "highlight" }] }],
      },
    ]);

    const { markdown } = toMarkdown(d, { registry });
    expect(markdown).toBe("==important==");
    expect(toHTML(d, { registry })).toBe('<p data-jul-editor-type="paragraph"><mark>important</mark></p>');
    // toText never renders marks (plain text only) -- unaffected by a new mark type.
    expect(toText(d, { registry })).toBe("important");

    // now round-trips both ways -- toMarkdown's "==important==" comes
    // back as a real `highlight`-marked text run (not literal "==...==" text),
    // via MarkSpec.markdown.parse wired as a marked inline extension.
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown, { registry });
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, registry)).toBe(canonicalNoIds(d, registry));
  });

  it("custom mark (highlight) parses standalone, nested inside bold, and alongside plain text", () => {
    const { doc: plain } = fromMarkdown("==hi==", { registry });
    expect(plain.blocks[0]!.content).toEqual([{ type: "text", text: "hi", marks: [{ type: "highlight" }] }]);

    const { doc: nested } = fromMarkdown("**==hi==**", { registry });
    expect(nested.blocks[0]!.content).toEqual([{ type: "text", text: "hi", marks: [{ type: "bold" }, { type: "highlight" }] }]);

    const { doc: mixed } = fromMarkdown("before ==hi== after", { registry });
    expect(plainText(mixed.blocks[0]!.content)).toBe("before hi after");
    expect(mixed.blocks[0]!.content).toContainEqual({ type: "text", text: "hi", marks: [{ type: "highlight" }] });
  });

  it("all three together in one doc: toMarkdown/toHTML/toText succeed, all three round-trip", () => {
    const d = doc([
      { id: "c1", type: "callout", props: { emoji: "ℹ️" }, content: [{ type: "text", text: "note" }] },
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "highlighted", marks: [{ type: "highlight" }] },
          { type: "text", text: " " },
          { type: "hashtag", attrs: { tag: "tag" } } as unknown as Inline,
        ],
      },
    ]);
    const { markdown, lossy } = toMarkdown(d, { registry });
    expect(lossy).toEqual([]);
    expect(markdown).toContain("```callout");
    expect(markdown).toContain("==highlighted==");
    expect(markdown).toContain("[#tag](hashtag:tag)");
    expect(toHTML(d, { registry })).toContain("<mark>highlighted</mark>");
    expect(toText(d, { registry })).toBe("ℹ️ note\nhighlighted #tag");

    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown, { registry });
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, registry)).toBe(canonicalNoIds(d, registry));
  });
});
