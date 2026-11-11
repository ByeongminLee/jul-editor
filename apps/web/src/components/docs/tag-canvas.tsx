import { Editor } from "@jul-editor/react";
import { EditorCanvas, type EditorCanvasProps } from "../workspace/editor-canvas.js";
import { PlacedMenu } from "../workspace/menu-placement.js";
import { useSiteSettings } from "../../app/site-settings.js";

function TagMenu() {
  const { locale, t } = useSiteSettings();
  const tags = [
    { id: "idea", label: locale === "ko" ? "아이디어" : "idea" },
    { id: "research", label: locale === "ko" ? "연구" : "research" },
    { id: "design", label: locale === "ko" ? "디자인" : "design" },
  ];
  return <Editor.TagMenu onSearch={(query) => tags.filter((tag) => tag.label.includes(query.toLowerCase()))}>
    {({ items, activeIndex, rect, getListboxProps, getOptionProps }) => <PlacedMenu data-jul-editor-keep-selection="" className="slash-menu" rect={rect}>
      <div className="slash-menu-label">{t("TAGS", "태그")}</div>
      <div {...getListboxProps()} aria-label={t("Tags", "태그")}>{items.map((item, index) => <div key={item.id} {...getOptionProps(index)} className="slash-option" data-active={index === activeIndex || undefined}>#{item.label}</div>)}</div>
      <div role="status">{!items.length && <div className="slash-empty">{t("No matching tags", "일치하는 태그가 없습니다")}</div>}</div>
    </PlacedMenu>}
  </Editor.TagMenu>;
}

/** Tag suggestions use @jul-editor/react without any optional visual plugin. */
export function DocsTagCanvas(props: EditorCanvasProps) {
  return <EditorCanvas {...props}><TagMenu /></EditorCanvas>;
}
