// Headless bookmark card. States: loading (metadata in flight), ready, error
// (fetch failed: still shows the URL-rule card, with data-state="error").
// Style slots + data attributes only, no CSS shipped. The card is an <a> that
// opens in a new tab with noopener; image/favicon are re-sanitized (http/https).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLinkContext } from "./link-context.js";
import { cardFromProps, resolveCard, type CardState } from "./metadata.js";
import type { PluginViewProps } from "../view-props.js";

export interface BookmarkClassNames {
  container?: string;
  body?: string;
  title?: string;
  description?: string;
  meta?: string;
  favicon?: string;
  thumbnail?: string;
  loading?: string;
  error?: string;
}

export interface BookmarkViewProps extends PluginViewProps {
  className?: string | BookmarkClassNames;
}

export function BookmarkView({ block, updateProps, readOnly, locale = "en", className }: BookmarkViewProps): ReactNode {
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const { fetchMetadata } = useLinkContext();
  const stored = useMemo(() => cardFromProps(block.props), [block.props]);
  const hasStoredMeta = typeof block.props.description === "string" && block.props.description !== "" ? true : typeof block.props.image === "string" && block.props.image !== "";
  const [state, setState] = useState<CardState>({ status: fetchMetadata && !hasStoredMeta ? "loading" : "ready", card: stored });
  const patchRef = useRef(updateProps);
  patchRef.current = updateProps;

  useEffect(() => {
    // Fetch once per url when the host gave an adapter and the block has no cached metadata.
    if (!fetchMetadata || hasStoredMeta || !stored.url) {
      setState({ status: "ready", card: stored });
      return;
    }
    const ctl = new AbortController();
    setState({ status: "loading", card: stored });
    void resolveCard(stored.url, { fetchMetadata, signal: ctl.signal }).then((s) => {
      if (ctl.signal.aborted) return;
      setState(s);
      if (s.status === "ready" && !readOnly) {
        patchRef.current?.({ title: s.card.title, description: s.card.description, image: s.card.image, favicon: s.card.favicon, siteName: s.card.siteName });
      }
    });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.url, fetchMetadata, hasStoredMeta, readOnly]);

  const { card, status } = state;
  const ko = locale === "ko";
  if (!card.url) return <div className={classes.container} data-jul-editor-plugin="bookmark" data-state="empty">{ko ? "URL이 없습니다" : "No URL"}</div>;
  return (
    <a className={classes.container} href={card.url} target="_blank" rel="noopener noreferrer" data-jul-editor-plugin="bookmark" data-state={status} data-provider={card.provider} data-kind={card.kind} aria-busy={status === "loading"}>
      <span className={classes.body}>
        <span className={classes.title} data-slot="title">{card.title || card.url}</span>
        {status === "loading" ? (
          <span className={classes.loading} data-slot="loading">{ko ? "불러오는 중..." : "Loading..."}</span>
        ) : (
          card.description && <span className={classes.description} data-slot="description">{card.description}</span>
        )}
        {status === "error" && <span className={classes.error} data-slot="error" role="status">{ko ? "미리보기를 불러오지 못했습니다" : "Preview unavailable"}</span>}
        <span className={classes.meta} data-slot="meta">
          {card.favicon ? <img className={classes.favicon} src={card.favicon} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" /> : <span className={classes.favicon} data-icon={card.icon} aria-hidden="true" />}
          {card.siteName || card.domain}
        </span>
      </span>
      {card.image && <img className={classes.thumbnail} src={card.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </a>
  );
}
