// <Editor>/<Editor.Content>: creates the core editor once (SSR-safe: nothing
// touches the DOM until an effect runs, so renderToString only ever renders
// the static children shell) and mounts its single contenteditable root.
// Void blocks are portaled into the exact container `renderVoid` hands back
// (one container per id, created once by core and never
// recreated) -- see VoidPortals/VoidPortal below.

import type { Block, BlockSpec, Doc, UploadContext, UploadResult, Editor as CoreEditor, InlineSpec, Json, MarkSpec, Registry } from "@jul-editor/core";
import { coreBlocks, coreInlines, coreMarks, coreRegistry, createEditor, createRegistry, fromDoc, isVoidBlockSpec, newId, toJSON } from "@jul-editor/core";
import type { ComponentType, ReactNode } from "react";
import { Children, Suspense, isValidElement, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ErrorBoundary } from "./error-boundary.js";
import type { EditorContextValue, VoidRendererProps } from "./context.js";
import { EditorContext, LabelsContext, LocaleContext, createEditorStoreShim, createVoidRegistry, useEditorContext } from "./context.js";
import { useEditor, useEditorState } from "./hooks.js";
import type { Labels, Locale } from "./labels.js";
import { resolveLabels } from "./labels.js";
import type { SlashItem } from "./menus/slash-items.js";
import type { BlockMenuPluginItem, TurnIntoPluginItem } from "./plugin-menu.js";

type CorePlugin = Parameters<CoreEditor["use"]>[0];

export interface EditorPluginProps extends CorePlugin {
  blocks?: BlockSpec[];
  inlines?: InlineSpec[];
  marks?: MarkSpec[];
  renderers?: Record<string, ComponentType<VoidRendererProps>>;
  /** `id` defaults to `type`, so @jul-editor/plugins' pluginSlashItems fit directly. */
  slashItems?: Array<SlashItem | Omit<SlashItem, "id">>;
  /** Extra entries for the Turn-into list (`useTurnInto` / `<Editor.TurnInto>`), after the built-ins. */
  turnIntoItems?: TurnIntoPluginItem[];
  /** Extra entries for the block (drag handle) menu (`useBlockActions().menuItems`). */
  blockMenuItems?: BlockMenuPluginItem[];
}

/** Declarative extension point. Place as a direct child of <Editor>. */
export function EditorPlugin(_props: EditorPluginProps): null {
  return null;
}

function emptyDoc(): Doc {
  return { version: 1, blocks: [{ id: newId(), type: "paragraph", props: {}, content: [] }] };
}

function buildRegistry(
  blocks: BlockSpec[] | undefined,
  inlines: InlineSpec[] | undefined,
  marks: MarkSpec[] | undefined,
  renderers: Record<string, ComponentType<VoidRendererProps>> | undefined,
): Registry {
  if (!blocks && !inlines && !marks && !renderers) return coreRegistry;
  // A block spec with its own editable content/children that ALSO has a
  // `renderers[type]` registered gets the "decorated" container slot
  // (view/decorations.ts) automatically -- the app shouldn't have to also
  // remember to set `decorated: true` on its own BlockSpec just because it
  // passed a renderer for it. A void block never needs this (it already gets
  // its own full-block renderer container).
  // P2: this must also cover a CORE block type (e.g. `codeBlock`) that gets a
  // `renderers[type]` with no custom `blocks` prop at all -- decorate() runs
  // over `coreBlocks` itself, not just the caller's own custom `blocks`, so
  // `<Editor renderers={{codeBlock: ...}}>` alone is enough (matching this
  // function's own doc comment above: "the app shouldn't have to also
  // remember..." applies equally to a built-in type, not only a custom one).
  const decorate = (b: BlockSpec): BlockSpec => (!b.decorated && renderers?.[b.type] && !isVoidBlockSpec(b) ? { ...b, decorated: true } : b);
  const decoratedBlocks = (blocks ?? []).map(decorate);
  return createRegistry({
    blocks: [...coreBlocks.map(decorate), ...decoratedBlocks],
    inlines: [...coreInlines, ...(inlines ?? [])],
    marks: [...coreMarks, ...(marks ?? [])],
  });
}

