import { defineBlock, newId, sanitizeUrl, type Block } from "@jul-editor/core";
import { useCallback, useSyncExternalStore } from "react";
import type { VoidRendererProps } from "../context.js";

/** Opt in with Editor.Plugin blocks={[attachmentBlock]} renderers={{attachment: AttachmentView}}. */
export const attachmentBlock = defineBlock({
  type: "attachment", content: "none", children: "none",
  props: {src: "", name: "", mimeType: "", size: 0, assetId: null},
  toMarkdown(block) { return "```jul-editor-attachment\n" + encodeURIComponent(JSON.stringify({...block.props, src: sanitizeUrl(String(block.props.src ?? ""), "image") ?? ""})) + "\n```"; },
  fromMarkdown: {fence: "jul-editor-attachment", parse(token) { return parseAttachment(token.text); }},
  toHTML(block, ctx) {
    const src = ctx.sanitizeUrl(String(block.props.src ?? ""), "image") ?? "";
    return '<a data-jul-editor-attachment="' + ctx.escapeAttr(encodeURIComponent(JSON.stringify({...block.props, src}))) + '" href="' + ctx.escapeAttr(src) + '">' + ctx.escapeText(String(block.props.name ?? "")) + '</a>';
  },
  fromHTML: {selector: "[data-jul-editor-attachment]", parse(el) { return parseAttachment(el.getAttribute("data-jul-editor-attachment") ?? ""); }},
  toText(block) { return String(block.props.name ?? ""); },
});
function parseAttachment(encoded: string): Block | null {
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(encoded.trim()));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    return {id: newId(), type: "attachment", props: {
      src: typeof p.src === "string" ? sanitizeUrl(p.src, "image") ?? "" : "",
      name: typeof p.name === "string" ? p.name : "",
      mimeType: typeof p.mimeType === "string" ? p.mimeType : "",
      size: typeof p.size === "number" && Number.isFinite(p.size) && p.size >= 0 ? p.size : 0,
      assetId: typeof p.assetId === "string" ? p.assetId : null,
    }};
  } catch { return null; }
}
export function createAttachmentBlock(file: File): Block {
  return {id: newId(), type: "attachment", props: {src: "", name: file.name, mimeType: file.type, size: file.size}};
}
export function AttachmentView({block, editor, selected, updateProps, locale = "en"}: VoidRendererProps) {
  const subscribe = useCallback((listener: () => void) => editor.onUpload(id => {if (id === block.id) listener();}), [editor, block.id]);
  const snapshot = useCallback(() => editor.getUploadState(block.id), [editor, block.id]);
  const upload = useSyncExternalStore(subscribe, snapshot, snapshot);
  const src = sanitizeUrl(String(block.props.src ?? ""), "image");
  const ko = locale === "ko";
  const name = String(block.props.name || (ko ? "첨부파일" : "Attachment"));
  return <figure data-jul-editor-attachment data-state={upload?.status ?? "ready"}>
    {src ? <a href={src} target="_blank" rel="noopener noreferrer" download>{name}</a> : <span>{name}</span>}
    <small>{String(block.props.mimeType ?? "")} · {Number(block.props.size ?? 0).toLocaleString()} B</small>
    {upload && <span role="status">{upload.status === "queued" ? (ko ? "업로드 대기" : "Pending upload") : upload.status === "uploading" ? (ko ? "업로드 중…" : "Uploading…") : (ko ? "업로드 실패" : "Upload failed")}</span>}
    {upload?.status === "error" && <button type="button" onClick={() => editor.retryUpload(block.id)}>{ko ? "다시 시도" : "Retry"}</button>}
    {selected && <label>{ko ? "파일 URL" : "File URL"}<input key={String(block.props.src ?? "")} defaultValue={String(block.props.src ?? "")} onBlur={e => updateProps({src: sanitizeUrl(e.target.value, "image") ?? ""})}/></label>}
  </figure>;
}
