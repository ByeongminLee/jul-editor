// Autosave: a framework-agnostic `createAutosave(editor, opts)` plus a
// thin `useAutosave(opts)` hook over it. Losing a draft loses a first-time
// user, so this exists mainly to survive a crashed tab and a flaky network,
// not to be a generic "save anything" queue -- see the many "keep simple"
// notes below where the design deliberately avoids over-building.

import type { Doc, Editor as CoreEditor, Registry } from "@jul-editor/core";
import { coreRegistry, fromJSON, toJSON } from "@jul-editor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./hooks.js";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "saved-local" | "server-error" | "local-error";

export interface DraftRecord {
  doc: Doc;
  savedAt: number;
}

export interface AutosaveOptions {
  key: string;
  save?: (doc: Doc, ctx: { signal: AbortSignal }) => Promise<void>;
  localDebounceMs?: number;
  serverDebounceMs?: number;
  maxRetries?: number;
  storage?: Storage;
  registry?: Registry;
  /** beforeunload warns only while a server save is outstanding. Default true. */
  warnOnUnload?: boolean;
  onStatus?: (status: AutosaveStatus) => void;
}

export interface AutosaveHandle {
  getStatus(): AutosaveStatus;
  getLastSavedAt(): number | null;
  /** Cancels the local debounce and writes the draft immediately. Does not
   * force a server save (that stays debounced -- unmounting/hiding the tab
   * shouldn't itself trigger a network call). */
  flush(): void;
  destroy(): void;
}

