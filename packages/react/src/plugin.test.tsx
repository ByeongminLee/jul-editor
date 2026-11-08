import type { Doc } from "@jul-editor/core";
import { buildTableBlock, coreBlocks, coreInlines, coreMarks, createRegistry, defineBlock, newId } from "@jul-editor/core";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Editor, useEditor } from "./";
import type { VoidRendererProps } from "./";

beforeEach(() => {
  const range = Range.prototype as unknown as { getClientRects?: () => unknown[]; getBoundingClientRect?: () => DOMRect };
  range.getClientRects ??= () => [];
  range.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => {
  cleanup();
  currentEditor = null;
});

const callout = defineBlock({ type: "callout", content: "inline", children: "none", props: { icon: "!" } });
const doc: Doc = { version: 1, blocks: [{ id: "c1", type: "callout", props: { icon: "*" }, content: [{ type: "text", text: "note" }] }] };

function Callout({ block }: VoidRendererProps) {
  return <span data-testid="callout-icon">{String(block.props.icon)}</span>;
}

let currentEditor: ReturnType<typeof useEditor>;
function Probe() {
  currentEditor = useEditor();
  return null;
}

it("Editor.Plugin contributes a block renderer and core lifecycle hook before editing", () => {
  const committed: string[] = [];
  render(
    <Editor defaultValue={doc}>
      <Editor.Content />
      <Editor.Plugin blocks={[callout]} renderers={{ callout: Callout }} onCommit={({ state }) => committed.push(String((state.store.records.get("c1")?.content?.[0] as { text?: string } | undefined)?.text))} />
      <Probe />
    </Editor>,
  );

  expect(screen.getByTestId("callout-icon").textContent).toBe("*");
  act(() => currentEditor!.update((tx) => tx.insertText({ blockId: "c1", offset: 4 }, "!")));
  expect(currentEditor!.getDoc().blocks[0]?.content).toEqual([{ type: "text", text: "note!" }]);
  expect(committed).toContain("note!");
});

it("Editor.Plugin slashItems are available in Editor.SlashMenu without extraItems", async () => {
  const slashDoc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
  render(
    <Editor defaultValue={slashDoc}>
      <Editor.Plugin renderers={{ chart: Callout }} slashItems={[{ type: "chart", title: "Live chart", keywords: ["chart"], create: () => ({ id: "chart1", type: "chart", props: {} }) }]} />
      <Editor.Content />
      <Editor.SlashMenu>{({ items }) => <div data-testid="slash-title">{items.find((item) => item.type === "chart")?.title}</div>}</Editor.SlashMenu>
      <Probe />
    </Editor>,
  );

  act(() => currentEditor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
  act(() => document.querySelector('[data-jul-editor-root]')!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  expect(screen.getByTestId("slash-title").textContent).toBe("Live chart");
});

it("SlashMenu items can remove, relabel, and add commands before search and selection", async () => {
  const slashDoc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
  render(<Editor defaultValue={slashDoc}>
    <Editor.Plugin blocks={[metric]} renderers={{ metric: Metric }} />
    <Editor.Content />
    <Editor.SlashMenu items={(defaults) => [
      ...defaults.filter((item) => item.id !== "heading-2").map((item) => item.id === "heading-1" ? { ...item, title: "Main title" } : item),
      { id: "custom-metric", type: "metric", title: "Metric card", description: "Insert a metric", keywords: ["metric"], create: () => ({ id: "metric-new", type: "metric", props: { label: "Score", value: 5 } }) },
    ]}>{({ items, getListboxProps, getOptionProps }) => <div {...getListboxProps()}>
      {items.map((item, index) => <div key={item.id} {...getOptionProps(index)}>{item.title}{item.description && <small>{item.description}</small>}</div>)}
    </div>}</Editor.SlashMenu>
    <Probe />
  </Editor>);
  act(() => currentEditor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
  act(() => document.querySelector("[data-jul-editor-root]")!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  expect(screen.getByRole("option", { name: "Main title" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Heading 2" })).toBeNull();
  fireEvent.mouseDown(screen.getByRole("option", { name: /Metric card/ }));
  expect(currentEditor!.getDoc().blocks.some((block) => block.type === "metric" && block.props.label === "Score")).toBe(true);
});

it("Editor.SlashMenu hides void commands without an installed renderer", async () => {
  const slashDoc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
  render(
    <Editor defaultValue={slashDoc}>
      <Editor.Content />
      <Editor.SlashMenu>{({ items }) => <div data-testid="slash-types">{items.map((item) => item.type).join(",")}</div>}</Editor.SlashMenu>
      <Probe />
    </Editor>,
  );

  act(() => currentEditor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
  act(() => document.querySelector('[data-jul-editor-root]')!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  const types = screen.getByTestId("slash-types").textContent ?? "";
  expect(types).toContain("paragraph");
  expect(types).toContain("divider");
  expect(types).not.toMatch(/image|embed|chart|diagram|dataTable/);
});

it("Editor.Content renders the built-in divider without a React plugin", () => {
  const dividerDoc: Doc = { version: 1, blocks: [{ id: "divider-1", type: "divider", props: {} }] };
  const { container } = render(<Editor defaultValue={dividerDoc}><Editor.Content /></Editor>);
  expect(container.querySelector('[data-type="divider"] hr')).not.toBeNull();
});

it("Editor.Plugin renderers replace void views and decorate the editable table", () => {
  const blocks = [
    { id: "chart-1", type: "chart", props: {} },
    { id: "diagram-1", type: "diagram", props: {} },
    { id: "data-table-1", type: "dataTable", props: {} },
    buildTableBlock(1, 1),
  ];
  const renderers = Object.fromEntries(["chart", "diagram", "dataTable", "table"].map((type) => [type, () => <span data-testid={`override-${type}`}>{type}</span>]));
  render(<Editor defaultValue={{ version: 1, blocks }}><Editor.Plugin renderers={renderers} /><Editor.Content /></Editor>);
  for (const type of ["chart", "diagram", "dataTable", "table"]) expect(screen.getByTestId(`override-${type}`).textContent).toBe(type);
});

const metric = defineBlock({
  type: "metric",
  content: "none",
  children: "none",
  props: { label: "", value: 0 },
  slash: { title: "Metric", keywords: ["metric"], props: { label: "Revenue", value: 7 } },
  toMarkdown: (block) => `\`\`\`jul-editor-metric\n${JSON.stringify(block.props)}\n\`\`\``,
  fromMarkdown: { fence: "jul-editor-metric", parse: (token) => ({ id: newId(), type: "metric", props: JSON.parse(token.text) }) },
  toHTML: (block, ctx) => `<figure data-jul-editor-type="metric" data-jul-editor-props="${ctx.escapeAttr(JSON.stringify(block.props))}"></figure>`,
});
const metricRegistry = createRegistry({ blocks: [...coreBlocks, metric], inlines: coreInlines, marks: coreMarks });

function Metric({ block, updateProps }: VoidRendererProps) {
  return <button onClick={() => updateProps({ value: Number(block.props.value) + 1 })}>Increment metric</button>;
}

it("a custom void plugin inserts from slash, edits props, and round-trips through Markdown and HTML", async () => {
  const slashDoc: Doc = { version: 1, blocks: [{ id: "p1", type: "paragraph", props: {}, content: [] }] };
  render(
    <Editor defaultValue={slashDoc}>
      <Editor.Plugin blocks={[metric]} renderers={{ metric: Metric }} />
      <Editor.Content />
      <Editor.SlashMenu>{({ items, getListboxProps, getOptionProps }) => <div {...getListboxProps()}>{items.map((item, i) => <div key={item.id} {...getOptionProps(i)}>{item.title}</div>)}</div>}</Editor.SlashMenu>
      <Probe />
    </Editor>,
  );

  act(() => currentEditor!.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } })));
  act(() => document.querySelector("[data-jul-editor-root]")!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "/", bubbles: true, cancelable: true })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  fireEvent.mouseDown(screen.getByRole("option", { name: "Metric" }));
  expect(currentEditor!.getDoc().blocks.find((block) => block.type === "metric")?.props).toEqual({ label: "Revenue", value: 7 });
  fireEvent.click(screen.getByRole("button", { name: "Increment metric" }));
  const edited = currentEditor!.getDoc();
  expect(edited.blocks.find((block) => block.type === "metric")?.props).toEqual({ label: "Revenue", value: 8 });

  const markdown = toMarkdown(edited, { registry: metricRegistry });
  expect(markdown.lossy).toEqual([]);
  expect(fromMarkdown(markdown.markdown, { registry: metricRegistry }).doc.blocks.find((block) => block.type === "metric")?.props).toEqual({ label: "Revenue", value: 8 });
  expect(fromHTML(toHTML(edited, { registry: metricRegistry }), { registry: metricRegistry }).doc.blocks.find((block) => block.type === "metric")?.props).toEqual({ label: "Revenue", value: 8 });
});
