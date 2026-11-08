// The "@jul-editor/plugins/data" subpath must be importable from a DOM-free
// process (a server, with `resolveData` injected -- the core
// data utilities never touch React/recharts/mermaid). This package's vitest
// config runs this suite under `environment: "node"` (no jsdom), and asserts
// there is in fact no `document` global, so a regression that makes this file
// (or anything it imports) reach for the DOM fails loudly here rather than
// silently passing under a jsdom test runner.
import { describe, expect, it } from "vitest";

describe("@jul-editor/plugins/data (node, no DOM)", () => {
  it("has no DOM globals in this test environment", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("imports and runs without touching the DOM", async () => {
    const { parseCSV, applyRange, defaultResolveData } = await import("./");
    const table = parseCSV("a,b\n1,2\n3,4");
    expect(applyRange(table, "A1:A2").rows).toEqual([[1], [3]]);
    await expect(defaultResolveData({ type: "inline", csv: "x\n1" })).resolves.toEqual({
      columns: ["x"],
      columnTypes: ["number"],
      rows: [[1]],
    });
  });
});
