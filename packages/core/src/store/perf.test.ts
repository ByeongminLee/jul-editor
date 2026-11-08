// Perf sanity test: commits are a full O(n) Map copy, but that
// should still be comfortably sub-millisecond at document scale. Not a hard
// CI gate (no bench/check.mjs budget wired for this package yet) -- reports
// the measured average so a future regression is visible in test output.

import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { isText, normalizeDoc } from "../model/canonical.js";
import { createTransaction } from "./transaction.js";
import { fromDoc } from "./store.js";
import type { EditorState } from "./types.js";

function make5000BlockDoc(): Doc {
  const blocks: Doc["blocks"] = [];
  for (let i = 0; i < 5000; i++) {
    blocks.push({ id: `p${i}`, type: "paragraph", props: {}, content: [{ type: "text", text: `paragraph ${i}` }] });
  }
  return normalizeDoc({ version: 1, blocks }, coreRegistry);
}

describe("perf sanity: 5000 blocks, 200 insertText commits", () => {
  it("averages well under 1ms per commit in node", () => {
    const doc = make5000BlockDoc();
    let state: EditorState = { store: fromDoc(doc, coreRegistry), selection: null };
    const targetBlockId = "p2500"; // a block in the middle of the document

    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      const offset = state.store.records.get(targetBlockId)!.content!.reduce((n, inl) => n + (isText(inl) ? inl.text.length : 1), 0);
      const result = createTransaction(state, coreRegistry).insertText({ blockId: targetBlockId, offset }, "x").commit();
      state = result.state;
    }
    const elapsed = performance.now() - start;
    const avg = elapsed / 200;
    // eslint-disable-next-line no-console
    console.log(`[perf] 5000-block store, 200 insertText commits: ${elapsed.toFixed(2)}ms total, ${avg.toFixed(4)}ms/commit average`);

    expect(state.store.records.get(targetBlockId)!.content).toEqual([{ type: "text", text: `paragraph 2500${"x".repeat(200)}` }]);
    expect(avg).toBeLessThan(1);
  });
});
