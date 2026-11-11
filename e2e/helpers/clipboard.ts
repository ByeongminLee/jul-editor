// Synthetic ClipboardEvent/DragEvent dispatch for e2e/clipboard*.spec.ts and
// e2e/image*.spec.ts -- the real OS clipboard is unavailable/unreliable in a
// headless CI browser, so every test builds its own DataTransfer and
// dispatches the event directly at the editor root (chromium supports
// constructing ClipboardEvent/DragEvent with a custom `clipboardData`/
// `dataTransfer`; this suite only runs on the chromium project, per
// playwright.config.ts).

import type { Page } from "@playwright/test";

async function dispatchClipboardEvent(
  page: Page,
  type: "paste" | "copy" | "cut",
  data: Record<string, string>,
): Promise<{ html: string; text: string; json: string }> {
  return page.evaluate(
    ({ type, data }) => {
      const dt = new DataTransfer();
      for (const [format, value] of Object.entries(data)) dt.setData(format, value);
      const root = document.querySelector("[data-jul-editor-root]")!;
      const ev = new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true });
      if (ev.clipboardData !== dt) Object.defineProperty(ev, "clipboardData", { value: dt });
      root.dispatchEvent(ev);
      return { html: dt.getData("text/html"), text: dt.getData("text/plain"), json: dt.getData("application/x-jul-editor+json") };
    },
    { type, data },
  );
}

export async function pasteHTML(page: Page, html: string): Promise<void> {
  await dispatchClipboardEvent(page, "paste", { "text/html": html });
}

export async function pasteText(page: Page, text: string): Promise<void> {
  await dispatchClipboardEvent(page, "paste", { "text/plain": text });
}

export async function pasteJulEditorJson(page: Page, json: string): Promise<void> {
  await dispatchClipboardEvent(page, "paste", { "application/x-jul-editor+json": json });
}

export async function copySelection(page: Page): Promise<{ html: string; text: string; json: string }> {
  return dispatchClipboardEvent(page, "copy", {});
}

export async function cutSelection(page: Page): Promise<{ html: string; text: string; json: string }> {
  return dispatchClipboardEvent(page, "cut", {});
}

/** Pastes a real image File (base64-encoded PNG bytes, decoded client-side --
 * Playwright can't hand a Buffer straight to page.evaluate). */
export async function pasteImageFile(page: Page, base64: string, filename: string, mime = "image/png"): Promise<void> {
  await page.evaluate(
    ({ base64, filename, mime }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], filename, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const root = document.querySelector("[data-jul-editor-root]")!;
      root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { base64, filename, mime },
  );
}

/** Drops a real image File at the given viewport (x, y). */
export async function dropImageFile(page: Page, base64: string, filename: string, x: number, y: number, mime = "image/png"): Promise<void> {
  await page.evaluate(
    ({ base64, filename, mime, x, y }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], filename, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const root = document.querySelector("[data-jul-editor-root]")!;
      const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, dataTransfer: dt };
      root.dispatchEvent(new DragEvent("dragover", opts));
      root.dispatchEvent(new DragEvent("drop", opts));
    },
    { base64, filename, mime, x, y },
  );
}

// A 1x1 transparent PNG, base64-encoded -- enough for "is this a real image
// File" round-tripping through the upload pipeline; nothing here decodes
// pixels.
export const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
