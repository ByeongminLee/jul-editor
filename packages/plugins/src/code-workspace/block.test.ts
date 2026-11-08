import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, createRegistry, type Doc } from "@jul-editor/core";
import { fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { codeWorkspaceBlock, codeWorkspaceSlashItem } from "./block.js";

const registry = createRegistry({ blocks: [...coreBlocks, codeWorkspaceBlock], inlines: coreInlines, marks: coreMarks });
const files = [
  { path: "src/App.tsx", language: "tsx", code: "const x = '</div><script>alert(1)</script>';\n```nested```", addedLines: [1], removedLines: [2] },
  { path: "README.md", language: "markdown", code: "# Hello" },
];
const doc: Doc = { version: 1, blocks: [{ id: "workspace", type: "codeWorkspace", props: { title: "Sample", files, folders: ["src/empty"], pinnedPaths: ["src/App.tsx"], showTree: false, showLineNumbers: false, showTabs: false } }] };

describe("Code Workspace block", () => {
  it("round-trips multiple files and display options through its Markdown fence", () => {
    const markdown = toMarkdown(doc, { registry }).markdown;
    expect(markdown).toContain("jul-editor-code-workspace");
    expect(fromMarkdown(markdown, { registry }).doc.blocks[0]?.props).toEqual(doc.blocks[0]?.props);
  });

  it("escapes file code in HTML and parses the JSON payload", () => {
    const html = toHTML(doc, { registry });
    expect(html).toContain("data-jul-editor-code-workspace=");
    expect(html).not.toContain("<script>");
    const parsed = codeWorkspaceBlock.fromHTML?.parse({ getAttribute: () => JSON.stringify(doc.blocks[0]!.props) } as unknown as Element, {} as never);
    expect(parsed?.props).toEqual(doc.blocks[0]?.props);
  });

  it("rejects malformed or non-file payloads", () => {
    const bad = fromMarkdown('```jul-editor-code-workspace\n{"files":"wrong"}\n```', { registry });
    expect(bad.doc.blocks[0]?.type).toBe("codeBlock");
    expect(codeWorkspaceBlock.fromHTML?.parse({ getAttribute: () => "{bad" } as unknown as Element, { lossy() {} } as never)).toBeNull();
  });

  it("rejects file paths that would make the tree or moves invalid", () => {
    for (const files of [
      [{ path: "src/../a.ts", language: "ts", code: "" }],
      [{ path: "a", language: "ts", code: "" }, { path: "a/b.ts", language: "ts", code: "" }],
    ]) {
      const markdown = `\`\`\`jul-editor-code-workspace\n${JSON.stringify({ files })}\n\`\`\``;
      expect(fromMarkdown(markdown, { registry }).doc.blocks[0]?.type).toBe("codeBlock");
    }
  });

  it("offers an optional slash item with an editable starter file", () => {
    const created = codeWorkspaceSlashItem.create();
    expect(created.type).toBe("codeWorkspace");
    expect(created.props.files).toEqual([{ path: "src/index.ts", language: "ts", code: "" }]);
  });

  it("round-trips an empty workspace after files are removed", () => {
    const empty: Doc = { version: 1, blocks: [{ id: "empty", type: "codeWorkspace", props: {} }] };
    const markdown = toMarkdown(empty, { registry }).markdown;
    expect(fromMarkdown(markdown, { registry }).doc.blocks[0]?.type).toBe("codeWorkspace");
  });

  it("keeps only known JSON fields from imported workspace data", () => {
    const imported = fromMarkdown('```jul-editor-code-workspace\n{"files":[{"path":"a.ts","language":"ts","code":"x","extra":"discard"}],"extra":"discard"}\n```', { registry });
    expect(imported.doc.blocks[0]?.props).toEqual({ files: [{ path: "a.ts", language: "ts", code: "x" }] });
  });
});
