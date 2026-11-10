// @vitest-environment jsdom
// image (width/align/caption) + embed serde round-trips and XSS
// invariants. jsdom environment (file-level override) since fromHTML needs a
// real DOMParser -- see from-html-sanitize.test.ts's own header comment.
import { describe, expect, it } from "vitest";
import { fromHTML } from "./from-html.js";
import { fromMarkdown } from "./from-markdown.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";
import { getProp } from "../model/canonical.js";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";

describe("image serde: width/align/caption", () => {
  it("toMarkdown/fromMarkdown round-trips src/alt/caption; reports lossy only for width/align/assetId", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "img", type: "image", props: { src: "https://x/y.png", alt: "a cat", caption: "a nice caption" } }],
    };
    const { markdown, lossy } = toMarkdown(doc);
    expect(markdown).toBe('![a cat](https://x/y.png "a nice caption")');
    expect(lossy).toEqual([]);

    const { doc: back } = fromMarkdown(markdown);
    const img = back.blocks[0]!;
    expect(img.type).toBe("image");
    expect(getProp(img, "src", coreRegistry)).toBe("https://x/y.png");
    expect(img.props.alt).toBe("a cat");
    expect(img.props.caption).toBe("a nice caption");
  });

  it("width/align (non-default) are reported lossy through markdown", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "img", type: "image", props: { src: "https://x/y.png", width: 200, align: "left" } }],
    };
    const { lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "img", type: "image", reason: "image-meta" }]);
  });

  it("a title containing a literal double quote round-trips (backslash-escaped)", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "img", type: "image", props: { src: "https://x/y.png", caption: 'say "hi"' } }] };
    const { markdown } = toMarkdown(doc);
    const { doc: back } = fromMarkdown(markdown);
    expect(back.blocks[0]!.props.caption).toBe('say "hi"');
  });

  it("toHTML/fromHTML round-trips src/alt/width/align/caption losslessly (our own figure convention)", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "img", type: "image", props: { src: "https://x/y.png", alt: "a cat", width: 240, align: "right", caption: "cap" } }],
    };
    const html = toHTML(doc);
    expect(html).toContain('data-align="right"');
    expect(html).toContain('width="240"');
    expect(html).toContain("<figcaption>cap</figcaption>");

    const { doc: back } = fromHTML(html);
    const img = back.blocks[0]!;
    expect(img.type).toBe("image");
    expect(img.props).toMatchObject({ src: "https://x/y.png", alt: "a cat", width: 240, align: "right", caption: "cap" });
  });

  it.each(["bulletListItem", "quote"])("round-trips a nested image in a %s", (type) => {
    const doc: Doc = { version: 1, blocks: [{ id: "parent", type, props: {}, content: [{ type: "text", text: "item" }], children: [
      { id: "img", type: "image", props: { src: "https://x/y.png", alt: "photo", width: 240, align: "right" } },
      { id: "child", type: "bulletListItem", props: {}, content: [{ type: "text", text: "child" }] },
    ] }] };
    const block = fromHTML(toHTML(doc)).doc.blocks[0]!;
    expect(block.content).toEqual([{ type: "text", text: "item" }]);
    expect(block.children).toHaveLength(2);
    expect(block.children![0]).toMatchObject({ type: "image", props: { src: "https://x/y.png", alt: "photo", width: 240, align: "right" } });
    expect(block.children![1]).toMatchObject({ type: "bulletListItem", content: [{ type: "text", text: "child" }] });
  });

  it("keeps bare inline images as alt text in lists", () => {
    const block = fromHTML('<ul><li>before <img src="https://x/y.png" alt="photo"> after</li></ul>').doc.blocks[0]!;
    expect(block.content?.map((inline) => inline.type === "text" && "text" in inline ? inline.text : "").join("")).toBe("before photo after");
    expect(block.children).toBeUndefined();
  });

  it("a bare third-party <img> (no figure wrapper) still parses via the generic path, ignoring width/align/caption", () => {
    const { doc } = fromHTML('<p><img src="https://x/y.png" alt="plain"></p>');
    expect(doc.blocks[0]).toMatchObject({ type: "image", props: { src: "https://x/y.png", alt: "plain" } });
  });
});

