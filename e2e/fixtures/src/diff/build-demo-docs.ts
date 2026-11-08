// Demo docs for the "/diff" playground route + e2e/diff.spec.ts (a shared
// module so both sides build the exact same before/after and the e2e test
// can cross-check the rendered stats against @jul-editor/plugins/diff's own
// diffStats independently). The 500-block "after" is a hand mutation
// exercising every scenario: a text edit, a format-only
// change (marks differ, text identical), an indent (reparent -> move), a
// reorder (same parent, different index -> move), an insert, a delete, and a
// props change on both a todoListItem.checked and a chart.kind. The
// 5000-block "after" just reuses the existing seeded mutateFixture (scale is
// the point there, not variety of scenarios).
//
// Takes the "before" fixture Doc as a plain parameter (rather than importing
// the bench/fixtures/*.json itself) so this module has no bundler-specific
// JSON-import syntax: the playground (Vite) and e2e/diff.spec.ts (plain Node,
// via Playwright's own test loader, which doesn't accept a bare JSON import
// the way Vite's resolveJsonModule handling does) each load the fixture file
// their own way and pass the parsed Doc in.
import type { Block, Doc } from "@jul-editor/core";
import { isText, newId } from "@jul-editor/core";
// MutateFixture is intentionally not part of @jul-editor/plugins/diff's
// public barrel (bench/test-only helper, see packages/plugins/src/diff/mutate.ts's
// own header comment) -- reached via a direct relative import, same as
// e2e's existing pattern of importing straight from packages/core/src for
// things the public API doesn't (need to) expose.
import { mutateFixture } from "../../../../packages/plugins/src/diff/mutate.js";

function findBlock(blocks: Block[], type: string): Block | undefined {
  for (const b of blocks) {
    if (b.type === type) return b;
    if (b.children) {
      const found = findBlock(b.children, type);
      if (found) return found;
    }
  }
  return undefined;
}

function mutate500(before: Doc): Doc {
  const after: Doc = structuredClone(before);

  // 1. Text edit on the first paragraph that has text.
  const edited = after.blocks.find((b) => b.type === "paragraph" && b.content?.[0]?.type === "text");
  const firstInline = edited?.content?.[0];
  if (edited && firstInline && isText(firstInline)) edited.content![0] = { ...firstInline, text: `${firstInline.text} (edited)` };

  // 2. Format-only change: same text, a mark added -- on a *different*
  // paragraph than the text edit above.
  const formatted = after.blocks.find((b) => b.type === "paragraph" && b !== edited && b.content?.[0]?.type === "text");
  const formatInline = formatted?.content?.[0];
  if (formatted && formatInline && isText(formatInline)) formatted.content![0] = { ...formatInline, marks: [{ type: "bold" }] };

  // 3. Indent: reparent the second root-level bulletListItem under its
  // preceding sibling (Notion Tab behavior -- a reparent, so the diff
  // engine reports it as a 'move', not a delete+insert).
  const rootBullets = after.blocks.filter((b) => b.type === "bulletListItem");
  if (rootBullets.length >= 2) {
    const idx = after.blocks.indexOf(rootBullets[1]!);
    const prev = idx > 0 ? after.blocks[idx - 1] : undefined;
    if (prev) {
      after.blocks.splice(idx, 1);
      prev.children = [...(prev.children ?? []), rootBullets[1]!];
    }
  }

  // 4. Reorder: swap two adjacent root-level orderedListItems (same parent,
  // different index -> also a 'move', via the LIS-exclusion path).
  const orderedIdx = after.blocks.reduce<number[]>((acc, b, i) => (b.type === "orderedListItem" ? [...acc, i] : acc), []);
  if (orderedIdx.length >= 2) {
    const i = orderedIdx[0]!;
    const j = orderedIdx[1]!;
    const tmp = after.blocks[i]!;
    after.blocks[i] = after.blocks[j]!;
    after.blocks[j] = tmp;
  }

  // 5. Props changes.
  const todo = findBlock(after.blocks, "todoListItem");
  if (todo) todo.props = { ...todo.props, checked: !todo.props.checked };
  const chart = findBlock(after.blocks, "chart");
  if (chart) chart.props = { ...chart.props, kind: chart.props.kind === "bar" ? "line" : "bar" };

  // 6. Insert + delete.
  after.blocks.push({ id: newId(), type: "paragraph", props: {}, content: [{ type: "text", text: "newly inserted" }] });
  const deletable = after.blocks.find((b) => b.type === "codeBlock");
  if (deletable) after.blocks.splice(after.blocks.indexOf(deletable), 1);

  return after;
}

/** `before` is whichever fixture (bench/fixtures/doc-500.json or
 * doc-5000.json) the caller loaded -- see the module doc comment for why
 * loading it is the caller's job, not this function's. */
export function buildDiffDemoDocs(before: Doc, size: 500 | 5000): { before: Doc; after: Doc } {
  if (size === 5000) {
    const { doc: after } = mutateFixture(before, 42);
    return { before, after };
  }
  return { before, after: mutate500(before) };
}
