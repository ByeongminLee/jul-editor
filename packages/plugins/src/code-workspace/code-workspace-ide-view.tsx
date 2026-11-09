"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import type { HighlightRange, Json } from "@jul-editor/core";
import { createLowlightHighlighter } from "../code/highlighter.js";
import type { PluginViewProps } from "../view-props.js";
import { lineChange, readCodeWorkspaceFiles, setLineChange, setMarkedLines, type CodeWorkspaceFile } from "./block.js";
import { indentCodeText } from "./code-indent.js";
import { inferLanguage, moveWorkspaceEntry, parseLineRanges, remapWorkspacePath, validWorkspacePath } from "./workspace-paths.js";

const DRAG_TYPE = "application/x-jul-editor-workspace-path";
const highlighter = /* @__PURE__ */ createLowlightHighlighter();
const IDE_CSS = `
[data-jul-editor-plugin="code-workspace-ide"] * { box-sizing: border-box; }
[data-jul-editor-plugin="code-workspace-ide"] button { font: inherit; color: var(--jul-editor-code-fg); background: transparent; border: 0; border-radius: 4px; padding: 3px 5px; cursor: pointer; }
[data-jul-editor-plugin="code-workspace-ide"] button:hover { background: var(--jul-editor-code-border); }
[data-jul-editor-plugin="code-workspace-ide"] button:focus-visible,
[data-jul-editor-plugin="code-workspace-ide"] input:focus-visible,
[data-jul-editor-plugin="code-workspace-ide"] textarea:focus-visible { outline: 1px solid var(--jul-editor-code-accent); outline-offset: 1px; }
[data-jul-editor-plugin="code-workspace-ide"] button[aria-current="page"],
[data-jul-editor-plugin="code-workspace-ide"] [role="tab"][aria-selected="true"] { color: var(--jul-editor-code-accent); background: var(--jul-editor-code-sidebar); }
[data-jul-editor-plugin="code-workspace-ide"] [role="tab"] { border-radius: 0; border-right: 1px solid var(--jul-editor-code-border); padding: 6px 10px; }
[data-jul-editor-plugin="code-workspace-ide"] input:not([type="checkbox"]) { font: inherit; color: var(--jul-editor-code-fg); background: var(--jul-editor-code-bg); border: 1px solid var(--jul-editor-code-border); border-radius: 4px; padding: 3px 5px; min-width: 0; }
[data-jul-editor-plugin="code-workspace-ide"] input[type="checkbox"] { accent-color: var(--jul-editor-code-accent); }
/* Zero specificity so a host can override: resets host inline-code styling (background, padding) that would paint stray boxes around the block-level preview lines. */
:where([data-jul-editor-code-preview] > code) { display: block; padding: 0; background: none; border: 0; border-radius: 0; font: inherit; color: inherit; }
/* The gutter and the code are two scroll containers, so the band is painted by two row elements that must line up exactly: the same 20px height, the same tint, and no uncolored strip between them. Gutter rows bleed over the gutter padding (-8px, see the inline style) to its left and right edges; code rows bleed over the pre padding (-10px) to the pane edges. The code pane starts right where the gutter ends, so together they cover the row from the left edge of the gutter to the right edge of the pane. */
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-gutter] [data-change="added"] { background: color-mix(in srgb, var(--jul-editor-code-added) 12%, transparent); }
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-gutter] [data-change="deleted"] { background: color-mix(in srgb, var(--jul-editor-code-removed) 12%, transparent); }
/* Full-row tint: the code area gets the same tint as the gutter. The code element is as wide as the longest line (min 100% of the pane) and each row bleeds over the pane padding, so the band reaches the right edge for short lines and stays put while scrolled horizontally. The rows live inside the scrolling preview, so they follow scroll, wrap-off layout and font size with no JS sync, and the textarea above them is untouched. */
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-preview] > code { min-width: 100%; width: max-content; }
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-preview] [data-change] { margin: 0 -10px; padding: 0 10px; }
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-preview] [data-change="added"] { background: color-mix(in srgb, var(--jul-editor-code-added) 12%, transparent); }
[data-jul-editor-plugin="code-workspace-ide"] [data-jul-editor-code-preview] [data-change="deleted"] { background: color-mix(in srgb, var(--jul-editor-code-removed) 12%, transparent); }
@media (max-width: 600px) { [data-jul-editor-plugin="code-workspace-ide"] { grid-template-columns: 1fr !important; } [data-jul-editor-plugin="code-workspace-ide"] aside { max-height: 180px; overflow: auto; border-right: 0 !important; border-bottom: 1px solid var(--jul-editor-code-border); } }
`;

