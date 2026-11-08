import { describe, expect, it } from "vitest";

describe("optional UI entry points", () => {
  it("provides chart rendering and its starter block independently", async () => {
    const { ChartView, ChartEditor, chartSlashItem, useResolveData, createFetchResolveData, readDataSource } = await import("./chart");
    expect(typeof ChartView).toBe("function");
    expect(typeof ChartEditor).toBe("function");
    expect(typeof useResolveData).toBe("function");
    expect(typeof createFetchResolveData).toBe("function");
    expect(typeof readDataSource).toBe("function");
    expect(chartSlashItem.create()).toMatchObject({ type: "chart", props: { source: { type: "inline" } } });
  });

  it("provides diagram rendering and its starter block independently", async () => {
    const { DiagramView, diagramSlashItem } = await import("./diagram");
    expect(typeof DiagramView).toBe("function");
    expect(diagramSlashItem.create()).toMatchObject({ type: "diagram", props: { code: expect.any(String) } });
  });

  it("provides table rendering and its starter block independently", async () => {
    const { DataTableView, dataTableSlashItem, useResolveData, createFetchResolveData, readDataSource } = await import("./table");
    expect(typeof DataTableView).toBe("function");
    expect(typeof useResolveData).toBe("function");
    expect(typeof createFetchResolveData).toBe("function");
    expect(typeof readDataSource).toBe("function");
    expect(dataTableSlashItem.create()).toMatchObject({ type: "dataTable", props: { source: { type: "inline" } } });
  });

  it("keeps syntax highlighting behind the code entry point", async () => {
    const { createLowlightHighlighter, pluginCodeLanguages } = await import("./code");
    expect(typeof createLowlightHighlighter).toBe("function");
    expect(pluginCodeLanguages.length).toBeGreaterThan(0);
  });

  it("exposes the new plugin subpaths", async () => {
    const diff = await import("./diff");
    expect(typeof diff.InlineDiffView).toBe("function");
    expect(typeof diff.SuggestionView).toBe("function");
    expect(typeof diff.DiffCompare).toBe("function");
    expect(typeof diff.useEditorSuggestions).toBe("function");
    expect(typeof diff.reconcileDoc).toBe("function");
    const comments = await import("./comments");
    expect(typeof comments.createCommentsController).toBe("function");
    expect(typeof comments.createMemoryCommentAdapter).toBe("function");
    const collab = await import("./collaboration");
    expect(typeof collab.useCollaboration).toBe("function");
    expect(typeof collab.createWebSocketTransport).toBe("function");
    const links = await import("./links");
    expect(typeof links.BookmarkView).toBe("function");
    expect(links.linkSlashItems.length).toBe(4);
    expect((await import("./callout")).calloutPlugin.blocks.length).toBe(1);
    expect((await import("./toggle")).togglePlugin.blocks.length).toBe(1);
    expect((await import("./toc")).tocPlugin.blocks.length).toBe(1);
    expect((await import("./columns")).columnsPlugin.blocks.length).toBeGreaterThan(0);
    const pages = await import("./pages");
    expect(typeof pages.PagedEditor).toBe("function");
    expect(typeof pages.exportDocx).toBe("function");
  });

  it("wires the new block types into pluginRenderers and pluginSlashItems", async () => {
    const { pluginRenderers, pluginSlashItems } = await import("./index");
    for (const t of ["pageBreak", "bookmark", "iframe", "callout", "toggle", "toc"]) expect(typeof pluginRenderers[t]).toBe("function");
    const types = pluginSlashItems.map((i) => i.type);
    for (const t of ["pageBreak", "bookmark", "iframe", "callout", "toggle", "toc"]) expect(types).toContain(t);
  });
});
