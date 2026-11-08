import { lazy, useEffect, useState } from "react";
import { Editor, createCodeBlockRenderer, useEditor } from "@jul-editor/react";
import type { Doc } from "@jul-editor/core";
const DiagramView = lazy(() => import("@jul-editor/plugins/diagram").then((m) => ({ default: m.DiagramView })));
const DataTableView = lazy(() => import("@jul-editor/plugins/table").then((m) => ({ default: m.DataTableView })));
const CodeView = lazy(() => import("@jul-editor/plugins/code").then((m) => ({ default: createCodeBlockRenderer({ languages: m.pluginCodeLanguages }) })));
function HighlightSetup() {
  const editor = useEditor();
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    if (editor) void import("@jul-editor/plugins/code").then(({ createLowlightHighlighter }) => {
      if (active) cleanup = editor.registerHighlighter(createLowlightHighlighter());
    });
    return () => { active = false; cleanup?.(); };
  }, [editor]);
  return null;
}
type Example = "diagram" | "data-table" | "code-blocks";
type Locale = "en" | "ko";

function exampleDoc(example: Example, locale: Locale): Doc {
  return { version: 1, blocks: [example === "diagram"
    ? { id: "docs-diagram", type: "diagram", props: { code: locale === "ko" ? "flowchart LR\n  idea[아이디어] --> draft[초안] --> publish[게시]" : "flowchart LR\n  Idea --> Draft --> Publish" } }
    : example === "data-table" ? { id: "docs-data-table", type: "dataTable", props: { source: { type: "inline", csv: locale === "ko" ? "페이지,조회수\n문서,420\n플레이그라운드,315\n쇼케이스,180" : "Page,Views\nDocs,420\nPlayground,315\nShowcase,180" } } }
      : { id: "docs-code-block", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: locale === "ko" ? 'const release = "배포 준비 완료";\nconsole.log(release);' : 'const release = "Ready to ship";\nconsole.log(release);' }] },
    { id: "docs-plugin-empty", type: "paragraph", props: {}, content: [] },
  ] };
}

export function DocsPluginCanvas({ example, locale }: { example: Example; locale: Locale }) {
  const [doc, setDoc] = useState<Doc>(() => exampleDoc(example, locale));
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited) setDoc(exampleDoc(example, locale)); }, [example, locale, edited]);
  return <div className="docs-live docs-plugin-demo">
    <div className="docs-live-head"><strong>{locale === "ko" ? "블록을 선택해 직접 편집하세요" : "Select the block to edit it"}</strong></div>
    <Editor value={doc} onChange={(next) => { setEdited(true); setDoc(next); }} locale={locale} className="editor-instance">
      <Editor.Plugin renderers={example === "diagram" ? { diagram: DiagramView } : example === "data-table" ? { dataTable: DataTableView } : { codeBlock: CodeView }} />
      {example === "code-blocks" && <HighlightSetup />}
      <Editor.Content className="editor-content editor-content-compact docs-demo-content" />
    </Editor>
  </div>;
}
