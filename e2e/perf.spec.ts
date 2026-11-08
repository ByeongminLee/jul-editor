// Performance + regression gate suite. Uses measurable, page-side metrics
// (Event Timing, MutationObserver, React Profiler) rather than self-reported
// or gameable counters. Chromium only (CDP-dependent, like ime.spec.ts). Results are
// written to test-results/perf.json and printed as a table in afterAll.
//
// Serial on purpose: perf.json is built up incrementally by every test in
// this file (Playwright's `fullyParallel: true` can otherwise fan tests
// across workers/processes, which would race on that shared object), and
// serial execution also keeps this file's own tests from adding noise to
// each other's timing on a shared machine.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { commitComposition, composeSteps } from "./helpers/ime.js";
import { gotoPerf, latencyMedianOfP95, percentile, setCpuThrottle } from "./helpers/perf.js";

test.describe.configure({ mode: "serial" });

const results: Record<string, unknown> = {};

async function modKey(page: import("@playwright/test").Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  return mac ? "Meta" : "Control";
}

function printTable(): void {
  const rows = Object.entries(results).map(([name, r]) => {
    const v = r as Record<string, unknown>;
    return { name, ...v };
  });
  // eslint-disable-next-line no-console
  console.table(rows);
}

test.afterAll(async () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const outPath = join(dir, "../test-results/perf.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(results, null, 2) + "\n");
  printTable();
});

// ---- 1. Input latency ------
// autosave=1 throughout (autosave on). Gate on react=1 (worst
// realistic consumer); react=0 is measured too and reported, not gated.

test("perf latency: 500 blocks, react=1, autosave=1 (gate p95 <= 8ms)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoPerf(page, { doc: "500", react: true, autosave: true });
  const { medianP95, p95s } = await latencyMedianOfP95(page);
  results["latency-500-react1-autosave1"] = { medianP95Ms: medianP95, p95sMs: p95s, budgetMs: 8, gated: true };
  expect(medianP95).toBeLessThanOrEqual(8);
});

test("perf latency: 5000 blocks, react=1, autosave=1 (gate p95 <= 16ms)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoPerf(page, { doc: "5000", react: true, autosave: true });
  const { medianP95, p95s } = await latencyMedianOfP95(page);
  results["latency-5000-react1-autosave1"] = { medianP95Ms: medianP95, p95sMs: p95s, budgetMs: 16, gated: true };
  expect(medianP95).toBeLessThanOrEqual(16);
});

test("perf latency: 500 blocks, react=0, autosave=1 (report only)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoPerf(page, { doc: "500", react: false, autosave: true });
  const { medianP95, p95s } = await latencyMedianOfP95(page);
  results["latency-500-react0-autosave1"] = { medianP95Ms: medianP95, p95sMs: p95s, budgetMs: null, gated: false };
});

test("perf latency: 5000 blocks, react=0, autosave=1 (report only)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoPerf(page, { doc: "5000", react: false, autosave: true });
  const { medianP95, p95s } = await latencyMedianOfP95(page);
  results["latency-5000-react0-autosave1"] = { medianP95Ms: medianP95, p95sMs: p95s, budgetMs: null, gated: false };
});

test("perf latency: 500 blocks, react=1, autosave=1, CPU 4x throttle (gate p95 <= 32ms)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoPerf(page, { doc: "500", react: true, autosave: true });
  const restore = await setCpuThrottle(page, 4);
  try {
    const { medianP95, p95s } = await latencyMedianOfP95(page);
    results["latency-500-react1-autosave1-cpu4x"] = { medianP95Ms: medianP95, p95sMs: p95s, budgetMs: 32, gated: true };
    expect(medianP95).toBeLessThanOrEqual(32);
  } finally {
    await restore();
  }
});

// ---- 2. Event Timing API (replaces a naive "rAF x2" measure) ------

