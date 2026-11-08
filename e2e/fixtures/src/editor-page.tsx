// T5ab playground route: a complete single-root editing surface built on
// @jul-editor/core's createEditor facade (view/editor.ts). Exposes
// window.__julEditor = { editor, getDoc, setCaret, setSelection } for
// e2e/render.spec.ts and e2e/editing.spec.ts. `?doc=500|5000` loads a bench
// fixture (bench/fixtures/doc-{500,5000}.json); otherwise a small
// hand-written doc covering headings/lists/void/nesting is used.
//
// The image void renderer + a controllable `onUpload` mock (see
// `window.__julEditorUploads`) for e2e/clipboard*.spec.ts and e2e/image*.spec.ts
// -- a real host app would use @jul-editor/react's <Editor renderers={{image:
// ImageView}}> instead; this vanilla page reimplements just enough of that
// same headless shape (figure[data-jul-editor-image][data-state], an alt <input>
// shown only while selected, a retry button; width/align/
// caption/resize handles the same way) by hand since it doesn't use React
// at all. `embed`'s doc-model behavior (paste-to-embed, slash insertion)
// needs no vanilla-page mirroring -- it's core-layer/view/embedPaste.ts, not
// React-only -- so e2e/media.spec.ts exercises it right here too, and only
// reaches for the "/react" page when it needs to see the real rendered
// iframe/link-card DOM (packages/react/src/blocks/embed-view.tsx).
import { useEffect, useRef } from "react";
import { coreRegistry, createEditor, type Doc, type Editor, type EditorState } from "@jul-editor/core";
import doc500 from "../../../bench/fixtures/doc-500.json";
import doc5000 from "../../../bench/fixtures/doc-5000.json";

interface PendingUpload {
  file: File;
  blockId: string;
  resolve: (result: { src: string; assetId?: string }) => void;
  reject: (err: Error) => void;
}

declare global {
  interface Window {
    __julEditor?: {
      editor: Editor;
      getDoc: () => Doc;
      setCaret: (blockId: string, offset: number) => void;
      setSelection: (selection: EditorState["selection"]) => void;
    };
    /** e2e-only controllable upload mock -- see `onUpload` below. */
    __julEditorUploads?: {
      pending: () => Array<{ blockId: string; filename: string }>;
      resolveNext: (result: { src: string; assetId?: string }) => void;
      rejectNext: (message?: string) => void;
    };
  }
}

function defaultDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello world" }] },
      { id: "h1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { id: "q1", type: "quote", props: {}, content: [{ type: "text", text: "quoted" }] },
      {
        id: "li1",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "parent item" }],
        children: [{ id: "li1a", type: "bulletListItem", props: {}, content: [{ type: "text", text: "child item" }] }],
      },
      { id: "o1", type: "orderedListItem", props: {}, content: [{ type: "text", text: "one" }] },
      { id: "o2", type: "orderedListItem", props: {}, content: [{ type: "text", text: "two" }] },
      { id: "o3", type: "orderedListItem", props: {}, content: [{ type: "text", text: "three" }] },
      { id: "v1", type: "image", props: { src: "spike.png", alt: "pic" } },
      { id: "pEnd", type: "paragraph", props: {}, content: [] },
    ],
  };
}

function loadDoc(): Doc {
  const which = new URLSearchParams(window.location.search).get("doc");
  if (which === "5000") return doc5000 as Doc;
  if (which === "500") return doc500 as Doc;
  return defaultDoc();
}

const MIN_WIDTH_PX = 80;
type ImageAlignV = "left" | "center" | "right";

interface ImageEls {
  figure: HTMLElement;
  img: HTMLImageElement;
  alt: HTMLInputElement;
  retry: HTMLButtonElement;
  // Mirrors @jul-editor/react's ImageView (width/align/caption/resize) by
  // hand, in plain DOM -- same reason this file already hand-rolls the alt
  // input/retry button (see this file's own header comment).
  caption: HTMLInputElement;
  captionText: HTMLElement;
  align: Record<ImageAlignV, HTMLButtonElement>;
  resizeLeft: HTMLButtonElement;
  resizeRight: HTMLButtonElement;
}

