import { describe, expect, it } from "vitest";

describe("@jul-editor/plugins main entry", () => {
  it("imports cleanly under node (no DOM) and exposes the public surface", async () => {
    const mod = await import("./");
    expect(typeof mod.parseCSV).toBe("function");
    expect(typeof mod.applyRange).toBe("function");
    expect(typeof mod.defaultResolveData).toBe("function");
    expect(typeof mod.useResolveData).toBe("function");
    expect(typeof mod.ChartView).toBe("function");
    expect(typeof mod.ChartEditor).toBe("function");
    expect(typeof mod.DiagramView).toBe("function");
    expect(typeof mod.DataTableView).toBe("function");
    expect(mod.pluginRenderers).toMatchObject({ chart: mod.ChartView, diagram: mod.DiagramView, dataTable: mod.DataTableView });
    expect(mod.pluginSlashItems.map((i) => i.type).sort()).toEqual([
      "bookmark", "bookmark", "callout", "chart", "columns", "columns", "dataTable", "diagram", "iframe", "iframe", "pageBreak", "toc", "toggle",
    ]);
  });

  it("pluginSlashItems.create() returns a fresh id per call and Korean keywords", async () => {
    const { pluginSlashItems } = await import("./slash.js");
    const chart = pluginSlashItems.find((i) => i.type === "chart")!;
    const a = chart.create();
    const b = chart.create();
    expect(a.id).not.toBe(b.id);
    expect(chart.keywords).toContain("차트");
  });
});