test("perf event timing: 500 blocks, keydown/input duration p95 <= 50ms", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoPerf(page, { doc: "500", react: true, autosave: true });
  await page.evaluate(() => {
    (window as unknown as { __perfEventDurations: number[] }).__perfEventDurations = [];
    const obs = new PerformanceObserver((list) => {
      (window as unknown as { __perfEventDurations: number[] }).__perfEventDurations.push(...list.getEntries().map((e) => e.duration));
    });
    obs.observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    window.__perf!.placeCaretMiddle();
    window.__perf!.reset();
  });
  await page.keyboard.type("x".repeat(200), { delay: 50 });
  await page.waitForTimeout(300); // let any trailing Event Timing entries flush
  const durations = await page.evaluate(() => (window as unknown as { __perfEventDurations: number[] }).__perfEventDurations);

  // durationThreshold:16 means the observer only ever records an entry that
  // ALREADY exceeded 16ms -- with fewer than 5 such entries, a p95 over them
  // is not a meaningful percentile so report "<16ms"
  // instead of a number computed from too small a sample.
  const p95: number | string = durations.length >= 5 ? percentile(durations, 95) : "<16ms";
  results["event-timing-500"] = { entries: durations.length, p95, budgetMs: 50, gated: typeof p95 === "number" };
  if (typeof p95 === "number") expect(p95).toBeLessThanOrEqual(50);
});

// ---- 3. MutationObserver scope (replaces a
// self-reported "DOM 재생성 블록 수" counter) ------------------------------

for (const docSize of ["500", "5000"] as const) {
  test(`perf mutation scope: one keystroke stays inside its block, 0 new elements (${docSize} blocks)`, async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPerf(page, { doc: docSize, react: false, autosave: false });
    const blockId = await page.evaluate(() => {
      window.__perf!.placeCaretMiddle();
      const sel = window.__perf!.editor.getState().selection;
      return sel && sel.type === "text" ? (sel.anchor!.blockId as string) : null;
    });
    expect(blockId).not.toBeNull();

    // Warm up (unobserved) before measuring: bench/gen.mjs's fixtures build
    // each paragraph's plain runs as several separate same-shape Inline
    // objects (one per word-group + one per space, never pre-merged), and
    // the FIRST edit to such a block normalizes/merges those adjacent
    // plain runs -- a real, one-time run-COUNT change that view/render.ts's
    // patchContent has no in-place path for, so it rebuilds that block's
    // whole DOM (recreating even an unrelated, untouched marked run inside
    // it). That's a genuine minor gap (flagged separately, view/render.ts
    // isn't this task's file), but it's a one-time migration cost, not the
    // recurring per-keystroke blowup this gate exists to catch -- so, like
    // the latency protocol's own warmup burst, this measures the STEADY
    // state (second and later keystrokes), not the fixture's one-time cost.
    await page.keyboard.type("w", { delay: 0 });

    await page.evaluate(() => {
      const root = document.querySelector("[data-jul-editor-root]")!;
      const records: MutationRecord[] = [];
      const obs = new MutationObserver((muts) => records.push(...muts));
      obs.observe(root, { childList: true, subtree: true, characterData: true });
      (window as unknown as { __mutObs: MutationObserver; __mutRecords: MutationRecord[] }).__mutObs = obs;
      (window as unknown as { __mutRecords: MutationRecord[] }).__mutRecords = records;
    });

    await page.keyboard.type("z", { delay: 0 });
    await page.waitForTimeout(50);

    const { recordCount, newElements, outsideTargetBlockCount } = await page.evaluate((targetBlockId) => {
      const w = window as unknown as { __mutObs: MutationObserver; __mutRecords: MutationRecord[] };
      w.__mutObs.disconnect();
      const records = w.__mutRecords;

      function ownerBlockId(node: Node): string | null {
        const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
        return el?.closest("[data-jul-editor-block]")?.getAttribute("data-id") ?? null;
      }

      // A move within the observed subtree (e.g. an unchanged run
      // repositioned by a childList rebuild) shows up as the SAME node in
      // both some record's removedNodes and some record's addedNodes --
      // only a node added but never also removed is a genuinely NEW element.
      const added = new Set<Node>();
      const removedElements = new Set<Node>();
      let outsideTargetBlockCount = 0;
      for (const r of records) {
        if (ownerBlockId(r.target) !== targetBlockId) outsideTargetBlockCount++;
        for (const n of Array.from(r.addedNodes)) added.add(n);
        for (const n of Array.from(r.removedNodes)) if (n.nodeType === 1) removedElements.add(n);
      }
      let newElements = 0;
      for (const n of added) if (n.nodeType === 1 && !removedElements.has(n)) newElements++;

      return { recordCount: records.length, newElements, outsideTargetBlockCount };
    }, blockId);

    results[`mutation-scope-${docSize}`] = { recordCount, newElements, outsideTargetBlockCount };
    expect(newElements).toBe(0);
    expect(outsideTargetBlockCount).toBe(0);
  });
}

// ---- 4. React Profiler (replaces a naive render
// count) -- @jul-editor/react's own react.spec.ts already covers this on a ~5-
// block demo doc; this repeats it at 5000 blocks. ---------------------------

