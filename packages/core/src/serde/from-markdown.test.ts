import { expect, it } from "vitest";
import { fromMarkdown } from "./from-markdown.js";

it('round-trips a large embedded raster image', () => {
  const src = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024);
  const result = fromMarkdown(`![large](${src})`);
  expect(result.doc.blocks[0]?.props.src).toBe(src);
});

it('preserves literal data URLs while rejecting them as links', () => {
  const src = 'data:image/png;base64,aGVsbG8=';
  const result = fromMarkdown(`literal ${src}\n\n\`\`\`\n${src}\n\`\`\`\n\n[unsafe](${src})`);
  expect(JSON.stringify(result.doc)).toContain(src);
  const link = result.doc.blocks.at(-1)?.content?.[0];
  expect(JSON.stringify(link)).not.toContain('"link"');
});
