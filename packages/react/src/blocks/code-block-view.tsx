"use client";

// P2: the default `codeBlock` "decorated" chrome -- a language <select> +
// copy button, mounted beside the block's own editable content div via the
// decoration slot (Editor.tsx's `buildRegistry` auto-marks `codeBlock` as
// `decorated` the moment a `renderers.codeBlock` is passed -- see its own
// comment). Headless: className/data-attr only, no inline styles/CSS file
// (matches ImageView.tsx's own "styling is the host's job" convention).
//
// `VoidRendererProps.block` only carries `{id,type,props}` (no `content`) --
// the copy button reads the block's CURRENT code text directly off
// `editor.getState()` at click time instead: it doesn't need a live
// subscription (unlike the language, which React already re-renders on via
// the portal's own `block.props` prop), only a snapshot at the moment of the
// click.

import type { ReactNode } from "react";
import { useContext, useState } from "react";
import { plainTextOf } from "@jul-editor/core";
import type { VoidRendererProps } from "../context.js";
import { LabelsContext } from "../context.js";

export interface CodeLanguageOption {
  value: string;
  label: string;
  aliases?: readonly string[];
}

/** The async Clipboard API can reject (NotAllowedError -- no permission,
 * an iframe without clipboard-write, some Safari/Firefox policies), not just
 * be absent -- falls back to the deprecated `execCommand` either way instead
 * of only when `writeText` doesn't exist, and never lets the rejection
 * escape (an unhandled rejection otherwise, since the caller below has no
 * catch of its own). Returns whether the copy actually succeeded. */
async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

const COPIED_RESET_MS = 1500;

function CodeBlockChrome(props: VoidRendererProps & { languages: readonly CodeLanguageOption[] }): ReactNode {
  const { block, editor, updateProps, languages } = props;
  // LabelsContext defaults to EN_LABELS on its own -- no
  // <Editor> wrapper (CodeBlockView.test.tsx mounts standalone) is a normal,
  // supported case, not an error.
  const labels = useContext(LabelsContext);
  const [copied, setCopied] = useState<false | "done" | "error">(false);
  const language = typeof block.props.language === "string" ? block.props.language : "";
  // The block's stored language can be one lowlight still highlights
  // (e.g. a "py" alias) without being one of `languages`' own curated
  // options -- a plain controlled <select> would otherwise silently fall
  // back to its first option's value, so add the real value as an extra
  // option instead of losing it.
  const matchedLanguage = languages.find((l) => l.value === language || l.aliases?.includes(language));

  function handleCopy(): void {
    const rec = editor.getState().store.records.get(block.id);
    const code = rec?.content ? plainTextOf(rec.content) : "";
    void writeClipboardText(code).then((ok) => {
      setCopied(ok ? "done" : "error");
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  }

  return (
    <div data-jul-editor-code-chrome>
      <select aria-label={labels.codeLanguage} value={matchedLanguage?.value ?? language} onChange={(e) => updateProps({ language: e.target.value })}>
        {!matchedLanguage && language && <option value={language}>{language}</option>}
        {languages.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <button type="button" data-jul-editor-code-copy aria-label={labels.codeCopy} data-copied={copied || undefined} onClick={handleCopy}>
        {copied === "done" ? labels.codeCopyDoneLabel : labels.codeCopyLabel}
      </button>
    </div>
  );
}

/** Factory (not a fixed component): the language list is app-supplied --
 * @jul-editor/plugins' `pluginCodeLanguages` is the natural default, but
 * @jul-editor/react has no dependency on @jul-editor/plugins (same "wired at the app
 * level" convention as `mergeSlashItems`). */
export function createCodeBlockRenderer(opts: { languages: readonly CodeLanguageOption[] }): (props: VoidRendererProps) => ReactNode {
  return function CodeBlockView(props: VoidRendererProps): ReactNode {
    return <CodeBlockChrome {...props} languages={opts.languages} />;
  };
}
