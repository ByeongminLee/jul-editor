"use client";

import { useEffect, useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { HighlightRange, Json } from "@jul-editor/core";
import { createLowlightHighlighter } from "../code/highlighter.js";
import { usePluginControls, type PluginViewProps } from "../view-props.js";
import { moveWorkspaceEntry } from "./workspace-paths.js";
import { lineChange, readCodeWorkspaceFiles, setMarkedLines, type CodeWorkspaceFile } from "./block.js";

const highlighter = /* @__PURE__ */ createLowlightHighlighter();

const UI = {
  en: {
    workspace: "Code Workspace", openFiles: "Open files", files: "Files", empty: "No files yet",
    settings: "Code Workspace settings", title: "Title", tree: "File tree", tabs: "Tabs",
    lineNumbers: "Line numbers", addFile: "Add file", removeFile: "Remove file",
    filePath: "File path", language: "Language", code: "Code",
    addedLines: "Added lines", deletedLines: "Deleted lines",
  },
  ko: {
    workspace: "코드 작업 공간", openFiles: "열린 파일", files: "파일", empty: "아직 파일이 없습니다",
    settings: "코드 작업 공간 설정", title: "제목", tree: "파일 트리", tabs: "탭",
    lineNumbers: "줄 번호", addFile: "파일 추가", removeFile: "파일 삭제",
    filePath: "파일 경로", language: "언어", code: "코드",
    addedLines: "추가된 줄", deletedLines: "삭제된 줄",
  },
} as const;

interface Folder {
  folders: Map<string, Folder>;
  files: CodeWorkspaceFile[];
}

function fileTree(files: CodeWorkspaceFile[]): Folder {
  const root: Folder = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let child = folder.folders.get(part);
      if (!child) folder.folders.set(part, (child = { folders: new Map(), files: [] }));
      folder = child;
    }
    folder.files.push(file);
  }
  return root;
}

