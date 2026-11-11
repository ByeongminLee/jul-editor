// The compound API's internal plumbing: two tiny external-store shims
// (useSyncExternalStore-compatible) plus the React context that wires
// <Editor> to <Editor.Content>/<Editor.Toolbar>/the hooks. No editing
// behavior lives here -- it only observes @jul-editor/core's own Editor/EditorState
// (nothing in React adds editing behavior; it only wraps core).

import type { ComponentType } from "react";
import type { Block, Doc, Editor as CoreEditor, EditorState, Json, Registry } from "@jul-editor/core";
import { createContext, useContext } from "react";
import { EN_LABELS } from "./labels.js";
import type { Labels, Locale } from "./labels.js";

/** Props handed to a `renderers[blockType]` component mounted (via portal)
 * into a void block's core-owned container (one container per
 * id, created once by core and never recreated). */
export interface VoidRendererProps {
  block: { id: string; type: string; props: Record<string, Json> };
  editor: CoreEditor;
  selected: boolean;
  updateProps: (patch: Record<string, Json | undefined>) => void;
  locale?: Locale;
}

/** getSnapshot/subscribe pair for the current EditorState, usable before the
 * real core editor exists (SSR / pre-mount: seeded with a plain `fromDoc`
 * snapshot, no DOM involved) and after (kept in sync from the 'change'
 * listener Editor.Content installs once it creates the real editor). */
export interface EditorStoreShim {
  getSnapshot(): EditorState;
  subscribe(listener: () => void): () => void;
  getEditor(): CoreEditor | null;
  attach(editor: CoreEditor): void;
  detach(): void;
  setState(state: EditorState): void;
  notify(): void;
  /** Bumped on every notify -- lets a selector re-run for view-side state
   * that lives outside EditorState (stored marks) even when the snapshot
   * object itself is unchanged. */
  getVersion(): number;
}

export function createEditorStoreShim(initialState: EditorState): EditorStoreShim {
  let state = initialState;
  let editor: CoreEditor | null = null;
  let version = 0;
  const listeners = new Set<() => void>();
  function notify(): void {
    version++;
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getEditor: () => editor,
    attach(next) {
      editor = next;
      state = next.getState();
      notify();
    },
    detach() {
      editor = null;
      notify();
    },
    setState(next) {
      state = next;
      notify();
    },
    notify,
    getVersion: () => version,
  };
}

/** The void map: which block ids currently have a live core-owned container,
 * and what renderer type each is. Mutated only by `renderVoid`'s
 * register/unregister pair (called once per block id at creation/removal --
 * never on ordinary prop updates), so it changes far less
 * often than the EditorState itself. */
export interface VoidEntry {
  id: string;
  type: string;
  el: HTMLElement;
}

export interface VoidRegistryShim {
  getSnapshot(): VoidEntry[];
  subscribe(listener: () => void): () => void;
  register(id: string, type: string, el: HTMLElement): () => void;
}

export function createVoidRegistry(): VoidRegistryShim {
  const map = new Map<string, VoidEntry>();
  let snapshot: VoidEntry[] = [];
  const listeners = new Set<() => void>();
  function refresh(): void {
    snapshot = Array.from(map.values());
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    register(id, type, el) {
      map.set(id, { id, type, el });
      refresh();
      return () => {
        map.delete(id);
        refresh();
      };
    },
  };
}

export interface EditorContextValue {
  store: EditorStoreShim;
  /** Editable root owned by this Editor instance (menus must never annotate another editor). */
  rootRef: { current: HTMLElement | null };
  plugins: Parameters<CoreEditor["use"]>[0][];
  pluginSlashItems: import("./menus/slash-items.js").SlashItem[];
  /** Extra Turn-into entries / block (drag handle) menu entries contributed by `<Editor.Plugin>`s. */
  pluginTurnIntoItems: import("./plugin-menu.js").TurnIntoPluginItem[];
  pluginBlockMenuItems: import("./plugin-menu.js").BlockMenuPluginItem[];
  voidRegistry: VoidRegistryShim;
  registry: Registry;
  /** Read fresh (not captured) every portal render -- kept as a ref so a
   * `renderers` prop change doesn't require recreating the editor. */
  renderersRef: { current: Record<string, ComponentType<VoidRendererProps>> };
  onUploadRef: { current: import("./editor.js").EditorProps["onUpload"] };
  uploadOptionsRef: { current: Pick<import("./editor.js").EditorProps, "uploadMode" | "createFileBlock" | "rehostExternalImages"> };
  /** Read once, at <Editor.Content>'s mount effect -- see Editor.tsx's
   * EditorProps.placeholder doc comment. */
  placeholderRef: { current: string | ((block: Block) => string) | undefined };
  /** The doc used to create the core editor. Set once (uncontrolled init);
   * later `defaultValue` prop changes are ignored by design (matches every
   * other "uncontrolled initial value" convention in the ecosystem). */
  initialDocRef: { current: Doc };
  valueRef: { current: Doc | undefined };
  onChangeRef: { current: ((doc: Doc) => void) | undefined };
  /** The last Doc this Editor itself produced (via onChange) or was reset to
   * (via setDoc) -- `value !== lastEmittedDocRef.current` is the entire
   * external-reset test. */
  lastEmittedDocRef: { current: Doc | undefined };
  /** onChange values awaiting the controlled parent's latest value. */
  pendingDocsRef: { current: WeakSet<Doc> };
  /** An already-constructed core Editor. Its existing root remains mounted
   * outside Editor.Content, while toolbar, menu, drag, and hook behavior bind
   * to that root through getRoot(). */
  externalEditor?: CoreEditor;
}

export const EditorContext = /* @__PURE__ */ createContext<EditorContextValue | null>(null);

export function useEditorContext(hookName: string): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error(`${hookName} must be used within <Editor>`);
  return ctx;
}

/** Labels/locale live in their OWN context, separate from
 * EditorContext -- `<Editor locale>`/`<Editor labels>` can change on every
 * render (an inline `labels={{...}}` object literal, a runtime locale flip)
 * without that ever being a dependency of <Editor.Content>'s mount effect
 * (Editor.tsx), which would otherwise destroy and recreate the whole core
 * editor. Defaults to EN_LABELS so every consumer (SlashMenu/TurnInto/
 * toolbar/MentionMenu/CodeBlockView/ImageView/EmbedView) works the same
 * whether or not it's actually inside an `<Editor>` (CodeBlockView.test.tsx
 * mounts standalone). */
export const LabelsContext = /* @__PURE__ */ createContext<Labels>(EN_LABELS);

export const LocaleContext = /* @__PURE__ */ createContext<Locale>("en");