export interface CodeWorkspaceIDETheme {
  background: string;
  sidebar: string;
  panel: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  added: string;
  removed: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
  type: string;
  function: string;
}

export interface CodeWorkspaceIDEClassNames {
  container?: string;
  tree?: string;
  tabs?: string;
  tab?: string;
  toolbar?: string;
  panel?: string;
  gutter?: string;
  code?: string;
  input?: string;
}

export interface CodeWorkspaceIDEViewProps extends PluginViewProps {
  className?: string | CodeWorkspaceIDEClassNames;
  theme?: Partial<CodeWorkspaceIDETheme>;
  defaultOpenPaths?: string[];
  defaultActivePath?: string;
}

const DARK: CodeWorkspaceIDETheme = {
  background: "#0d1117", sidebar: "#111820", panel: "#0d1117", foreground: "#d5dee8",
  muted: "#83909e", border: "#26313d", accent: "#ee9b51", added: "#5ebf85", removed: "#e27979",
  keyword: "#c792ea", string: "#c3e88d", comment: "#718096", number: "#f78c6c", type: "#82aaff", function: "#82aaff",
};

function highlightedLine(line: string, start: number, ranges: HighlightRange[]): ReactNode[] {
  const end = start + line.length;
  const relevant = ranges.filter((range) => range.from < end && range.to > start);
  const cuts = [0, line.length, ...relevant.flatMap((range) => [Math.max(0, range.from - start), Math.min(line.length, range.to - start)])];
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((from, index) => {
    const to = sorted[index + 1]!;
    const token = relevant.filter((range) => range.from <= start + from && range.to >= start + to)
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]?.token;
    return <span key={from} data-jul-editor-token={token} style={token ? { color: `var(--jul-editor-code-token-${token}, var(--jul-editor-code-fg))` } : undefined}>{line.slice(from, to)}</span>;
  });
}

function RangeInput({ label, lines, maxLine, onValid, onInvalid }: { label: string; lines?: number[]; maxLine: number; onValid: (lines: number[]) => void; onInvalid: () => void }): ReactNode {
  const value = lines?.join(", ") ?? "";
  const [draft, setDraft] = useState(value);
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (value !== emitted.current) setDraft(value);
    emitted.current = null;
  }, [value]);
  return <input aria-label={label} value={draft} placeholder="3-7, 11" onChange={(event) => {
    setDraft(event.target.value);
    const parsed = parseLineRanges(event.target.value, maxLine);
    if (parsed) { emitted.current = parsed.join(", "); onValid(parsed); }
    else onInvalid();
  }} style={{ width: 100, background: "var(--jul-editor-code-bg)", color: "var(--jul-editor-code-fg)", border: "1px solid var(--jul-editor-code-border)", borderRadius: 4, font: "inherit" }} />;
}

interface Folder {
  path: string;
  folders: Map<string, Folder>;
  files: CodeWorkspaceFile[];
}

function fileTree(files: CodeWorkspaceFile[], folders: string[]): Folder {
  const root: Folder = { path: "", folders: new Map(), files: [] };
  function folderAt(path: string): Folder {
    let current = root;
    for (const part of path.split("/").filter(Boolean)) {
      const nextPath = current.path ? `${current.path}/${part}` : part;
      let next = current.folders.get(part);
      if (!next) current.folders.set(part, (next = { path: nextPath, folders: new Map(), files: [] }));
      current = next;
    }
    return current;
  }
  for (const path of folders) folderAt(path);
  for (const file of files) folderAt(file.path.split("/").slice(0, -1).join("/")).files.push(file);
  return root;
}

