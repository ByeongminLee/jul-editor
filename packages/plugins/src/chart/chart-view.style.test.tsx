// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChartView } from "./chart-view.js";

afterEach(cleanup);

it("accepts direct chart colors and Tailwind classes for its visual slots", () => {
  const view = render(<ChartView
    block={{ id: "chart", type: "chart", props: { kind: "bar", source: { type: "inline", csv: "" } } }}
    selected updateProps={() => {}}
    className={{ container: "rounded-xl", status: "text-sm", controls: "border" }}
    theme={{ series: ["#f97316"], tooltipBackground: "#111827" }}
  />);
  const root = view.container.querySelector('[data-jul-editor-plugin="chart"]') as HTMLElement;
  expect(root.className).toBe("rounded-xl");
  expect(root.style.getPropertyValue("--chart-1")).toBe("#f97316");
  expect(root.style.getPropertyValue("--chart-tooltip-bg")).toBe("#111827");
  expect(view.container.querySelector('[data-jul-editor-plugin="chart-loading"]')?.className).toBe("text-sm");
  expect(view.container.querySelector('[data-jul-editor-plugin="chart-editor"]')?.parentElement?.className).toBe("border");
});
