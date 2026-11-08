"use client";

// Default `image` void renderer (with width/align/caption
// + resize handles). Headless: no CSS, no inline styles -- a host app styles
// `[data-jul-editor-image]`/`[data-state]`/`[data-align]`/
// `[data-jul-editor-resize-handle]` itself (matches every other @jul-editor/react
// component's "styling is the host's job" convention; keeping the resized
// image's aspect ratio is also the host's own CSS's job, e.g. `height:
// auto` -- this component only ever writes `width`). Upload status
// (`editor.getUploadState`/`onUpload`) is transient view-layer state, never
// part of the doc model/EditorState, so it needs its own
// useSyncExternalStore subscription separate from the doc.

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useContext, useRef, useState, useSyncExternalStore } from "react";
import type { VoidRendererProps } from "../context.js";
import { LabelsContext } from "../context.js";

const MIN_WIDTH_PX = 80;
type ImageAlign = "left" | "center" | "right";
type ResizeSide = "left" | "right";

export function ImageView({ block, editor, selected, updateProps }: VoidRendererProps): ReactNode {
  const labels = useContext(LabelsContext);
  const blockId = block.id;
  const subscribe = useCallback((listener: () => void) => editor.onUpload((id) => id === blockId && listener()), [editor, blockId]);
  const getSnapshot = useCallback(() => editor.getUploadState(blockId), [editor, blockId]);
  const upload = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const state = upload?.status ?? "ready";
  const src = editor.getUploadPreview(blockId) ?? (typeof block.props.src === "string" ? block.props.src : "");
  const alt = typeof block.props.alt === "string" ? block.props.alt : "";
  const caption = typeof block.props.caption === "string" ? block.props.caption : "";
  const align: ImageAlign = block.props.align === "left" || block.props.align === "right" ? block.props.align : "center";
  const committedWidth = typeof block.props.width === "number" ? block.props.width : typeof block.props.width === "string" ? block.props.width : null;

  // A resize drag previews locally (dragWidthPx) instead of calling
  // updateProps per pointermove -- ONE updateProps call, at pointerup, is
  // the whole point (one history/undo entry for the whole drag, not one per
  // pixel). Only ever previews a NUMBER (px) even if the committed width is
  // a percentage string -- dragging always commits a concrete px value.
  const [dragWidthPx, setDragWidthPx] = useState<number | null>(null);
  const dragRef = useRef<{ side: ResizeSide; startX: number; startWidth: number } | null>(null);
  const width: number | string | null = dragWidthPx ?? committedWidth;

  const onResizePointerDown = useCallback(
    (side: ResizeSide) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault(); // a real <button> focuses itself on mousedown otherwise, stealing focus off the contenteditable root
      const img = e.currentTarget.parentElement?.querySelector("img");
      const startWidth = typeof committedWidth === "number" ? committedWidth : (img?.getBoundingClientRect().width ?? MIN_WIDTH_PX);
      dragRef.current = { side, startX: e.clientX, startWidth };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [committedWidth],
  );
  const onResizePointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const delta = drag.side === "left" ? -dx : dx;
    setDragWidthPx(Math.max(MIN_WIDTH_PX, Math.round(drag.startWidth + delta)));
  }, []);
  const onResizePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (dragWidthPx !== null) updateProps({ width: dragWidthPx });
      setDragWidthPx(null);
    },
    [dragWidthPx, updateProps],
  );

  return (
    <figure data-jul-editor-image data-state={state} data-align={align}>
      <img src={src || undefined} alt={alt} {...(width != null ? { width } : {})} data-jul-editor-width={width != null ? String(width) : undefined} />
      {selected && (
        <>
          <button
            type="button"
            data-jul-editor-resize-handle="left"
            aria-label={labels.imageResizeLeft}
            onPointerDown={onResizePointerDown("left")}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <button
            type="button"
            data-jul-editor-resize-handle="right"
            aria-label={labels.imageResizeRight}
            onPointerDown={onResizePointerDown("right")}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div data-jul-editor-align-group role="group" aria-label={labels.imageAlignGroup}>
            {(
              [
                ["left", labels.imageAlignLeft],
                ["center", labels.imageAlignCenter],
                ["right", labels.imageAlignRight],
              ] as const
            ).map(([a, alignLabel]) => (
              <button
                key={a}
                type="button"
                // A locale-stable hook for a host's own CSS/e2e
                // to target "the left/center/right button" by -- aria-label
                // is now localized, so it can no longer double as one.
                data-jul-editor-align-option={a}
                aria-pressed={align === a}
                aria-label={alignLabel}
                onMouseDown={(e) => e.preventDefault()} // same "don't steal root focus" reason as the resize handles above
                onClick={() => updateProps({ align: a })}
              />
            ))}
          </div>
          <input
            aria-label={labels.imageUrl}
            data-jul-editor-image-url
            key={String(block.props.src ?? "")}
            defaultValue={typeof block.props.src === "string" ? block.props.src : ""}
            onBlur={e => updateProps({src: e.target.value})}
          />
          <input
            data-jul-editor-alt-input
            aria-label={labels.imageAltText}
            value={alt}
            // A plain controlled input inside the void's own (contenteditable=
            // false) container -- typing here calls updateProps directly and
            // never touches the root's inline content/selection.
            onChange={(e) => updateProps({ alt: e.target.value })}
          />
        </>
      )}
      {(selected || caption) && (
        <figcaption>
          {selected ? (
            <input data-jul-editor-caption-input aria-label={labels.imageCaption} value={caption} placeholder={labels.imageCaptionPlaceholder} onChange={(e) => updateProps({ caption: e.target.value })} />
          ) : (
            caption
          )}
        </figcaption>
      )}
      {(state === "queued" || state === "uploading") && <span role="status">{state === "queued" ? labels.imageUploadPending : labels.imageUploading}</span>}
      {state === "error" && (
        <button type="button" onClick={() => editor.retryUpload(blockId)}>
          {labels.imageRetry}
        </button>
      )}
    </figure>
  );
}

export const defaultRenderers = { image: ImageView };
