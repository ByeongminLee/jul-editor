// @jul-editor/plugins' chart/diagram/dataTable views on the "/plugins"
// playground page (e2e/fixtures/src/plugins/plugins-demo.tsx). Selection
// (`window.__julEditorPlugins.selectBlock`) mirrors e2e/react.spec.ts's bridge
// pattern -- core has no click-to-select-void yet, so tests drive selection
// programmatically rather than guessing pixel coordinates.

import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __julEditorPlugins?: {
      getDoc: () => unknown;
      setSelection: (selection: unknown) => void;
      selectBlock: (id: string) => void;
    };
  }
}

interface DocBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
}
interface DocLike {
  blocks: DocBlock[];
}

async function getBlock(page: import("@playwright/test").Page, id: string): Promise<DocBlock> {
  const doc = (await page.evaluate(() => window.__julEditorPlugins!.getDoc())) as DocLike;
  const block = doc.blocks.find((b) => b.id === id);
  if (!block) throw new Error(`no block ${id}`);
  return block;
}

test.describe("chart block", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plugins");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
  });

  test("chart: the bar chart SVG renders one bar per CSV data row", async ({ page }) => {
    const chart = page.locator('[data-jul-editor-block][data-id="x-chart-bar"]');
    await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(4); // Jan/Feb/Mar/Apr
  });

  test("chart: an A1 range on a line chart's source clips it to the requested rows", async ({ page }) => {
    // x-chart-line's csv has 25 rows, range is "A1:C20" -> at most 20 points.
    const chart = page.locator('[data-jul-editor-block][data-id="x-chart-line"]');
    await expect(chart.locator(".recharts-line-dot")).toHaveCount(20);
  });

  test("chart: editing the CSV textarea updates both the chart and block.props.source, without inserting text into the document", async ({
    page,
  }) => {
    await page.evaluate(() => window.__julEditorPlugins!.selectBlock("x-chart-bar"));
    const csv = page.getByTestId("jul-editor-chart-csv");
    await expect(csv).toBeVisible();

    await csv.click();
    await page.keyboard.press("End");
    await page.keyboard.type("\nMay,999");

    const chart = page.locator('[data-jul-editor-block][data-id="x-chart-bar"]');
    await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(5);

    const block = await getBlock(page, "x-chart-bar");
    const source = block.props.source as { type: string; csv: string };
    expect(source.csv).toContain("May,999");

    // The surrounding paragraph's text must be untouched -- core's
    // isInsideVoid guard keeps keydown/beforeinput out of a void's portal.
    const p1 = await getBlock(page, "x-p1");
    expect(JSON.stringify(p1)).not.toContain("May,999");
  });

  test("chart: an invalid range keeps the editor available so the range can be corrected", async ({ page }) => {
    await page.evaluate(() => window.__julEditorPlugins!.selectBlock("x-chart-bar"));
    const range = page.getByTestId("jul-editor-chart-range");
    await range.fill("invalid range");
    await expect(page.locator('[data-jul-editor-block][data-id="x-chart-bar"] [data-jul-editor-plugin="chart-error"]')).toBeVisible();
    await expect(range).toBeVisible();
    await range.fill("A1:B2");
    await expect(page.locator('[data-jul-editor-block][data-id="x-chart-bar"] .recharts-bar-rectangle')).toHaveCount(2);
  });
});

test.describe("resolveData injection", () => {
  test("dataTable: a 'view' source with no <ResolveDataProvider> shows a headless missing-resolver state", async ({ page }) => {
    await page.goto("/plugins");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
    const viewTable = page.locator('[data-jul-editor-block][data-id="x-table-view"] [data-jul-editor-plugin="missing-resolver"]');
    await expect(viewTable).toBeVisible();
    // and it must not have silently rendered an (empty) <table> instead.
    await expect(page.locator('[data-jul-editor-block][data-id="x-table-view"] table')).toHaveCount(0);
  });
});

