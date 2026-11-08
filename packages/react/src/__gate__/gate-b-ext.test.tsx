// Third-party extensibility contract, exercised ONLY through public
// exports (@jul-editor/core, @jul-editor/react), no library edits. (Control, verified
// passing and removed: a custom VOID block gets renderer + slash item + md
// fence serde + fromHTML paste hook.)
import type { Doc } from "@jul-editor/core";
import { coreBlocks, coreInlines, coreMarks, createRegistry, defineBlock, getProp, newId } from "@jul-editor/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "..";
import type { VoidRendererProps } from "..";

afterEach(() => cleanup());

const embed = defineBlock({
  type: "embed",
  content: "none",
  children: "none",
  props: { url: "" },
  slash: { title: "Embed", keywords: ["embed", "youtube"] },
  toMarkdown: (b, ctx) => "```jul-editor-embed\n" + String(getProp(b, "url", ctx.registry)) + "\n```",
  fromMarkdown: { fence: "jul-editor-embed", parse: (tk) => ({ id: newId(), type: "embed", props: { url: tk.text.trim() } }) },
  toHTML: (b, ctx) => `<div data-embed-url="${ctx.escapeAttr(String(getProp(b, "url", ctx.registry)))}"></div>`,
  fromHTML: { selector: "div[data-embed-url]", parse: (el) => ({ id: newId(), type: "embed", props: { url: el.getAttribute("data-embed-url") ?? "" } }) },
  toText: (b, ctx) => String(getProp(b, "url", ctx.registry)),
});
// Notion-style callout: editable inline text + a decoration (icon) the app wants to render with React.
const callout = defineBlock({ type: "callout", content: "inline", children: "none", props: { icon: "!" }, slash: { title: "Callout" } });
const blocks = [embed, callout];
const registry = createRegistry({ blocks: [...coreBlocks, ...blocks], inlines: coreInlines, marks: coreMarks });

function Embed({ block }: VoidRendererProps) {
  return <iframe data-testid="embed" title="e" src={String(block.props.url)} />;
}
function Callout({ block }: VoidRendererProps) {
  return <span data-testid="callout-icon">{String(block.props.icon ?? "!")}</span>;
}

describe("extensibility", () => {
  it("a custom block WITH editable inline content (callout) can get a React renderer for its decoration", () => {
    const d: Doc = { version: 1, blocks: [{ id: "c1", type: "callout", props: { icon: "*" }, content: [{ type: "text", text: "note" }] }] };
    const { queryByTestId } = render(
      <Editor defaultValue={d} blocks={blocks} renderers={{ callout: Callout }}>
        <Editor.Content />
      </Editor>,
    );
    expect(queryByTestId("callout-icon")?.textContent).toBe("*");
  });
});
