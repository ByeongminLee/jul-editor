// @vitest-environment jsdom
// table's colspan/rowspan-aware toMarkdown/toHTML/toText/fromHTML.
import { describe, expect, it } from "vitest";
import type { Block, Doc } from "../model/types.js";
import { fromHTML } from "./from-html.js";
import { toHTML } from "./to-html.js";
import { toMarkdown } from "./to-markdown.js";
import { toText } from "./to-text.js";

function cell(id: string, text = "", props: Record<string, number> = {}): Block {
  return { id, type: "tableCell", props, content: text ? [{ type: "text", text }] : [] };
}

/** A 2x2 table with c00 merged as colspan=2 rowspan=2 (covering the whole
 * table) -- row1 has no cells of its own (fully covered). */
function mergedDoc(): Doc {
  return {
    version: 1,
    blocks: [
      {
        id: "t1",
        type: "table",
        props: {},
        children: [
          { id: "r0", type: "tableRow", props: {}, children: [cell("c00", "Merged", { colspan: 2, rowspan: 2 })] },
          { id: "r1", type: "tableRow", props: {}, children: [] },
        ],
      },
    ],
  };
}

/** A 1-row table: a colspan=2 anchor + one plain trailing cell. */
function colspanDoc(): Doc {
  return {
    version: 1,
    blocks: [
      {
        id: "t1",
        type: "table",
        props: {},
        children: [{ id: "r0", type: "tableRow", props: {}, children: [cell("c00", "Wide", { colspan: 2 }), cell("c02", "C02")] }],
      },
    ],
  };
}

describe("table toMarkdown (lossy 'table-span')", () => {
  it("reports 'table-span' and writes the anchor's own content, blank at every covered position", () => {
    const { markdown, lossy } = toMarkdown(mergedDoc());
    expect(lossy).toEqual([{ blockId: "t1", type: "table", reason: "table-span" }]);
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("| Merged |  |");
    expect(lines[2]).toBe("|  |  |"); // row 1: fully covered, both blank
  });

  it("an un-merged table reports no 'table-span' lossy entry", () => {
    const { lossy } = toMarkdown({
      version: 1,
      blocks: [{ id: "t1", type: "table", props: {}, children: [{ id: "r0", type: "tableRow", props: {}, children: [cell("c1", "A")] }] }],
    });
    expect(lossy).toEqual([]);
  });
});

describe("table toHTML (real colspan/rowspan attributes)", () => {
  it("emits colspan/rowspan only on the anchor, skips covered positions entirely", () => {
    const html = toHTML(mergedDoc());
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    // Exactly one <td>/<th> total (the anchor) -- covered positions get no
    // cell of their own. (Not `<thead>`/`<table>` -- match only a real
    // opening cell tag, immediately followed by a space or '>'.)
    expect((html.match(/<t[dh](?=[ >])/g) ?? []).length).toBe(1);
  });

  it("omits the attribute entirely when span is 1 (the default)", () => {
    const html = toHTML({
      version: 1,
      blocks: [{ id: "t1", type: "table", props: {}, children: [{ id: "r0", type: "tableRow", props: {}, children: [cell("c1", "A")] }] }],
    });
    expect(html).not.toContain("colspan");
    expect(html).not.toContain("rowspan");
  });
});

describe("table toText (lays out the grid)", () => {
  it("tab-joins the grid, blank at covered positions", () => {
    const text = toText(mergedDoc());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Merged\t");
    expect(lines[1]).toBe("\t");
  });
});

describe("table fromHTML (reads colspan/rowspan back, clamped)", () => {
  it("round-trips a colspan attribute into the tableCell's own prop", () => {
    const { doc } = fromHTML(`<table><tr><td colspan="2">Wide</td><td>C02</td></tr></table>`);
    const table = doc.blocks.find((b) => b.type === "table")!;
    const row = table.children![0]!;
    expect(row.children![0]!.props.colspan).toBe(2);
    expect(row.children![1]!.props.colspan).toBeUndefined();
  });

  it("clamps an absurd/negative colspan to a sane range", () => {
    const { doc } = fromHTML(`<table><tr><td colspan="99999">X</td></tr></table>`);
    const cellRec = doc.blocks.find((b) => b.type === "table")!.children![0]!.children![0]!;
    expect(cellRec.props.colspan).toBe(100);

    const { doc: doc2 } = fromHTML(`<table><tr><td colspan="-5">Y</td></tr></table>`);
    const cellRec2 = doc2.blocks.find((b) => b.type === "table")!.children![0]!.children![0]!;
    expect(cellRec2.props.colspan).toBeUndefined(); // clamped to the (omitted) default 1
  });

  it("round-trips toHTML's own colspan/rowspan output", () => {
    const html = toHTML(colspanDoc());
    const { doc } = fromHTML(html);
    const table = doc.blocks.find((b) => b.type === "table")!;
    expect(table.children![0]!.children![0]!.props.colspan).toBe(2);
  });
});