export interface EditorProps {
  /** Uncontrolled initial doc. Ignored after the first render (matches every
   * other "uncontrolled initial value" convention -- change it via `value`
   * instead if you need a later reset). */
  defaultValue?: Doc;
  /** Controlled external reset: setDoc()s (clearing history/selection) only
   * when this is a *different* Doc than the one this Editor itself last
   * emitted via `onChange` or was reset to -- re-passing the exact object an
   * `onChange` handed you back is the normal controlled-component round trip
   * and must NOT stomp the user's cursor. */
  value?: Doc;
  onChange?: (doc: Doc) => void;
  blocks?: BlockSpec[];
  inlines?: InlineSpec[];
  marks?: MarkSpec[];
  renderers?: Record<string, ComponentType<VoidRendererProps>>;
  /** Bring your own already-constructed core Editor instead of having this
   * component create one. Known limitation (checked again): a
   * "createEditor without an element, then editor.mount(el) later" API was
   * considered here, but isn't a small/additive change -- `element` is
   * captured as a plain constant (not a reassignable/indirected ref) in
   * MANY closures across THREE modules at construction time: view/index.ts's
   * own `root`, view/interaction.ts's event listeners AND its shared
   * document-level `selectionchange` registry (keyed by that same `root`
   * reference), view/clipboard.ts's paste/drop listeners, and
   * editor.ts's own `getBlockAtPoint`/`getBlockRect` closures. Supporting a
   * later "swap in the real element" would mean turning `root` into a
   * mutable, re-pointed reference everywhere it's captured, not just
   * exposing one new method -- out of scope for a minimal fix. So:
   * <Editor.Content> still cannot re-home an external instance's root; this
   * prop wires the instance and its existing root into context for the
   * toolbar, menus, drag handle, and hooks. The caller mounts that element. */
  editor?: CoreEditor;
  onUpload?: (file: File, context: UploadContext) => Promise<string | UploadResult> | string | UploadResult;
  uploadMode?: "immediate" | "deferred";
  createFileBlock?: (file: File) => Block | null;
  rehostExternalImages?: (url: string) => Promise<UploadResult>;
  /** A text block's placeholder text (e.g. "Type '/' for commands") -- passed
   * straight through to core's `createEditor({placeholder})`. Read once at
   * construction, same "initial config, not live" contract as `onUpload`/
   * `blocks`/`renderers` just above: core's own render context captures it as
   * a plain closed-over value at createView time (view/render.ts), with no
   * live setter to push a later change into -- unlike `locale`/`labels`
   * (pure display strings core never sees), threading this live would need a
   * new core API, out of scope for this fix. */
  placeholder?: string | ((block: Block) => string);
  /** Which built-in-label preset (labels.ts's `EN_LABELS`/
   * `KO_LABELS`) SlashMenu/TurnInto/the toolbar atoms/MentionMenu/
   * CodeBlockView read their default text from. Default 'en'. */
  locale?: Locale;
  /** Per-key overrides on top of `locale`'s preset -- e.g. `{toolbarBold:
   * "굵게"}` alone, with everything else still following `locale`. */
  labels?: Partial<Labels>;
  className?: string;
  children?: ReactNode;
}