test.describe("diagram block", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plugins");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
  });

  test("diagram: the mermaid chunk is requested only once a diagram block exists on the page", async ({ page }) => {
    const withDiagram: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("mermaid")) withDiagram.push(req.url());
    });
    await page.goto("/plugins");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
    await page.waitForTimeout(500); // debounce (300ms) + render
    expect(withDiagram.length).toBeGreaterThan(0);
  });

  test("diagram: no mermaid chunk is requested on a page with no diagram blocks", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("mermaid")) requests.push(req.url());
    });
    await page.goto("/plugins?empty=1");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests.length).toBe(0);
  });

  test("diagram: valid mermaid code renders an SVG preview", async ({ page }) => {
    const preview = page.getByTestId("jul-editor-diagram-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator("svg")).toHaveCount(1);
  });

  test("diagram: invalid mermaid code shows a headless error element and the editor stays editable", async ({ page }) => {
    await page.evaluate(() => window.__julEditorPlugins!.selectBlock("x-diagram"));
    const code = page.getByTestId("jul-editor-diagram-code");
    await expect(code).toBeVisible();

    await code.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("this is ((( not valid mermaid at all");
    await expect(page.getByTestId("jul-editor-diagram-error")).toBeVisible({ timeout: 2000 });

    // still editable: typing in the trailing paragraph still reaches the model.
    await page.evaluate(() => window.__julEditorPlugins!.setSelection({ type: "text", anchor: { blockId: "x-p2", offset: 0 }, focus: { blockId: "x-p2", offset: 0 } }));
    await page.keyboard.type("still editable");
    const doc = (await page.evaluate(() => window.__julEditorPlugins!.getDoc())) as DocLike & { blocks: (DocBlock & { content?: { text?: string }[] })[] };
    const p2 = doc.blocks.find((b) => b.id === "x-p2")!;
    expect((p2.content ?? []).map((c) => c.text ?? "").join("")).toBe("still editable");
  });

  test("diagram: a %%{init}%% directive cannot raise mermaid's securityLevel above 'strict' (no script tag, no javascript: href)", async ({
    page,
  }) => {
    await page.evaluate(() => window.__julEditorPlugins!.selectBlock("x-diagram"));
    const code = page.getByTestId("jul-editor-diagram-code");
    await expect(code).toBeVisible();
    await code.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(
      '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A[Start] --> B[Click me]\n  click B "javascript:alert(1)" "xss"\n  B --> C["<script>alert(2)<' + "/script>" + '"]',
      { delay: 5 },
    );

    const preview = page.getByTestId("jul-editor-diagram-preview");
    await expect(preview).toBeVisible({ timeout: 2000 });
    const html = await preview.innerHTML();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).not.toContain('onclick="');
  });
});

test.describe("dataTable block", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plugins");
    await expect(page.getByTestId("page-plugins")).toBeVisible();
  });

  test("dataTable: renders the resolved CSV as a plain table", async ({ page }) => {
    const table = page.getByTestId("jul-editor-datatable");
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(3); // alice/bob/carol
    await expect(table.locator("thead th")).toHaveCount(3); // name/age/city
  });

  test("dataTable: selected inline CSV remains editable while the table refreshes", async ({ page }) => {
    await page.evaluate(() => window.__julEditorPlugins!.selectBlock("x-table"));
    const csv = page.getByTestId("jul-editor-datatable-csv");
    await expect(csv).toBeVisible();
    await csv.fill("name,score\nAlex,8\nSam,13");
    await expect(page.locator('[data-jul-editor-block][data-id="x-table"] tbody tr')).toHaveCount(2);
    await expect(page.locator('[data-jul-editor-block][data-id="x-table"] thead th')).toContainText(["name", "score"]);
    await expect(csv).toBeVisible();
    const block = await getBlock(page, "x-table");
    expect(block.props.source).toEqual({ type: "inline", csv: "name,score\nAlex,8\nSam,13" });
  });
});
