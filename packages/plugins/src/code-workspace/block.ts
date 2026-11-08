import { defineBlock, newId } from "@jul-editor/core";
import type { Json } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";
import { validWorkspacePath } from "./workspace-paths.js";

export interface CodeWorkspaceFile {
  path: string;
  language: string;
  code: string;
  addedLines?: number[];
  removedLines?: number[];
}

export interface CodeWorkspaceProps {
  title?: string;
  files: CodeWorkspaceFile[];
  folders?: string[];
  pinnedPaths?: string[];
  showTree?: boolean;
  showTabs?: boolean;
  showLineNumbers?: boolean;
}

export type LineChange = "added" | "deleted" | undefined;

/**
 * +/- markers are mutually exclusive. Legacy data may list a line in both
 * addedLines and removedLines; the rule is: added wins, the removed mark is ignored.
 */
export function lineChange(file: Pick<CodeWorkspaceFile, "addedLines" | "removedLines">, line: number): LineChange {
  if (file.addedLines?.includes(line)) return "added";
  return file.removedLines?.includes(line) ? "deleted" : undefined;
}

/** Sets a line to added, deleted or none (radio-like), keeping both lists disjoint. */
export function setLineChange(file: Pick<CodeWorkspaceFile, "addedLines" | "removedLines">, line: number, change: LineChange): Pick<CodeWorkspaceFile, "addedLines" | "removedLines"> {
  const without = (lines?: number[]) => (lines ?? []).filter((item) => item !== line);
  const add = (lines?: number[]) => [...without(lines), line].sort((a, b) => a - b);
  return {
    addedLines: change === "added" ? add(file.addedLines) : without(file.addedLines),
    removedLines: change === "deleted" ? add(file.removedLines) : without(file.removedLines),
  };
}

/** Replaces one list wholesale (range input) and drops those lines from the other list. */
export function setMarkedLines(file: Pick<CodeWorkspaceFile, "addedLines" | "removedLines">, kind: "addedLines" | "removedLines", lines: number[]): Pick<CodeWorkspaceFile, "addedLines" | "removedLines"> {
  const other = kind === "addedLines" ? "removedLines" : "addedLines";
  return file[other] ? { [kind]: lines, [other]: file[other].filter((line) => !lines.includes(line)) } : { [kind]: lines };
}

function validLines(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((line) => Number.isInteger(line) && line > 0));
}

function parseProps(value: unknown): Record<string, Json> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const props = value as Record<string, unknown>;
  const files = props.files === undefined ? [] : props.files;
  if (!Array.isArray(files) || !files.every((file: unknown) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return false;
    const entry = file as Record<string, unknown>;
    return typeof entry.path === "string" && validWorkspacePath(entry.path) &&
      typeof entry.language === "string" && typeof entry.code === "string" &&
      validLines(entry.addedLines) && validLines(entry.removedLines);
  })) return null;
  const paths = files.map((file: CodeWorkspaceFile) => file.path);
  const filePaths = new Set(paths);
  if (filePaths.size !== paths.length) return null;
  for (const path of paths) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count++) if (filePaths.has(parts.slice(0, count).join("/"))) return null;
  }
  for (const key of ["folders", "pinnedPaths"] as const) {
    const list = props[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((path: unknown) => typeof path === "string" && validWorkspacePath(path)) || new Set(list).size !== list.length)) return null;
  }
  const folders = (props.folders ?? []) as string[];
  const pinnedPaths = (props.pinnedPaths ?? []) as string[];
  if (folders.some((folder) => paths.some((path) => folder === path || folder.startsWith(`${path}/`))) || pinnedPaths.some((path) => !paths.includes(path))) return null;
  if (props.title !== undefined && typeof props.title !== "string") return null;
  for (const key of ["showTree", "showLineNumbers", "showTabs"]) {
    if (props[key] !== undefined && typeof props[key] !== "boolean") return null;
  }
  const clean: Record<string, Json> = {};
  if (props.files !== undefined) clean.files = files.map((value: Record<string, unknown>) => {
    const file: CodeWorkspaceFile = { path: value.path as string, language: value.language as string, code: value.code as string };
    if (value.addedLines !== undefined) file.addedLines = [...(value.addedLines as number[])];
    if (value.removedLines !== undefined) file.removedLines = [...(value.removedLines as number[])];
    return file;
  }) as unknown as Json;
  if (props.title !== undefined) clean.title = props.title as string;
  if (props.folders !== undefined) clean.folders = [...folders];
  if (props.pinnedPaths !== undefined) clean.pinnedPaths = [...pinnedPaths];
  for (const key of ["showTree", "showLineNumbers", "showTabs"]) {
    if (props[key] !== undefined) clean[key] = props[key] as boolean;
  }
  return clean;
}

export function readCodeWorkspaceFiles(props: unknown): CodeWorkspaceFile[] {
  return (parseProps(props)?.files as unknown as CodeWorkspaceFile[] | undefined) ?? [];
}

function parsePayload(text: string | null): Record<string, Json> | null {
  if (text === null) return null;
  try {
    return parseProps(JSON.parse(text));
  } catch {
    return null;
  }
}

export const codeWorkspaceBlock = defineBlock({
  type: "codeWorkspace",
  content: "none",
  children: "none",
  props: { title: "", files: [], showTree: true, showLineNumbers: true, showTabs: true },
  toMarkdown: (block) => `\`\`\`jul-editor-code-workspace\n${JSON.stringify(block.props)}\n\`\`\``,
  fromMarkdown: {
    fence: "jul-editor-code-workspace",
    parse(token, ctx) {
      const props = parsePayload(token.text);
      if (props) return { id: newId(), type: "codeWorkspace", props };
      ctx.lossy(newId(), "codeWorkspace", "invalid-payload");
      return null;
    },
  },
  toHTML: (block, ctx) => `<figure data-jul-editor-code-workspace="${ctx.escapeAttr(JSON.stringify(block.props))}"></figure>`,
  fromHTML: {
    selector: "figure[data-jul-editor-code-workspace]",
    parse(el, ctx) {
      const props = parsePayload(el.getAttribute("data-jul-editor-code-workspace"));
      if (props) return { id: newId(), type: "codeWorkspace", props };
      ctx.lossy(newId(), "codeWorkspace", "invalid-payload");
      return null;
    },
  },
  toText: (block) => readCodeWorkspaceFiles(block.props).map((file) => `${file.path}\n${file.code}`).join("\n\n"),
});

export const codeWorkspaceSlashItem: SlashItem = {
  type: "codeWorkspace",
  title: "Code Workspace",
  keywords: ["code", "files", "project", "workspace", "코드", "파일"],
  create: () => ({ id: newId(), type: "codeWorkspace", props: { files: [{ path: "src/index.ts", language: "ts", code: "" }] } }),
};
