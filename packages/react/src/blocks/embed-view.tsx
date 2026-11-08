"use client";

// The default `embed` void renderer -- YouTube/Vimeo render as a
// sandboxed iframe (embedIframeSrc re-validates provider+id itself, so this
// component can never be tricked into rendering an iframe for an
// unallowlisted provider even if a doc's props were hand-crafted); X/link
// (or an id that fails that re-validation) render as a plain link card.
// Headless, same "styling is the host's job" convention as ImageView.tsx:
// className/data attrs only, no inline styles.
//
// An empty (no url yet) embed shows its own inline URL input instead of a
// window.prompt -- typing there is local component state only (never
// touches the doc/history) until Enter commits it via updateProps in ONE
// call, parsing the provider/id from whatever was typed via parseEmbedUrl
// (model/embed.ts, DOM-free, shared with view/embedPaste.ts's own paste
// detection and media-serde.ts's fromMarkdown/fromHTML reconstruction).

import type { ReactNode } from "react";
import { useContext, useState } from "react";
import { embedIframeSrc, parseEmbedUrl, type EmbedProvider } from "@jul-editor/core";
import type { VoidRendererProps } from "../context.js";
import { LabelsContext } from "../context.js";

const EMBED_IFRAME_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

/** Only a genuine absolute http(s) URL is worth storing as a link embed
 * -- `parseEmbedUrl` itself never throws (any garbage input comes back as
 * `provider: "link"` so callers that already HAVE a url can render it as a
 * card), but that also means it can't be used on its own to reject typed
 * junk here; check the URL is actually well-formed first. */
function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function EmbedView({ block, selected, updateProps }: VoidRendererProps): ReactNode {
  const labels = useContext(LabelsContext);
  const provider = (typeof block.props.provider === "string" ? block.props.provider : "link") as EmbedProvider;
  const url = typeof block.props.url === "string" ? block.props.url : "";
  const id = typeof block.props.id === "string" ? block.props.id : "";
  const title = typeof block.props.title === "string" ? block.props.title : "";
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  if (!url) {
    return (
      <div data-jul-editor-embed data-state="empty">
        <input
          aria-label={labels.embedUrl}
          placeholder={labels.embedUrlPlaceholder}
          aria-invalid={invalid || undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const trimmed = draft.trim();
            if (!trimmed) return;
            if (!isHttpUrl(trimmed)) {
              setInvalid(true);
              return;
            }
            const parsed = parseEmbedUrl(trimmed);
            updateProps({ provider: parsed.provider, url: parsed.url, id: parsed.id, title: "" });
          }}
        />
        {invalid && <span role="alert">{labels.embedInvalidUrl}</span>}
      </div>
    );
  }

  const iframeSrc = embedIframeSrc(provider, id);
  return (
    <div data-jul-editor-embed data-state="ready" data-provider={provider}>
      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          title={title || provider}
          sandbox={EMBED_SANDBOX}
          allow={EMBED_IFRAME_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        />
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {title || url}
        </a>
      )}
      {selected && <input aria-label={labels.embedTitle} value={title} onChange={(e) => updateProps({ title: e.target.value })} placeholder={labels.embedTitlePlaceholder} />}
    </div>
  );
}

export const defaultRenderers = { embed: EmbedView };