/** A second, self-styled renderer for the same serializable codeWorkspace block. */
export function CodeWorkspaceIDEView({ block, selected, readOnly, updateProps, locale = "en", theme, className, defaultOpenPaths, defaultActivePath }: CodeWorkspaceIDEViewProps): ReactNode {
  const files = readCodeWorkspaceFiles(block.props);
  const folders = Array.isArray(block.props.folders) ? block.props.folders.filter((path): path is string => typeof path === "string") : [];
  const pinnedPaths = Array.isArray(block.props.pinnedPaths) ? block.props.pinnedPaths.filter((path): path is string => typeof path === "string") : [];
  const paths = files.map((file) => file.path);
  const [openPaths, setOpenPaths] = useState<string[]>(() => [...new Set([...(defaultOpenPaths ?? []), ...pinnedPaths, files[0]?.path ?? ""])].filter(Boolean));
  const [activePath, setActivePath] = useState(() => defaultActivePath && paths.includes(defaultActivePath) ? defaultActivePath : files[0]?.path ?? "");
  const [creating, setCreating] = useState<{ kind: "folder" | "file"; parent: string } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState("");
  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  const tabs = [...new Set([...openPaths.filter((path) => paths.includes(path)), ...pinnedPaths.filter((path) => paths.includes(path)), activeFile?.path ?? ""])].filter(Boolean);
  const panelId = useId();
  // Edit controls only while the block is selected (same rule as ChartView and CodeWorkspaceView).
  // The editor clears a block selection when focus leaves it, and interacting with the controls
  // keeps focus inside the block, so no local "armed" state is needed.
  const editable = !!selected && !readOnly && !!updateProps;
  const asideRef = useRef<HTMLElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusPathRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  // the selection a Tab/Shift-Tab indent should leave behind once the
  // controlled textarea re-renders with the new value (React resets the
  // caret to the end when `value` changes under it).
  const pendingCodeSelection = useRef<{ value: string; start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingCodeSelection.current;
    const textarea = codeRef.current;
    if (!pending || !textarea || textarea.value !== pending.value) return;
    pendingCodeSelection.current = null;
    textarea.setSelectionRange(pending.start, pending.end);
  });
  const [highlight, setHighlight] = useState<{ code: string; language: string; ranges: HighlightRange[] } | null>(null);
  useLayoutEffect(() => {
    if (creating || renaming) return;
    const path = focusPathRef.current;
    if (path) {
      const target = [...(asideRef.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])]
        .find((button) => button.getAttribute("aria-label") === path);
      if (target) { target.focus(); focusPathRef.current = null; createTriggerRef.current = null; }
      return;
    }
    if (createTriggerRef.current?.isConnected) createTriggerRef.current.focus();
    createTriggerRef.current = null;
  }, [creating, renaming, files, folders]);
  useEffect(() => {
    if (!activeFile) return;
    let live = true;
    void Promise.resolve(highlighter.highlight(activeFile.code, activeFile.language)).then((ranges) => {
      if (live) setHighlight({ code: activeFile.code, language: activeFile.language, ranges });
    }).catch(() => { if (live) setHighlight({ code: activeFile.code, language: activeFile.language, ranges: [] }); });
    return () => { live = false; };
  }, [activeFile?.code, activeFile?.language]);
  const ranges = activeFile && highlight && highlight.code === activeFile.code && highlight.language === activeFile.language ? highlight.ranges : [];
  const codeLines = activeFile?.code.split("\n") ?? [];
  let lineStart = 0;
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const colors = { ...DARK, ...theme };
  const style = {
    "--jul-editor-code-bg": colors.background, "--jul-editor-code-sidebar": colors.sidebar,
    "--jul-editor-code-panel": colors.panel, "--jul-editor-code-fg": colors.foreground,
    "--jul-editor-code-muted": colors.muted, "--jul-editor-code-border": colors.border,
    "--jul-editor-code-accent": colors.accent, "--jul-editor-code-added": colors.added,
    "--jul-editor-code-removed": colors.removed,
    "--jul-editor-code-token-keyword": colors.keyword, "--jul-editor-code-token-string": colors.string,
    "--jul-editor-code-token-comment": colors.comment, "--jul-editor-code-token-number": colors.number,
    "--jul-editor-code-token-type": colors.type, "--jul-editor-code-token-function": colors.function,
    display: "grid", gridTemplateColumns: "minmax(205px, 26%) minmax(0, 1fr)", minHeight: 320,
    background: "var(--jul-editor-code-bg)", color: "var(--jul-editor-code-fg)",
    border: "1px solid var(--jul-editor-code-border)", borderRadius: classes.container ? undefined : 10,
    font: classes.container ? undefined : "12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace", overflow: "hidden",
  } as CSSProperties;

  function openFile(path: string): void {
    setOpenPaths((current) => current.includes(path) ? current : [...current.filter((item) => paths.includes(item)), path]);
    setActivePath(path);
  }

  function updateFile(patch: Partial<CodeWorkspaceFile>): void {
    if (!activeFile || !editable) return;
    updateProps({ files: files.map((file) => file.path === activeFile.path ? { ...file, ...patch } : file) as unknown as Json });
  }

  function toggleLine(kind: "addedLines" | "removedLines", line: number): void {
    if (!activeFile || !editable) return;
    const target = kind === "addedLines" ? "added" : "deleted";
    updateFile(setLineChange(activeFile, line, lineChange(activeFile, line) === target ? undefined : target));
  }

  function beginCreate(kind: "folder" | "file", parent = "", trigger?: HTMLButtonElement): void {
    createTriggerRef.current = trigger ?? null;
    focusPathRef.current = null;
    setCreating({ kind, parent });
    setNameDraft("");
    setError("");
  }

  function commitCreate(): void {
    if (!creating || !editable) return;
    const name = nameDraft.trim();
    const path = creating.parent ? `${creating.parent}/${name}` : name;
    const allFolders = new Set(folders);
    for (const folder of folders) {
      const parts = folder.split("/");
      for (let count = 1; count < parts.length; count++) allFolders.add(parts.slice(0, count).join("/"));
    }
    for (const file of files) {
      const parts = file.path.split("/");
      for (let count = 1; count < parts.length; count++) allFolders.add(parts.slice(0, count).join("/"));
    }
    if (!name || name.includes("/") || !validWorkspacePath(path) || paths.includes(path) || allFolders.has(path)) {
      setError("Name is empty or already in use.");
      return;
    }
    focusPathRef.current = path;
    if (creating.kind === "folder") updateProps?.({ folders: [...folders, path] });
    else {
      updateProps?.({ files: [...files, { path, language: inferLanguage(path), code: "" }] as unknown as Json });
      openFile(path);
    }
    setCreating(null);
    setError("");
  }

  function creationInput(parent: string): ReactNode {
    if (!creating || creating.parent !== parent) return null;
    return <input autoFocus aria-label={creating.kind === "folder" ? "New folder name" : "New file name"} value={nameDraft}
      onChange={(event) => setNameDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commitCreate(); }
        if (event.key === "Escape") setCreating(null);
      }} />;
  }

  function togglePin(path: string): void {
    if (!editable) return;
    const next = pinnedPaths.includes(path) ? pinnedPaths.filter((item) => item !== path) : [...pinnedPaths, path];
    updateProps?.({ pinnedPaths: next });
    if (next.includes(path)) openFile(path);
  }

  function beginRename(path: string): void {
    if (!editable) return;
    createTriggerRef.current = null;
    focusPathRef.current = path;
    setRenaming(path);
    setRenameDraft(path.split("/").at(-1) ?? path);
    setError("");
  }

  function moveEntry(from: string, to: string): boolean {
    if (!editable) return false;
    const moved = moveWorkspaceEntry(files, folders, from, to);
    if (!moved) { setError("That path is already in use or cannot be moved there."); return false; }
    const sourceFile = files.find((file) => file.path === from);
    const nextFiles = sourceFile
      ? moved.files.map((file) => file.path === to ? { ...file, language: inferLanguage(to) } : file)
      : moved.files;
    const remap = (path: string) => remapWorkspacePath(path, from, to);
    updateProps?.({ files: nextFiles as unknown as Json, folders: moved.folders, pinnedPaths: pinnedPaths.map(remap) });
    setOpenPaths((current) => current.map(remap));
    setActivePath((current) => remap(current));
    setError("");
    return true;
  }

  function commitRename(): void {
    if (!renaming) return;
    const name = renameDraft.trim();
    const parent = renaming.split("/").slice(0, -1).join("/");
    if (!name || name.includes("/") || name === "." || name === "..") { setError("Enter a valid name."); return; }
    const nextPath = parent ? `${parent}/${name}` : name;
    if (moveEntry(renaming, nextPath)) { focusPathRef.current = nextPath; setRenaming(null); }
  }

  function renameInput(path: string): ReactNode {
    return renaming === path && <input autoFocus aria-label={`Rename ${path}`} value={renameDraft}
      onChange={(event) => setRenameDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commitRename(); }
        if (event.key === "Escape") setRenaming(null);
      }} />;
  }

  function dragTo(event: DragEvent, targetFolder: string): void {
    event.preventDefault();
    event.stopPropagation();
    const from = event.dataTransfer.getData(DRAG_TYPE);
    if (!from) return;
    const name = from.split("/").at(-1) ?? from;
    moveEntry(from, targetFolder ? `${targetFolder}/${name}` : name);
  }

  function renderFolder(folder: Folder): ReactNode {
    return <ul style={{ listStyle: "none", margin: 0, paddingLeft: folder.path ? 12 : 0 }}>
      {[...folder.folders].map(([name, child]) => <li key={child.path}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
          {renaming === child.path ? renameInput(child.path) : <button type="button" aria-label={child.path} draggable={editable}
            onDoubleClick={() => beginRename(child.path)} onKeyDown={(event) => { if (event.key === "F2") beginRename(child.path); }}
            onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_TYPE, child.path); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => dragTo(event, child.path)}
            style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</button>}
          {editable && <><button type="button" aria-label={`New folder in ${child.path}`} title={`New folder in ${child.path}`} onClick={(event) => beginCreate("folder", child.path, event.currentTarget)} style={{ flex: "0 0 22px", padding: 1 }}>▣</button><button type="button" aria-label={`New file in ${child.path}`} title={`New file in ${child.path}`} onClick={(event) => beginCreate("file", child.path, event.currentTarget)} style={{ flex: "0 0 22px", padding: 1 }}>＋</button></>}
        </div>
        {creationInput(child.path)}{renderFolder(child)}
      </li>)}
      {folder.files.map((file) => <li key={file.path} style={{ display: "flex", alignItems: "center" }}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        {renaming === file.path ? renameInput(file.path) : <button type="button" aria-label={file.path} aria-current={file.path === activeFile?.path ? "page" : undefined} onClick={() => openFile(file.path)}
          onDoubleClick={() => beginRename(file.path)} onKeyDown={(event) => { if (event.key === "F2") beginRename(file.path); }} draggable={editable}
          onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_TYPE, file.path); event.dataTransfer.effectAllowed = "move"; }}
          style={{ flex: 1, textAlign: "left" }}>{file.path.split("/").at(-1)}</button>}
        {editable && <input type="checkbox" aria-label={`Pin ${file.path}`} checked={pinnedPaths.includes(file.path)} onChange={() => togglePin(file.path)} style={{ marginLeft: "auto" }} />}
      </li>)}
    </ul>;
  }

  return <section className={classes.container} data-jul-editor-plugin="code-workspace-ide" aria-label={locale === "ko" ? "코드 작업 공간" : "Code Workspace"} style={style}>
    <style>{IDE_CSS}</style>
    <aside className={classes.tree} ref={asideRef} aria-label={locale === "ko" ? "파일" : "Files"} style={{ background: "var(--jul-editor-code-sidebar)", borderRight: "1px solid var(--jul-editor-code-border)", padding: 10, minWidth: 0 }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); } }}
      onDrop={(event) => dragTo(event, "")}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, whiteSpace: "nowrap" }}>
        <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{locale === "ko" ? "탐색기" : "Explorer"}</strong>
        {editable && <><button type="button" aria-label="New folder" title={locale === "ko" ? "새 폴더" : "New folder"} onClick={(event) => beginCreate("folder", "", event.currentTarget)} style={{ flex: "0 0 26px", padding: 2 }}>▣</button><button type="button" aria-label="New file" title={locale === "ko" ? "새 파일" : "New file"} onClick={(event) => beginCreate("file", "", event.currentTarget)} style={{ flex: "0 0 26px", padding: 2 }}>＋</button></>}
      </div>
      {creationInput("")}
      {error && <p role="alert">{error}</p>}
      {renderFolder(fileTree(files, folders))}
    </aside>
    <div style={{ minWidth: 0, background: "var(--jul-editor-code-panel)" }}>
      <div className={classes.tabs} role="tablist" aria-label={locale === "ko" ? "열린 파일" : "Open files"} style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--jul-editor-code-border)" }}>
        {tabs.map((path, index) => <button className={classes.tab} key={path} id={`${panelId}-tab-${index}`} type="button" role="tab" aria-label={path} aria-selected={path === activeFile?.path} aria-controls={`${panelId}-panel`} onClick={() => openFile(path)}>{path.split("/").at(-1)}</button>)}
      </div>
      {activeFile && <div className={classes.toolbar} data-jul-editor-code-toolbar style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "5px 10px", padding: "6px 10px", borderBottom: "1px solid var(--jul-editor-code-border)", color: "var(--jul-editor-code-muted)", minWidth: 0 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={activeFile.path}>{activeFile.path}</span>
        <span>{activeFile.language}</span>
        {editable && <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px 12px" }}>
          <label style={{ whiteSpace: "nowrap" }}>{locale === "ko" ? "추가" : "Added"} <RangeInput key={`added-${activeFile.path}`} label="Added line ranges" lines={activeFile.addedLines} maxLine={codeLines.length} onValid={(addedLines) => { setError(""); updateFile(setMarkedLines(activeFile, "addedLines", addedLines)); }} onInvalid={() => setError("Invalid line range.")} /></label>
          <label style={{ whiteSpace: "nowrap" }}>{locale === "ko" ? "삭제" : "Deleted"} <RangeInput key={`removed-${activeFile.path}`} label="Deleted line ranges" lines={activeFile.removedLines} maxLine={codeLines.length} onValid={(removedLines) => { setError(""); updateFile(setMarkedLines(activeFile, "removedLines", removedLines)); }} onInvalid={() => setError("Invalid line range.")} /></label>
        </div>}
      </div>}
      <div className={classes.panel} id={`${panelId}-panel`} role="tabpanel" aria-labelledby={activeFile ? `${panelId}-tab-${tabs.indexOf(activeFile.path)}` : undefined} style={{ display: "flex", minHeight: 280, height: 320, overflow: "hidden" }}>
        {activeFile ? <>
          <div className={classes.gutter} ref={gutterRef} data-jul-editor-code-gutter style={{ flex: editable ? "0 0 92px" : "0 0 64px", color: "var(--jul-editor-code-muted)", padding: "10px 8px", overflow: "hidden" }}>
            {codeLines.map((_, index) => {
              const line = index + 1;
              const change = lineChange(activeFile, line);
              const added = change === "added";
              const removed = change === "deleted";
              // In edit mode both toggles are always visible on every row; the active one is colored and bold, the inactive one is muted.
              const markerStyle = (active: boolean, color: string) => ({ color: active ? color : "var(--jul-editor-code-muted)", fontWeight: active ? 700 : 400, width: 18, padding: 0, lineHeight: "18px", opacity: 1 });
              return <div key={line} data-jul-editor-code-line={line} data-change={change} style={{ height: 20, minHeight: 0, margin: "0 -8px", padding: "0 8px", display: "grid", gridTemplateColumns: editable ? "18px 18px minmax(0, 1fr)" : "14px minmax(0, 1fr)", columnGap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
                {editable && <><button type="button" data-jul-editor-code-marker="added" aria-label={`Mark line ${line} added`} aria-pressed={added} onClick={() => toggleLine("addedLines", line)} style={markerStyle(added, "var(--jul-editor-code-added)")}>+</button><button type="button" data-jul-editor-code-marker="deleted" aria-label={`Mark line ${line} deleted`} aria-pressed={removed} onClick={() => toggleLine("removedLines", line)} style={markerStyle(removed, "var(--jul-editor-code-removed)")}>−</button></>}
                {/* Read-only gutters have no toggles, so changed lines get a static +/- marker like a diff view. */}
                {/* The marker column is reserved on every row (empty when unchanged) so the number never moves; the number column is fixed-width and right-aligned. */}
                {!editable && (added || removed ? <span data-jul-editor-code-change-marker={change} aria-hidden="true" style={{ color: added ? "var(--jul-editor-code-added)" : "var(--jul-editor-code-removed)", textAlign: "center" }}>{added ? "+" : "\u2212"}</span> : <span aria-hidden="true" />)}
                <span data-jul-editor-code-number style={{ textAlign: "right" }}>{line}</span>
              </div>;
            })}
          </div>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <pre className={classes.code} ref={previewRef} aria-hidden={editable || undefined} data-jul-editor-code-preview
              onScroll={(event) => { if (!editable && gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
              style={{ position: "absolute", inset: 0, overflow: editable ? "hidden" : "auto", margin: 0, padding: 10, font: classes.code ? undefined : "inherit", lineHeight: "20px", whiteSpace: "pre", pointerEvents: editable ? "none" : "auto" }}>
              <code>{codeLines.map((line, index) => {
                const content = highlightedLine(line, lineStart, ranges);
                lineStart += line.length + 1;
                return <span key={index} data-jul-editor-code-row={index + 1} data-change={lineChange(activeFile, index + 1)} style={{ display: "block", height: 20 }}>{content.length ? content : " "}</span>;
              })}</code>
            </pre>
            {editable && <textarea className={[classes.code, classes.input].filter(Boolean).join(" ") || undefined} aria-label={locale === "ko" ? "코드" : "Code"} value={activeFile.code} spellCheck={false} wrap="off"
              ref={codeRef}
              onChange={(event) => updateFile({ code: event.target.value })}
              onKeyDown={(event) => {
                // Home / End move the caret to the line's start / end, as in a code editor. Left to the
                // browser, macOS treats them as "scroll to the top / bottom", and inside the editable
                // document that scrolls the whole page while the caret stays put.
                if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey && !event.altKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  const textarea = event.currentTarget;
                  const caret = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
                  const next = event.key === "Home" ? textarea.value.lastIndexOf("\n", caret - 1) + 1 : ((end) => (end < 0 ? textarea.value.length : end))(textarea.value.indexOf("\n", caret));
                  if (event.shiftKey) {
                    const fixed = textarea.selectionDirection === "backward" ? textarea.selectionEnd : textarea.selectionStart;
                    textarea.setSelectionRange(Math.min(fixed, next), Math.max(fixed, next), next < fixed ? "backward" : "forward");
                  } else textarea.setSelectionRange(next, next);
                  return;
                }
                // Tab indents the code instead of moving focus out of the editor (the browser default).
                if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
                event.preventDefault();
                event.stopPropagation();
                const textarea = event.currentTarget;
                const result = indentCodeText(textarea.value, textarea.selectionStart, textarea.selectionEnd, event.shiftKey ? -1 : 1);
                if (!result) return;
                pendingCodeSelection.current = result;
                updateFile({ code: result.value });
              }}
              onScroll={(event) => { if (previewRef.current) { previewRef.current.scrollTop = event.currentTarget.scrollTop; previewRef.current.scrollLeft = event.currentTarget.scrollLeft; } if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", boxSizing: "border-box", resize: "none", padding: 10, border: 0, background: "transparent", color: "transparent", WebkitTextFillColor: "transparent", caretColor: "var(--jul-editor-code-accent)", font: classes.code || classes.input ? undefined : "inherit", lineHeight: "20px", whiteSpace: "pre", overflow: "auto" }} />}
          </div>
        </> : <p>{locale === "ko" ? "아직 파일이 없습니다" : "No files yet"}</p>}
      </div>
    </div>
  </section>;
}
