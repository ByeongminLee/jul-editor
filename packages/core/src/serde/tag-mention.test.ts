// @vitest-environment jsdom
import { expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Doc } from "../model/types.js";
import { fromHTML, fromMarkdown, toHTML, toMarkdown, toText } from "./";

it("tag mentions display with # and round-trip through Markdown and HTML", () => {
  const doc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [
    { type: "text", text: "See " },
    { type: "mention", attrs: { kind: "tag", id: "research", label: "research" } },
  ] }] };
  const { markdown } = toMarkdown(doc, { registry: coreRegistry });
  const html = toHTML(doc, { registry: coreRegistry });

  expect(markdown).toBe("See [#research](jul-editor:tag/research)");
  expect(html).toBe('<p data-jul-editor-type="paragraph">See <a data-mention data-kind="tag" data-id="research" href="jul-editor:tag/research">#research</a></p>');
  expect(toText(doc, { registry: coreRegistry })).toBe("See #research");
  expect(fromMarkdown(markdown, { registry: coreRegistry }).doc.blocks[0]?.content?.[1]).toEqual(doc.blocks[0]?.content?.[1]);
  expect(fromHTML(html, { registry: coreRegistry }).doc.blocks[0]?.content?.[1]).toEqual(doc.blocks[0]?.content?.[1]);
});
