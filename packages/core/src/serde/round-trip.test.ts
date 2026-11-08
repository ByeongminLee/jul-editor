import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { handFixture } from "./fixtures.hand.js";
import { fromMarkdown } from "./from-markdown.js";
import { canonicalNoIds } from "./test-helpers.js";
import { toMarkdown } from "./to-markdown.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(dir, "../../../../bench/fixtures");

describe("serde round-trip invariant", () => {
  for (const name of ["doc-500.json", "doc-5000.json"]) {
    it(`${name}: fromMarkdown(toMarkdown(doc)).doc equals doc (ids stripped)`, () => {
      const doc = JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8")) as Doc;
      const { markdown, lossy } = toMarkdown(doc);
      expect(lossy).toEqual([]);
      const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
      expect(lossy2).toEqual([]);
      expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(doc, coreRegistry));
    });
  }

  it("hand fixture (every block type + every mark) round-trips losslessly", () => {
    const { markdown, lossy } = toMarkdown(handFixture);
    expect(lossy).toEqual([]);
    const { doc: doc2, lossy: lossy2 } = fromMarkdown(markdown);
    expect(lossy2).toEqual([]);
    expect(canonicalNoIds(doc2, coreRegistry)).toBe(canonicalNoIds(handFixture, coreRegistry));
  });
});