export function Editor(props: EditorProps): ReactNode {
  const { defaultValue, value, onChange, blocks, inlines, marks, renderers, editor: externalEditor, onUpload, placeholder, locale, labels, className, children } = props;

  const pluginsRef = useRef<EditorPluginProps[] | null>(null);
  if (!pluginsRef.current) pluginsRef.current = Children.toArray(children).flatMap((child) => isValidElement<EditorPluginProps>(child) && child.type === EditorPlugin ? [child.props] : []);
  const plugins = pluginsRef.current;

  // Built ONCE per mount, from whatever `blocks`/`inlines`/`marks`/
  // `renderers` were passed on the FIRST render -- these are effectively
  // part of the "initial document" (same convention as `defaultValue`
  // below), not live config. The idiomatic `<Editor blocks={[callout]}>`
  // (a new array literal every render, same contents) must never recreate
  // the core editor -- a `useMemo` keyed on those arrays' IDENTITY did
  // exactly that on every parent re-render, silently discarding every edit.
  const registryRef = useRef<Registry | undefined>(undefined);
  if (!registryRef.current) registryRef.current = plugins.length
    ? buildRegistry(
      [...plugins.flatMap((plugin) => plugin.blocks ?? []), ...(blocks ?? [])],
      [...plugins.flatMap((plugin) => plugin.inlines ?? []), ...(inlines ?? [])],
      [...plugins.flatMap((plugin) => plugin.marks ?? []), ...(marks ?? [])],
      Object.assign({}, ...plugins.map((plugin) => plugin.renderers), renderers),
    )
    : buildRegistry(blocks, inlines, marks, renderers);
  const registry = registryRef.current;

  const initialDocRef = useRef<Doc | undefined>(undefined);
  if (!initialDocRef.current) initialDocRef.current = value ?? defaultValue ?? emptyDoc();

  const storeRef = useRef<EditorContextValue["store"] | undefined>(undefined);
  if (!storeRef.current) storeRef.current = createEditorStoreShim({ store: fromDoc(initialDocRef.current, registry), selection: null });
  const rootRef = useRef<HTMLElement | null>(null);

  const voidRegistryRef = useRef<EditorContextValue["voidRegistry"] | undefined>(undefined);
  if (!voidRegistryRef.current) voidRegistryRef.current = createVoidRegistry();

  const renderersRef = useRef<Record<string, ComponentType<VoidRendererProps>>>({});
  renderersRef.current = plugins.length ? Object.assign({}, ...plugins.map((plugin) => plugin.renderers), renderers) : (renderers ?? {});
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;
  const uploadOptionsRef = useRef({uploadMode: props.uploadMode, createFileBlock: props.createFileBlock, rehostExternalImages: props.rehostExternalImages});
  uploadOptionsRef.current = {uploadMode: props.uploadMode, createFileBlock: props.createFileBlock, rehostExternalImages: props.rehostExternalImages};
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedDocRef = useRef<Doc | undefined>(undefined);
  const pendingDocsRef = useRef(new WeakSet<Doc>());

  // Locale/labels are pure display strings with no construction
  // cost (unlike blocks/inlines/marks/renderers, frozen at mount since
  // changing them means recreating the whole core editor) -- recomputed
  // whenever `locale`/`labels` themselves change (not frozen at mount) so a
  // consumer CAN flip locale at runtime or pass a fresh `labels={{...}}`
  // object literal every render. Deliberately its OWN context (LabelsContext,
  // provided below), NEVER folded into `contextValue`: that object is what
  // <Editor.Content>'s mount effect depends on, and depending on labels there
  // was exactly the bug (a locale/labels change silently destroyed and
  // recreated the whole core editor, wiping every edit + history).
  const resolvedLabels = useMemo(() => resolveLabels(locale, labels), [locale, labels]);

  // contextValue is stable unless the registry or the external-editor escape
  // hatch change -- every other input above is read fresh through its ref
  // (or, for labels, through the separate LabelsContext), so it never needs
  // to be a dependency here.
  const contextValue = useMemo<EditorContextValue>(
    () => ({
      store: storeRef.current!,
      rootRef,
      plugins,
      pluginSlashItems: plugins.flatMap((plugin) => (plugin.slashItems ?? []).map((item) => ({ id: item.type, ...item }))),
      pluginTurnIntoItems: plugins.flatMap((plugin) => plugin.turnIntoItems ?? []),
      pluginBlockMenuItems: plugins.flatMap((plugin) => plugin.blockMenuItems ?? []),
      voidRegistry: voidRegistryRef.current!,
      registry,
      renderersRef,
      onUploadRef,
      uploadOptionsRef,
      placeholderRef,
      initialDocRef: initialDocRef as { current: Doc },
      valueRef,
      onChangeRef,
      lastEmittedDocRef,
      pendingDocsRef,
      externalEditor,
    }),
    [registry, externalEditor],
  );

  return (
    <EditorContext.Provider value={contextValue}>
      <LabelsContext.Provider value={resolvedLabels}>
        <LocaleContext.Provider value={locale ?? "en"}>
          <div className={className}>{children}</div>
        </LocaleContext.Provider>
      </LabelsContext.Provider>
    </EditorContext.Provider>
  );
}

