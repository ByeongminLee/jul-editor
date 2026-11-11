// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import type { DataSource } from "../data";
import { parseCSV, parseJSON } from "../data";
import { ChartEditor, SAMPLE_CSV } from "./chart-editor.js";

afterEach(cleanup);

function Harness({ initial, log }: { initial: DataSource; log: DataSource[] }) {
  const [source, setSource] = useState<DataSource>(initial);
  return <ChartEditor kind="bar" source={source} range={null} x="Month" y="Visitors" columns={["Month", "Visitors"]} yColumns={["Visitors"]}
    updateProps={(patch) => { if (patch.source) { const next = patch.source as unknown as DataSource; log.push(next); setSource(next); } }} />;
}

function setup(initial: DataSource) {
  const log: DataSource[] = [];
  const view = render(<Harness initial={initial} log={log} />);
  return { log, view, last: () => log[log.length - 1]! };
}

it("switching inline CSV to JSON converts the current rows instead of showing []", () => {
  const { view, last } = setup({ type: "inline", csv: SAMPLE_CSV });
  fireEvent.click(view.getByTestId("jul-editor-chart-format-json"));
  const next = last();
  expect(next.type === "inline" && "format" in next && next.format).toBe("json");
  const json = (next as { json: string }).json;
  expect(json).not.toBe("[]");
  const table = parseJSON(json);
  expect(table.columns).toEqual(["Month", "Visitors", "Signups", "Revenue"]);
  expect(table.rows).toHaveLength(5);
  expect(table.rows[0]).toEqual(["Jan", 120, 30, 42]);
  expect((view.getByTestId("jul-editor-chart-json") as HTMLTextAreaElement).value).toBe(json);
});

it("switching inline JSON back to CSV converts the current rows", () => {
  const { view, last } = setup({ type: "inline", format: "json", json: JSON.stringify([{ Month: "Jan", Visitors: 1 }, { Month: "Feb, 2nd", Visitors: 2 }]) });
  fireEvent.click(view.getByTestId("jul-editor-chart-format-csv"));
  const next = last() as { csv: string };
  const table = parseCSV(next.csv);
  expect(table.columns).toEqual(["Month", "Visitors"]);
  expect(table.rows).toEqual([["Jan", 1], ["Feb, 2nd", 2]]);
});

it("a source round trip inline > URL > inline keeps the inline data", () => {
  const { view, last } = setup({ type: "inline", csv: SAMPLE_CSV });
  fireEvent.change(view.getByTestId("jul-editor-chart-source"), { target: { value: "url" } });
  expect(last().type).toBe("url");
  fireEvent.change(view.getByTestId("jul-editor-chart-source"), { target: { value: "view" } });
  expect(last().type).toBe("view");
  fireEvent.change(view.getByTestId("jul-editor-chart-source"), { target: { value: "inline" } });
  expect(last()).toEqual({ type: "inline", csv: SAMPLE_CSV });
  expect((view.getByTestId("jul-editor-chart-csv") as HTMLTextAreaElement).value).toBe(SAMPLE_CSV);
});
