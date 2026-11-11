import { defineBlock, newId, type Doc } from "@jul-editor/core";
import { Editor, type SlashItem, type SlashMenuRenderArgs } from "@jul-editor/react";
import { useEffect, useMemo, useState } from "react";
import { EditorCanvas } from "../workspace/editor-canvas.js";
import { useMenuPlacement } from "../workspace/menu-placement.js";
import "../../styles/docs-menu-customization.css";

const notice = defineBlock({ type: "notice", content: "inline", children: "none", props: { tone: "info" } });
const initialDoc: Doc = { version: 1, blocks: [{ id: "custom-menu-intro", type: "paragraph", props: {}, content: [] }] };

function CuratedOptions({ locale, ...args }: SlashMenuRenderArgs & { locale: "en" | "ko" }) {
  const [hoveredId, setHoveredId] = useState("");
  const { items, activeIndex, loading, rect, getListboxProps, getOptionProps } = args;
  useEffect(() => setHoveredId(""), [activeIndex]);
  const preview = items.find((item) => item.id === hoveredId) ?? items[activeIndex];
  // Position only: the preview card hangs outside the menu, so the menu must not clip its overflow.
  const { ref, style } = useMenuPlacement(rect, { width: 236, height: 240 });
  return <div ref={ref} data-jul-editor-keep-selection="" className="slash-menu docs-curated-menu" style={style && { left: style.left, top: style.top, visibility: style.visibility }}
    onMouseLeave={() => setHoveredId("")} onKeyDown={() => setHoveredId("")}>
    <div className="slash-menu-label">{locale === "ko" ? "블록 선택" : "CHOOSE A BLOCK"}</div>
    <div {...getListboxProps()} aria-label={locale === "ko" ? "블록 명령" : "Block commands"}>{items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined} onMouseEnter={() => setHoveredId(item.id)}><span aria-hidden="true">{item.icon ?? "▣"}</span><span>{item.title}</span></div>)}</div>
    <div role="status">{!items.length && <div className="slash-empty">{loading ? (locale === "ko" ? "불러오는 중…" : "Loading…") : (locale === "ko" ? "일치하는 블록이 없습니다" : "No matching blocks")}</div>}</div>
    {preview && <aside className="docs-curated-preview" aria-live="polite"><strong>{preview.title}</strong><p>{preview.description ?? (locale === "ko" ? "선택한 블록을 문서에 추가합니다." : "Add this block to your document.")}</p></aside>}
  </div>;
}

function CuratedMenu({ locale }: { locale: "en" | "ko" }) {
  const configure = useMemo(() => (defaults: SlashItem[]) => [
    ...defaults.filter((item) => item.id === "paragraph" || item.id === "heading-1"),
    { id: "notice", type: "notice", title: locale === "ko" ? "안내 카드" : "Notice card", description: locale === "ko" ? "강조할 내용을 남기는 블록" : "A highlighted block for a key point", keywords: ["notice", "callout", "안내"], icon: "✦", create: () => ({ id: newId(), type: "notice", props: { tone: "info" }, content: [] }) },
  ], [locale]);
  return <Editor.SlashMenu items={configure}>{(args) => <CuratedOptions {...args} locale={locale} />}</Editor.SlashMenu>;
}

export function DocsMenuCustomizationCanvas({ locale }: { locale: "en" | "ko" }) {
  const [doc, setDoc] = useState(initialDoc);
  return <div className="docs-live docs-menu-customization" data-testid="docs-menu-customization">
    <div className="docs-live-head"><div><span className="docs-live-signal" /><strong>{locale === "ko" ? "맞춤 슬래시 메뉴" : "Curated slash menu"}</strong><small>{locale === "ko" ? "문장 끝에 /를 입력하고 항목 위에 마우스를 올려 보세요" : "Type / at the end, then hover an item"}</small></div></div>
    <EditorCanvas value={doc} onChange={setDoc} mode="block" compact slashMenu={<CuratedMenu locale={locale} />}>
      <Editor.Plugin blocks={[notice]} />
    </EditorCanvas>
  </div>;
}

export default DocsMenuCustomizationCanvas;
