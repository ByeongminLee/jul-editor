// @vitest-environment jsdom
import { fromHTML, toHTML, toMarkdown, toText } from "@jul-editor/core/serde";
import type { Block } from "@jul-editor/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, mountEditor, para, registry, stripIds, text } from "../notion-shared/test-helpers.js";
import { extractOutline, extractOutlineFromDoc, fromMarkdownExt, pickActiveIndex, TocDocProvider, TocSidebar, tocBlock, tocPlugin, tocSlashItem, TocView } from "./index.js";

afterEach(cleanup);

const h = (id: string, level: number, t: string): Block => ({ id, type: "heading", props: level === 1 ? {} : { level }, content: text(t) });
const toggleH = (id: string, level: number, t: string, children: Block[] = []): Block => ({ id, type: "toggle", props: { level }, content: text(t), ...(children.length ? { children } : {}) });
const sample = () => doc([h("a", 1, "Intro"), para("p", "body"), h("b", 2, "Setup"), h("c", 3, "Deep"), h("d", 2, "Usage"), { id: "t", type: "toc", props: {} }]);

describe("toc block: create + serde", () => {
  it("slash item and plugin bundle", () => {
    expect(tocSlashItem.create()).toMatchObject({ type: "toc", props: {} });
    expect(tocPlugin.blocks[0]).toBe(tocBlock);
    expect(tocBlock.content).toBe("none");
  });

  it("markdown [TOC] round-trips, including a level range", () => {
    for (const props of [{} as Record<string, number>, { minLevel: 2, maxLevel: 4 }]) {
      const d = doc([h("a", 1, "x"), { id: "t", type: "toc", props }, para("z", "end")]); // a trailing void gets a repair paragraph, so end with text
      const { markdown } = toMarkdown(d, { registry });
      expect(markdown).toBe(Object.keys(props).length ? "# x\n\n[TOC 2-4]\n\nend" : "# x\n\n[TOC]\n\nend");
      expect(stripIds(fromMarkdownExt(markdown, { registry }).doc.blocks)).toEqual(stripIds(d.blocks));
    }
    expect(toText(doc([{ id: "t", type: "toc", props: {} }]), { registry })).toBe("[TOC]");
  });

  it("html <nav> round-trips", () => {
    const d = doc([{ id: "t", type: "toc", props: { maxLevel: 5 } }, para("p", "x")]);
    const html = toHTML(d, { registry });
    expect(html).toContain('<nav data-jul-editor-type="toc" data-min-level="1" data-max-level="5"');
    expect(stripIds(fromHTML(html, { registry }).doc.blocks)).toEqual(stripIds(d.blocks));
  });
});

describe("outline extraction", () => {
  it("lists headings in order with outline depth, skipping other blocks", () => {
    const outline = extractOutlineFromDoc(sample());
    expect(outline.map((e) => [e.text, e.level, e.depth])).toEqual([["Intro", 1, 0], ["Setup", 2, 1], ["Deep", 3, 2], ["Usage", 2, 1]]);
  });

  it("a skipped level indents one step only, and a lone deeper heading starts at depth 0", () => {
    expect(extractOutlineFromDoc(doc([h("a", 1, "A"), h("b", 3, "B")])).map((e) => e.depth)).toEqual([0, 1]);
    expect(extractOutlineFromDoc(doc([h("a", 3, "A"), h("b", 2, "B")])).map((e) => e.depth)).toEqual([0, 0]);
  });

  it("includes toggle headings (also nested in a toggle) and honors the level range", () => {
    const d = doc([toggleH("t1", 1, "Toggle H1", [toggleH("t2", 2, "Inner", [h("h", 3, "Nested heading")])]), { id: "plain", type: "toggle", props: {}, content: text("not a heading") }]);
    expect(extractOutlineFromDoc(d).map((e) => e.text)).toEqual(["Toggle H1", "Inner", "Nested heading"]);
    expect(extractOutlineFromDoc(d, { minLevel: 2, maxLevel: 2 }).map((e) => e.text)).toEqual(["Inner"]);
  });

  it("store and doc extraction agree", () => {
    const m = mountEditor(sample());
    expect(extractOutline(m.editor.getState().store)).toEqual(extractOutlineFromDoc(m.editor.getDoc()));
    m.destroy();
  });

  it("pickActiveIndex: last heading past the threshold, first when none, -1 when empty", () => {
    expect(pickActiveIndex([-300, -20, 400], 96)).toBe(1);
    expect(pickActiveIndex([200, 500], 96)).toBe(0);
    expect(pickActiveIndex([], 96)).toBe(-1);
  });
});

