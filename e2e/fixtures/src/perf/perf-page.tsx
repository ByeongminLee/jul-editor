// "/perf?doc=500|5000&react=0|1&autosave=0|1" playground route: the
// input-latency + regression-gate measurement surface for e2e/perf.spec.ts.
// It exists to support the latency protocol in e2e/perf.spec.ts; see window.__perf
// below for its exact shape.
//
// react=0 mounts @jul-editor/core's createEditor directly (no React in the
// editing path, like EditorPage.tsx/VanillaPage.tsx); react=1 mounts
// @jul-editor/react's compound <Editor> with a Toolbar + SlashMenu, matching the
// "worst realistic" consumer autosave=1 wires
// @jul-editor/react's createAutosave/useAutosave in either mode (it's
// framework-agnostic -- takes a CoreEditor, not JSX).
import type { MutableRefObject, ReactNode } from "react";
import { Profiler, useCallback, useEffect, useMemo, useRef } from "react";
import type { Doc, Editor as CoreEditor } from "@jul-editor/core";
import { coreRegistry, createEditor, decodeClipboard } from "@jul-editor/core";
import { createAutosave, Editor, useAutosave, useEditor, type AutosaveHandle, type VoidRendererProps } from "@jul-editor/react";
import doc500 from "../../../../bench/fixtures/doc-500.json";
import doc5000 from "../../../../bench/fixtures/doc-5000.json";
import { findMiddleTextPoint, renderVoidGeneric } from "./perf-shared.js";

export interface PerfWindow {
  editor: CoreEditor;
  commitTimes: number[];
  reset(): void;
  placeCaretMiddle(): void;
  /** react=1 only: every <Editor.Toolbar> Profiler commit, incl. mount. */
  toolbarRenders?: number;
  /** Vanilla-only (isolates core's own render cost from React's mount
   * overhead): ms from just before createEditor() to just after its
   * synchronous first render()+restoreSelection(). */
  mountMs?: number;
  /** "Big paste" bench (e2e/perf.spec.ts): decodes `markdown` as a clipboard
   * text/plain payload (core's own decodeClipboard) and inserts it at the
   * current selection via the `pasteFragment` transaction op -- this
   * exercises the real decode+insert+render+commit cost without depending on
   * interaction.ts's DOM `paste` event wiring. Returns the elapsed ms. */
  pasteMarkdown(markdown: string): number;
}

declare global {
  interface Window {
    __perf?: PerfWindow;
  }
}

interface PerfParams {
  doc: Doc;
  react: boolean;
  autosave: boolean;
}

function parseParams(): PerfParams {
  const params = new URLSearchParams(window.location.search);
  return {
    doc: (params.get("doc") === "5000" ? doc5000 : doc500) as Doc,
    react: params.get("react") === "1",
    autosave: params.get("autosave") === "1",
  };
}

/** Shared instrumentation for both variants. A capture-phase listener on
 * `window` records the triggering keydown/input's `timeStamp`; the
 * editor's `onCommit` (view/index.ts's runDispatch -> emitter.emit) fires
 * strictly AFTER that dispatch's render() + restoreSelection(), so
 * `performance.now()` taken there already is "commit incl. DOM patch +
 * selection restore" -- no microtask-after-change approximation needed. */
function attachPerfWindow(editor: CoreEditor, doc: Doc, element: HTMLElement, extra?: { mountMs?: number; toolbarRenders?: number }): () => void {
  const commitTimes: number[] = [];
  let lastTriggerTs = 0;
  const onTrigger = (e: Event) => {
    lastTriggerTs = e.timeStamp;
  };
  // Plain typing: the editor's beforeinput handler preventDefault()s the
  // browser's own edit and does the whole dispatch synchronously, so no
  // native `input` event ever fires for it -- `keydown` is the only trigger.
  // IME composition: measured (empirically, via a scratch CDP trace) each
  // composeSteps() call commits synchronously off that step's own `input`
  // event, with NO accompanying `keydown` -- `compositionend` fires only
  // once, well after every per-step commit already happened, so it is NOT a
  // usable trigger here. Listening to both covers each real path without the
  // two ever double-firing for the same commit.
  window.addEventListener("keydown", onTrigger, true);
  window.addEventListener("input", onTrigger, true);
  const off = editor.on("change", () => {
    commitTimes.push(performance.now() - lastTriggerTs);
  });

  window.__perf = {
    editor,
    commitTimes,
    mountMs: extra?.mountMs,
    toolbarRenders: extra?.toolbarRenders,
    reset() {
      commitTimes.length = 0;
    },
    placeCaretMiddle() {
      element.focus();
      const point = findMiddleTextPoint(doc);
      editor.update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
    },
    pasteMarkdown(markdown: string): number {
      const start = performance.now();
      const { doc: fragmentDoc } = decodeClipboard({ getData: (format) => (format === "text/plain" ? markdown : "") }, { registry: coreRegistry });
      const selection = editor.getState().selection;
      if (selection) editor.update((tx) => tx.pasteFragment(selection, fragmentDoc.blocks));
      return performance.now() - start;
    },
  };

  return () => {
    window.removeEventListener("keydown", onTrigger, true);
    window.removeEventListener("input", onTrigger, true);
    off();
    delete window.__perf;
  };
}

