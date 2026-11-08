// @vitest-environment jsdom
import { expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import { fromHTML } from "@jul-editor/core/serde";
import { PAGE_BREAK_HTML, pageBreak } from "./page-break.js";

const registry = createRegistry({ blocks: [...coreBlocks, pageBreak], inlines: coreInlines, marks: coreMarks });

it("parses our own html and Word style page-break divs back to pageBreak", () => {
  const r = fromHTML(`<p>a</p>${PAGE_BREAK_HTML}<div style="page-break-after: always"></div><div style="break-after:page">text</div>`, { registry });
  const types = r.doc.blocks.map((b) => b.type);
  expect(types.slice(0, 3)).toEqual(["paragraph", "pageBreak", "pageBreak"]);
  expect(types.filter((t) => t === "pageBreak")).toHaveLength(2); // a non-empty div is not a break
});
