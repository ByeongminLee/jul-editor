// Headless iframe embed. The src comes only from resolveIframe() (provider
// transform or host allowlist; default deny). Blocked urls render a plain
// link card instead, never an iframe. Height is stored in props and resizable
// by dragging the bottom handle (clamped 120..1600) when editable.
import { useMemo, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { clampIframeHeight, resolveIframe } from "./iframe.js";
import { useLinkContext } from "./link-context.js";
import type { PluginViewProps } from "../view-props.js";
import { UrlInput } from "./url-input.js";

export interface IframeClassNames {
  container?: string;
  frame?: string;
  handle?: string;
  blocked?: string;
}

export interface IframeViewProps extends PluginViewProps {
  className?: string | IframeClassNames;
}

export function IframeView({ block, editor, updateProps, readOnly, selected, locale = "en", className }: IframeViewProps): ReactNode {
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const { iframePolicy } = useLinkContext();
  const url = typeof block.props.url === "string" ? block.props.url : "";
  const title = typeof block.props.title === "string" ? block.props.title : "";
  const spec = useMemo(() => (url ? resolveIframe(url, iframePolicy) : null), [url, iframePolicy]);
  const height = clampIframeHeight(block.props.height ?? spec?.height);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const ko = locale === "ko";

  // Empty embed (a slash insert): ask for the url right here instead of a dead-end placeholder.
  if (!url && updateProps && !readOnly) return <UrlInput kind="iframe" selected={selected} editor={editor} locale={locale} className={classes.blocked ?? classes.container} onSubmit={(next) => updateProps({ url: next })} />;

  if (!spec) {
    // default deny: show the url as a link, never frame it.
    return (
      <div className={classes.blocked ?? classes.container} data-jul-editor-plugin="iframe" data-state="blocked">
        {url ? (
          <a href={/^https?:\/\//i.test(url) ? url : undefined} target="_blank" rel="noopener noreferrer">{title || url}</a>
        ) : (
          <span>{ko ? "URL이 없습니다" : "No URL"}</span>
        )}
      </div>
    );
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, h: height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    updateProps?.({ height: clampIframeHeight(drag.current.h + e.clientY - drag.current.y) });
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div className={classes.container} data-jul-editor-plugin="iframe" data-provider={spec.provider} data-state="ready">
      <iframe
        className={classes.frame}
        title={title || spec.provider}
        {...(spec.src ? { src: spec.src } : { srcDoc: spec.srcdoc })}
        sandbox={spec.sandbox}
        allow={spec.allow}
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        allowFullScreen
        style={{ width: "100%", height, border: 0 }}
      />
      {!readOnly && updateProps && (
        <div className={classes.handle} role="separator" aria-orientation="horizontal" aria-label={ko ? "높이 조절" : "Resize height"} data-slot="resize" style={{ cursor: "ns-resize", touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      )}
    </div>
  );
}
