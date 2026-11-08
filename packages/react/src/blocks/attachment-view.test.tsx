import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, createRegistry, type Doc } from "@jul-editor/core";
import { fromMarkdown, fromHTML, toMarkdown, toHTML } from "@jul-editor/core/serde";
import { attachmentBlock, createAttachmentBlock } from "./attachment-view.js";
const registry = createRegistry({blocks: [...coreBlocks, attachmentBlock], inlines: coreInlines, marks: coreMarks});
describe("attachment plugin", () => {
  it("preserves filenames and asset metadata through Markdown and HTML", () => {
    const file = new File(["report"], 'release <notes> "v1".pdf', {type: "application/pdf"});
    const block = createAttachmentBlock(file);
    block.props.src = "https://cdn.example/report.pdf";
    block.props.assetId = "asset-1";
    const doc: Doc = {version: 1, blocks: [block]};
    for (const restored of [fromMarkdown(toMarkdown(doc, {registry}).markdown, {registry}).doc, fromHTML(toHTML(doc, {registry}), {registry}).doc]) {
      expect(restored.blocks[0]!.type).toBe("attachment");
      expect(restored.blocks[0]!.props).toMatchObject({name: file.name, src: block.props.src, assetId: "asset-1", size: file.size});
    }
  });
  it("rejects malformed payloads and does not export local object URLs", () => {
    const block = createAttachmentBlock(new File(["x"], "x.txt"));
    block.props.src = "blob:temporary";
    const doc: Doc = {version: 1, blocks: [block]};
    expect(decodeURIComponent(toMarkdown(doc, {registry}).markdown)).not.toContain("blob:temporary");
    expect(decodeURIComponent(toHTML(doc, {registry}))).not.toContain("blob:temporary");
    expect(attachmentBlock.fromMarkdown!.parse({text: "%not-json"}, {} as never)).toBeNull();
  });
});
