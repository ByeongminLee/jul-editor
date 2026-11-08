import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { defineBlock, type Block, type Doc } from "@jul-editor/core";
import { Editor, type ViewRendererProps } from "./";

afterEach(cleanup);

const doc = (blocks: Block[]): Doc => ({ version: 1, blocks });

describe("Editor.View", () => {
  it("renders nested blocks, marks, ordered indexes and table span hooks without an editable root", () => {
    const saved = doc([
      { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "strong", marks: [{ type: "bold" }] }] },
      { id: "o1", type: "orderedListItem", props: {}, content: [{ type: "text", text: "first" }], children: [
        { id: "nested", type: "paragraph", props: {}, content: [{ type: "text", text: "inner", marks: [{ type: "italic" }] }] },
      ] },
      { id: "o2", type: "orderedListItem", props: {}, content: [{ type: "text", text: "second" }] },
      { id: "table", type: "table", props: {}, children: [{ id: "row", type: "tableRow", props: {}, children: [
        { id: "cell", type: "tableCell", props: { colspan: 2, rowspan: 2 }, content: [{ type: "text", text: "value" }] },
      ] }] },
    ]);
    const { container } = render(<Editor.View doc={saved} className="editor-content" />);
    expect(container.querySelector(".editor-content [data-jul-editor-block][data-id='p'] strong")?.textContent).toBe("strong");
    expect(container.querySelector("[data-id='nested'] em")?.textContent).toBe("inner");
    expect(container.querySelector("[data-id='nested']")?.getAttribute("data-jul-editor-depth")).toBe("1");
    expect(container.querySelector("[data-id='o1']")?.getAttribute("data-jul-editor-index")).toBe("1");
    expect(container.querySelector("[data-id='o2']")?.getAttribute("data-jul-editor-index")).toBe("2");
    expect(container.querySelector("[data-id='cell']")?.getAttribute("data-jul-editor-colspan")).toBe("2");
    expect(container.querySelector("[data-id='cell']")?.getAttribute("data-jul-editor-rowspan")).toBe("2");
    expect(container.querySelector("[data-id='o1'] > [data-jul-editor-children] [data-id='nested']")).not.toBeNull();
    expect(container.querySelector("[contenteditable], input, textarea")).toBeNull();
  });

  it("passes read-only props to a custom renderer and reflects a new doc", () => {
    const card = defineBlock({ type: "customCard", content: "none", children: "none", props: { label: "" } });
    let seen: ViewRendererProps | undefined;
    function Card(props: ViewRendererProps) {
      seen = props;
      return <div data-testid="card">{String(props.block.props.label)}</div>;
    }
    const make = (label: string) => doc([{ id: "card", type: "customCard", props: { label } }]);
    const { container, rerender } = render(<Editor.View doc={make("A")} blocks={[card]} renderers={{ customCard: Card }} locale="ko" />);
    expect(container.querySelector("[data-testid='card']")?.textContent).toBe("A");
    expect(seen).toMatchObject({ readOnly: true, selected: false, locale: "ko" });
    seen!.updateProps({ label: "ignored" });
    expect(container.querySelector("[data-testid='card']")?.textContent).toBe("A");
    rerender(<Editor.View doc={make("B")} blocks={[card]} renderers={{ customCard: Card }} locale="ko" />);
    expect(container.querySelector("[data-testid='card']")?.textContent).toBe("B");
  });

  it("passes a custom container's inline content and nested blocks as children", () => {
    const callout = defineBlock({ type: "callout", content: "inline", children: "any", props: {} });
    function Callout({ children }: ViewRendererProps) { return <aside>{children}</aside>; }
    const saved = doc([{ id: "callout", type: "callout", props: {}, content: [{ type: "text", text: "note" }], children: [
      { id: "child", type: "paragraph", props: {}, content: [{ type: "text", text: "inside" }] },
    ] }]);
    const { container } = render(<Editor.View doc={saved} blocks={[callout]} renderers={{ callout: Callout }} />);
    expect(container.querySelector("[data-id='callout'] aside > [data-jul-editor-content]")?.textContent).toBe("note");
    expect(container.querySelector("[data-id='callout'] aside > [data-jul-editor-children] [data-id='child']")?.textContent).toBe("inside");
  });

  it("keeps underline, script, highlight and text-color marks in saved text", () => {
    const saved = doc([{ id: "marks", type: "paragraph", props: {}, content: [
      { type: "text", text: "under", marks: [{ type: "underline" }] },
      { type: "text", text: "sub", marks: [{ type: "subscript" }] },
      { type: "text", text: "sup", marks: [{ type: "superscript" }] },
      { type: "text", text: "lit", marks: [{ type: "highlight", attrs: { color: "yellow" } }] },
      { type: "text", text: "red", marks: [{ type: "textColor", attrs: { color: "red" } }] },
    ] }]);
    const { container } = render(<Editor.View doc={saved} />);
    const block = container.querySelector("[data-id='marks']")!;
    expect(block.querySelector("u")?.textContent).toBe("under");
    expect(block.querySelector("sub")?.textContent).toBe("sub");
    expect(block.querySelector("sup")?.textContent).toBe("sup");
    expect(block.querySelector("mark[data-jul-editor-highlight='yellow']")?.textContent).toBe("lit");
    expect(block.querySelector("span[data-jul-editor-color='red']")?.textContent).toBe("red");
  });

  it("uses heading and table semantics while retaining editor theme hooks", () => {
    const saved = doc([
      { id: "heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Report" }] },
      { id: "table", type: "table", props: { headerRow: true }, children: [
        { id: "header", type: "tableRow", props: {}, children: [
          { id: "head-cell", type: "tableCell", props: {}, content: [{ type: "text", text: "Name" }] },
        ] },
        { id: "body", type: "tableRow", props: {}, children: [
          { id: "body-cell", type: "tableCell", props: { colspan: 2 }, content: [{ type: "text", text: "Ada" }] },
        ] },
      ] },
    ]);
    const { container } = render(<Editor.View doc={saved} />);
    expect(container.querySelector("[data-id='heading'] h2[data-jul-editor-content]")?.textContent).toBe("Report");
    expect(container.querySelector("[data-id='table'] > table[data-jul-editor-children] thead tr[data-id='header'] th[data-id='head-cell']")?.textContent).toBe("Name");
    expect(container.querySelector("[data-id='table'] tbody tr[data-id='body'] td[data-id='body-cell'][colspan='2']")?.textContent).toBe("Ada");
    expect(container.querySelector("[data-id='body-cell']")?.getAttribute("data-jul-editor-colspan")).toBe("2");
  });

  it("sanitizes image, embed, attachment and marked-link URLs", () => {
    const saved = doc([
      { id: "bad-image", type: "image", props: { src: "javascript:alert(1)", alt: "bad" } },
      { id: "good-image", type: "image", props: { src: "https://images.example/a.png", alt: "good" } },
      { id: "bad-embed", type: "embed", props: { provider: "link", url: "javascript:alert(1)", title: "bad link" } },
      { id: "video", type: "embed", props: { provider: "youtube", id: "dQw4w9WgXcQ", title: "video" } },
      { id: "attachment", type: "attachment", props: { src: "data:text/html,evil", name: "report.pdf" } },
      { id: "link", type: "paragraph", props: {}, content: [{ type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    ]);
    const { container } = render(<Editor.View doc={saved} />);
    expect(container.querySelector("[data-id='bad-image'] img")?.getAttribute("src")).toBeNull();
    expect(container.querySelector("[data-id='good-image'] img")?.getAttribute("src")).toBe("https://images.example/a.png");
    expect(container.querySelector("[data-id='bad-embed'] a")).toBeNull();
    expect(container.querySelector("[data-id='video'] iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(container.querySelector("[data-id='video'] iframe")?.hasAttribute("sandbox")).toBe(true);
    expect(container.querySelector("[data-id='attachment'] a")).toBeNull();
    expect(container.querySelector("[data-id='link'] a")).toBeNull();
  });
});
