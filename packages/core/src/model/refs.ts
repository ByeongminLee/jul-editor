import type { Block, Doc, MentionInline } from "./types.js";

export interface RefEntry {
  blockId: string;
  kind: string;
  id: string;
}

/** Collects mention/asset/view references for server-side ref-counting and
 * cited-by lookups. Pure, doesn't touch a registry: it only
 * knows the built-in shapes (mention attrs, image assetId, chart/diagram/dataTable
 * view source). */
export function collectRefs(doc: Doc): RefEntry[] {
  const out: RefEntry[] = [];

  function visitBlock(block: Block) {
    for (const inl of block.content ?? []) {
      if (inl.type === "mention") {
        const attrs = (inl as MentionInline).attrs;
        out.push({ blockId: block.id, kind: attrs.kind, id: attrs.id });
      }
    }

    if (block.type === "image") {
      const assetId = block.props.assetId;
      if (typeof assetId === "string" && assetId) {
        out.push({ blockId: block.id, kind: "asset", id: assetId });
      }
    }

    if (block.type === "chart" || block.type === "diagram" || block.type === "dataTable") {
      const source = block.props.source as { type?: string; viewId?: string } | undefined;
      if (source && source.type === "view" && source.viewId) {
        out.push({ blockId: block.id, kind: "view", id: source.viewId });
      }
    }

    for (const child of block.children ?? []) visitBlock(child);
  }

  for (const b of doc.blocks) visitBlock(b);
  return out;
}
