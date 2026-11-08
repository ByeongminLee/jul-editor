// Shared by serde tests only (not exported from index.ts).
import { canonicalStringify, normalizeDoc } from "../model/canonical.js";
import type { Registry } from "../model/schema.js";
import type { Block, Doc, Inline, TextInline } from "../model/types.js";

function stripIds(doc: Doc): Doc {
  function walk(b: Block): Block {
    const { id: _id, children, ...rest } = b;
    const out: Block = { ...rest } as Block;
    if (children) out.children = children.map(walk);
    return out;
  }
  return { version: doc.version, blocks: doc.blocks.map(walk) };
}

// toMarkdown trims a leading/trailing whitespace-only run off every
// inline-content block's own text (see to-markdown.ts renderInlineFinal for
// why -- headings/table cells are trimmed by CommonMark itself regardless,
// and we make list items consistent with that instead of leaving them at
// the mercy of whether a neighboring sibling happens to make the list
// "loose"). Applying the same trim to the reference doc here is what makes
// the round-trip invariant well-defined for fixtures that have this content
// shape (bench/gen.mjs always appends a trailing bare-space run).
function trimContentEdges(content: Inline[] | undefined): Inline[] | undefined {
  if (!content || content.length === 0) return content;
  const out = content.map((inl) => ({ ...inl }) as Inline);
  const first = out[0]!;
  if (first.type === "text") (first as TextInline).text = (first as TextInline).text.replace(/^\s+/, "");
  const last = out[out.length - 1]!;
  if (last.type === "text") (last as TextInline).text = (last as TextInline).text.replace(/\s+$/, "");
  return out.filter((inl) => !(inl.type === "text" && (inl as TextInline).text === ""));
}

function trimEdges(doc: Doc): Doc {
  function walk(b: Block): Block {
    const out: Block = { ...b };
    if (out.content && out.type !== "codeBlock") out.content = trimContentEdges(out.content);
    if (out.children) out.children = out.children.map(walk);
    return out;
  }
  return { version: doc.version, blocks: doc.blocks.map(walk) };
}

/** Canonical JSON of a doc, normalized, edge-trimmed and with every block id
 * stripped -- for the "equal ignoring ids" round-trip invariant. */
export function canonicalNoIds(doc: Doc, registry: Registry): string {
  return canonicalStringify(stripIds(trimEdges(normalizeDoc(doc, registry))));
}
