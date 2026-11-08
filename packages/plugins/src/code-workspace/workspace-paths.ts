import type { CodeWorkspaceFile } from "./block.js";

const languages: Record<string, string> = {
  ts: "ts", tsx: "tsx", mts: "ts", cts: "ts",
  js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  json: "json", css: "css", html: "html", htm: "html",
  md: "markdown", markdown: "markdown", py: "python",
  yml: "yaml", yaml: "yaml", sh: "bash", zsh: "bash",
  rs: "rust", rb: "ruby", kt: "kotlin", cs: "csharp",
  go: "go", java: "java", swift: "swift", sql: "sql",
  c: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", php: "php", diff: "diff",
};

export function inferLanguage(path: string): string {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? languages[extension] ?? "plaintext" : "plaintext";
}

export function parseLineRanges(text: string, maxLine: number): number[] | null {
  if (!Number.isSafeInteger(maxLine) || maxLine < 0) return null;
  if (!text.trim()) return [];
  const lines = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) return null;
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > maxLine) return null;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}

export function validWorkspacePath(path: string): boolean {
  return path.length > 0 && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function remapWorkspacePath(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

export function moveWorkspaceEntry(files: CodeWorkspaceFile[], folders: string[], from: string, to: string): { files: CodeWorkspaceFile[]; folders: string[] } | null {
  if (![from, to, ...files.map((file) => file.path), ...folders].every(validWorkspacePath)) return null;

  const filePaths = new Set(files.map((file) => file.path));
  const folderPaths = new Set<string>();
  for (const path of [...filePaths, ...folders]) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count++) folderPaths.add(parts.slice(0, count).join("/"));
  }
  for (const folder of folders) folderPaths.add(folder);
  if (filePaths.size !== files.length || new Set(folders).size !== folders.length ||
    [...filePaths].some((path) => folderPaths.has(path))) return null;

  const isFile = filePaths.has(from);
  const isFolder = folderPaths.has(from);
  if (!isFile && !isFolder) return null;
  if (from === to) return { files: [...files], folders: [...folders] };
  const withinSource = (path: string) => path === from || path.startsWith(`${from}/`);
  if (to.startsWith(`${from}/`)) return null;

  const unrelatedFiles = files.filter((file) => isFile ? file.path !== from : !withinSource(file.path));
  const unrelatedFolders = [...folderPaths].filter((folder) => isFile || !withinSource(folder));
  if (unrelatedFiles.some((file) => file.path === to || to.startsWith(`${file.path}/`)) || unrelatedFolders.includes(to)) return null;

  return {
    files: files.map((file) => (isFile ? file.path === from : withinSource(file.path))
      ? { ...file, path: remapWorkspacePath(file.path, from, to) } : file),
    folders: folders.map((folder) => isFolder && withinSource(folder) ? remapWorkspacePath(folder, from, to) : folder),
  };
}
