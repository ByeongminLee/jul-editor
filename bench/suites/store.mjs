// Store perf gate ("store-commit-5000").
// Mirrors packages/core/src/store/perf.test.ts's own vitest sanity check
// (200 insertText commits on a 5000-block store, avg < 1ms) but wired into
// bench/check.mjs so a regression fails the `pnpm perf` gate, not just a
// console.log a human has to notice. Budget 200ms == 200 commits * 1ms/commit.
import { coreRegistry } from "../../packages/core/src/model/builtins.js";
import { normalizeDoc } from "../../packages/core/src/model/canonical.js";
import { fromDoc } from "../../packages/core/src/store/store.js";
import { createTransaction } from "../../packages/core/src/store/transaction.js";

function make5000BlockDoc() {
  const blocks = [];
  for (let i = 0; i < 5000; i++) {
    blocks.push({ id: `p${i}`, type: "paragraph", props: {}, content: [{ type: "text", text: `paragraph ${i}` }] });
  }
  return normalizeDoc({ version: 1, blocks }, coreRegistry);
}

// Built once, outside the timed fn -- bench/check.mjs's 5 warmups + 20 timed
// calls all keep mutating the SAME state (each call appends 200 more "x"s to
// the target block), so doc construction/fromDoc cost never lands inside the
// timed portion, matching perf.test.ts's intent.
const TARGET_BLOCK_ID = "p2500"; // middle block, matching the typing-latency protocol
let state = { store: fromDoc(make5000BlockDoc(), coreRegistry), selection: null };

export default (bench) => {
  bench(
    "store-commit-5000",
    () => {
      for (let i = 0; i < 200; i++) {
        const offset = state.store.records.get(TARGET_BLOCK_ID).content.reduce((n, inl) => n + (inl.type === "text" ? inl.text.length : 1), 0);
        state = createTransaction(state, coreRegistry).insertText({ blockId: TARGET_BLOCK_ID, offset }, "x").commit().state;
      }
    },
    200,
  );
};
