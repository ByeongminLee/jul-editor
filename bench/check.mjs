#!/usr/bin/env node
// CLI: node bench/check.mjs [name...]
// Runs registered benches (5 warmups + 20 timed runs), prints a table of
// medians, and exits 1 if any median exceeds its budget. Suites register
// their own budgets (e.g. against packages/core's diff/serde).
// Import approach: tsx, so a bench can
// `import` package source directly (packages/*/src) without requiring a
// prior `pnpm -r build`.

const results = [];
const registry = [];

function bench(name, fn, budgetMs) {
  registry.push({ name, fn, budgetMs });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function run(name, fn, budgetMs) {
  for (let i = 0; i < 5; i++) await fn();
  const durations = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  const med = median(durations);
  results.push({ name, medianMs: med, budgetMs, pass: med <= budgetMs });
}

// Suites: every bench/suites/*.mjs default-exports `(bench) => void` and
// registers its benches. tsx is registered first so suites can import
// packages/*/src/*.ts directly.
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const { register } = await import("tsx/esm/api");
register();
const suitesDir = join(dirname(fileURLToPath(import.meta.url)), "suites");
for (const f of readdirSync(suitesDir).filter((f) => f.endsWith(".mjs")).sort()) {
  const mod = await import(pathToFileURL(join(suitesDir, f)).href);
  mod.default(bench);
}

async function main() {
  const filter = process.argv.slice(2);
  const selected = filter.length ? registry.filter((b) => filter.includes(b.name)) : registry;

  for (const { name, fn, budgetMs } of selected) {
    await run(name, fn, budgetMs);
  }

  const nameWidth = Math.max(4, ...results.map((r) => r.name.length));
  console.log(`${"name".padEnd(nameWidth)}  median(ms)  budget(ms)  status`);
  let failed = false;
  for (const r of results) {
    if (!r.pass) failed = true;
    console.log(
      `${r.name.padEnd(nameWidth)}  ${r.medianMs.toFixed(2).padStart(10)}  ${String(r.budgetMs).padStart(10)}  ${r.pass ? "PASS" : "FAIL"}`,
    );
  }

  if (failed) {
    console.error("bench/check.mjs: at least one median exceeded its budget");
    process.exit(1);
  }
}

main();
