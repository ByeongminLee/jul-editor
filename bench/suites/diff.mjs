// Diff perf gate (diff(1% change) <= 30ms).
//
// Two variants:
// - diff-5000-1pct: fresh (JSON round-tripped) object graphs every run, so
//   the diff engine's WeakMap subtree-hash cache never hits -- a true cold
//   worst case.
// - diff-5000-1pct-cached: the *same* before/after object graphs reused
//   across every run, mimicking a store that path-copies (unchanged
//   subtrees keep their object identity across snapshots) -- the cache
//   should make this several times cheaper.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffDocs } from "../../packages/plugins/src/diff/diff.ts";
import { coreRegistry } from "../../packages/core/src/model/builtins.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(readFileSync(join(dir, "../fixtures/doc-5000.json"), "utf8"));
const originalJson = JSON.stringify(original);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Restricted to top-level blocks so this can be built with a single shallow
// copy of the root array: every untouched top-level block (whole subtree
// included) keeps its exact object reference from `before`.
function mutateTopLevelShared(before, seed) {
  const rng = mulberry32(seed);
  const total = before.blocks.length;
  const touchedCount = Math.max(15, Math.round(total * 0.01));
  const touched = new Set();
  while (touched.size < touchedCount) touched.add(Math.floor(rng() * total));
  const touchedIds = [...touched].map((i) => before.blocks[i].id);
  const deleteIds = new Set(touchedIds.slice(0, 5));
  const moveIds = new Set(touchedIds.slice(5, 10));
  const modifyIds = new Set(touchedIds.slice(10));

  let next = before.blocks.filter((b) => !deleteIds.has(b.id));

  next = next.map((b) => {
    if (!modifyIds.has(b.id) || !Array.isArray(b.content)) return b;
    const textAt = b.content.findIndex((c) => c.type === "text");
    if (textAt === -1) return b;
    const content = b.content.slice();
    content[textAt] = { ...content[textAt], text: `${content[textAt].text} EDITED` };
    return { ...b, content };
  });

  for (const id of moveIds) {
    const pos = next.findIndex((x) => x.id === id);
    if (pos === -1) continue;
    const [block] = next.splice(pos, 1);
    next.splice(Math.floor(rng() * (next.length + 1)), 0, block);
  }

  for (let i = 0; i < 5; i++) {
    next.splice(Math.floor(rng() * (next.length + 1)), 0, {
      id: `bench-insert-${seed}-${i}`,
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "inserted" }],
    });
  }

  return { version: before.version, blocks: next };
}

const sharedAfter = mutateTopLevelShared(original, 7);
const afterJson = JSON.stringify(sharedAfter);

// bench/check.mjs runs 5 warmups + 20 timed calls (25 total) per registered
// bench; pre-parsing that many fresh (no shared identity) pairs up front
// keeps JSON.parse out of the timed `fn()` itself, so this measures diffDocs
// alone, matching the "diff(1% change) <= 30ms" budget rather than clone speed.
const FRESH_PAIRS = 25;
const freshPairs = Array.from({ length: FRESH_PAIRS }, () => [JSON.parse(originalJson), JSON.parse(afterJson)]);
let freshCallIndex = 0;

export default (bench) => {
  bench(
    "diff-5000-1pct",
    () => {
      const [before, after] = freshPairs[freshCallIndex % freshPairs.length];
      freshCallIndex++;
      diffDocs(before, after, coreRegistry);
    },
    30,
  );

  bench(
    "diff-5000-1pct-cached",
    () => {
      diffDocs(original, sharedAfter, coreRegistry);
    },
    10,
  );
};
