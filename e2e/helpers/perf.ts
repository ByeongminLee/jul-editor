// Shared helpers for e2e/perf.spec.ts (the latency measurement protocol), and
// see e2e/fixtures/src/perf/perf-page.tsx for window.__perf's shape.

import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __perf?: {
      editor: {
        getState: () => { selection: { type: string; anchor?: { blockId: string; offset: number } } | null };
        getDoc: () => { blocks: unknown[] };
        update: (build: (tx: { setSelection: (selection: unknown) => unknown }) => unknown) => void;
      };
      commitTimes: number[];
      reset(): void;
      placeCaretMiddle(): void;
      pasteMarkdown(markdown: string): number;
      toolbarRenders?: number;
      mountMs?: number;
    };
  }
}

export interface PerfPageParams {
  doc?: "500" | "5000";
  react?: boolean;
  autosave?: boolean;
}

export async function gotoPerf(page: Page, params: PerfPageParams = {}): Promise<void> {
  const search = new URLSearchParams({
    doc: params.doc ?? "500",
    react: params.react ? "1" : "0",
    autosave: params.autosave ? "1" : "0",
  });
  await page.goto(`/perf?${search.toString()}`);
  await page.waitForFunction(() => !!window.__perf);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank percentile (simple, no interpolation -- fine at n=200). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const WARMUP_CHARS = 20;
const MEASURE_CHARS = 200;
const TYPE_DELAY_MS = 50;

/** One p95 sample of the latency protocol: caret to the doc's middle text
 * block, discard a 20-char warmup burst, type a 200-char measured burst
 * (delay 50ms/key so each keystroke is its own frame), return that burst's
 * commit-time p95 (ms) plus the raw samples. */
export async function latencyP95Sample(page: Page): Promise<{ p95: number; samples: number[] }> {
  await page.evaluate(() => {
    window.__perf!.placeCaretMiddle();
    window.__perf!.reset();
  });
  await page.keyboard.type("w".repeat(WARMUP_CHARS), { delay: TYPE_DELAY_MS });
  await page.evaluate(() => window.__perf!.reset());
  await page.keyboard.type("x".repeat(MEASURE_CHARS), { delay: TYPE_DELAY_MS });
  const samples = await page.evaluate(() => window.__perf!.commitTimes.slice());
  return { p95: percentile(samples, 95), samples };
}

/** repeats (default 3) latency samples -> median of their p95s, the
 * protocol's final reported number. */
export async function latencyMedianOfP95(page: Page, repeats = 3): Promise<{ medianP95: number; p95s: number[] }> {
  const p95s: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const { p95 } = await latencyP95Sample(page);
    p95s.push(p95);
  }
  return { medianP95: median(p95s), p95s };
}

/** CDP Emulation.setCPUThrottlingRate -- returns a restore function (rate 1). */
export async function setCpuThrottle(page: Page, rate: number): Promise<() => Promise<void>> {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate });
  return async () => {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  };
}
