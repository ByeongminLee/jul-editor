// @vitest-environment jsdom
import { coreRegistry } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiffStats, DiffView, useDiff } from "./";

afterEach(cleanup);

function doc(blocks: Block[]): Doc {
  return { version: 1, blocks };
}

function p(id: string, text: string, extra: Partial<Block> = {}): Block {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text }], ...extra };
}

function blockEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-jul-editor-diff-block][data-id="${id}"]`);
  if (!el) throw new Error(`no diff block for id ${id}`);
  return el as HTMLElement;
}

describe("DiffView: per-node data-diff attributes", () => {
  it("retains the editor's semantic text marks on unchanged blocks", () => {
    const saved = doc([{ id: "marked", type: "paragraph", props: {}, content: [
      { type: "text", text: "under", marks: [{ type: "underline" }] },
      { type: "text", text: "sub", marks: [{ type: "subscript" }] },
      { type: "text", text: "sup", marks: [{ type: "superscript" }] },
      { type: "text", text: "lit", marks: [{ type: "highlight", attrs: { color: "yellow" } }] },
      { type: "text", text: "red", marks: [{ type: "textColor", attrs: { color: "red" } }] },
    ] }]);
    const { container } = render(<DiffView before={saved} after={saved} mode="full" />);
    const block = blockEl(container, "marked");
    expect(block.querySelector("u")?.textContent).toBe("under");
    expect(block.querySelector("sub")?.textContent).toBe("sub");
    expect(block.querySelector("sup")?.textContent).toBe("sup");
    expect(block.querySelector("mark[data-jul-editor-highlight='yellow']")?.textContent).toBe("lit");
    expect(block.querySelector("span[data-jul-editor-color='red']")?.textContent).toBe("red");
  });

  it("insert/delete/modify/same/move each get the right status", () => {
    const before = doc([p("a", "alpha"), p("b", "bravo"), p("c", "charlie")]);
    const after = doc([p("a", "alpha"), p("c2", "charlie edited", { id: "c" }), p("d", "delta")]);
    // a: unchanged (same). b: only in before (delete). c: text changed (modify).
    // d: only in after (insert).
    const { container } = render(<DiffView before={before} after={after} mode="full" />);

    expect(blockEl(container, "a").dataset.diff).toBe("same");
    expect(blockEl(container, "b").dataset.diff).toBe("delete");
    expect(blockEl(container, "c").dataset.diff).toBe("modify");
    expect(blockEl(container, "d").dataset.diff).toBe("insert");
  });

  it("renders inline ins/del with the exact inserted/deleted text", () => {
    const before = doc([p("a", "hello world")]);
    const after = doc([p("a", "hello brave world")]);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    const block = blockEl(container, "a");
    expect(block.querySelector("ins[data-diff-inline='insert']")?.textContent).toBe("brave ");
    expect(block.querySelector("del[data-diff-inline='delete']")).toBeNull();
  });

  it("renders a pure deletion as <del> with the removed text", () => {
    const before = doc([p("a", "hello brave world")]);
    const after = doc([p("a", "hello world")]);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    const block = blockEl(container, "a");
    expect(block.querySelector("del[data-diff-inline='delete']")?.textContent).toBe("brave ");
  });

  it("a deleted node renders at its old position among still-existing siblings", () => {
    const before = doc([p("a", "alpha"), p("b", "bravo"), p("c", "charlie")]);
    const after = doc([p("a", "alpha"), p("c", "charlie")]);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    // Root-level blocks only (this fixture has no nesting) -- b sits between a and c.
    const rootIds = Array.from(container.querySelector("[data-jul-editor-diff-view]")!.children).map((el) => (el as HTMLElement).dataset.id);
    expect(rootIds).toEqual(["a", "b", "c"]);
  });

  it("a move (reparent) gets a move label and a data-diff-from with the old position", () => {
    const before = doc([
      { id: "container1", type: "bulletListItem", props: {}, content: [{ type: "text", text: "one" }] },
      { id: "container2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "two" }] },
      p("x", "moved me"),
    ]);
    const after = doc([
      { id: "container1", type: "bulletListItem", props: {}, content: [{ type: "text", text: "one" }] },
      { id: "container2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "two" }], children: [p("x", "moved me")] },
    ]);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    const moved = blockEl(container, "x");
    expect(moved.dataset.diff).toBe("move");
    expect(moved.querySelector("[data-diff-move-label]")).not.toBeNull();
    const from = JSON.parse(moved.dataset.diffFrom!);
    expect(from).toEqual({ parentId: null, index: 2 });
  });

  it("renders a props change as a <dl data-diff-props>", () => {
    const before = doc([{ id: "t1", type: "todoListItem", props: { checked: false }, content: [{ type: "text", text: "buy milk" }] }]);
    const after = doc([{ id: "t1", type: "todoListItem", props: { checked: true }, content: [{ type: "text", text: "buy milk" }] }]);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    const dl = blockEl(container, "t1").querySelector("dl[data-diff-props]")!;
    expect(dl).not.toBeNull();
    expect(dl.querySelector("[data-diff-prop-key]")?.textContent).toBe("checked");
    expect(dl.querySelector("[data-diff-prop-before]")?.textContent).toBe("false");
    expect(dl.querySelector("[data-diff-prop-after]")?.textContent).toBe("true");
  });
});

describe("DiffView: 'changes' mode collapsing", () => {
  function manyUnchanged(n: number, changedAt: number): { before: Doc; after: Doc } {
    const beforeBlocks = Array.from({ length: n }, (_, i) => p(`b${i}`, `text ${i}`));
    const afterBlocks = beforeBlocks.map((b, i) => (i === changedAt ? p(`b${i}`, `text ${i} EDITED`) : b));
    return { before: doc(beforeBlocks), after: doc(afterBlocks) };
  }

  it("collapses a run of unchanged siblings into a button with the right count, and expands it on click", () => {
    const { before, after } = manyUnchanged(10, 5);
    const { container } = render(<DiffView before={before} after={after} mode="changes" />);

    // Context reserves b4/b6 (shown individually, next to the changed b5) --
    // the remaining 7 untouched siblings (b0-b3, b7-b9) split into two
    // collapsed runs of 4 and 3.
    const buttons = container.querySelectorAll("button[data-diff-collapsed]");
    expect(buttons.length).toBe(2);
    const counts = Array.from(buttons).map((b) => Number(b.textContent!.match(/\d+/)![0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(container.querySelector('[data-id="b4"]')).not.toBeNull(); // context, not collapsed
    expect(container.querySelector('[data-id="b6"]')).not.toBeNull(); // context, not collapsed

    expect(container.querySelector('[data-id="b0"]')).toBeNull();
    fireEvent.click(buttons[0]!);
    expect(container.querySelector('[data-id="b0"]')).not.toBeNull();
  });

  it("'full' mode never collapses anything", () => {
    const { before, after } = manyUnchanged(10, 5);
    const { container } = render(<DiffView before={before} after={after} mode="full" />);
    expect(container.querySelectorAll("button[data-diff-collapsed]").length).toBe(0);
    expect(container.querySelector('[data-id="b0"]')).not.toBeNull();
  });
});

describe("useDiff / DiffStats", () => {
  it("useDiff returns the same stats DiffStats renders", () => {
    const before = doc([p("a", "alpha"), p("b", "bravo")]);
    const after = doc([p("a", "alpha edited"), p("c", "charlie")]);
    function Probe() {
      const { stats } = useDiff(before, after, coreRegistry);
      return <DiffStats stats={stats} />;
    }
    const { container } = render(<Probe />);
    expect(container.querySelector('[data-diff-stat="modified"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-diff-stat="inserted"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-diff-stat="deleted"]')?.textContent).toBe("1");
  });
});