describe("embed serde: youtube/vimeo/x/link", () => {
  it("youtube: toMarkdown exports a plain link, fromMarkdown recovers provider/id/url losslessly", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "e", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } }],
    };
    const { markdown, lossy } = toMarkdown(doc);
    // The label text goes through the usual inline markdown escaping
    // (escapeMdInline backslash-escapes a literal "https://" prefix so it
    // can't trigger GFM's own autolink scanning inside the label) -- the
    // destination in (...) is untouched. fromMarkdown still recovers the
    // exact original url/id below (marked itself unescapes the label).
    expect(markdown).toBe("[https:\\//www\\.youtube.com/watch?v=dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ)");
    expect(lossy).toEqual([]);

    const { doc: back } = fromMarkdown(markdown);
    expect(back.blocks[0]).toMatchObject({ type: "embed", props: { provider: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  });

  it("a custom title round-trips through markdown too", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "e", type: "embed", props: { provider: "vimeo", url: "https://vimeo.com/123456789", id: "123456789", title: "My Video" } }],
    };
    const { markdown } = toMarkdown(doc);
    expect(markdown).toBe("[My Video](https://vimeo.com/123456789)");
    const { doc: back } = fromMarkdown(markdown);
    expect(back.blocks[0]!.props.title).toBe("My Video");
  });

  it("x/link providers are reported lossy through markdown (become a plain link, not an embed, on re-import)", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "e", type: "embed", props: { provider: "x", url: "https://x.com/a/status/1" } }] };
    const { lossy } = toMarkdown(doc);
    expect(lossy).toEqual([{ blockId: "e", type: "embed", reason: "embed-provider" }]);
  });

  it("youtube/vimeo toHTML/fromHTML round-trips through the allowlisted iframe", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "e", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } }],
    };
    const html = toHTML(doc);
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');

    const { doc: back } = fromHTML(html);
    expect(back.blocks[0]).toMatchObject({ type: "embed", props: { provider: "youtube", id: "dQw4w9WgXcQ" } });
  });

  it("x/link toHTML never emits an iframe, only a plain link card", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "e", type: "embed", props: { provider: "x", url: "https://x.com/a/status/1", title: "a post" } }] };
    const html = toHTML(doc);
    expect(html).not.toContain("<iframe");
    expect(html).toContain('<a href="https://x.com/a/status/1">a post</a>');
  });
});

describe("embed XSS/security invariants", () => {
  it("toHTML never emits an iframe for a crafted/invalid id, even for an allowlisted provider", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "e", type: "embed", props: { provider: "youtube", url: "https://x", id: '"><script>alert(1)</script>' } }] };
    const html = toHTML(doc);
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/<script/i);
  });

  it("toHTML never emits an iframe for an unrecognized provider string", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "e", type: "embed", props: { provider: "evil", url: "https://evil.example.com", id: "dQw4w9WgXcQ" } }] };
    const html = toHTML(doc);
    expect(html).not.toContain("<iframe");
  });

  it("embed.url with a javascript: scheme is sanitized to empty at the model layer (opInsertBlock/normalizeDoc), never reaches an href live", () => {
    const { doc } = fromHTML('<div data-jul-editor-type="embed" data-provider="link"><a href="javascript:alert(1)">click</a></div>');
    // The generic div-unwrap path doesn't reconstruct an embed block from
    // this shape (only a real <iframe> does, see media-serde.ts) -- either
    // way, no live javascript: href can reach the model.
    const html = toHTML(doc);
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("fromHTML drops a non-allowlisted iframe (plain youtube.com/embed, not -nocookie) -- never becomes an embed block, never re-emitted", () => {
    const { doc, lossy } = fromHTML('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
    expect(doc.blocks.find((b) => b.type === "embed")).toBeUndefined();
    expect(lossy.some((l) => l.reason === "dropped-element")).toBe(true);
    expect(toHTML(doc)).not.toContain("<iframe");
  });

  it("fromHTML drops an arbitrary third-party iframe entirely", () => {
    const { doc } = fromHTML('<iframe src="https://evil.example.com/x" onload="alert(1)"></iframe>');
    expect(doc.blocks.find((b) => b.type === "embed")).toBeUndefined();
    expect(toHTML(doc)).not.toContain("<iframe");
    expect(toHTML(doc)).not.toMatch(/onload/i);
  });

  it("a paragraph-of-one-link that ISN'T youtube/vimeo never becomes an embed on fromMarkdown", () => {
    const { doc } = fromMarkdown("[click me](javascript:alert(1))");
    expect(doc.blocks[0]!.type).not.toBe("embed");
    expect(toHTML(doc)).not.toMatch(/javascript:/i);
  });
});
