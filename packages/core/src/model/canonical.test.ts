import { describe, expect, it } from "vitest";
import { coreRegistry } from "./builtins.js";
import { canonicalStringify, getProp, normalizeDoc, normalizeInline } from "./canonical.js";
import { cyrb53 } from "./hash.js";
import { validateDoc } from "./validate.js";
import type { Block, Doc } from "./types.js";

const r = coreRegistry;

function doc(blocks: Doc["blocks"]): Doc {
  return { version: 1, blocks };
}

describe("canonicalStringify", () => {
  it("sorts object keys", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omits undefined values recursively", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalStringify({ a: { x: undefined, y: 1 } })).toBe('{"a":{"y":1}}');
  });
});

describe("normalizeDoc idempotence", () => {
  it("is idempotent on a hand-built doc", () => {
    const d = doc([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] },
      { id: "img1", type: "image", props: { src: "https://x/y.png", alt: "x" } },
    ]);
    const once = normalizeDoc(d, r);
    const twice = normalizeDoc(once, r);
    expect(canonicalStringify(twice)).toBe(canonicalStringify(once));
  });
});

describe("canonical equality across cosmetic differences", () => {
  it("same content, different prop key order -> identical canonical JSON and hash", () => {
    const a = doc([
      { id: "i1", type: "image", props: { src: "x.png", alt: "a caption", width: 100 } },
      { id: "p1", type: "paragraph", props: {}, content: [] },
    ]);
    const b = doc([
      { id: "i1", type: "image", props: { width: 100, alt: "a caption", src: "x.png" } },
      { id: "p1", type: "paragraph", props: {}, content: [] },
    ]);
    const na = normalizeDoc(a, r);
    const nb = normalizeDoc(b, r);
    expect(canonicalStringify(na)).toBe(canonicalStringify(nb));
    expect(cyrb53(canonicalStringify(na))).toBe(cyrb53(canonicalStringify(nb)));
  });

  it("same text split into different runs with equal marks -> identical after normalize", () => {
    const a = normalizeInline([{ type: "text", text: "hello world" }], r);
    const b = normalizeInline(
      [
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ],
      r,
    );
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("marks in different order but equal set normalize identically", () => {
    const a = normalizeInline([{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] }], r);
    const b = normalizeInline([{ type: "text", text: "x", marks: [{ type: "italic" }, { type: "bold" }] }], r);
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("dedupes identical marks on a run", () => {
    const a = normalizeInline([{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }], r);
    expect((a[0] as any).marks.length).toBe(1);
  });

  it("drops empty text runs", () => {
    const a = normalizeInline(
      [
        { type: "text", text: "a" },
        { type: "text", text: "" },
        { type: "text", text: "b" },
      ],
      r,
    );
    // "a" and "b" both have no marks so they merge into one run anyway
    expect(a).toEqual([{ type: "text", text: "ab" }]);
  });
});

describe("default props omission + getProp", () => {
  it("normalize omits props equal to the schema default", () => {
    const d = doc([{ id: "h1", type: "heading", props: { level: 1 }, content: [] }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks[0]!.props).toEqual({});
  });

  it("keeps props that differ from default", () => {
    const d = doc([{ id: "h1", type: "heading", props: { level: 3 }, content: [] }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks[0]!.props).toEqual({ level: 3 });
  });

  it("getProp returns the explicit value when present", () => {
    const block = { id: "h1", type: "heading", props: { level: 3 }, content: [] };
    expect(getProp(block, "level", r)).toBe(3);
  });

  it("getProp falls back to the schema default when absent", () => {
    const block = { id: "h1", type: "heading", props: {}, content: [] };
    expect(getProp(block, "level", r)).toBe(1);
  });

  it("getProp returns undefined for a prop with no default and no value", () => {
    const block = { id: "o1", type: "orderedListItem", props: {}, content: [] };
    expect(getProp(block, "start", r)).toBeUndefined();
  });
});

describe("structure repair", () => {
  it("pads table rows to the widest row's cell count", () => {
    const d = doc([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          {
            id: "r1",
            type: "tableRow",
            props: {},
            children: [
              { id: "c1", type: "tableCell", props: {}, content: [] },
              { id: "c2", type: "tableCell", props: {}, content: [] },
            ],
          },
          {
            id: "r2",
            type: "tableRow",
            props: {},
            children: [{ id: "c3", type: "tableCell", props: {}, content: [] }],
          },
        ],
      },
    ]);
    const n = normalizeDoc(d, r);
    const table = n.blocks.find((b) => b.type === "table")!;
    const rows = table.children!;
    expect(rows[0]!.children!.length).toBe(2);
    expect(rows[1]!.children!.length).toBe(2);
    expect(rows[1]!.children![1]!.content).toEqual([]);
  });

  it("appends a trailing empty paragraph when the doc ends with a void block", () => {
    const d = doc([{ id: "img1", type: "image", props: { src: "x", alt: "y" } }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks.length).toBe(2);
    expect(n.blocks[1]!.type).toBe("paragraph");
    expect(n.blocks[1]!.content).toEqual([]);
  });

  it("appends a paragraph to an empty doc", () => {
    const n = normalizeDoc(doc([]), r);
    expect(n.blocks.length).toBe(1);
    expect(n.blocks[0]!.type).toBe("paragraph");
  });

  it("does not append after a non-void trailing block", () => {
    const d = doc([{ id: "p1", type: "paragraph", props: {}, content: [] }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks.length).toBe(1);
  });

  it("lifts a child type not allowed by the parent's schema to become a following sibling", () => {
    // codeBlock has children: 'none' -- a table nested under it must be lifted out
    // (paragraph/heading/quote have children: 'any' (Notion-style nesting),
    // so this case now needs a genuinely childless-schema container instead.)
    const d = doc([
      {
        id: "c1",
        type: "codeBlock",
        props: {},
        content: [{ type: "text", text: "hi" }],
        children: [{ id: "t1", type: "table", props: {}, children: [] }],
      } as any,
    ]);
    const n = normalizeDoc(d, r);
    // table has no 'inline'/'code' content of its own, so a cursor can't be placed
    // after it either -- a trailing paragraph gets appended, same as after a void.
    expect(n.blocks.map((b) => b.type)).toEqual(["codeBlock", "table", "paragraph"]);
    expect(n.blocks[0]!.children).toBeUndefined();
  });

  it("appends a trailing empty paragraph when the doc ends with a table (precondition fix)", () => {
    const d = doc([
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] },
      {
        id: "t1",
        type: "table",
        props: {},
        children: [{ id: "r1", type: "tableRow", props: {}, children: [{ id: "c1", type: "tableCell", props: {}, content: [] }] }],
      },
    ]);
    const n = normalizeDoc(d, r);
    expect(n.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(n.blocks[2]!.content).toEqual([]);
  });

  // a bare tableRow at root used to be kept AS-IS (structurally
  // invalid -- validateDoc flags it as a parent-violation, and nothing could
  // ever render/edit it as a real row). It's now wrapped in a fresh table
  // instead, which is both root-legal and still edits like a real table.
  it("wraps a tableRow placed directly at doc root (parent violation) in a table, without losing it", () => {
    const d = doc([{ id: "row1", type: "tableRow", props: {}, children: [] }]);
    const n = normalizeDoc(d, r);
    expect(validateDoc(n, r)).toEqual([]);
    const findsRow1 = (bs: Block[]): boolean => bs.some((b) => b.id === "row1" || (b.children && findsRow1(b.children)));
    expect(findsRow1(n.blocks)).toBe(true);
    expect(n.blocks.some((b) => b.type === "table" && b.children?.[0]?.id === "row1")).toBe(true);
  });

  it("lifts a child not in the table's allowed children list (tableRow only)", () => {
    const d = doc([
      {
        id: "t1",
        type: "table",
        props: {},
        children: [{ id: "p1", type: "paragraph", props: {}, content: [] } as any],
      },
    ]);
    const n = normalizeDoc(d, r);
    const table = n.blocks.find((b) => b.id === "t1")!;
    expect(table.children ?? []).toEqual([]);
    expect(n.blocks.some((b) => b.id === "p1")).toBe(true);
  });
});

describe("sanitizeUrl wiring (precondition fix)", () => {
  it("drops a link mark with an unsafe href but keeps the text", () => {
    const d = doc([
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "click me", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
      },
    ]);
    const n = normalizeDoc(d, r);
    expect(n.blocks[0]!.content).toEqual([{ type: "text", text: "click me" }]);
  });

  it("keeps a link mark with a safe href", () => {
    const d = doc([
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "click me", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      },
    ]);
    const n = normalizeDoc(d, r);
    expect((n.blocks[0]!.content![0] as any).marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
  });

  it("resets an unsafe image src to '' (omitted, the schema default)", () => {
    const d = doc([{ id: "i1", type: "image", props: { src: "javascript:alert(1)", alt: "x" } }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks[0]!.props.src).toBeUndefined();
  });

  it("keeps a safe image src", () => {
    const d = doc([{ id: "i1", type: "image", props: { src: "https://x/y.png", alt: "x" } }]);
    const n = normalizeDoc(d, r);
    expect(n.blocks[0]!.props.src).toBe("https://x/y.png");
  });
});

describe("unknown block types", () => {
  it("preserves an unregistered type opaquely through normalize", () => {
    const d = doc([{ id: "x1", type: "totallyUnknownBlock", props: { foo: "bar" }, content: [{ type: "text", text: "hi" }] } as any]);
    const n = normalizeDoc(d, r);
    const found = n.blocks.find((b) => b.id === "x1")!;
    expect(found.type).toBe("totallyUnknownBlock");
    expect(found.props).toEqual({ foo: "bar" });
    expect(r.isKnown("totallyUnknownBlock")).toBe(false);
  });
});
