import type { Doc } from "@jul-editor/core";
import { Editor } from "@jul-editor/react";
import "../../styles/docs-style-slots.css";

const example: Doc = { version: 1, blocks: [
  { id: "style-title", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "JulEditor" }] },
  { id: "style-empty", type: "paragraph", props: {}, content: [] },
] };

export function DocsStyleSlotsCanvas({ locale }: { locale: "en" | "ko" }) {
  return <div className="docs-live docs-style-slots" data-testid="docs-style-slots">
    <div className="docs-live-head"><div><span className="docs-live-signal" /><strong>{locale === "ko" ? "클래스 슬롯 실제 예제" : "Class slots in a live editor"}</strong><small>{locale === "ko" ? "툴바 색을 보고 빈 줄에 /를 입력하세요" : "Inspect the toolbar colors, then type / on the empty line"}</small></div></div>
    <Editor defaultValue={example} locale={locale} placeholder="" className="slot-demo-editor">
      <Editor.Toolbar className={{ container: "slot-demo-toolbar", button: "slot-demo-button", text: "slot-demo-label" }}>
        <Editor.Bold /><Editor.Italic /><Editor.Heading level={2} />
      </Editor.Toolbar>
      <Editor.Content className="slot-demo-content" />
      <Editor.SlashMenu className={{ container: "slot-demo-menu", item: "slot-demo-item", text: "slot-demo-text", description: "slot-demo-description", empty: "slot-demo-empty" }} />
    </Editor>
  </div>;
}

export default DocsStyleSlotsCanvas;
