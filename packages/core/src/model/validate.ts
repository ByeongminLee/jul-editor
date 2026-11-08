import type { Registry } from "./schema.js";
import type { Block, Doc, TextInline } from "./types.js";

export interface Issue {
  kind: "unknown-mark" | "disallowed-child" | "parent-violation" | "content-on-none" | "missing-id" | "duplicate-id";
  blockId?: string;
  message: string;
}

/** Reports schema violations without repairing anything (see normalizeDoc for repair). */
export function validateDoc(doc: Doc, registry: Registry): Issue[] {
  const issues: Issue[] = [];
  const seenIds = new Set<string>();

  function checkMarks(block: Block) {
    if (!block.content) return;
    for (const inl of block.content) {
      if (inl.type === "text") {
        for (const m of (inl as TextInline).marks ?? []) {
          if (!registry.isKnownMark(m.type)) {
            issues.push({
              kind: "unknown-mark",
              blockId: block.id,
              message: `unknown mark type "${m.type}" on block ${block.id}`,
            });
          }
        }
      }
    }
  }

  function walk(block: Block, containerType: string | null) {
    if (!block.id) {
      issues.push({ kind: "missing-id", message: "block missing id" });
    } else if (seenIds.has(block.id)) {
      issues.push({ kind: "duplicate-id", blockId: block.id, message: `duplicate id "${block.id}"` });
    } else {
      seenIds.add(block.id);
    }

    const spec = registry.blocks.get(block.type);
    checkMarks(block);

    if (spec) {
      if (spec.content === "none" && block.content !== undefined) {
        issues.push({
          kind: "content-on-none",
          blockId: block.id,
          message: `block ${block.id} of type "${block.type}" has content but content kind is "none"`,
        });
      }
      if (spec.parent && (containerType === null || !spec.parent.includes(containerType))) {
        issues.push({
          kind: "parent-violation",
          blockId: block.id,
          message: `block ${block.id} of type "${block.type}" requires parent in [${spec.parent.join(", ")}] but found ${containerType ?? "root"}`,
        });
      }
    }

    for (const child of block.children ?? []) {
      if (spec) {
        const allowed = spec.children === "any" || (Array.isArray(spec.children) && spec.children.includes(child.type));
        if (!allowed) {
          issues.push({
            kind: "disallowed-child",
            blockId: block.id,
            message: `block ${block.id} of type "${block.type}" does not allow child type "${child.type}"`,
          });
        }
      }
      walk(child, block.type);
    }
  }

  for (const b of doc.blocks) walk(b, null);
  return issues;
}
