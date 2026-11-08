import { coreRegistry, normalizeProps } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { parseCSV } from "./data";
import { pageBreak } from "./pages/page-break.js";
import { calloutBlock } from "./callout/block.js";
import { toggleBlock } from "./toggle/block.js";
import { tocBlock } from "./toc/block.js";
import { columnsBlocks } from "./columns/block.js";
import { createLinkBlocks } from "./links";
import { pluginSlashItems } from "./slash.js";

// Plugin-defined blocks are not in coreRegistry (hosts pass them via <Editor blocks>), so look them up here too.
const pluginBlocks = new Map([pageBreak, calloutBlock, toggleBlock, tocBlock, ...columnsBlocks, ...createLinkBlocks()].map((b) => [b.type, b]));

describe("pluginSlashItems", () => {
  it("every item's create() already omits props equal to its own schema defaults", () => {
    for (const item of pluginSlashItems) {
      const block = item.create();
      const spec = coreRegistry.blocks.get(item.type) ?? pluginBlocks.get(item.type);
      expect(spec, `no registered block spec for "${item.type}"`).toBeDefined();
      expect(block.props).toEqual(normalizeProps(block.props, spec!.props));
    }
  });

  it("new chart, diagram and data table blocks have useful editable starter content", () => {
    const chart = pluginSlashItems.find((i) => i.type === "chart")!;
    const diagram = pluginSlashItems.find((i) => i.type === "diagram")!;
    const dataTable = pluginSlashItems.find((i) => i.type === "dataTable")!;
    expect(chart.create().props.source).toMatchObject({ type: "inline", csv: expect.stringContaining("\n") });
    const chartSource = chart.create().props.source as { csv: string };
    const chartTable = parseCSV(chartSource.csv);
    expect(chartTable.rows.length).toBeGreaterThan(0);
    expect(chartTable.columnTypes).toContain("number");
    expect(diagram.create().props.code).toContain("flowchart");
    expect(dataTable.create().props.source).toMatchObject({ type: "inline", csv: expect.stringContaining("\n") });
  });
});
