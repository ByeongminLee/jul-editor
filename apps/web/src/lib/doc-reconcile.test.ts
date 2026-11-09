// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Block } from "@jul-editor/core";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { diffDocs } from "@jul-editor/plugins/diff";
import { workspaceRegistry } from "../components/workspace/workspace-registry.js";
import { canonicalDoc, reconcileIds } from "./doc-reconcile.js";
import { demoDoc } from "./sample.js";

const registry = workspaceRegistry;
const markdownKey = (block: Block) => toMarkdown({ version: 1, blocks: [block] }, { registry }).markdown;
const htmlKey = (block: Block) => toHTML({ version: 1, blocks: [block] }, { registry });

describe("reconcileIds", () => {
  it("keeps block ids when edited Markdown is applied, so Diff shows only the new block", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const markdown = toMarkdown(doc, { registry }).markdown + "\n\nADDED\n";
    const parsed = canonicalDoc(fromMarkdown(markdown, { registry }).doc, registry);
    const next = reconcileIds(doc, parsed, markdownKey);
    const { stats } = diffDocs(doc, next, registry);
    expect(stats).toMatchObject({ inserted: 1, deleted: 0, modified: 0, moved: 0 });
    expect(next.blocks.slice(0, -1).map((block) => block.id)).toEqual(doc.blocks.map((block) => block.id));
    expect(next.blocks.at(-1)!.content).toEqual([{ type: "text", text: "ADDED" }]);
    // Untouched blocks are the same objects, with props Markdown cannot express.
    expect(next.blocks.find((block) => block.id === "demo-image")).toBe(doc.blocks.find((block) => block.id === "demo-image"));
  });

  it("keeps ids for edited HTML and reports an edited block as modified", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const html = toHTML(doc, { registry }).replace("Review the changes", "Review every change");
    const parsed = canonicalDoc(fromHTML(html, { registry }).doc, registry);
    const next = reconcileIds(doc, parsed, htmlKey);
    const { stats } = diffDocs(doc, next, registry);
    expect(stats).toMatchObject({ inserted: 0, deleted: 0, modified: 1, moved: 0 });
    expect(next.blocks.find((block) => block.id === "demo-heading")?.content).toEqual([{ type: "text", text: "Review every change" }]);
  });

  it("keeps the id of a block that only moved", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const fresh = (block: Block): Block => ({ ...block, id: `${block.id}-new`, children: block.children?.map(fresh) });
    const blocks = doc.blocks.map(fresh);
    const [moved] = blocks.splice(1, 1);
    blocks.push(moved!);
    const next = reconcileIds(doc, { ...doc, blocks });
    expect(next.blocks.at(-1)!.id).toBe("demo-subtitle");
    expect(next.blocks.map((block) => block.id).sort()).toEqual(doc.blocks.map((block) => block.id).sort());
  });
});
