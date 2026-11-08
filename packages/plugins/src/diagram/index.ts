import { newId } from "@jul-editor/core";
import type { SlashItem } from "../slash.js";

export { DiagramView } from "../diagram-view.js";
export type { DiagramViewProps, DiagramViewClassNames } from "../diagram-view.js";

export const diagramSlashItem: SlashItem = {
  type: "diagram",
  title: "Diagram",
  keywords: ["diagram", "mermaid", "flowchart", "다이어그램", "순서도"],
  create: () => ({ id: newId(), type: "diagram", props: { code: "flowchart LR\n  Idea --> Draft --> Publish" } }),
};
