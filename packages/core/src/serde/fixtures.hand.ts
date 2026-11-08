// Hand-built fixture covering every built-in block type and mark, for the
// round-trip invariant test. Deliberately avoids any lossy feature
// (image width/assetId, table headerRow:false, opts.strict) so the whole
// doc round-trips losslessly and the test can compare structurally as-is.
import type { Doc } from "../model/types.js";

export const handFixture: Doc = {
  version: 1,
  blocks: [
    {
      id: "p1",
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "italic", marks: [{ type: "italic" }] },
        { type: "text", text: " and " },
        { type: "text", text: "strike", marks: [{ type: "strike" }] },
        { type: "text", text: " and " },
        { type: "text", text: "code(x)", marks: [{ type: "code" }] },
        { type: "text", text: " and a " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com/a" } }] },
        { type: "text", text: " and " },
        { type: "mention", attrs: { kind: "user", id: "u1", label: "Alice" } },
        { type: "text", text: " done." },
      ],
    },
    { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "A Heading" }] },
    {
      id: "b1",
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: "bullet one" }],
      children: [{ id: "b1a", type: "bulletListItem", props: {}, content: [{ type: "text", text: "nested bullet" }] }],
    },
    { id: "b2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "bullet two" }] },
    { id: "o1", type: "orderedListItem", props: {}, content: [{ type: "text", text: "ordered one" }] },
    { id: "o2", type: "orderedListItem", props: {}, content: [{ type: "text", text: "ordered two" }] },
    { id: "t1", type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "done thing" }] },
    { id: "t2", type: "todoListItem", props: { checked: false }, content: [{ type: "text", text: "todo thing" }] },
    { id: "q1", type: "quote", props: {}, content: [{ type: "text", text: "a quoted line" }] },
    {
      id: "c1",
      type: "codeBlock",
      props: { language: "js" },
      content: [{ type: "text", text: "const s = `template`;\nfunction f() {}\n" }],
    },
    { id: "d1", type: "divider", props: {} },
    { id: "img1", type: "image", props: { src: "https://example.com/a.png", alt: "an image" } },
    {
      id: "tbl1",
      type: "table",
      props: { headerRow: true },
      children: [
        {
          id: "tr1",
          type: "tableRow",
          props: {},
          children: [
            { id: "tc1", type: "tableCell", props: {}, content: [{ type: "text", text: "H1" }] },
            { id: "tc2", type: "tableCell", props: {}, content: [{ type: "text", text: "H2" }] },
          ],
        },
        {
          id: "tr2",
          type: "tableRow",
          props: {},
          children: [
            { id: "tc3", type: "tableCell", props: {}, content: [{ type: "text", text: "a | b" }] },
            { id: "tc4", type: "tableCell", props: {}, content: [{ type: "text", text: "*star*" }] },
          ],
        },
      ],
    },
    { id: "ch1", type: "chart", props: { kind: "line", source: { type: "inline", csv: "x,y\n1,2" } } },
    { id: "dg1", type: "diagram", props: { code: "graph TD; A-->B;" } },
    { id: "dt1", type: "dataTable", props: { source: { type: "inline", csv: "a,b\n1,2" } } },
    { id: "pEnd", type: "paragraph", props: {}, content: [{ type: "text", text: "the end" }] },
  ],
};
