import type { Doc } from "@jul-editor/core";
import { codeWorkspaceBlock, codeWorkspaceSlashItem, CodeWorkspaceIDEView, CodeWorkspaceView } from "@jul-editor/plugins/code-workspace";
import { Editor } from "@jul-editor/react";
import { useState } from "react";
import { EditorCanvas } from "../workspace/editor-canvas.js";
import "../../styles/code-workspace.css";

const example: Doc = { version: 1, blocks: [
  { id: "workspace-demo", type: "codeWorkspace", props: {
    title: "acme/components", showTree: true, showTabs: true, showLineNumbers: true,
    files: [
      { path: "src/Button.tsx", language: "typescript", code: "type Props = { label: string };\n\nexport function Button({ label }: Props) {\n  return <button className=\"primary\">{label}</button>;\n}", addedLines: [4] },
      { path: "src/Dialog.tsx", language: "typescript", code: "export function Dialog() {\n  return <section role=\"dialog\">New dialog</section>;\n}", addedLines: [2], removedLines: [3] },
      { path: "src/theme.css", language: "css", code: ":root {\n  --accent: #f97316;\n  --radius: 8px;\n}" },
    ],
  } },
] };

export function DocsCodeWorkspaceCanvas({ locale, variant = "basic" }: { locale: "en" | "ko"; variant?: "basic" | "ide" }) {
  const [doc, setDoc] = useState(example);
  const ide = variant === "ide";
  return <div className="docs-live docs-code-workspace" data-testid={ide ? "docs-code-workspace-ide" : "docs-code-workspace"}>
    <div className="docs-live-head"><div><span className="docs-live-signal" /> <strong>{ide ? (locale === "ko" ? "IDE 편집 테마" : "IDE editing theme") : (locale === "ko" ? "기본 워크스페이스" : "Basic workspace")}</strong><small>{ide ? (locale === "ko" ? "트리에서 파일을 만들고 코드와 변경 줄을 바로 편집하세요" : "Create files in the tree and edit code and changed lines in place") : (locale === "ko" ? "파일을 열고 블록을 선택해 옵션을 바꿔 보세요" : "Open a file, then select the block to change its options")}</small></div></div>
    <EditorCanvas value={doc} onChange={setDoc} mode="block" compact>
      <Editor.Plugin blocks={[codeWorkspaceBlock]} renderers={{ codeWorkspace: ide ? CodeWorkspaceIDEView : CodeWorkspaceView }} slashItems={[codeWorkspaceSlashItem]} />
    </EditorCanvas>
  </div>;
}

export default DocsCodeWorkspaceCanvas;