describe("TocView (live)", () => {
  it("renders indented entries and updates when headings change, but not on body edits", () => {
    const m = mountEditor(sample());
    const view = render(<TocView block={{ id: "t", type: "toc", props: {} }} editor={m.editor} />);
    const items = () => Array.from(view.container.querySelectorAll("[data-toc-list] li")).map((li) => `${li.getAttribute("data-depth")}:${li.textContent}`);
    expect(items()).toEqual(["0:Intro", "1:Setup", "2:Deep", "1:Usage"]);

    act(() => {
      m.editor.update((tx) => tx.replaceContent("b", 0, 5, text("Install")));
    });
    expect(items()[1]).toBe("1:Install");

    act(() => {
      m.editor.update((tx) => tx.insertBlock(null, 1, h("n", 2, "Fresh")));
    });
    expect(items()).toEqual(["0:Intro", "1:Fresh", "1:Install", "2:Deep", "1:Usage"]);

    const before = view.container.querySelector("[data-toc-list]");
    act(() => {
      m.editor.update((tx) => tx.insertText({ blockId: "p", offset: 4 }, "!"));
    });
    expect(view.container.querySelector("[data-toc-list]")).toBe(before); // same node: no heading change, no rerender work

    act(() => {
      m.editor.update((tx) => tx.removeBlock("n").setType("a", "paragraph"));
    });
    expect(items()).toEqual(["0:Install", "1:Deep", "0:Usage"]); // depth recomputed for the new first heading
    m.destroy();
  });

  it("honors minLevel/maxLevel props and shows an empty state", () => {
    const m = mountEditor(sample());
    const { container, rerender } = render(<TocView block={{ id: "t", type: "toc", props: { minLevel: 2, maxLevel: 2 } }} editor={m.editor} />);
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["Setup", "Usage"]);
    rerender(<TocView block={{ id: "t", type: "toc", props: { minLevel: 6 } }} editor={m.editor} />);
    expect(container.querySelector("[data-toc-empty]")).not.toBeNull();
    m.destroy();
  });

  it("clicking an entry selects the heading, and expands a collapsed toggle that hides it", () => {
    const d = doc([toggleH("tg", 1, "Hidden section", [h("deep", 2, "Deep heading")]), para("z", "end")]);
    const m = mountEditor(d);
    const view = render(<TocView block={{ id: "t", type: "toc", props: {} }} editor={m.editor} />);
    const link = Array.from(view.container.querySelectorAll<HTMLAnchorElement>("a")).find((a) => a.textContent === "Deep heading")!;
    act(() => {
      fireEvent.click(link);
    });
    expect(m.editor.getState().selection).toMatchObject({ type: "text", anchor: { blockId: "deep", offset: 0 } });
    expect(m.editor.getState().store.records.get("tg")!.props.open).toBe(true);
    m.destroy();
  });

  it("custom onNavigate replaces the default; read-only reads the doc from TocDocProvider", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <TocDocProvider value={sample()}>
        <TocView block={{ id: "t", type: "toc", props: {} }} readOnly onNavigate={onNavigate} />
      </TocDocProvider>,
    );
    fireEvent.click(container.querySelectorAll("a")[1]!);
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "b", text: "Setup" }), undefined);
  });
});

describe("TocSidebar", () => {
  it("shows one line per heading, expands on hover/focus, and navigates on click", () => {
    const m = mountEditor(sample());
    const { container } = render(<TocSidebar editor={m.editor} />);
    const nav = container.querySelector("[data-jul-toc-sidebar]")!;
    expect(container.querySelectorAll("[data-toc-line]")).toHaveLength(4);
    expect(nav.getAttribute("data-expanded")).toBe("false");
    fireEvent.mouseEnter(nav);
    expect(nav.getAttribute("data-expanded")).toBe("true");
    fireEvent.mouseLeave(nav);
    expect(nav.getAttribute("data-expanded")).toBe("false");
    fireEvent.focus(container.querySelector("button")!);
    expect(nav.getAttribute("data-expanded")).toBe("true");
    act(() => {
      fireEvent.click(container.querySelectorAll("button")[2]!);
    });
    expect(m.editor.getState().selection).toMatchObject({ anchor: { blockId: "c" } });
    m.destroy();
  });

  it("hides itself below minHeadings and follows live heading edits", () => {
    const m = mountEditor(doc([h("a", 1, "Only"), para("p", "x")]));
    const { container } = render(<TocSidebar editor={m.editor} />);
    expect(container.querySelector("[data-jul-toc-sidebar]")).toBeNull();
    act(() => {
      m.editor.update((tx) => tx.insertBlock(null, 2, h("b", 2, "Second")));
    });
    expect(container.querySelectorAll("[data-toc-line]")).toHaveLength(2);
    m.destroy();
  });

  it("marks the section in view as active from heading positions", () => {
    const m = mountEditor(sample());
    const tops: Record<string, number> = { a: -400, b: -50, c: 300, d: 700 };
    for (const [id, top] of Object.entries(tops)) {
      const el = m.element.querySelector(`[data-id="${id}"]`) as HTMLElement;
      el.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    const { container } = render(<TocSidebar editor={m.editor} />);
    const active = Array.from(container.querySelectorAll("li[data-active='true']")).map((li) => li.textContent);
    expect(active).toEqual(["Setup"]);
    m.destroy();
  });

  it("works read-only from a plain doc", () => {
    const { container } = render(<TocSidebar doc={sample()} expanded />);
    expect(container.querySelector("[data-expanded='true']")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(4);
  });
});
