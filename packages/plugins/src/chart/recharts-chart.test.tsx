import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Area, AreaChart, Bar, Cell, BarChart, Legend, Line, LineChart, Pie, PieChart, Radar, RadarChart, RadialBar, RadialBarChart, Tooltip } from "recharts";
import { describe, expect, it } from "vitest";
import type { Table } from "../data";
import { ChartEditor, SAMPLE_CSV, SAMPLE_JSON } from "./chart-editor.js";
import RechartsChart, { ChartTooltipContent, type ChartKind } from "./recharts-chart.js";

const table: Table = {
  columns: ["month", "visitors"],
  columnTypes: ["string", "number"],
  rows: [["Jan", 120], ["Feb", 160]],
};

type ElementProps = { children?: ReactNode; value?: string; "aria-label"?: string; "data-testid"?: string; onChange?: (event: { target: { value: string } }) => void };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function control(editor: ReactNode, testId: string): ReactElement<ElementProps> {
  const found = elements(editor).find((element) => element.props["data-testid"] === testId);
  if (!found) throw new Error(`missing ${testId}`);
  return found;
}

describe("chart kinds", () => {
  const base = { kind: "bar" as const, source: { type: "inline" as const, csv: "" }, range: null, x: "month", y: "visitors", columns: table.columns, yColumns: ["visitors"], updateProps: () => {} };

  it("offers all six chart types as an icon radio group", () => {
    const editor = ChartEditor(base);
    const radios = elements(editor).filter((element) => (element.props as { role?: string }).role === "radio" && String(element.props["data-testid"]).startsWith("jul-editor-chart-kind-"));
    expect(radios.map((element) => element.props["data-testid"])).toEqual(["bar", "line", "area", "pie", "radar", "radial"].map((k) => `jul-editor-chart-kind-${k}`));
    const updates: unknown[] = [];
    const picked = ChartEditor({ ...base, updateProps: (patch) => updates.push(patch) });
    (control(picked, "jul-editor-chart-kind-pie").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toEqual({ kind: "pie" });
  });

  it("shows axis controls per chart type", () => {
    const ids = (kind: ChartKind) => elements(ChartEditor({ ...base, kind, ys: ["visitors"] })).map((e) => e.props["data-testid"]);
    expect(ids("bar")).toContain("jul-editor-chart-y-visitors");
    expect(ids("radar")).toContain("jul-editor-chart-y-visitors");
    expect(ids("pie")).not.toContain("jul-editor-chart-y-visitors");
    expect(control(ChartEditor({ ...base, kind: "pie" }), "jul-editor-chart-y").props["aria-label"]).toBe("Value column");
    expect(control(ChartEditor({ ...base, kind: "pie" }), "jul-editor-chart-x").props["aria-label"]).toBe("Label column");
    expect(ids("pie")).not.toContain("jul-editor-chart-colorby");
    expect(ids("bar")).toContain("jul-editor-chart-colorby");
    expect(ids("line")).not.toContain("jul-editor-chart-colorby");
  });

  it("toggles y series, keeping at least one and storing a string for one series", () => {
    const updates: unknown[] = [];
    const props = { ...base, columns: ["month", "a", "b"], yColumns: ["a", "b"], y: "a", ys: ["a"], updateProps: (patch: unknown) => updates.push(patch) };
    const editor = ChartEditor(props);
    (control(editor, "jul-editor-chart-y-b").props as { onChange?: () => void }).onChange?.();
    expect(updates.pop()).toEqual({ y: ["a", "b"] });
    (control(editor, "jul-editor-chart-y-a").props as { onChange?: () => void }).onChange?.();
    expect(updates).toEqual([]);
    const both = ChartEditor({ ...props, ys: ["a", "b"] });
    (control(both, "jul-editor-chart-y-a").props as { onChange?: () => void }).onChange?.();
    expect(updates.pop()).toEqual({ y: "b" });
  });

  it("edits palette colors, applies presets and resets to the theme default", () => {
    const updates: unknown[] = [];
    const editor = ChartEditor({ ...base, updateProps: (patch) => updates.push(patch) });
    (control(editor, "jul-editor-chart-color-1").props as { onCommit?: (hex: string) => void }).onCommit?.("#112233");
    const patch = updates.pop() as { palette: string[] };
    expect(patch.palette).toHaveLength(8);
    expect(patch.palette[1]).toBe("#112233");
    // untouched slots keep following the host theme
    expect(patch.palette[0]).toBe("var(--chart-1, #e8833a)");
    (control(editor, "jul-editor-chart-palette-ocean").props as { onClick?: () => void }).onClick?.();
    expect((updates.pop() as { palette: string[] }).palette[0]).toBe("#3c94b7");
    const custom = ChartEditor({ ...base, palette: ["#111111"], updateProps: (p) => updates.push(p) });
    (control(custom, "jul-editor-chart-palette-reset").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toEqual({ palette: undefined });
    (control(editor, "jul-editor-chart-colorby-series").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toEqual({ colorBy: "series" });
  });

  it("validates inline data live and previews columns", () => {
    const bad = JSON.stringify(ChartEditor({ ...base, source: { type: "inline", format: "json", json: "{oops" } }));
    expect(bad).toContain("jul-editor-chart-error");
    const good = JSON.stringify(ChartEditor({ ...base, source: { type: "inline", csv: "month,visitors\nJan,120\nFeb,160" } }));
    expect(good).toContain("jul-editor-chart-preview");
    expect(good).toContain("2 rows");
    expect(good).not.toContain("jul-editor-chart-error");
  });

  it("loads a sample into the current format and resets x/y", () => {
    const updates: unknown[] = [];
    const csv = ChartEditor({ ...base, updateProps: (patch) => updates.push(patch) });
    (control(csv, "jul-editor-chart-sample").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toMatchObject({ source: { type: "inline", csv: SAMPLE_CSV }, x: undefined, y: undefined });
    const json = ChartEditor({ ...base, source: { type: "inline", format: "json", json: "[]" }, updateProps: (patch) => updates.push(patch) });
    (control(json, "jul-editor-chart-sample").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toMatchObject({ source: { type: "inline", format: "json", json: SAMPLE_JSON } });
  });

  it("labels chart controls and empty states in Korean when selected", () => {
    const editor = ChartEditor({ ...base, x: "", y: "", columns: [], yColumns: [], locale: "ko" });
    const labels = elements(editor).map((element) => element.props["aria-label"]).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["차트 종류", "데이터 소스", "데이터 형식", "범주 열", "값 열", "차트 CSV 데이터", "데이터 범위"]));
    expect(JSON.stringify(editor)).toContain("차트 설정");
    expect(JSON.stringify(editor)).toContain("선택할 열이 없습니다");
    expect(JSON.stringify(editor)).toContain("선택할 숫자 열이 없습니다");
  });

  it("switches inline CSV/JSON and edits JSON without losing the CSV draft", () => {
    const updates: unknown[] = [];
    const props = { kind: "bar" as const, range: null, x: "", y: "", columns: [], yColumns: [], updateProps: (patch: unknown) => updates.push(patch) };
    const csv = ChartEditor({ ...props, source: { type: "inline", csv: "month,sales\nJan,120" } });
    (control(csv, "jul-editor-chart-format-json").props as { onClick?: () => void }).onClick?.();
    // the current CSV rows are converted, not replaced by an empty array
    expect(updates.pop()).toEqual({ source: { type: "inline", format: "json", json: JSON.stringify([{ month: "Jan", sales: 120 }], null, 2), csv: "month,sales\nJan,120" } });

    const json = ChartEditor({ ...props, source: { type: "inline", format: "json", json: "[]", csv: "month,sales\nJan,120" }, locale: "ko" });
    expect(control(json, "jul-editor-chart-json").props["aria-label"]).toBe("차트 JSON 데이터");
    control(json, "jul-editor-chart-json").props.onChange?.({ target: { value: '[{"month":"Jan","sales":120}]' } });
    expect(updates.pop()).toEqual({ source: { type: "inline", format: "json", json: '[{"month":"Jan","sales":120}]', csv: "month,sales\nJan,120" } });
    (control(json, "jul-editor-chart-format-csv").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toEqual({ source: { type: "inline", csv: "month,sales\nJan,120", json: "[]" } });
  });

  it("offers URL and viewId controls with localized labels", () => {
    const updates: unknown[] = [];
    const props = { kind: "bar" as const, range: null, x: "", y: "", columns: [], yColumns: [], updateProps: (patch: unknown) => updates.push(patch) };
    const inline = ChartEditor({ ...props, source: { type: "inline", csv: "x\n1" } });
    // The source select is its own stateful component (it remembers each type's last source); its
    // switching is covered by chart-editor-source.test.tsx, here only its wiring.
    const sourceSelect = elements(inline).find((element) => typeof (element.props as { onSelect?: unknown }).onSelect === "function")!;
    expect(sourceSelect.props["aria-label"]).toBe("Data source");
    (sourceSelect.props as unknown as { onSelect: (next: unknown) => void }).onSelect({ type: "url", format: "csv", url: "" });
    expect(updates.pop()).toEqual({ source: { type: "url", format: "csv", url: "" } });

    const url = ChartEditor({ ...props, source: { type: "url", format: "json", url: "https://cdn.example/chart.json" }, locale: "ko" });
    expect(control(url, "jul-editor-chart-url").props["aria-label"]).toBe("차트 데이터 URL");
    control(url, "jul-editor-chart-url").props.onChange?.({ target: { value: "https://s3.example/signed.json?sig=abc" } });
    expect(updates.pop()).toEqual({ source: { type: "url", format: "json", url: "https://s3.example/signed.json?sig=abc" } });
    (control(url, "jul-editor-chart-format-csv").props as { onClick?: () => void }).onClick?.();
    expect(updates.pop()).toEqual({ source: { type: "url", format: "csv", url: "https://cdn.example/chart.json" } });

    const view = ChartEditor({ ...props, source: { type: "view", viewId: "sales" }, locale: "ko" });
    expect(control(view, "jul-editor-chart-view-id").props["aria-label"]).toBe("뷰 ID");
    control(view, "jul-editor-chart-view-id").props.onChange?.({ target: { value: "revenue" } });
    expect(updates.pop()).toEqual({ source: { type: "view", viewId: "revenue" } });
  });

  it.each([
    ["bar", BarChart], ["line", LineChart], ["area", AreaChart],
    ["pie", PieChart], ["radar", RadarChart], ["radial", RadialBarChart],
  ] as const)("renders %s with its matching Recharts family", (kind, family) => {
    const wrapper = RechartsChart({ kind: kind as ChartKind, table, x: "month", y: "visitors" });
    expect(isValidElement<{ children: ReactElement }>(wrapper)).toBe(true);
    if (!isValidElement<{ children: ReactElement }>(wrapper)) return;
    expect(wrapper.props.children.type).toBe(family);
  });

  it("keeps category names with radial rows for its legend and tooltip", () => {
    const wrapper = RechartsChart({ kind: "radial", table, x: "month", y: "visitors" });
    if (!isValidElement<{ children: ReactElement<{ data: unknown }> }>(wrapper)) throw new Error("missing chart");
    expect(wrapper.props.children.props.data).toEqual([
      { x: "Jan", name: "Jan", y: 120, s0: 120, fill: "var(--chart-1, #e8833a)" },
      { x: "Feb", name: "Feb", y: 160, s0: 160, fill: "var(--chart-2, #4a90c2)" },
    ]);
  });

  it("colors each category of a single-series bar by default and one color with colorBy series", () => {
    const wrapper = RechartsChart({ kind: "bar", table, x: "month", y: "visitors" });
    if (!isValidElement<{ children: ReactElement<{ data: unknown }> }>(wrapper)) throw new Error("missing chart");
    expect(wrapper.props.children.props.data).toEqual([
      { x: "Jan", name: "Jan", y: 120, s0: 120, fill: "var(--chart-1, #e8833a)" },
      { x: "Feb", name: "Feb", y: 160, s0: 160, fill: "var(--chart-2, #4a90c2)" },
    ]);
    expect(elements(wrapper).filter((e) => e.type === Cell)).toHaveLength(2);
    const single = RechartsChart({ kind: "bar", table, x: "month", y: "visitors", colorBy: "series" });
    expect(elements(single).filter((e) => e.type === Cell)).toHaveLength(0);
    expect(elements(single).find((e) => e.type === Bar)?.props).toHaveProperty("fill", "var(--chart-1, #e8833a)");
  });

  it("draws one colored mark per series for multi-series charts", () => {
    const wide: Table = { columns: ["m", "a", "b"], columnTypes: ["string", "number", "number"], rows: [["Jan", 1, 2]] };
    for (const [kind, mark] of [["bar", Bar], ["line", Line], ["area", Area], ["radar", Radar]] as const) {
      const marks = elements(RechartsChart({ kind, table: wide, x: "m", y: ["a", "b"] })).filter((e) => e.type === mark);
      expect(marks.map((e) => (e.props as { name?: string }).name)).toEqual(["a", "b"]);
      expect(elements(RechartsChart({ kind, table: wide, x: "m", y: ["a", "b"] })).filter((e) => e.type === Cell)).toHaveLength(0);
    }
  });

  it("uses a per-chart palette override instead of the theme variables", () => {
    const wrapper = RechartsChart({ kind: "line", table, x: "month", y: "visitors", palette: ["#112233"] });
    expect(elements(wrapper).find((e) => e.type === Line)?.props).toHaveProperty("stroke", "#112233");
    const pie = RechartsChart({ kind: "pie", table, x: "month", y: "visitors", palette: ["#112233", "#445566"] });
    expect(elements(pie).filter((e) => e.type === Cell).map((e) => e.props)).toEqual([{ fill: "#112233" }, { fill: "#445566" }]);
  });

  it("uses a subdued hover band instead of Recharts' bright default bar cursor", () => {
    const wrapper = RechartsChart({ kind: "bar", table, x: "month", y: "visitors" });
    const tooltip = elements(wrapper).find((element) => element.type === Tooltip);
    expect(tooltip?.props).toHaveProperty("cursor.fill", "var(--chart-hover, #ee9b5114)");
  });

  it("keeps pie legend categories in CSV order", () => {
    const wrapper = RechartsChart({ kind: "pie", table, x: "month", y: "visitors" });
    const legend = elements(wrapper).find((element) => element.type === Legend);
    expect(legend?.props).toHaveProperty("itemSorter", null);
  });

  it("renders a category, measure and formatted value in a token-aware tooltip", () => {
    const html = JSON.stringify(ChartTooltipContent({
      active: true,
      label: "Jan",
      valueLabel: "Visitors",
      payload: [{ value: 12500, color: "var(--chart-1)", payload: { x: "Jan" } }],
    }));
    expect(html).toContain("Jan");
    expect(html).toContain("Visitors");
    expect(html).toContain("12,500");
    expect(html).toContain("var(--chart-1)");
    expect(html).toContain("data-chart-tooltip");
  });

  it("lets a tooltip slot class own visual styles instead of inline defaults", () => {
    const tooltip = ChartTooltipContent({ active: true, label: "Jan", valueLabel: "Visitors", payload: [{ value: 12 }], className: "rounded-xl bg-zinc-900 p-4 shadow-xl" });
    if (!isValidElement<{ className?: string; style?: Record<string, unknown> }>(tooltip)) throw new Error("missing tooltip");
    expect(tooltip.props.className).toContain("shadow-xl");
    expect(tooltip.props.style?.boxShadow).toBeUndefined();
    expect(tooltip.props.style?.background).toBeUndefined();
  });

  it.each(["bar", "line", "area", "pie", "radar", "radial"] as ChartKind[])("uses custom tooltip on %s charts", (kind) => {
    const wrapper = RechartsChart({ kind, table, x: "month", y: "visitors" });
    const tooltip = elements(wrapper).find((element) => element.type === Tooltip);
    expect(tooltip).toBeDefined();
    expect(tooltip?.props).toHaveProperty("content");
  });

  it.each([
    ["bar", Bar], ["line", Line], ["area", Area], ["pie", Pie], ["radar", Radar], ["radial", RadialBar],
  ] as const)("shows a complete %s chart immediately when kinds are switched", (kind, mark) => {
    const wrapper = RechartsChart({ kind, table, x: "month", y: "visitors" });
    const shape = elements(wrapper).find((element) => element.type === mark);
    expect(shape?.props).toHaveProperty("isAnimationActive", false);
  });
});
