// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { Editor } from "./";

it("server-renders a saved document without DOM access or editing controls", () => {
  const html = renderToString(<Editor.View doc={{ version: 1, blocks: [
    { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "saved" }] },
  ] }} />);
  expect(html).toContain("saved");
  expect(html).toContain("data-jul-editor-block");
  expect(html).not.toMatch(/contenteditable|<input|<textarea/);
});