function defaultStorage(): Storage | undefined {
  // A plain try/catch, not a capability probe -- Safari private
  // mode throws on the property access itself, not just on setItem.
  try {
    return typeof globalThis !== "undefined" ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Reads back a draft written by `createAutosave`. Corrupt/foreign JSON,
 * or a doc that fails `fromJSON`'s validation, both come back as null --
 * never throws. */
export function restoreDraft(key: string, storage: Storage | undefined = defaultStorage(), registry: Registry = coreRegistry): DraftRecord | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; doc?: unknown };
    if (typeof parsed.savedAt !== "number" || parsed.doc == null) return null;
    const { doc } = fromJSON(parsed.doc, registry);
    return { doc, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/** True when the server's own copy is newer than this local draft -- the
 * caller decides what to do with that (e.g. offer "restore" vs. silently
 * discard); this just answers the comparison. */
export function isDraftStale(draft: DraftRecord, serverUpdatedAt: number | null | undefined): boolean {
  return serverUpdatedAt != null && serverUpdatedAt > draft.savedAt;
}

const BASE_BACKOFF_MS = 500;

export function createAutosave(editor: CoreEditor, opts: AutosaveOptions): AutosaveHandle {
  const { key, save, localDebounceMs = 500, serverDebounceMs = 2000, maxRetries = 5, warnOnUnload = true, onStatus } = opts;
  const storage = opts.storage ?? defaultStorage();

  let status: AutosaveStatus = "idle";
  let lastSavedAt: number | null = null;
  let destroyed = false;
  let dirtyForUnload = false;

  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let serverTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  let lastServerSaved: string | null = null; // canonical JSON of the last doc successfully saved
  let inFlight = false;
  let pendingAfterFlight = false;
  let retryCount = 0;
  let controller: AbortController | null = null;

  function setStatus(next: AutosaveStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  function writeLocalDraft(): void {
    if (!storage) return;
    try {
      // toJSON's canonical stringify, then re-parsed, so the stored `doc` has
      // deterministic key order regardless of how the caller built it.
      // Read the doc HERE (debounced fire time), not on every
      // keystroke -- see onChange's own comment below.
      const canonicalDoc: unknown = JSON.parse(toJSON(editor.getDoc()));
      storage.setItem(key, JSON.stringify({ savedAt: Date.now(), doc: canonicalDoc }));
      // With no `save` configured at all, a local draft write IS the
      // whole story -- there's no server round-trip ahead to eventually
      // reach "saved" through, so this is that mode's own terminal success
      // state (previously it sat at "dirty" forever after the first change).
      if (!save) {
        lastSavedAt = Date.now();
        setStatus("saved-local");
      } else if (status === "local-error") {
        setStatus("dirty");
      }
    } catch {
      // QuotaExceededError or anything else storage throws -- never surface,
      // the in-memory doc is still fine, only the draft failed to persist.
      setStatus("local-error");
    }
  }

  function scheduleLocal(): void {
    if (localTimer) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      writeLocalDraft();
    }, localDebounceMs);
  }

  function flushLocal(): void {
    if (localTimer) {
      clearTimeout(localTimer);
      localTimer = null;
    }
    writeLocalDraft();
  }

  function scheduleServer(): void {
    if (!save) return;
    if (serverTimer) clearTimeout(serverTimer);
    serverTimer = setTimeout(() => {
      serverTimer = null;
      runServerSave();
    }, serverDebounceMs);
  }

  // Never two saves in flight -- a change that lands mid-save just
  // sets `pendingAfterFlight` and gets picked up (with whatever is newest by
  // then) the moment the current one settles. No proactive abort-and-restart;
  // this is deliberately kept simple.
  function runServerSave(): void {
    if (!save || destroyed) return;
    if (inFlight) {
      pendingAfterFlight = true;
      return;
    }
    // Read the doc HERE (debounced fire time -- server saves are
    // debounced serverDebounceMs already, so one more fresh read costs
    // nothing extra), not on every keystroke.
    const docToSave = editor.getDoc();
    const canonical = toJSON(docToSave);
    if (canonical === lastServerSaved) {
      setStatus("saved");
      return;
    }
    inFlight = true;
    setStatus("saving");
    controller = new AbortController();
    save(docToSave, { signal: controller.signal })
      .then(() => {
        inFlight = false;
        controller = null;
        retryCount = 0;
        lastServerSaved = canonical;
        lastSavedAt = Date.now();
        if (pendingAfterFlight) {
          pendingAfterFlight = false;
          dirtyForUnload = true; // a save covering the newer content is about to start
          runServerSave();
          return;
        }
        // A newer edit can be sitting in ITS OWN still-pending debounce
        // right now (scheduleServer already re-armed its timer at that edit's
        // own onChange -- `pendingAfterFlight` only catches a re-trigger that
        // happened WHILE this save was in flight, not one still waiting out
        // its debounce) -- only report "saved" and disarm the unload guard
        // once the doc we just saved is still the CURRENT doc.
        const stillCurrent = toJSON(editor.getDoc()) === canonical;
        dirtyForUnload = !stillCurrent;
        setStatus(stillCurrent ? "saved" : "dirty");
      })
      .catch((err: unknown) => {
        inFlight = false;
        controller = null;
        if (destroyed) return;
        if (err instanceof Error && err.name === "AbortError") return; // destroy()'s own abort
        retryCount += 1;
        if (retryCount > maxRetries) {
          setStatus("server-error");
          return;
        }
        const backoff = BASE_BACKOFF_MS * 2 ** (retryCount - 1);
        const jitter = Math.random() * backoff * 0.5;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          runServerSave();
        }, backoff + jitter);
      });
  }

  // No `editor.getDoc()` call here -- it used to run on every single
  // keystroke even though both saves are already debounced. writeLocalDraft/
  // runServerSave each read the doc fresh at their own (debounced) fire time
  // instead, so a keystroke that never reaches a save fire never pays for a
  // doc snapshot at all.
  function onChange(): void {
    if (destroyed) return;
    dirtyForUnload = true;
    setStatus("dirty");
    scheduleLocal();
    scheduleServer();
  }

  const offChange = editor.on("change", onChange);

  function handleVisibility(): void {
    if (document.hidden) flushLocal();
  }
  function handlePageHide(): void {
    flushLocal();
  }
  function handleBeforeUnload(e: BeforeUnloadEvent): void {
    if (warnOnUnload && dirtyForUnload) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  if (hasDom) {
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  return {
    getStatus: () => status,
    getLastSavedAt: () => lastSavedAt,
    flush: flushLocal,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      offChange();
      if (localTimer) clearTimeout(localTimer);
      if (serverTimer) clearTimeout(serverTimer);
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      flushLocal(); // last chance to persist the draft before unmount
      if (hasDom) {
        document.removeEventListener("visibilitychange", handleVisibility);
        window.removeEventListener("pagehide", handlePageHide);
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }
    },
  };
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  flush: () => void;
  restoreDraft: () => DraftRecord | null;
}

export function useAutosave(opts: AutosaveOptions): UseAutosaveResult {
  const editor = useEditor();
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const handleRef = useRef<AutosaveHandle | null>(null);
  // Read fresh every effect run without re-creating the autosave instance on
  // every render -- only `editor` and `opts.key` are treated as identity.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!editor) return;
    const handle = createAutosave(editor, {
      ...optsRef.current,
      onStatus(next) {
        setStatus(next);
        setLastSavedAt(handle.getLastSavedAt());
        optsRef.current.onStatus?.(next);
      },
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, opts.key]);

  const flush = useCallback(() => handleRef.current?.flush(), []);
  const doRestoreDraft = useCallback(
    () => restoreDraft(opts.key, opts.storage ?? defaultStorage(), opts.registry),
    [opts.key, opts.storage, opts.registry],
  );

  return { status, lastSavedAt, flush, restoreDraft: doRestoreDraft };
}
