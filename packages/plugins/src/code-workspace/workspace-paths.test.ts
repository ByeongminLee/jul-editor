import { describe, expect, it } from "vitest";
import type { CodeWorkspaceFile } from "./block.js";
import { inferLanguage, moveWorkspaceEntry, parseLineRanges, remapWorkspacePath, validWorkspacePath } from "./workspace-paths.js";

const file = (path: string): CodeWorkspaceFile => ({ path, language: "ts", code: path });

describe("Code Workspace paths", () => {
  it("infers common highlighting languages from the final extension", () => {
    expect(["a.ts", "a.tsx", "a.js", "a.jsx", "a.json", "a.css", "a.html", "README.md", "src/main.py"].map(inferLanguage))
      .toEqual(["ts", "tsx", "js", "jsx", "json", "css", "html", "markdown", "python"]);
    expect(inferLanguage("src/README.unknown")).toBe("plaintext");
    expect(inferLanguage("src/component.TSX")).toBe("tsx");
  });

  it("parses and normalizes inclusive line ranges", () => {
    expect(parseLineRanges(" 3-7, 11, 5, 2 - 3 ", 11)).toEqual([2, 3, 4, 5, 6, 7, 11]);
    expect(parseLineRanges("  ", 0)).toEqual([]);
  });

  it("rejects malformed, reversed, or out-of-bounds line ranges", () => {
    for (const text of ["0", "12", "8-7", "2-12", "1,,2", "1,", "1-", "1.5", "1 2", "-1", "a"]) {
      expect(parseLineRanges(text, 11), text).toBeNull();
    }
  });

  it("accepts only nonempty slash-separated paths without dot segments", () => {
    expect(validWorkspacePath("src/components/App.tsx")).toBe(true);
    for (const path of ["", "/src", "src/", "src//App.tsx", ".", "..", "src/./App.tsx", "src/../App.tsx"]) {
      expect(validWorkspacePath(path), path).toBe(false);
    }
  });

  it("remaps exact paths and descendants without touching similar prefixes", () => {
    expect(remapWorkspacePath("src", "src", "lib")).toBe("lib");
    expect(remapWorkspacePath("src/nested/a.ts", "src", "lib")).toBe("lib/nested/a.ts");
    expect(remapWorkspacePath("src-old/a.ts", "src", "lib")).toBe("src-old/a.ts");
  });

  it("moves a file to a full new path and preserves its metadata", () => {
    const files: CodeWorkspaceFile[] = [{ ...file("src/a.ts"), addedLines: [2], removedLines: [3] }, file("docs/guide.md")];
    const folders = ["src", "docs"];
    expect(moveWorkspaceEntry(files, folders, "src/a.ts", "docs/a.ts")).toEqual({
      files: [{ ...files[0], path: "docs/a.ts" }, files[1]], folders,
    });
    expect(files[0]?.path).toBe("src/a.ts");
  });

  it("moves an explicit or implied folder with all descendants and empty folders", () => {
    const files = [file("src/a.ts"), file("src/nested/b.ts"), file("src-old/c.ts")];
    const folders = ["src", "src/nested", "src/empty", "src-old"];
    expect(moveWorkspaceEntry(files, folders, "src", "lib")).toEqual({
      files: [{ ...files[0], path: "lib/a.ts" }, { ...files[1], path: "lib/nested/b.ts" }, files[2]],
      folders: ["lib", "lib/nested", "lib/empty", "src-old"],
    });
    expect(moveWorkspaceEntry([file("src/a.ts")], [], "src", "lib")).toEqual({
      files: [{ ...file("src/a.ts"), path: "lib/a.ts" }], folders: [],
    });
  });

  it("rejects invalid moves, cycles, and collisions with files or implied folders", () => {
    const files = [file("src/a.ts"), file("src/nested/b.ts"), file("docs/guide.md"), file("README.md")];
    const folders = ["src", "src/empty"];
    const invalidMoves: [string, string][] = [
      ["missing", "new"], ["src", "src/nested/deep"], ["src/a.ts", "README.md"],
      ["src/a.ts", "docs"], ["src/a.ts", "README.md/child.ts"], ["src/a.ts", "src/a.ts/child.ts"], ["src", "docs"],
      ["src", "/bad"], ["src", "bad/../path"],
    ];
    for (const [from, to] of invalidMoves) {
      expect(moveWorkspaceEntry(files, folders, from, to), `${from} -> ${to}`).toBeNull();
    }
  });
});
