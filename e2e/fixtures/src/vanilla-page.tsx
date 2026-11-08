// "/vanilla" route: @jul-editor/core's createEditor with no React wrapper at
// all involved in the editing path (React here only mounts/unmounts the host
// div -- the same vanilla-parity point EditorPage.tsx makes for "/editor").
// Exposes window.__julEditorVanilla = { getDoc } for e2e/react.spec.ts's
// "vanilla" test.
import { coreRegistry, createEditor, type Doc } from "@jul-editor/core";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __julEditorVanilla?: { getDoc: () => Doc };
  }
}

function initialDoc(): Doc {
  return { version: 1, blocks: [{ id: "v-p1", type: "paragraph", props: {}, content: [] }] };
}

export function VanillaPage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const editor = createEditor({ element, registry: coreRegistry, defaultValue: initialDoc() });
    window.__julEditorVanilla = { getDoc: () => editor.getDoc() };

    return () => {
      editor.destroy();
      delete window.__julEditorVanilla;
    };
  }, []);

  return <div data-testid="page-vanilla" ref={ref} />;
}
