// Autosave tests. Drives a real @jul-editor/core `createEditor` (jsdom) rather
// than a hand-rolled fake -- it already exposes exactly the `getDoc`/`on`
// surface createAutosave needs, and real change events are the realistic
// input this code has to survive.
import type { Doc } from "@jul-editor/core";
import { coreRegistry, createEditor, toJSON } from "@jul-editor/core";
import type { Editor as CoreEditor } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, restoreDraft, useAutosave } from "./autosave.js";
import { Editor, EditorContent } from "./editor.js";

function makeDoc(text = ""): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] }] };
}

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } satisfies Storage;
}

function mountEditor(): { editor: CoreEditor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry: coreRegistry, defaultValue: makeDoc() });
  return { editor, element };
}

function typeChars(editor: CoreEditor, count: number): void {
  for (let i = 0; i < count; i++) {
    editor.update((tx) => tx.insertText({ blockId: "p1", offset: i }, "x"));
  }
}

describe("createAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces: 100 rapid changes produce exactly 1 local write and 1 server save", async () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    const save = vi.fn().mockResolvedValue(undefined);
    const handle = createAutosave(editor, { key: "k", storage, save });

    typeChars(editor, 100);

    vi.advanceTimersByTime(500);
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    handle.destroy();
    editor.destroy();
  });

  it("reaches a terminal 'saved-local' status in local-only mode (no `save` configured)", () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const onStatus = vi.fn();
    const handle = createAutosave(editor, { key: "k", storage, onStatus });

    typeChars(editor, 1);
    expect(handle.getStatus()).toBe("dirty");

    vi.advanceTimersByTime(500);
    expect(handle.getStatus()).toBe("saved-local");
    expect(handle.getLastSavedAt()).not.toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith("saved-local");

    handle.destroy();
    editor.destroy();
  });

  it("flushes the local draft synchronously on pagehide, before the debounce fires", () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    const handle = createAutosave(editor, { key: "k", storage, localDebounceMs: 10_000 });

    typeChars(editor, 1);
    expect(setItemSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    handle.destroy();
    editor.destroy();
  });

  it("flushes on visibilitychange only when the document becomes hidden", () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    const handle = createAutosave(editor, { key: "k", storage, localDebounceMs: 10_000 });

    typeChars(editor, 1);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(setItemSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    handle.destroy();
    editor.destroy();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("flushes on destroy/unmount", () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    const handle = createAutosave(editor, { key: "k", storage, localDebounceMs: 10_000 });

    typeChars(editor, 1);
    expect(setItemSpy).not.toHaveBeenCalled();
    handle.destroy();
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    editor.destroy();
  });

  it("a quota-exceeded (or any) setItem failure sets local-error and never throws", () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const onStatus = vi.fn();
    const handle = createAutosave(editor, { key: "k", storage, onStatus });

    typeChars(editor, 1);
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(onStatus).toHaveBeenCalledWith("local-error");

    handle.destroy();
    editor.destroy();
  });

  it("retries a failing server save with backoff, then reports server-error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { editor } = mountEditor();
    const storage = makeStorage();
    const save = vi.fn().mockRejectedValue(new Error("network down"));
    const onStatus = vi.fn();
    const handle = createAutosave(editor, { key: "k", storage, save, maxRetries: 2, onStatus });

    typeChars(editor, 1);
    await vi.advanceTimersByTimeAsync(2000); // initial debounce -> attempt 1 (fails)
    await vi.advanceTimersByTimeAsync(500); // backoff 1 -> attempt 2 (fails)
    await vi.advanceTimersByTimeAsync(1000); // backoff 2 -> attempt 3 (fails, exceeds maxRetries)

    expect(save).toHaveBeenCalledTimes(3);
    expect(onStatus).toHaveBeenCalledWith("server-error");

    handle.destroy();
    editor.destroy();
  });

  it("never runs two server saves concurrently; a change mid-save is queued", async () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    let resolveFirst: (() => void) | null = null;
    const save = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          if (!resolveFirst) resolveFirst = resolve;
          else resolve();
        }),
    );
    const handle = createAutosave(editor, { key: "k", storage, save, serverDebounceMs: 1000 });

    typeChars(editor, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1); // in flight, unresolved

    typeChars(editor, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1); // still just the one in flight -- queued, not started

    resolveFirst!();
    await vi.advanceTimersByTimeAsync(0); // flush the resolved promise's .then()
    expect(save).toHaveBeenCalledTimes(2);

    handle.destroy();
    editor.destroy();
  });

  it("restoreDraft validates via fromJSON; corrupt JSON returns null", () => {
    const storage = makeStorage();
    storage.setItem("k", "{ not json");
    expect(restoreDraft("k", storage)).toBeNull();
    expect(restoreDraft("missing-key", storage)).toBeNull();
  });

  it("restoreDraft round-trips a draft written by createAutosave", async () => {
    const { editor } = mountEditor();
    const storage = makeStorage();
    const handle = createAutosave(editor, { key: "k", storage });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 0 }, "hello"));
    handle.flush();

    const draft = restoreDraft("k", storage);
    expect(draft).not.toBeNull();
    expect(toJSON(draft!.doc)).toBe(toJSON(editor.getDoc()));
    expect(typeof draft!.savedAt).toBe("number");

    handle.destroy();
    editor.destroy();
  });
});

describe("useAutosave", () => {
  afterEach(() => cleanup());

  it("flushes the local draft on unmount", () => {
    const storage = makeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");

    function Harness({ mounted }: { mounted: boolean }) {
      if (!mounted) return null;
      return (
        <Editor defaultValue={makeDoc("hi")}>
          <EditorContent />
          <Probe storage={storage} />
        </Editor>
      );
    }
    function Probe({ storage: s }: { storage: Storage }) {
      useAutosave({ key: "k", storage: s, localDebounceMs: 10_000 });
      return null;
    }

    function Wrapper() {
      const [mounted, setMounted] = useState(true);
      return (
        <div>
          <button onClick={() => setMounted(false)}>unmount</button>
          <Harness mounted={mounted} />
        </div>
      );
    }

    const { getByText } = render(<Wrapper />);
    expect(setItemSpy).not.toHaveBeenCalled();
    fireEvent.click(getByText("unmount"));
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});
