// Autosave race. A save that resolves while a newer change is still
// waiting in the server debounce must NOT report "saved" nor disarm the
// beforeunload guard -- otherwise closing the tab loses that newer change
// on the server while the UI said "saved".
import type { Doc } from "@jul-editor/core";
import { coreRegistry, createEditor } from "@jul-editor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "../autosave.js";

function makeDoc(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
}

describe("autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("in-flight save resolving with a newer change pending keeps status dirty and unload guard armed", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: makeDoc() });
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));
    const statuses: string[] = [];
    const handle = createAutosave(editor, { key: "k", save, onStatus: (s) => statuses.push(s) });

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 0 }, "v1"));
    await vi.advanceTimersByTimeAsync(2000); // server save #1 starts (in flight)
    expect(save).toHaveBeenCalledTimes(1);

    editor.update((tx) => tx.insertText({ blockId: "p1", offset: 2 }, "v2")); // newer change, debounced
    await vi.advanceTimersByTimeAsync(100);
    resolveSave(); // save #1 (without v2) completes
    await vi.advanceTimersByTimeAsync(0);

    expect(handle.getStatus()).not.toBe("saved");
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    handle.destroy();
    editor.destroy();
  });
});
