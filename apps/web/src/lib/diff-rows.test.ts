import { describe, expect, it } from "vitest";
import type { Block, Doc } from "@jul-editor/core";
import { workspaceRegistry } from "../components/workspace/workspace-registry.js";
import { compareRows } from "./diff-rows.js";
import { canonicalDoc } from "./doc-reconcile.js";
import { demoDoc } from "./sample.js";

const text = (block: Block, value: string): Block => ({ ...block, content: [{ type: "text", text: value }] });
const changed = (before: Doc, after: Doc) => compareRows(before, after, workspaceRegistry).filter((row) => row.status !== "same");

describe("compareRows", () => {
  it("does not report default props the editor omits as a change", () => {
    const sample = demoDoc();
    // What the editor hands back after any edit: the same document with default props dropped.
    const edited = canonicalDoc({ ...sample, blocks: sample.blocks.map((block) => block.id === "demo-p1" ? text(block, "Edited paragraph.") : block) }, workspaceRegistry);
    const rows = changed(sample, edited);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "modify", after: "Edited paragraph." });
  });

  it("shows a reordered list item as a delete and an insert, never paired with a blank line", () => {
    const sample = demoDoc();
    const ids = sample.blocks.map((block) => block.id);
    const blocks = [...sample.blocks];
    const [first] = blocks.splice(ids.indexOf("demo-list-1"), 1);
    blocks.splice(ids.indexOf("demo-list-3"), 0, first!);
    const rows = changed(sample, { ...sample, blocks });
    expect(rows.map((row) => row.status)).toEqual(["delete", "insert"]);
    expect(rows[0]!.before).toBe("- Drag the handle on the left to move this item.");
    expect(rows[1]!.after).toBe("- Drag the handle on the left to move this item.");
    expect(rows.some((row) => row.status === "modify")).toBe(false);
  });

  it("still pairs an edited line with its previous text", () => {
    const sample = demoDoc();
    const rows = changed(sample, { ...sample, blocks: sample.blocks.map((block) => block.id === "demo-quote" ? text(block, "A different quote.") : block) });
    expect(rows).toEqual([expect.objectContaining({ status: "modify", before: "> Open Diff to see which blocks changed since the saved version.", after: "> A different quote." })]);
  });
});
