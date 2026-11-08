import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreRegistry } from "./builtins.js";
import { canonicalStringify, normalizeDoc } from "./canonical.js";
import { validateDoc } from "./validate.js";
import type { Doc } from "./types.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(dir, "../../../../bench/fixtures");

describe("bench fixtures", () => {
  for (const name of ["doc-500.json", "doc-5000.json"]) {
    it(`${name} passes validateDoc with zero issues`, () => {
      const doc = JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8")) as Doc;
      const issues = validateDoc(doc, coreRegistry);
      expect(issues).toEqual([]);
    });

    it(`${name} normalizes idempotently`, () => {
      const doc = JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8")) as Doc;
      const once = normalizeDoc(doc, coreRegistry);
      const twice = normalizeDoc(once, coreRegistry);
      expect(canonicalStringify(twice)).toBe(canonicalStringify(once));
    });
  }
});
