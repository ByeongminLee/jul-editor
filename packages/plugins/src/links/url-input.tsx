// Inline URL entry for an empty bookmark / iframe block (what the slash items insert). Headless:
// data attributes only. Typing is local state until Enter commits ONE updateProps call; a value
// that is not an absolute http(s) url (after the same normalization the link editor applies,
// so "github.com/x" works) is refused with an inline message instead of being stored.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { normalizeLinkHref } from "@jul-editor/core";
import type { Editor as CoreEditor } from "@jul-editor/core";

export function toHttpUrl(text: string): string | null {
  const normalized = normalizeLinkHref(text);
  try {
    const u = new URL(normalized);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export interface UrlInputProps {
  kind: "bookmark" | "iframe";
  /** Selected right when it mounts: focus the field. */
  selected?: boolean;
  /** When the editor has focus as the empty block mounts (the user just inserted it, e.g. from the
   * slash menu), the field takes the focus so the url can be typed right away. */
  editor?: CoreEditor;
  locale?: "en" | "ko";
  className?: string;
  onSubmit: (url: string) => void;
}

export function UrlInput({ kind, selected, editor, locale = "en", className, onSubmit }: UrlInputProps): ReactNode {
  const ko = locale === "ko";
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  // Only on mount, and only while the user is editing (never on page load): arrowing onto an
  // existing empty card later must not steal the caret.
  useEffect(() => {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const editing = !!editor && !!active && editor.getRoot().contains(active);
    if (selected || editing) ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label = kind === "bookmark" ? (ko ? "북마크 URL" : "Bookmark URL") : ko ? "임베드 URL" : "Embed URL";
  const placeholder = kind === "bookmark" ? (ko ? "링크를 붙여넣고 Enter를 누르세요" : "Paste a link and press Enter") : ko ? "임베드할 URL을 붙여넣고 Enter를 누르세요" : "Paste a URL to embed and press Enter";
  return (
    <div className={className} data-jul-editor-plugin={kind} data-state="empty" contentEditable={false}>
      <input
        ref={ref}
        type="url"
        data-slot="url-input"
        aria-label={label}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!draft.trim()) return;
          const url = toHttpUrl(draft.trim());
          if (!url) {
            setInvalid(true);
            return;
          }
          onSubmit(url);
        }}
      />
      {invalid && <span data-slot="url-error" role="alert">{ko ? "http(s) 주소를 입력하세요" : "Enter an http(s) URL"}</span>}
    </div>
  );
}
