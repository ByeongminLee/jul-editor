import type { Block, Doc } from "./types.js";

// base62, no padding chars that read ambiguously -- fine, this is not user-facing.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 10;

/** Short random base62 id (~10 chars, crypto-random). */
export function newId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Reissues any duplicate (or missing) block id in a doc, depth-first. */
export function ensureUniqueIds(doc: Doc): Doc {
  const seen = new Set<string>();
  function walk(blocks: Block[]): Block[] {
    return blocks.map((b) => {
      let id = b.id;
      if (!id || seen.has(id)) id = newId();
      seen.add(id);
      const next: Block = { ...b, id };
      if (b.children) next.children = walk(b.children);
      return next;
    });
  }
  return { ...doc, blocks: walk(doc.blocks) };
}