function VanillaPerf({ doc, autosave }: { doc: Doc; autosave: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const mountStart = performance.now();
    const editor = createEditor({ element, registry: coreRegistry, defaultValue: doc, renderVoid: renderVoidGeneric });
    const mountMs = performance.now() - mountStart;

    let autosaveHandle: AutosaveHandle | undefined;
    if (autosave) autosaveHandle = createAutosave(editor, { key: "jul-editor-perf-draft-vanilla", save: async () => {} });

    const detach = attachPerfWindow(editor, doc, element, { mountMs });

    return () => {
      detach();
      autosaveHandle?.destroy();
      editor.destroy();
    };
    // Mount-once by design (doc/autosave are fixed for this page's lifetime,
    // read off the URL once).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div data-testid="page-perf" ref={ref} />;
}

function VoidRendererGeneric({ block }: VoidRendererProps): ReactNode {
  return (
    <div data-testid="void-block" data-jul-editor-void-type={block.type}>
      {String(block.props.alt ?? block.props.code ?? block.type)}
    </div>
  );
}

function PerfBridge({ doc, toolbarRendersRef }: { doc: Doc; toolbarRendersRef: MutableRefObject<number> }): ReactNode {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    const element = document.querySelector<HTMLElement>("[data-jul-editor-root]");
    if (!element) return;
    return attachPerfWindow(editor, doc, element, { toolbarRenders: toolbarRendersRef.current });
  }, [editor, doc, toolbarRendersRef]);

  return null;
}

function AutosaveBridge(): ReactNode {
  useAutosave({ key: "jul-editor-perf-draft-react", save: async () => {} });
  return null;
}

function SlashMenuUI(): ReactNode {
  return (
    <Editor.SlashMenu>
      {({ items, activeIndex, rect, getListboxProps, getOptionProps }) => (
        <div {...getListboxProps()} data-testid="slash-menu" style={rect ? { position: "fixed", left: rect.left, top: rect.bottom + 4 } : undefined}>
          {items.map((item, i) => (
            <div key={item.id} {...getOptionProps(i)} data-active={i === activeIndex || undefined}>
              {item.title}
            </div>
          ))}
        </div>
      )}
    </Editor.SlashMenu>
  );
}

function ReactPerf({ doc, autosave }: { doc: Doc; autosave: boolean }): ReactNode {
  const toolbarRendersRef = useRef(0);
  const onToolbarRender = useCallback(() => {
    toolbarRendersRef.current += 1;
    if (window.__perf) window.__perf.toolbarRenders = toolbarRendersRef.current;
  }, []);

  return (
    <div data-testid="page-perf">
      <Editor defaultValue={doc} renderers={{ image: VoidRendererGeneric, chart: VoidRendererGeneric, diagram: VoidRendererGeneric }}>
        <Profiler id="perf-toolbar" onRender={onToolbarRender}>
          <Editor.Toolbar aria-label="Formatting">
            <Editor.Bold />
            <Editor.Italic />
            <Editor.Strike />
            <Editor.Code />
            <Editor.Heading level={1} />
            <Editor.BulletList />
            <Editor.Undo />
            <Editor.Redo />
          </Editor.Toolbar>
        </Profiler>
        <Editor.Content />
        <SlashMenuUI />
        <PerfBridge doc={doc} toolbarRendersRef={toolbarRendersRef} />
        {autosave && <AutosaveBridge />}
      </Editor>
    </div>
  );
}

export function PerfPage(): ReactNode {
  const { doc, react, autosave } = useMemo(() => parseParams(), []);
  return react ? <ReactPerf doc={doc} autosave={autosave} /> : <VanillaPerf doc={doc} autosave={autosave} />;
}
