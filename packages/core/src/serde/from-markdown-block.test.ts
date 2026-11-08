import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, createRegistry, defineBlock } from "../model/index.js";
import type { FromMarkdownBlockResult } from "../model/index.js";
import { newId } from "../model/id.js";
import { fromMarkdown } from "./from-markdown.js";

const tag = defineBlock({
  type: "tagged",
  content: "none",
  children: "none",
  props: { kind: "" },
  fromMarkdownBlock(token, ctx): FromMarkdownBlockResult {
    if (token.type === "paragraph" && token.text === "[X]") return { id: newId(), type: "tagged", props: { kind: "para" } };
    if (token.type === "blockquote" && token.text.startsWith("[!Z]")) {
      const [q] = ctx.default();
      return { id: newId(), type: "tagged", props: { kind: "quote", inner: q!.type } };
    }
    if (token.type === "html" && token.raw.startsWith("<x>")) {
      // multi-token: swallow following tokens up to </x>
      let i = 0;
      while (i < ctx.following.length && !ctx.following[i]!.raw.includes("</x>")) i++;
      if (i >= ctx.following.length) return null;
      return { blocks: [{ id: newId(), type: "tagged", props: { kind: "html", body: ctx.parseMarkdown(ctx.following.slice(0, i).map((t) => t.raw).join("")).length } }], consumed: i + 1 };
    }
    return null;
  },
});
const registry = createRegistry({ blocks: [...coreBlocks, tag], inlines: coreInlines, marks: coreMarks });
const types = (md: string) => fromMarkdown(md, { registry }).doc.blocks.map((b) => b.type);

describe("BlockSpec.fromMarkdownBlock", () => {
  it("intercepts paragraph, blockquote and multi-token html; default() gives core's conversion", () => {
    const d = fromMarkdown("a\n\n[X]\n\n> [!Z] hi\n\n<x>\n\none\n\ntwo\n\n</x>\n\nz", { registry }).doc.blocks;
    expect(d.map((b) => b.type)).toEqual(["paragraph", "tagged", "tagged", "tagged", "paragraph"]);
    expect(d[1]!.props).toEqual({ kind: "para" });
    expect(d[2]!.props).toEqual({ kind: "quote", inner: "quote" });
    expect(d[3]!.props).toEqual({ kind: "html", body: 2 });
  });

  it("returning null falls through to the default conversion (and its lossy report)", () => {
    const r = fromMarkdown("<x>\n\nno end", { registry });
    expect(r.doc.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(r.lossy.some((l) => l.reason === "raw-html")).toBe(true);
  });

  it("applies to nested tokens (quote children, list item bodies) and is absent without the block", () => {
    expect(types("> q\n>\n> [X]")).toEqual(["quote"]);
    const nested = fromMarkdown("> q\n>\n> [X]", { registry }).doc.blocks[0]!;
    expect(nested.children?.map((c) => c.type)).toEqual(["tagged"]);
    const list = fromMarkdown("- item\n\n  [X]", { registry }).doc.blocks[0]!;
    expect(list.children?.map((c) => c.type)).toEqual(["tagged"]);
    expect(fromMarkdown("[X]").doc.blocks[0]!.type).toBe("paragraph");
  });
});