export function EditorPage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // `renderVoid` can fire synchronously DURING createEditor(...) itself
    // (its very first render pass, for a doc that already has void blocks) --
    // well before `editor` below is assigned. Every reference to the editor
    // from inside renderVoid goes through this ref instead of the `editor`
    // binding directly, and every call site guards against it still being
    // null (the initial paint below only ever reads `block.props`, which IS
    // available synchronously; live updates go through `syncImage`, called
    // again once the ref is set).
    const editorRef: { current: Editor | null } = { current: null };
    const imageEls = new Map<string, ImageEls>();

    function syncImage(blockId: string): void {
      const editor = editorRef.current;
      const els = imageEls.get(blockId);
      if (!editor || !els) return;
      const rec = editor.getState().store.records.get(blockId);
      els.img.src = String(rec?.props.src ?? "");
      els.img.alt = String(rec?.props.alt ?? "");
      if (document.activeElement !== els.alt) els.alt.value = els.img.alt;
      const sel = editor.getState().selection;
      const selected = !!sel && sel.type === "block" && sel.ids.includes(blockId);
      els.alt.style.display = selected ? "" : "none";
      const upload = editor.getUploadState(blockId);
      const state = upload?.status === "uploading" ? "uploading" : upload?.status === "error" ? "error" : "ready";
      els.figure.setAttribute("data-state", state);
      els.retry.style.display = state === "error" ? "" : "none";

      const rawAlign = rec?.props.align;
      const align: ImageAlignV = rawAlign === "left" || rawAlign === "right" ? rawAlign : "center";
      els.figure.setAttribute("data-align", align);
      for (const a of ["left", "center", "right"] as const) {
        els.align[a].style.display = selected ? "" : "none";
        els.align[a].setAttribute("aria-pressed", String(a === align));
      }
      els.resizeLeft.style.display = selected ? "" : "none";
      els.resizeRight.style.display = selected ? "" : "none";

      const width = rec?.props.width;
      if (typeof width === "number" || typeof width === "string") {
        els.img.setAttribute("width", String(width));
        els.img.setAttribute("data-jul-editor-width", String(width));
      } else {
        els.img.removeAttribute("width");
        els.img.removeAttribute("data-jul-editor-width");
      }

      const caption = typeof rec?.props.caption === "string" ? rec.props.caption : "";
      // Same "input while selected, plain text otherwise" split as the
      // React ImageView (figcaption): a real host wants to actually READ a
      // caption once the block is no longer selected, not stare at an
      // editable-looking input for it.
      els.caption.style.display = selected ? "" : "none";
      if (document.activeElement !== els.caption) els.caption.value = caption;
      els.captionText.style.display = !selected && caption ? "" : "none";
      els.captionText.textContent = caption;
    }

    // A controllable upload mock (e2e-only): every onUpload call queues here
    // instead of resolving on its own, so a test can assert the "uploading"
    // state deterministically before choosing when/how it settles.
    const uploadQueue: PendingUpload[] = [];
    window.__julEditorUploads = {
      pending: () => uploadQueue.map((u) => ({ blockId: u.blockId, filename: u.file.name })),
      resolveNext(result) {
        uploadQueue.shift()?.resolve(result);
      },
      rejectNext(message) {
        uploadQueue.shift()?.reject(new Error(message ?? "upload failed"));
      },
    };

    const editor = createEditor({
      element,
      registry: coreRegistry,
      defaultValue: loadDoc(),
      onUpload: (file, ctx) => new Promise((resolve, reject) => uploadQueue.push({ file, blockId: ctx.blockId, resolve, reject })),
      renderVoid: (block, container) => {
        if (block.type !== "image") {
          const div = document.createElement("div");
          div.setAttribute("data-testid", "void-block");
          div.textContent = String(block.props.alt ?? block.type);
          container.appendChild(div);
          return;
        }
        const figure = document.createElement("figure");
        figure.setAttribute("data-jul-editor-image", "");
        figure.setAttribute("data-state", "ready");
        const img = document.createElement("img");
        img.src = String(block.props.src ?? "");
        img.alt = String(block.props.alt ?? "");
        const alt = document.createElement("input");
        alt.setAttribute("aria-label", "Alt text");
        alt.style.display = "none";
        alt.addEventListener("input", () => editorRef.current?.update((tx) => tx.setProps(block.id, { alt: alt.value })));

        const caption = document.createElement("input");
        caption.setAttribute("aria-label", "Caption");
        caption.style.display = "none";
        caption.addEventListener("input", () => editorRef.current?.update((tx) => tx.setProps(block.id, { caption: caption.value })));

        const captionText = document.createElement("figcaption");
        captionText.style.display = "none";

        function makeAlignButton(a: ImageAlignV): HTMLButtonElement {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("aria-label", `Align ${a}`);
          button.style.display = "none";
          // Same "don't steal focus off the contenteditable root" convention
          // as this file's own "toolbar-bold" button below -- a real
          // <button> focuses itself on mousedown by default, which would
          // move focus (and with it Ctrl+Z/Backspace) off the root.
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", () => editorRef.current?.update((tx) => tx.setProps(block.id, { align: a })));
          return button;
        }
        const alignButtons: Record<ImageAlignV, HTMLButtonElement> = { left: makeAlignButton("left"), center: makeAlignButton("center"), right: makeAlignButton("right") };

        // A resize drag previews locally (mutating the <img> width
        // attribute directly on pointermove) and commits via ONE
        // editor.update at pointerup -- same "one history entry, not one per
        // pointermove" contract as ImageView.tsx's React version.
        function currentWidth(): number {
          const w = editorRef.current?.getState().store.records.get(block.id)?.props.width;
          return typeof w === "number" ? w : img.getBoundingClientRect().width || MIN_WIDTH_PX;
        }
        function makeResizeHandle(side: "left" | "right"): HTMLButtonElement {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.setAttribute("data-jul-editor-resize-handle", side);
          handle.setAttribute("aria-label", `Resize from ${side}`);
          handle.style.display = "none";
          let startX = 0;
          let startWidth = 0;
          let moved = false;
          handle.addEventListener("pointerdown", (e) => {
            e.preventDefault(); // same "don't steal focus off the root" reason as the align buttons above
            startX = e.clientX;
            startWidth = currentWidth();
            moved = false;
            handle.setPointerCapture?.(e.pointerId);
          });
          handle.addEventListener("pointermove", (e) => {
            if (e.buttons === 0) return;
            moved = true;
            const dx = e.clientX - startX;
            const delta = side === "left" ? -dx : dx;
            const width = Math.max(MIN_WIDTH_PX, Math.round(startWidth + delta));
            img.setAttribute("width", String(width));
            img.setAttribute("data-jul-editor-width", String(width));
          });
          handle.addEventListener("pointerup", (e) => {
            handle.releasePointerCapture?.(e.pointerId);
            if (!moved) return;
            moved = false;
            const width = Number(img.getAttribute("width"));
            if (Number.isFinite(width) && width > 0) editorRef.current?.update((tx) => tx.setProps(block.id, { width }));
          });
          return handle;
        }
        const resizeLeft = makeResizeHandle("left");
        const resizeRight = makeResizeHandle("right");

        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry";
        retry.style.display = "none";
        retry.addEventListener("click", () => editorRef.current?.retryUpload(block.id));
        figure.append(img, resizeLeft, resizeRight, alignButtons.left, alignButtons.center, alignButtons.right, alt, caption, captionText, retry);
        container.appendChild(figure);
        imageEls.set(block.id, { figure, img, alt, retry, caption, captionText, align: alignButtons, resizeLeft, resizeRight });
        syncImage(block.id);
        return () => imageEls.delete(block.id);
      },
    });
    editorRef.current = editor;
    for (const id of imageEls.keys()) syncImage(id); // catch up now that editorRef is set (selection/upload state)
    const offChange = editor.on("change", () => {
      for (const id of imageEls.keys()) syncImage(id);
    });
    const offUpload = editor.onUpload((id) => syncImage(id));

    window.__julEditor = {
      editor,
      getDoc: () => editor.getDoc(),
      setCaret: (blockId, offset) => {
        element.focus();
        const point = { blockId, offset };
        editor.update((tx) => tx.setSelection({ type: "text", anchor: point, focus: point }));
      },
      setSelection: (selection) => {
        element.focus();
        editor.update((tx) => tx.setSelection(selection));
      },
    };

    return () => {
      offChange();
      offUpload();
      editor.destroy();
      delete window.__julEditor;
      delete window.__julEditorUploads;
    };
  }, []);

  return (
    <div data-testid="page-editor">
      <div ref={ref} />
      {/* Test-only fixtures for e2e/ime.spec.ts's blur/toolbar-command cases
          -- these sit OUTSIDE the contenteditable root on purpose, since the
          point is a real focus change away from it (blur), and a "toolbar"
          button whose click handler calls a command directly (bypassing
          keydown entirely), not a real UI. */}
      <button type="button" data-testid="blur-target">
        blur target
      </button>
      {/* onMouseDown preventDefault: a real toolbar button must not steal
          focus (and with it, the selection) away from the contenteditable
          root -- otherwise the very selection the command is meant to act on
          would already be gone by the time the click handler runs. */}
      <button type="button" data-testid="toolbar-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => window.__julEditor?.editor.commands.toggleMark("bold")}>
        Bold
      </button>
    </div>
  );
}
