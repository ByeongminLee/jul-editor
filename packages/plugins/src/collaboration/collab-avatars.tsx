"use client";

// Notion-style presence avatars for a page header: the people currently in the
// document as overlapping circles with their color ring, "+N" overflow, idle
// users dimmed. Headless-ish: inline styles read CSS variables, and every part
// has a data attribute / classNames slot so a host can restyle freely.
//
//   --jul-collab-avatar-size   (28px)
//   --jul-collab-avatar-ring   (2px)
//   --jul-collab-avatar-overlap (-8px)

import type { CSSProperties, ReactNode } from "react";
import type { CollabPeer, CollabUser } from "./types.js";

export interface CollabAvatarsProps {
  /** Remote participants (from useCollaboration). */
  peers: CollabPeer[];
  /** Also show the local user first (default: not shown, like Notion). */
  self?: CollabUser;
  /** Avatars shown before collapsing into "+N" (default 4). */
  max?: number;
  className?: string;
  classNames?: Partial<Record<"root" | "avatar" | "overflow", string>>;
  style?: CSSProperties;
  /** Replace the inside of one avatar (default: photo or initials). */
  renderAvatar?: (user: CollabUser, peer: CollabPeer | null) => ReactNode;
  onAvatarClick?: (peer: CollabPeer) => void;
  /** Accessible name of the group, e.g. for i18n (default "People in this document"). */
  label?: string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0]!)[0] ?? "?";
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + second).toUpperCase();
}

const circle: CSSProperties = {
  width: "var(--jul-collab-avatar-size, 28px)",
  height: "var(--jul-collab-avatar-size, 28px)",
  borderRadius: "50%",
  boxSizing: "border-box",
  marginLeft: "var(--jul-collab-avatar-overlap, -8px)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  font: "600 11px/1 system-ui, sans-serif",
  color: "#fff",
  border: "var(--jul-collab-avatar-ring, 2px) solid transparent",
  flex: "none",
};

export function CollabAvatars({ peers, self, max = 4, className, classNames, style, renderAvatar, onAvatarClick, label = "People in this document" }: CollabAvatarsProps) {
  const entries: { user: CollabUser; peer: CollabPeer | null; key: string }[] = [
    ...(self ? [{ user: self, peer: null, key: `self:${self.id}` }] : []),
    ...peers.map((peer) => ({ user: peer.user, peer, key: peer.clientId })),
  ];
  const shown = entries.slice(0, Math.max(0, max));
  const hidden = entries.slice(shown.length);
  const rootClass = [className, classNames?.root].filter(Boolean).join(" ") || undefined;
  return (
    <div role="list" aria-label={label} data-jul-collab-avatars="" className={rootClass} style={{ display: "inline-flex", alignItems: "center", paddingLeft: "calc(var(--jul-collab-avatar-overlap, -8px) * -1)", ...style }}>
      {shown.map(({ user, peer, key }) => {
        const idle = peer?.status === "idle";
        const body = renderAvatar ? (
          renderAvatar(user, peer)
        ) : user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initialsOf(user.name)
        );
        const common = {
          role: "listitem" as const,
          title: peer ? user.name : `${user.name} (you)`,
          "aria-label": user.name,
          "data-jul-collab-avatar": user.id,
          "data-status": peer ? peer.status : "self",
          className: classNames?.avatar,
          style: { ...circle, background: user.color, borderColor: user.color, opacity: idle ? 0.5 : 1, ...(onAvatarClick && peer ? { cursor: "pointer" } : null) } as CSSProperties,
        };
        return peer && onAvatarClick ? (
          <button type="button" key={key} {...common} onClick={() => onAvatarClick(peer)} style={{ ...common.style, padding: 0 }}>
            {body}
          </button>
        ) : (
          <span key={key} {...common}>
            {body}
          </span>
        );
      })}
      {hidden.length > 0 && (
        <span role="listitem" data-jul-collab-overflow="" title={hidden.map((h) => h.user.name).join(", ")} aria-label={`${hidden.length} more`} className={classNames?.overflow} style={{ ...circle, background: "var(--jul-collab-overflow-bg, #6b7280)", borderColor: "var(--jul-collab-overflow-bg, #6b7280)" }}>
          +{hidden.length}
        </span>
      )}
    </div>
  );
}