function lineList(text: string): number[] {
  return [...new Set(text.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

function LineMarkerInput({ lines, onChange }: { lines?: number[]; onChange: (lines: number[]) => void }): ReactNode {
  const value = lines?.join(", ") ?? "";
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input value={draft} onChange={(event) => {
    setDraft(event.target.value);
    onChange(lineList(event.target.value));
  }} />;
}

function highlightedLine(line: string, start: number, ranges: HighlightRange[]): ReactNode[] {
  // Scan ranges per line; index them only if very large files become common.
  const end = start + line.length;
  const relevant = ranges.filter((range) => range.from < end && range.to > start);
  const cuts = [0, line.length, ...relevant.flatMap((range) => [Math.max(0, range.from - start), Math.min(line.length, range.to - start)])];
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((from, index) => {
    const to = sorted[index + 1]!;
    const token = relevant.filter((range) => range.from <= start + from && range.to >= start + to)
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]?.token;
    return <span key={from} data-jul-editor-token={token}>{line.slice(from, to)}</span>;
  });
}

/** Headless renderer: hosts style the tree, tabs, gutter and token attributes. */
export interface CodeWorkspaceViewClassNames {
  container?: string;
  title?: string;
  layout?: string;
  tree?: string;
  tabs?: string;
  tab?: string;
  panel?: string;
  path?: string;
  code?: string;
  line?: string;
  gutter?: string;
  toolbar?: string;
}

export interface CodeWorkspaceViewProps extends PluginViewProps {
  className?: string | CodeWorkspaceViewClassNames;
}

export function CodeWorkspaceView({ block, editor, selected, updateProps, readOnly, locale = "en", className }: CodeWorkspaceViewProps): ReactNode {
  const controls = usePluginControls(editor, selected);
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const ui = UI[locale];
  const files = readCodeWorkspaceFiles(block.props);
  const showTree = block.props.showTree !== false;
  const showLineNumbers = block.props.showLineNumbers !== false;
  const showTabs = block.props.showTabs !== false || !showTree;
  const title = typeof block.props.title === "string" ? block.props.title : "";
  const [openPaths, setOpenPaths] = useState<string[]>(() => files[0] ? [files[0].path] : []);
  const [activePath, setActivePath] = useState(() => files[0]?.path ?? "");
  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  const validOpenPaths = openPaths.filter((path) => files.some((file) => file.path === path));
  const tabs = showTree ? (activeFile && !validOpenPaths.includes(activeFile.path) ? [...validOpenPaths, activeFile.path] : validOpenPaths) : files.map((file) => file.path);
  const activeTab = activeFile?.path ?? "";
  const panelId = useId();
  const [highlight, setHighlight] = useState<{ code: string; language: string; ranges: HighlightRange[] } | null>(null);

  useEffect(() => {
    if (!activeFile) return;
    let live = true;
    void Promise.resolve(highlighter.highlight(activeFile.code, activeFile.language)).then((ranges) => {
      if (live) setHighlight({ code: activeFile.code, language: activeFile.language, ranges });
    }).catch(() => {
      if (live) setHighlight({ code: activeFile.code, language: activeFile.language, ranges: [] });
    });
    return () => { live = false; };
  }, [activeFile?.code, activeFile?.language]);

  function saveFiles(next: CodeWorkspaceFile[], rename?: { from: string; to: string }): void {
    const pins = Array.isArray(block.props.pinnedPaths) ? block.props.pinnedPaths : [];
    const pinnedPaths = pins.map((path) => path === rename?.from ? rename.to : path).filter((path) => next.some((file) => file.path === path));
    if (!readOnly) updateProps?.({ files: next as unknown as Json, ...(block.props.pinnedPaths !== undefined ? { pinnedPaths } : {}) });
  }

  function updateFile(patch: Partial<CodeWorkspaceFile>): void {
    if (!activeFile) return;
    saveFiles(files.map((file) => file.path === activeFile.path ? { ...file, ...patch } : file), patch.path ? { from: activeFile.path, to: patch.path } : undefined);
  }

  function openFile(path: string): void {
    setOpenPaths((current) => current.includes(path) ? current : [...current.filter((item) => files.some((file) => file.path === item)), path]);
    setActivePath(path);
  }

  function addFile(): void {
    const occupied = new Set(files.map((file) => file.path));
    const folders = Array.isArray(block.props.folders) ? block.props.folders.filter((path): path is string => typeof path === "string") : [];
    for (const path of folders) occupied.add(path);
    for (const path of [...occupied]) {
      for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) occupied.add(path.slice(0, slash));
    }
    let path = "untitled.ts";
    for (let n = 2; occupied.has(path); n++) path = `untitled-${n}.ts`;
    saveFiles([...files, { path, language: "ts", code: "" }]);
    openFile(path);
  }

  function removeFile(): void {
    if (!activeFile) return;
    const next = files.filter((file) => file.path !== activeFile.path);
    const fallback = next[0]?.path ?? "";
    saveFiles(next);
    setOpenPaths((current) => {
      const remaining = current.filter((path) => next.some((file) => file.path === path));
      return fallback && !remaining.includes(fallback) ? [...remaining, fallback] : remaining;
    });
    setActivePath(fallback);
  }

  function renameFile(nextPath: string): boolean {
    if (!activeFile) return false;
    const path = nextPath.trim();
    const folders = Array.isArray(block.props.folders) ? block.props.folders.filter((folder): folder is string => typeof folder === "string") : [];
    if (!moveWorkspaceEntry(files, folders, activeFile.path, path)) return false;
    if (path === activeFile.path) return true;
    updateFile({ path });
    setOpenPaths((current) => current.map((item) => item === activeFile.path ? path : item));
    setActivePath(path);
    return true;
  }

  function renderFolder(folder: Folder, prefix = ""): ReactNode {
    return <ul>
      {[...folder.folders].map(([name, child]) => <li key={`${prefix}${name}/`}><details open><summary>{name}</summary>{renderFolder(child, `${prefix}${name}/`)}</details></li>)}
      {folder.files.map((file) => <li key={file.path}><button type="button" aria-label={file.path} aria-current={file.path === activeTab ? "page" : undefined} onClick={() => openFile(file.path)}>{file.path.split("/").filter(Boolean).at(-1) ?? file.path}</button></li>)}
    </ul>;
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, path: string): void {
    const index = tabs.indexOf(path);
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length :
      event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length :
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActivePath(tabs[next]!);
    (event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next] as HTMLElement | undefined)?.focus();
  }

  const ranges = activeFile && highlight && highlight.code === activeFile.code && highlight.language === activeFile.language ? highlight.ranges : [];
  let lineStart = 0;

  return <section className={classes.container} data-jul-editor-plugin="code-workspace" aria-label={title || ui.workspace} onKeyDown={controls.onKeyDown} onPointerDown={controls.onPointerDown}>
    {title && <header className={classes.title} data-jul-editor-code-title>{title}</header>}
    {showTabs && tabs.length > 0 && <div className={classes.tabs} role="tablist" aria-label={ui.openFiles} data-jul-editor-code-tabs>
      {tabs.map((path, index) => <button className={classes.tab} key={path} id={`${panelId}-tab-${index}`} type="button" role="tab" aria-selected={path === activeTab} aria-controls={`${panelId}-panel`} tabIndex={path === activeTab ? 0 : -1} onClick={() => setActivePath(path)} onKeyDown={(event) => onTabKeyDown(event, path)}>{path.split("/").filter(Boolean).at(-1) ?? path}</button>)}
    </div>}
    <div className={classes.layout} data-jul-editor-code-layout>
      {showTree && files.length > 0 && <nav className={classes.tree} aria-label={ui.files} data-jul-editor-code-tree>{renderFolder(fileTree(files))}</nav>}
      <div className={classes.panel} id={`${panelId}-panel`} role={showTabs && tabs.length ? "tabpanel" : undefined} aria-labelledby={showTabs && tabs.length ? `${panelId}-tab-${tabs.indexOf(activeTab)}` : undefined} data-jul-editor-code-panel>
        {activeFile ? <>
          <div className={classes.path} data-jul-editor-code-path>{activeFile.path}</div>
          <div className={classes.code} data-jul-editor-code-viewport>{activeFile.code.split("\n").map((line, index) => {
            const number = index + 1;
            const change = lineChange(activeFile, number);
            const content = highlightedLine(line, lineStart, ranges);
            lineStart += line.length + 1;
            return <div className={classes.line} key={number} data-jul-editor-code-line={number} data-change={change}>
              <span className={classes.gutter} data-jul-editor-code-gutter aria-hidden="true"><span data-jul-editor-code-marker-slot>{change === "added" ? "+" : change === "deleted" ? "−" : ""}</span><span data-jul-editor-code-number>{showLineNumbers ? number : ""}</span></span>
              <code>{content.length ? content : " "}</code>
            </div>;
          })}</div>
        </> : <p data-jul-editor-code-empty>{ui.empty}</p>}
      </div>
    </div>
    {controls.open && !readOnly && updateProps && <fieldset className={classes.toolbar} data-jul-editor-code-controls>
      <legend>{ui.settings}</legend>
      <label>{ui.title} <input value={title} onChange={(event) => updateProps({ title: event.target.value })} /></label>
      <label><input type="checkbox" checked={showTree} onChange={(event) => updateProps({ showTree: event.target.checked })} /> {ui.tree}</label>
      <label><input type="checkbox" checked={showTabs} onChange={(event) => updateProps({ showTabs: event.target.checked })} disabled={!showTree} /> {ui.tabs}</label>
      <label><input type="checkbox" checked={showLineNumbers} onChange={(event) => updateProps({ showLineNumbers: event.target.checked })} /> {ui.lineNumbers}</label>
      <button type="button" onClick={addFile}>{ui.addFile}</button>
      {activeFile && <>
        <button type="button" onClick={removeFile}>{ui.removeFile}</button>
        <label>{ui.filePath} <input key={activeFile.path} defaultValue={activeFile.path} onBlur={(event) => { if (!renameFile(event.target.value)) event.target.value = activeFile.path; }} /></label>
        <label>{ui.language} <input value={activeFile.language} onChange={(event) => updateFile({ language: event.target.value })} /></label>
        <label>{ui.code} <textarea value={activeFile.code} onChange={(event) => updateFile({ code: event.target.value })} /></label>
        <label>{ui.addedLines} <LineMarkerInput key={`added-${activeFile.path}`} lines={activeFile.addedLines} onChange={(addedLines) => updateFile(setMarkedLines(activeFile, "addedLines", addedLines))} /></label>
        <label>{ui.deletedLines} <LineMarkerInput key={`removed-${activeFile.path}`} lines={activeFile.removedLines} onChange={(removedLines) => updateFile(setMarkedLines(activeFile, "removedLines", removedLines))} /></label>
      </>}
    </fieldset>}
  </section>;
}
