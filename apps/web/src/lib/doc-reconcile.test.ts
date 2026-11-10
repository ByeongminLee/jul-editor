// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Block } from "@jul-editor/core";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { diffDocs } from "@jul-editor/plugins/diff";
import { workspaceRegistry } from "../components/workspace/workspace-registry.js";
import { canonicalDoc, reconcileIds } from "./doc-reconcile.js";
import { demoDoc } from "./sample.js";

const registry = workspaceRegistry;
const markdownKey = (block: Block) => toMarkdown({ version: 1, blocks: [block] }, { registry }).markdown;
const htmlKey = (block: Block) => toHTML({ version: 1, blocks: [block] }, { registry });

describe("reconcileIds", () => {
  it("keeps block ids when edited Markdown is applied, so Diff shows only the new block", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const markdown = toMarkdown(doc, { registry }).markdown + "\n\nADDED\n";
    const parsed = canonicalDoc(fromMarkdown(markdown, { registry }).doc, registry);
    const next = reconcileIds(doc, parsed, markdownKey);
    const { stats } = diffDocs(doc, next, registry);
    expect(stats).toMatchObject({ inserted: 1, deleted: 0, modified: 0, moved: 0 });
    expect(next.blocks.slice(0, -1).map((block) => block.id)).toEqual(doc.blocks.map((block) => block.id));
    expect(next.blocks.at(-1)!.content).toEqual([{ type: "text", text: "ADDED" }]);
    // Untouched blocks are the same objects, with props Markdown cannot express.
    expect(next.blocks.find((block) => block.id === "demo-image")).toBe(doc.blocks.find((block) => block.id === "demo-image"));
  });

  it("keeps ids for edited HTML and reports an edited block as modified", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const html = toHTML(doc, { registry }).replace("Review the changes", "Review every change");
    const parsed = canonicalDoc(fromHTML(html, { registry }).doc, registry);
    const next = reconcileIds(doc, parsed, htmlKey);
    const { stats } = diffDocs(doc, next, registry);
    expect(stats).toMatchObject({ inserted: 0, deleted: 0, modified: 1, moved: 0 });
    expect(next.blocks.find((block) => block.id === "demo-heading")?.content).toEqual([{ type: "text", text: "Review every change" }]);
  });

  it("keeps the id of a block that only moved", () => {
    const doc = canonicalDoc(demoDoc(), registry);
    const fresh = (block: Block): Block => ({ ...block, id: `${block.id}-new`, children: block.children?.map(fresh) });
    const blocks = doc.blocks.map(fresh);
    const [moved] = blocks.splice(1, 1);
    blocks.push(moved!);
    const next = reconcileIds(doc, { ...doc, blocks });
    expect(next.blocks.at(-1)!.id).toBe("demo-subtitle");
    expect(next.blocks.map((block) => block.id).sort()).toEqual(doc.blocks.map((block) => block.id).sort());
  });
});

it.each([['Markdown', markdownKey, toMarkdown, fromMarkdown], ['HTML', htmlKey, toHTML, fromHTML]] as const)('applies edited %s table cells', (_format, key, serialize, parse) => {
  const original = canonicalDoc(fromMarkdown('| A | B |\n| --- | --- |\n| old | value |', { registry }).doc, registry);
  const result = serialize(original, { registry });
  const source = typeof result === 'string' ? result : result.markdown;
  const parsed = canonicalDoc(parse(source.replace('old', 'new'), { registry }).doc, registry);
  const next = reconcileIds(original, parsed, key);
  expect(JSON.stringify(next)).toContain('new');
  expect(JSON.stringify(next)).not.toContain('old');
});

it('keeps identical table cells apart when one of them is edited', () => {
  const original = canonicalDoc(fromMarkdown('| A | B |\n| --- | --- |\n| same | same |', { registry }).doc, registry);
  const parsed = canonicalDoc(fromMarkdown('| A | B |\n| --- | --- |\n| same | changed |', { registry }).doc, registry);
  const cells = (doc: typeof original) => doc.blocks[0]!.children![1]!.children!;
  const next = reconcileIds(original, parsed, markdownKey);
  expect(cells(next)[0]).toBe(cells(original)[0]);
  expect(cells(next)[1]!.id).toBe(cells(original)[1]!.id);
  expect(cells(next)[1]!.content).toEqual([{ type: 'text', text: 'changed' }]);
  expect(next.blocks[0]!.children![0]).toBe(original.blocks[0]!.children![0]);
});

it.each([['Markdown', markdownKey, toMarkdown, fromMarkdown, 'bulletListItem'], ['HTML', htmlKey, toHTML, fromHTML, 'bulletListItem']] as const)('preserves an unchanged nested image after a sibling edit in %s', (_format, key, serialize, parse, type) => {
  const original = canonicalDoc({ version: 1, blocks: [{ id: 'parent', type, props: {}, content: [{ type: 'text', text: 'item' }], children: [
    { id: 'image', type: 'image', props: { src: 'https://example.com/a.png', width: 200, assetId: 'asset' } },
    { id: 'sibling', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'old' }] },
  ] }] }, registry);
  const result = serialize(original, { registry });
  const source = typeof result === 'string' ? result : result.markdown;
  const parsed = canonicalDoc(parse(source.replace('old', 'new'), { registry }).doc, registry);
  const next = reconcileIds(original, parsed, key);
  expect(next.blocks[0]!.children![0]).toBe(original.blocks[0]!.children![0]);
  expect(next.blocks[0]!.children![1]!.content).toEqual([{ type: 'text', text: 'new' }]);
});

it('applies an explicitly edited nested HTML image width', () => {
  const original = canonicalDoc({ version: 1, blocks: [{ id: 'quote', type: 'quote', props: {}, content: [{ type: 'text', text: 'item' }], children: [
    { id: 'image', type: 'image', props: { src: 'https://example.com/a.png', width: 200 } },
  ] }] }, registry);
  const source = toHTML(original, { registry }).replace('width="200"', 'width="300"');
  const next = reconcileIds(original, canonicalDoc(fromHTML(source, { registry }).doc, registry), htmlKey);
  expect(next.blocks[0]!.children![0]!.props.width).toBe(300);
  expect(next.blocks[0]!.children![0]!.id).toBe('image');
});

it('does not restore children absent from the parsed document when source keys match', () => {
  const original = canonicalDoc({ version: 1, blocks: [{ id: 'list', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'item' }], children: [
    { id: 'image', type: 'image', props: { src: 'https://example.com/a.png' } },
  ] }] }, registry);
  const parsed = canonicalDoc(fromHTML('<ul><li>item</li></ul>', { registry }).doc, registry);
  expect(reconcileIds(original, parsed, () => 'same source').blocks[0]!.children ?? []).toHaveLength(0);
});

it('applies a changed HTML table span', () => {
  const original = canonicalDoc(fromMarkdown('| A | B |\n| --- | --- |\n| C | D |', { registry }).doc, registry);
  const source = toHTML(original, { registry }).replace('<td', '<td colspan="2"');
  const parsed = canonicalDoc(fromHTML(source, { registry }).doc, registry);
  const next = reconcileIds(original, parsed, htmlKey);
  expect(next.blocks[0]!.children![1]!.children![0]!.props.colspan).toBe(2);
});
