// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { coreBlocks, coreInlines, coreMarks, createRegistry } from "@jul-editor/core";
import { fromHTML } from "@jul-editor/core/serde";
import { importDocx, restoreDocxPageBreaks } from "./docx.js";
import { pageBreak } from "./page-break.js";
import type { MammothLib } from "./docx.js";

const registry = createRegistry({ blocks: [...coreBlocks, pageBreak], inlines: coreInlines, marks: coreMarks });
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Stand-in for mammoth: emits page breaks only when the style map names them (as mammoth does). */
function fakeMammoth(html: (pageBreak: string) => string): MammothLib & { styleMap?: string | string[] } {
  const lib: MammothLib & { styleMap?: string | string[] } = {
    async convertToHtml(_input, options) {
      lib.styleMap = options?.styleMap;
      const mapped = ([] as string[]).concat(options?.styleMap ?? []).find((l) => /^br\[type='page'\]\s*=>\s*hr\.([\w-]+)$/.test(l));
      const cls = mapped ? /hr\.([\w-]+)/.exec(mapped)![1] : null;
      return { value: html(cls ? `<hr class="${cls}" />` : ""), messages: [] };
    },
  };
  return lib;
}

describe("importDocx", () => {
  it("turns docx page breaks (exported as their own paragraph) back into pageBreak blocks", async () => {
    const mammothLib = fakeMammoth((br) => `<p>Before</p><p>${br}</p><p>After</p>`);
    const { doc } = await importDocx(new ArrayBuffer(0), { mammothLib, fromHTML: (html) => fromHTML(html, { registry }) });
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("splits a paragraph around a page break inside its text", async () => {
    const mammothLib = fakeMammoth((br) => `<p>B${br}C</p>`);
    const { doc } = await importDocx(new ArrayBuffer(0), { mammothLib, fromHTML: (html) => fromHTML(html, { registry }) });
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("returns embedded data: images with their block ids instead of dropping them", async () => {
    const mammothLib = fakeMammoth(() => `<p>Before image</p><p><img src="${PNG}" alt="logo" /></p>`);
    const { doc, images } = await importDocx(new ArrayBuffer(0), { mammothLib, fromHTML: (html) => fromHTML(html, { registry }) });
    const image = doc.blocks.find((b) => b.type === "image");
    expect(image).toBeTruthy();
    expect(images).toEqual([{ blockId: image!.id, dataUrl: PNG }]);
  });

  it("restoreDocxPageBreaks leaves html without markers untouched", () => {
    expect(restoreDocxPageBreaks("<p>a</p>")).toBe("<p>a</p>");
  });
});
