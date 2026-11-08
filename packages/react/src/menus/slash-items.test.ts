import { coreRegistry, createRegistry, defineBlock, newId } from "@jul-editor/core";
import { describe, expect, it } from "vitest";
import { KO_LABELS } from "../labels.js";
import { collectSlashItems, filterSlashItems, mergeSlashItems } from "./slash-items.js";
import type { SlashItem } from "./slash-items.js";

describe("slashItems", () => {
  const items = collectSlashItems(coreRegistry);

  it("empty query returns every item", () => {
    expect(filterSlashItems(items, "").length).toBe(items.length);
  });

  it("matches by title or English keyword prefix", () => {
    expect(filterSlashItems(items, "head").map((i) => i.id)).toEqual(["heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6"]);
    expect(filterSlashItems(items, "quo").map((i) => i.id)).toEqual(["quote"]);
  });

  it("choseong search: '/ㅊㅌ' matches the Chart item (title 차트 keyword)", () => {
    const found = filterSlashItems(items, "ㅊㅌ");
    expect(found.map((i) => i.id)).toContain("chart");
  });

  it("choseong search: 'ㅍ' matches the Table item (표)", () => {
    const found = filterSlashItems(items, "ㅍ");
    expect(found.map((i) => i.id)).toContain("table");
  });

  it("a non-choseong Korean query still matches via keyword prefix", () => {
    expect(filterSlashItems(items, "할일").map((i) => i.id)).toEqual(["todoListItem"]);
  });

  it("collects a custom block's BlockSpec.slash alongside the built-ins", () => {
    const callout = defineBlock({
      type: "callout",
      content: "inline",
      children: "none",
      props: { emoji: "💡" },
      slash: { title: "Callout", keywords: ["callout", "콜아웃"] },
    });
    const registry = createRegistry({ blocks: [...coreRegistry.blocks.values(), callout], inlines: [], marks: [] });
    const withCustom = collectSlashItems(registry);
    expect(withCustom.length).toBe(items.length + 1);
    expect(filterSlashItems(withCustom, "call").map((i) => i.type)).toEqual(["callout"]);
  });

  it("mergeSlashItems: an extra item replaces the built-in of the same type (e.g. @jul-editor/plugins' richer chart)", () => {
    const richerChart: SlashItem = {
      id: "chart",
      type: "chart",
      title: "Chart",
      keywords: ["chart", "차트"],
      create: () => ({ id: newId(), type: "chart", props: { kind: "line" } }),
    };
    const merged = mergeSlashItems(items, [richerChart]);
    expect(merged.length).toBe(items.length); // replaced, not duplicated
    const chart = merged.find((i) => i.type === "chart");
    expect(chart?.create).toBe(richerChart.create);
  });

  it("mergeSlashItems: empty plugin items leaves the base list untouched", () => {
    expect(mergeSlashItems(items, [])).toBe(items);
  });

  // I18n -- titles localize, but keywords (both languages, always)
  // and item identity (id/type) never do.
  it("collectSlashItems(registry, KO_LABELS) localizes every built-in title, per the built-in label mapping", () => {
    const ko = collectSlashItems(coreRegistry, KO_LABELS);
    expect(ko.length).toBe(items.length); // same items, just localized titles
    const byId = (id: string) => ko.find((i) => i.id === id)!;
    expect(byId("paragraph").title).toBe("텍스트");
    expect(byId("heading-1").title).toBe("제목 1");
    expect(byId("bulletListItem").title).toBe("글머리 기호 목록");
    expect(byId("orderedListItem").title).toBe("번호 목록");
    expect(byId("todoListItem").title).toBe("할 일 목록");
    expect(byId("quote").title).toBe("인용");
    expect(byId("codeBlock").title).toBe("코드");
    expect(byId("divider").title).toBe("구분선");
    expect(byId("image").title).toBe("이미지");
    expect(byId("table").title).toBe("표");
    expect(byId("chart").title).toBe("차트");
    expect(byId("diagram").title).toBe("다이어그램");
    expect(byId("dataTable").title).toBe("데이터 표");
    expect(byId("embed-youtube").title).toBe("유튜브");
    expect(byId("embed").title).toBe("임베드");
  });

  it("search keywords match both languages regardless of which locale's titles are showing", () => {
    const ko = collectSlashItems(coreRegistry, KO_LABELS);
    // English query still finds the Korean-titled item...
    expect(filterSlashItems(ko, "quo").map((i) => i.id)).toEqual(["quote"]);
    // ...and a Korean query still finds it under the English-titled default list.
    expect(filterSlashItems(items, "인용").map((i) => i.id)).toEqual(["quote"]);
  });
});
