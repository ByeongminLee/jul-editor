import { canonicalStringify, normalizeDoc } from "./canonical.js";
import { ensureUniqueIds } from "./id.js";
import type { Registry } from "./schema.js";
import type { Doc } from "./types.js";
import { validateDoc, type Issue } from "./validate.js";

export const CURRENT_VERSION = 1;

export type Migration = (doc: Doc) => Doc;

/** Applies migrations[v] in order, v from doc.version up to CURRENT_VERSION - 1. */
export function migrate(doc: Doc, migrations: Record<number, Migration> = {}): Doc {
  let d = doc;
  let v = d.version ?? 0;
  while (v < CURRENT_VERSION) {
    const step = migrations[v];
    d = step ? step(d) : d;
    v += 1;
    d = { ...d, version: v };
  }
  return d;
}

export interface FromJSONResult {
  doc: Doc;
  issues: Issue[];
}

/** parse -> migrate -> ensureUniqueIds -> normalize. Validation issues are
 * computed on the migrated-but-not-yet-repaired doc (what was actually wrong
 * with the input, e.g. duplicate ids) and returned alongside the repaired,
 * normalized doc. */
export function fromJSON(input: string | unknown, registry: Registry, migrations?: Record<number, Migration>): FromJSONResult {
  const raw = (typeof input === "string" ? JSON.parse(input) : input) as Doc;
  const migrated = migrate(raw, migrations);
  const issues = validateDoc(migrated, registry);
  const uniqued = ensureUniqueIds(migrated);
  const doc = normalizeDoc(uniqued, registry);
  return { doc, issues };
}

export function toJSON(doc: Doc): string {
  return canonicalStringify(doc);
}
