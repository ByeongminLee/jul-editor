// @vitest-environment node
//
// SSR: <Editor> only touches the DOM inside an effect, so
// renderToString (which never runs effects) must render the static children
// shell without throwing -- no `window`/`document` access anywhere on this
// path. Run in vitest's `node` environment (no jsdom at all) to actually
// prove that, not just "jsdom happens to tolerate it".

import type { Doc } from "@jul-editor/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Editor } from "./";

function makeDoc(): Doc {
  return { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] };
}

describe("@jul-editor/react SSR", () => {
  it("renderToString does not throw for a full compound tree", () => {
    expect(() =>
      renderToString(
        <Editor defaultValue={makeDoc()}>
          <Editor.Toolbar>
            <Editor.Bold />
            <Editor.Heading level={2} />
          </Editor.Toolbar>
          <Editor.Content />
        </Editor>,
      ),
    ).not.toThrow();
  });

  it("renders the toolbar's static shell (buttons present, not yet interactive)", () => {
    const html = renderToString(
      <Editor defaultValue={makeDoc()}>
        <Editor.Toolbar aria-label="Formatting">
          <Editor.Bold />
        </Editor.Toolbar>
        <Editor.Content />
      </Editor>,
    );
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("Bold");
  });
});
