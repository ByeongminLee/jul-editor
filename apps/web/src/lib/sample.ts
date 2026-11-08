import type { Block, Doc } from "@jul-editor/core";

/** Small, real document blocks shared by the home, playground, and themes. */
export function mediaExampleBlocks(prefix: string, locale: "en" | "ko"): Block[] {
  const ko = locale === "ko";
  const cell = (id: string, text: string): Block => ({ id: `${prefix}-${id}`, type: "tableCell", props: {}, content: [{ type: "text", text }] });
  return [
    { id: `${prefix}-image`, type: "image", props: {
      src: "/editor-canvas.svg", alt: ko ? "JulEditor 문서 화면 구성 그림" : "Illustration of the JulEditor canvas",
      caption: ko ? "이미지는 URL이나 업로드 결과로 연결할 수 있습니다." : "Images can point to a URL or an uploaded asset.", width: 420,
    } },
    { id: `${prefix}-table`, type: "table", props: { headerRow: true }, children: [
      { id: `${prefix}-table-head`, type: "tableRow", props: {}, children: [cell("cell-head-1", ko ? "채널" : "Channel"), cell("cell-head-2", ko ? "구독자" : "Subscribers")] },
      { id: `${prefix}-table-docs`, type: "tableRow", props: {}, children: [cell("cell-docs-1", ko ? "문서" : "Docs"), cell("cell-docs-2", "1,240")] },
      { id: `${prefix}-table-showcase`, type: "tableRow", props: {}, children: [cell("cell-showcase-1", ko ? "쇼케이스" : "Showcase"), cell("cell-showcase-2", "880")] },
    ] },
    { id: `${prefix}-code`, type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: `export const theme = {\n  accent: "#f97316",\n  radius: 8,\n};` }] },
  ];
}

export function introDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "intro-title", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Release notes draft" }] },
      { id: "intro-lead", type: "paragraph", props: {}, content: [
        { type: "text", text: "Summarize your next release in one sentence. " },
        { type: "text", text: "Edit this sentence", marks: [{ type: "bold" }] },
        { type: "text", text: ", then open the Markdown, HTML, or Diff tab to inspect the result." },
      ] },
      { id: "intro-list", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Move this block or type / to add another one." }] },
      ...mediaExampleBlocks("intro", "en"),
      { id: "intro-empty", type: "paragraph", props: {}, content: [] },
    ],
  };
}

export function demoDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "demo-title", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Product update draft" }] },
      { id: "demo-subtitle", type: "paragraph", props: {}, content: [
        { type: "text", text: "This sample uses " },
        { type: "text", text: "JulEditor", marks: [{ type: "bold" }] },
        { type: "text", text: ". Edit the content, then use the tabs above to inspect its source or compare changes." },
      ] },
      { id: "demo-tags", type: "paragraph", props: {}, content: [
        { type: "text", text: "Add an " },
        { type: "mention", attrs: { kind: "tag", id: "idea", label: "idea" } },
        { type: "text", text: " tag and mention " },
        { type: "mention", attrs: { kind: "user", id: "mina", label: "Mina" } },
        { type: "text", text: ". Type # or @ to open the matching menu." },
      ] },
      { id: "demo-heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Review the changes" }] },
      { id: "demo-p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Select this paragraph to change its formatting, or move a block to adjust the order. The other tabs read from the same document." }] },
      { id: "demo-list-1", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Drag the handle on the left to move this item." }] },
      { id: "demo-list-2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Type / in a new paragraph to add a block." }] },
      { id: "demo-list-3", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Open the tabs above to inspect Markdown, HTML, or JSON." }] },
      { id: "demo-quote", type: "quote", props: {}, content: [{ type: "text", text: "Open Diff to see which blocks changed since the saved version." }] },
      { id: "demo-chart-heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Customer feedback by month" }] },
      { id: "demo-chart", type: "chart", props: { kind: "bar", source: { type: "inline", csv: "month,feedback\nJan,12\nFeb,18\nMar,15\nApr,26\nMay,31" }, x: "month", y: "feedback" } },
      ...mediaExampleBlocks("demo", "en"),
      { id: "demo-code-workspace", type: "codeWorkspace", props: {
        title: "JulEditor/site", showTree: true, showTabs: true, showLineNumbers: true,
        files: [
          { path: "src/Button.tsx", language: "typescript", code: "type ButtonProps = { label: string };\n\nexport function Button({ label }: ButtonProps) {\n  return <button className=\"primary\">{label}</button>;\n}", addedLines: [4] },
          { path: "src/theme.css", language: "css", code: ":root {\n  --accent: #f97316;\n  --radius: 8px;\n}", addedLines: [2], removedLines: [3] },
          { path: "README.md", language: "markdown", code: "# Site components\n\nThe button uses the shared orange theme." },
        ],
      } },
      { id: "demo-end", type: "paragraph", props: {}, content: [{ type: "text", text: "Click the chart to change its data or display. It comes from an optional plugin." }] },
      { id: "demo-blank", type: "paragraph", props: {}, content: [] },
    ],
  };
}
