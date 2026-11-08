"use client";

// Callout renderer. Two modes, picked by the props the host gives it:
//  - editing (`<Editor renderers>`): mounted into the block's "decorated" slot beside the editable
//    content, so it renders ONLY the chrome (icon button + color/emoji picker) and mirrors
//    `data-callout-color` / `data-callout-icon` onto the block wrapper for host CSS (done by core from
//    calloutBlock.wrapperAttrs);
//  - read-only (`<EditorView renderers>`, which passes `readOnly` + `children`): renders the whole
//    `<aside>` itself around the already rendered body.
// Headless like the other plugin views: data attributes + class slots, no inline styles; an
// optional ready-made stylesheet is exported as CALLOUT_CSS (CSS variables per color).
import { useState } from "react";
import type { ReactNode } from "react";
import type { PluginViewProps } from "../view-props.js";
import { CALLOUT_COLORS, CALLOUT_DEFAULT_ICONS, readCallout } from "./block.js";

export interface CalloutClassNames {
  container?: string;
  iconButton?: string;
  picker?: string;
  swatch?: string;
  emoji?: string;
}

export interface CalloutViewProps extends PluginViewProps {
  /** Read-only mode: the already rendered content/children from EditorView. */
  children?: ReactNode;
  className?: string | CalloutClassNames;
  /** Emoji presets in the picker. */
  emojis?: readonly string[];
  /** Replaces the built-in picker (e.g. with a full emoji picker); call `pick(emoji)` to commit. */
  renderPicker?: (api: { current: string; pick: (emoji: string) => void; close: () => void }) => ReactNode;
}

export const DEFAULT_CALLOUT_EMOJIS = ["\u{1F4A1}", "ℹ️", "✅", "⚠️", "\u{1F6AB}", "\u{1F525}", "\u{1F4CC}", "❓", "⭐", "\u{1F4DD}", "\u{1F3AF}", "\u{1F680}"] as const;

function cls(className: CalloutViewProps["className"]): CalloutClassNames {
  return typeof className === "string" ? { container: className } : (className ?? {});
}

export function CalloutView({ block, readOnly, children, className, emojis = DEFAULT_CALLOUT_EMOJIS, renderPicker, updateProps, locale }: CalloutViewProps): ReactNode {
  const { icon, color, resolvedIcon } = readCallout(block.props);
  const classes = cls(className);
  const [picking, setPicking] = useState(false);
  const ko = locale === "ko";

  if (readOnly) {
    return (
      <aside data-jul-callout="" data-color={color} className={classes.container}>
        <span data-callout-icon="" aria-hidden="true">{resolvedIcon}</span>
        <div data-callout-body="">{children}</div>
      </aside>
    );
  }

  const pick = (emoji: string) => {
    updateProps?.({ icon: emoji === CALLOUT_DEFAULT_ICONS[color] ? "" : emoji });
    setPicking(false);
  };

  return (
    <span data-jul-callout-chrome="" data-color={color} className={classes.container}>
      <button
        type="button"
        data-callout-icon-button=""
        className={classes.iconButton}
        aria-label={ko ? "아이콘 변경" : "Change icon"}
        aria-expanded={picking}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPicking((v) => !v)}
      >
        {resolvedIcon}
      </button>
      {picking && (
        <div data-callout-picker="" role="dialog" className={classes.picker}>
          {renderPicker ? (
            renderPicker({ current: resolvedIcon, pick, close: () => setPicking(false) })
          ) : (
            <>
              <div data-callout-emojis="">
                {emojis.map((emoji) => (
                  <button key={emoji} type="button" className={classes.emoji} data-emoji={emoji} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
              <div data-callout-colors="" role="radiogroup" aria-label={ko ? "색상" : "Color"}>
                {CALLOUT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === color}
                    aria-label={c}
                    data-swatch={c}
                    className={classes.swatch}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => updateProps?.({ color: c === "default" ? undefined : c })}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}

/** Optional ready-made stylesheet (paste into a <style> or import as text). Everything is a CSS
 * variable so a host theme only overrides colors. Selectors target the live editing DOM
 * (`[data-type="callout"]` wrapper + the mirrored `data-callout-color`) and the read-only
 * `<aside data-jul-callout>`. */
export const CALLOUT_CSS = `
:root{--jul-callout-bg:#f1f1ef;--jul-callout-border:#e3e2e0;
--jul-callout-info-bg:#e7f3f8;--jul-callout-success-bg:#edf3ec;--jul-callout-warning-bg:#fbf3db;--jul-callout-danger-bg:#fdebec}
[data-jul-editor-block][data-type="callout"],aside[data-jul-callout]{position:relative;display:block;padding:12px 16px 12px 44px;border-radius:6px;
background:var(--jul-callout-bg);border:1px solid var(--jul-callout-border)}
[data-type="callout"][data-callout-color="info"],aside[data-jul-callout][data-color="info"]{background:var(--jul-callout-info-bg)}
[data-type="callout"][data-callout-color="success"],aside[data-jul-callout][data-color="success"]{background:var(--jul-callout-success-bg)}
[data-type="callout"][data-callout-color="warning"],aside[data-jul-callout][data-color="warning"]{background:var(--jul-callout-warning-bg)}
[data-type="callout"][data-callout-color="danger"],aside[data-jul-callout][data-color="danger"]{background:var(--jul-callout-danger-bg)}
[data-type="callout"]>[data-jul-editor-decoration]{position:absolute;left:12px;top:10px}
aside[data-jul-callout]>[data-callout-icon]{position:absolute;left:12px;top:12px}
[data-callout-icon-button]{border:0;background:transparent;font-size:1.2em;cursor:pointer;line-height:1}
[data-callout-picker]{position:absolute;z-index:10;margin-top:4px;padding:8px;border:1px solid var(--jul-callout-border);border-radius:8px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.12)}
[data-callout-emojis]{display:grid;grid-template-columns:repeat(6,1fr);gap:2px}
[data-callout-colors]{display:flex;gap:6px;margin-top:8px}
[data-swatch]{width:16px;height:16px;border-radius:50%;border:1px solid var(--jul-callout-border);cursor:pointer}
[data-swatch="default"]{background:var(--jul-callout-bg)}[data-swatch="info"]{background:var(--jul-callout-info-bg)}
[data-swatch="success"]{background:var(--jul-callout-success-bg)}[data-swatch="warning"]{background:var(--jul-callout-warning-bg)}
[data-swatch="danger"]{background:var(--jul-callout-danger-bg)}
`;
