import type { Doc, Editor as CoreEditor } from "@jul-editor/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type VoidRendererProps } from "./";

afterEach(cleanup);

const doc: Doc = { version: 1, blocks: [{ id: "image-1", type: "image", props: { src: "x.png" } }] };
const editors = new Map<string, CoreEditor>();

function LocaleView({ block, editor, locale }: VoidRendererProps) {
  editors.set(block.id, editor);
  return <span data-testid={block.id}>{locale}</span>;
}

describe("void renderer locale", () => {
  it("updates per editor without remounting either editor", () => {
    const { rerender } = render(<>
      <Editor defaultValue={doc} locale="en" renderers={{ image: LocaleView }}><Editor.Content /></Editor>
      <Editor defaultValue={{ ...doc, blocks: [{ ...doc.blocks[0]!, id: "image-2" }] }} locale="ko" renderers={{ image: LocaleView }}><Editor.Content /></Editor>
    </>);
    expect(screen.getByTestId("image-1").textContent).toBe("en");
    expect(screen.getByTestId("image-2").textContent).toBe("ko");
    const first = editors.get("image-1");
    const second = editors.get("image-2");

    rerender(<>
      <Editor defaultValue={doc} locale="ko" renderers={{ image: LocaleView }}><Editor.Content /></Editor>
      <Editor defaultValue={{ ...doc, blocks: [{ ...doc.blocks[0]!, id: "image-2" }] }} locale="en" renderers={{ image: LocaleView }}><Editor.Content /></Editor>
    </>);
    expect(screen.getByTestId("image-1").textContent).toBe("ko");
    expect(screen.getByTestId("image-2").textContent).toBe("en");
    expect(editors.get("image-1")).toBe(first);
    expect(editors.get("image-2")).toBe(second);
  });
});
