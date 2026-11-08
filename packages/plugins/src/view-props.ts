// Accepts both editing void-renderer props and read-only viewer props without
// depending on @jul-editor/react. Plugin renderers do not use the editor.
import type { Editor as CoreEditor, Json } from "@jul-editor/core";

export interface PluginViewProps {
  block: { id: string; type: string; props: Record<string, Json> };
  editor?: CoreEditor;
  selected?: boolean;
  updateProps?: (patch: Record<string, Json | undefined>) => void;
  readOnly?: boolean;
  locale?: "en" | "ko";
}