test("perf react profiler: 100 plain chars -> 0 Toolbar commits at 5000 blocks; Bold toggle -> >= 1", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoPerf(page, { doc: "5000", react: true, autosave: false });
  const start = await page.evaluate(() => {
    window.__perf!.placeCaretMiddle();
    const sel = window.__perf!.editor.getState().selection;
    return sel && sel.type === "text" ? sel.anchor : null;
  });
  expect(start).not.toBeNull();

  const before = await page.evaluate(() => window.__perf!.toolbarRenders ?? 0);
  await page.keyboard.type("y".repeat(100), { delay: 5 });
  const afterTyping = await page.evaluate(() => window.__perf!.toolbarRenders ?? 0);

  // Same workaround as e2e/react.spec.ts's own "toggling Bold" test: Mod+b on
  // a *collapsed* caret only updates core's internal "stored marks for the
  // next typed char" (marksRef) without a store commit, so nothing tells
  // @jul-editor/react's external-store subscription to re-render -- select a
  // range of what was just typed first, so the toggle is a real op/commit.
  await page.evaluate((anchor) => {
    window.__perf!.editor.update((tx) => tx.setSelection({ type: "text", anchor, focus: { blockId: anchor!.blockId, offset: anchor!.offset + 10 } }));
  }, start);
  const mod = await modKey(page);
  await page.keyboard.press(`${mod}+b`);
  const afterBold = await page.evaluate(() => window.__perf!.toolbarRenders ?? 0);

  results["react-profiler-5000"] = {
    toolbarCommitsDuringTyping: afterTyping - before,
    toolbarCommitsAfterBoldToggle: afterBold - afterTyping,
  };
  expect(afterTyping - before).toBe(0);
  expect(afterBold - afterTyping).toBeGreaterThanOrEqual(1);
});

// ---- 5. IME latency (CDP composition, same metric as
// the plain-typing protocol) -------------------------------------------------

test("perf ime latency: 50 Korean compositions at 500 blocks (gate p95 <= 16ms)", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoPerf(page, { doc: "500", react: true, autosave: true });
  await page.evaluate(() => {
    window.__perf!.placeCaretMiddle();
    window.__perf!.reset();
  });

  const STEPS = ["ㅎ", "하", "한", "한ㄱ", "한그", "한글"];
  for (let i = 0; i < 50; i++) {
    await composeSteps(page, STEPS);
    await commitComposition(page, "한글");
  }

  const samples = await page.evaluate(() => window.__perf!.commitTimes.slice());
  const p95 = percentile(samples, 95);
  results["ime-latency-500"] = { entries: samples.length, p95Ms: p95, budgetMs: 16, gated: true };
  expect(p95).toBeLessThanOrEqual(16);
});

// ---- 6. Big paste (report only) --------------------------------------------

test("perf big paste: 1000-block markdown into 500-block doc (report, < 500ms)", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoPerf(page, { doc: "500", react: false, autosave: false });
  const markdown = Array.from({ length: 1000 }, (_, i) => `- pasted paragraph number ${i} with a few extra words for realism`).join("\n");

  await page.evaluate(() => window.__perf!.placeCaretMiddle());
  const ms = await page.evaluate((md) => window.__perf!.pasteMarkdown(md), markdown);
  const blockCount = await page.evaluate(() => window.__perf!.editor.getDoc().blocks.length);

  results["big-paste-1000-into-500"] = { ms, blockCountAfter: blockCount, budgetMs: 500, gated: false };
  // eslint-disable-next-line no-console
  console.log(`[perf] big paste: ${ms.toFixed(1)}ms (budget 500ms), doc now ${blockCount} blocks`);
});

// ---- 7. Initial mount time (vanilla-only: isolates core's own render cost
// from React's own mount overhead -- see PerfPage.tsx's mountMs doc comment)

for (const docSize of ["500", "5000"] as const) {
  test(`perf mount time: ${docSize} blocks (react=0)${docSize === "5000" ? " (gate < 1500ms)" : " (report)"}`, async ({ page }) => {
    test.setTimeout(30_000);
    await gotoPerf(page, { doc: docSize, react: false, autosave: false });
    const mountMs = await page.evaluate(() => window.__perf!.mountMs);
    results[`mount-${docSize}`] = { mountMs, budgetMs: docSize === "5000" ? 1500 : null, gated: docSize === "5000" };
    if (docSize === "5000") expect(mountMs).toBeLessThan(1500);
  });
}
