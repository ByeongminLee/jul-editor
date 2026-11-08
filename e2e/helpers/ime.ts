// Chromium-only IME composition helper via CDP's Input domain. Modeled on the
// idea in refs/BlockNote/tests/src/utils/imeComposition.ts (steps + a final
// commit) but written from scratch against Playwright's CDPSession directly.
//
// CDP's Input.imeSetComposition is a
// necessary but not sufficient IME test (it can't reproduce macOS's two-set
// Korean compositionend ordering, Safari's insertCompositionText, or a
// real IME's mid-composition Enter/blur races) -- e2e/ime-manual.md tracks
// the manual checklist for what only a real OS IME can exercise.

import type { CDPSession, Page } from "@playwright/test";

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function session(page: Page): Promise<CDPSession> {
  let s = sessions.get(page);
  if (!s) {
    s = page.context().newCDPSession(page);
    sessions.set(page, s);
  }
  return s;
}

/** Sends one imeSetComposition per step (fires compositionstart on the first
 * call, compositionupdate on the rest) -- e.g. Korean 2-beolsik jamo build-up
 * steps ["ㅎ", "하", "한", "한ㄱ", "한그", "한글"]. Composition stays open;
 * call `commitComposition` (or `cancelComposition`) to end it. */
export async function composeSteps(page: Page, steps: string[]): Promise<void> {
  const client = await session(page);
  for (const step of steps) {
    await client.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
  }
}

/** Commits the in-progress composition as `finalText` (fires compositionend +
 * the text lands in the DOM), matching a real IME's Enter/space/click commit. */
export async function commitComposition(page: Page, finalText: string): Promise<void> {
  const client = await session(page);
  await client.send("Input.insertText", { text: finalText });
}

/** composeSteps + commitComposition in one call -- the common case. */
export async function typeComposed(page: Page, steps: string[], finalText: string): Promise<void> {
  await composeSteps(page, steps);
  await commitComposition(page, finalText);
}

/** Ends composition with no committed text (Escape-style cancel). */
export async function cancelComposition(page: Page): Promise<void> {
  const client = await session(page);
  await client.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
}