export interface EditorContentProps {
  className?: string;
}

export function EditorContent({ className }: EditorContentProps): ReactNode {
  const ctx = useEditorContext("Editor.Content");
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CoreEditor | null>(null);
  // Set right before WE call `editor.setDoc()` (the controlled-reset
  // effect below) and cleared by the very next "change" event it
  // synchronously triggers -- lets that one listener tell "the user just
  // edited" apart from "we just reset from `value`" without needing a core
  // API change (setDoc has no way to mark its own change event as external).
  const suppressNextChangeRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (ctx.externalEditor) {
      // The core instance already owns its root; keep per-editor UI bound to
      // that element while the caller keeps it mounted outside this div.
      ctx.rootRef.current = ctx.externalEditor.getRoot();
      ctx.store.attach(ctx.externalEditor);
      const unuse = ctx.plugins.map((plugin) => ctx.externalEditor!.use(plugin));
      return () => {
        for (const off of unuse) off();
        ctx.store.detach();
        ctx.rootRef.current = null;
      };
    }

    ctx.rootRef.current = element;
    const editor = createEditor({
      element,
      registry: ctx.registry,
      defaultValue: ctx.initialDocRef.current,
      renderVoid: (block, container) => ctx.voidRegistry.register(block.id, block.type, container),
      // Preserve the original string result while allowing durable URL + asset metadata.
      onUpload: ctx.onUploadRef.current ? (file, context) => Promise.resolve(ctx.onUploadRef.current!(file, context)).then(result => typeof result === "string" ? {src: result} : result) : undefined,
      ...ctx.uploadOptionsRef.current,
      // `<Editor placeholder>` was never threaded through to
      // core at all -- read once here, same "initial config" convention as
      // onUpload/registry above (core's own render context has no live
      // setter for this).
      placeholder: ctx.placeholderRef.current,
    });
    const unuse = ctx.plugins.map((plugin) => editor.use(plugin));
    editorRef.current = editor;
    ctx.lastEmittedDocRef.current = ctx.initialDocRef.current;
    ctx.store.attach(editor);
    // Selection-only commits keep the same store object: they update
    // hook subscribers but are not document changes, so they skip getDoc()
    // and never reach onChange (a caret move must not re-render a
    // controlled parent).
    let lastStore = editor.getState().store;
    const off = editor.on("change", (state) => {
      ctx.store.setState(state);
      if (state.store === lastStore) return;
      lastStore = state.store;
      const doc = editor.getDoc();
      ctx.lastEmittedDocRef.current = doc;
      // A change caused by OUR OWN external `setDoc` (below) must not
      // bounce back out through onChange -- a controlled consumer that
      // stores whatever onChange hands it would otherwise see its own reset
      // reflected back as a "new" change and reset again, forever.
      if (suppressNextChangeRef.current) {
        suppressNextChangeRef.current = false;
        return;
      }
      if (ctx.valueRef.current !== undefined && ctx.onChangeRef.current) {
        ctx.pendingDocsRef.current.add(ctx.valueRef.current); // the prop can still render while this newer edit is pending
        ctx.pendingDocsRef.current.add(doc);
      }
      ctx.onChangeRef.current?.(doc);
    });

    return () => {
      off();
      for (const unusePlugin of unuse) unusePlugin();
      editor.destroy();
      ctx.store.detach();
      editorRef.current = null;
      ctx.rootRef.current = null;
    };
    // Mount-once by design: `ctx` (and everything it exposes) is the stable
    // per-<Editor> context value, not a per-render prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Controlled reset: re-checked every render (cheap ref reads) rather
  // than through a dependency array, since `value` itself isn't a prop of
  // this component -- it only reaches here via ctx.valueRef.
  useEffect(() => {
    const editor = editorRef.current;
    const value = ctx.valueRef.current;
    if (!editor || value === undefined) return;
    if (value === ctx.lastEmittedDocRef.current) {
      ctx.pendingDocsRef.current = new WeakSet<Doc>();
      return;
    }
    if (ctx.pendingDocsRef.current.has(value)) return; // stale onChange echo; a newer edit already won
    // Re-passing a NEW object that is nonetheless canonically identical
    // to what we last emitted (a consumer that copies the doc via spread/
    // immer/zod-parse/JSON round trip on every onChange) is the same
    // "nothing actually changed" case as the reference check above -- just
    // adopt the new reference as the latest "ours" without resetting, or
    // every such copy would re-trigger a reset -> change -> copy loop.
    if (toJSON(value) === toJSON(ctx.lastEmittedDocRef.current!)) {
      ctx.lastEmittedDocRef.current = value;
      ctx.pendingDocsRef.current = new WeakSet<Doc>();
      return;
    }
    ctx.pendingDocsRef.current = new WeakSet<Doc>();
    suppressNextChangeRef.current = true;
    editor.setDoc(value);
    ctx.lastEmittedDocRef.current = value;
    ctx.store.setState(editor.getState());
  });

  return (
    <div className={className} ref={containerRef}>
      <VoidPortals />
    </div>
  );
}

