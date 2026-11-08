// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Table } from "../data";
import { chooseChartColumns, readYColumns } from "./chart-view.js";
import { fromHTML, fromMarkdown, toHTML, toMarkdown } from "@jul-editor/core/serde";

describe("chooseChartColumns", () => {
  const table: Table = {
    columns: ["month", "region", "sales"],
    columnTypes: ["string", "string", "number"],
    rows: [["Jan", "East", 120]],
  };

  it("uses the first numeric column for values, not a neighboring text column", () => {
    expect(chooseChartColumns(table)).toEqual({ x: "month", y: "sales", ys: ["sales"], yColumns: ["sales"] });
  });

  it("honors valid choices and falls back when a stored y column is not numeric", () => {
    expect(chooseChartColumns(table, "region", "sales")).toEqual({ x: "region", y: "sales", ys: ["sales"], yColumns: ["sales"] });
    expect(chooseChartColumns(table, "region", "month").y).toBe("sales");
  });

  it("accepts several y series, drops stale ones and keeps a string y backward compatible", () => {
    const wide: Table = { columns: ["m", "a", "b"], columnTypes: ["string", "number", "number"], rows: [["Jan", 1, 2]] };
    expect(chooseChartColumns(wide, "m", ["a", "b"]).ys).toEqual(["a", "b"]);
    expect(chooseChartColumns(wide, "m", ["gone", "b"]).ys).toEqual(["b"]);
    expect(chooseChartColumns(wide, "gone", ["gone"])).toMatchObject({ x: "m", y: "a", ys: ["a"] });
    expect(chooseChartColumns(wide, "m", "b").ys).toEqual(["b"]);
    expect(readYColumns("a")).toEqual(["a"]);
    expect(readYColumns(["a", 3 as never, "b"])).toEqual(["a", "b"]);
    expect(readYColumns(undefined)).toEqual([]);
  });

  it("has no values to plot when a dataset has no numeric column", () => {
    expect(chooseChartColumns({ ...table, columnTypes: ["string", "string", "string"] }).y).toBe("");
  });

});

describe("chart props serialization", () => {
  it("round-trips y arrays, colorBy and palette through markdown and html", () => {
    const props = { kind: "line", x: "m", y: ["a", "b"], colorBy: "series", palette: ["#112233", "#445566"], source: { type: "inline", csv: "m,a,b\nJan,1,2" } };
    const doc = { version: 1 as const, blocks: [{ id: "c", type: "chart", props }] };
    const md = toMarkdown(doc).markdown;
    expect(fromMarkdown(md).doc.blocks[0]?.props).toEqual(props);
    const html = toHTML(doc);
    expect(fromHTML(html).doc.blocks[0]?.props).toEqual(props);
  });
});
