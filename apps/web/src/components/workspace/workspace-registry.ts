import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import { codeWorkspaceBlock } from "@jul-editor/plugins/code-workspace";
import { attachmentBlock } from "@jul-editor/react";

/** The web playground opts into these blocks when converting source formats. */
export const workspaceRegistry = createRegistry({
  blocks: [...coreBlocks, attachmentBlock, codeWorkspaceBlock],
  inlines: coreInlines,
  marks: coreMarks,
});