function VoidPortals(): ReactNode {
  const ctx = useEditorContext("Editor.Content");
  const entries = useSyncExternalStore(ctx.voidRegistry.subscribe, ctx.voidRegistry.getSnapshot, ctx.voidRegistry.getSnapshot);
  return (
    <>
      {entries.map((entry) => (
        <VoidPortal key={entry.id} id={entry.id} type={entry.type} container={entry.el} />
      ))}
    </>
  );
}

function VoidPortal({ id, type, container }: { id: string; type: string; container: HTMLElement }): ReactNode {
  const ctx = useEditorContext("Editor.Content");
  const locale = useContext(LocaleContext);
  const editor = useEditor();
  const record = useEditorState(
    (state) => state.store.records.get(id),
    (a, b) => a === b,
  );
  const selected = useEditorState((state) => !!state.selection && state.selection.type === "block" && state.selection.ids.includes(id));

  if (!editor || !record) return null;
  const Renderer = ctx.renderersRef.current[type];
  if (!Renderer) return type === "divider" ? createPortal(<hr />, container) : null;

  const block = { id: record.id, type: record.type, props: record.props };
  // Opts this into core's typing-style merge window (editor.ts's own doc
  // comment) -- a void renderer's own <input> (ImageView's caption/alt,
  // EmbedView's title) calls this on every keystroke; without it each
  // keystroke was its own undo step (one undo restored only the last
  // character instead of the whole edit).
  const updateProps = (patch: Record<string, Json | undefined>) => editor.update((tx) => tx.setProps(id, patch), { mergeable: true });

  return createPortal(
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Renderer block={block} editor={editor} selected={selected} updateProps={updateProps} locale={locale} />
      </Suspense>
    </ErrorBoundary>,
    container,
  );
}
