import { describe, expect, it } from "vitest";
import { coreRegistry } from "./builtins.js";
import { CURRENT_VERSION, fromJSON, migrate, toJSON } from "./migrate.js";
import type { Doc } from "./types.js";

const r = coreRegistry;

describe("migrate", () => {
  it("applies migration steps in order up to CURRENT_VERSION", () => {
    const calls: number[] = [];
    const doc: Doc = { version: 0, blocks: [] };
    const migrations = {
      0: (d: Doc) => {
        calls.push(0);
        return d;
      },
    };
    const out = migrate(doc, migrations);
    expect(calls).toEqual([0]);
    expect(out.version).toBe(CURRENT_VERSION);
  });

  it("is a no-op when already current", () => {
    const doc: Doc = { version: CURRENT_VERSION, blocks: [] };
    const out = migrate(doc, {});
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.blocks).toEqual([]);
  });

  it("skips versions without a registered step", () => {
    const doc: Doc = { version: 0, blocks: [] };
    const out = migrate(doc, {});
    expect(out.version).toBe(CURRENT_VERSION);
  });
});

describe("fromJSON / toJSON", () => {
  it("parses a JSON string, migrates, dedupes ids, normalizes, and reports issues", () => {
    const raw = JSON.stringify({
      version: 0,
      blocks: [
        { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] },
        { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "there" }] },
      ],
    });
    const { doc, issues } = fromJSON(raw, r);
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.blocks[0]!.id).not.toBe(doc.blocks[1]!.id);
    // the input had a duplicate id, which validateDoc (run before ensureUniqueIds's
    // effects are hidden by re-validation) should have flagged
    expect(issues.some((i) => i.kind === "duplicate-id")).toBe(true);
  });

  it("accepts an already-parsed object", () => {
    const { doc } = fromJSON({ version: 1, blocks: [] }, r);
    expect(doc.blocks.length).toBe(1); // empty doc gets a trailing paragraph
  });

  it("toJSON round-trips through canonical stringify", () => {
    const { doc } = fromJSON({ version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] }, r);
    const json = toJSON(doc);
    expect(JSON.parse(json)).toEqual(doc);
  });
});
