// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChartEditor } from "./chart-editor.js";

afterEach(cleanup);

function setup(palette?: string[]) {
  const updates: Record<string, unknown>[] = [];
  const view = render(<ChartEditor kind="bar" source={{ type: "inline", csv: "" }} range={null} x="month" y="visitors" columns={["month", "visitors"]} yColumns={["visitors"]}
    palette={palette} updateProps={(patch) => updates.push(patch)} />);
  return { updates, color: (i: number) => view.getByTestId(`jul-editor-chart-color-${i}`) as HTMLInputElement };
}

it("writes the palette once per color pick, not once per drag step", () => {
  const { updates, color } = setup();
  const input = color(1);
  fireEvent.input(input, { target: { value: "#111111" } });
  fireEvent.input(input, { target: { value: "#222222" } });
  fireEvent.input(input, { target: { value: "#333333" } });
  expect(updates).toHaveLength(0);
  expect(input.value).toBe("#333333");
  fireEvent.change(input, { target: { value: "#333333" } });
  expect(updates).toHaveLength(1);
  const palette = (updates[0] as { palette: string[] }).palette;
  expect(palette).toHaveLength(8);
  expect(palette[1]).toBe("#333333");
});

it("commits a pending color on blur", () => {
  const { updates, color } = setup();
  const input = color(2);
  fireEvent.input(input, { target: { value: "#abcdef" } });
  fireEvent.blur(input);
  expect(updates).toHaveLength(1);
  expect((updates[0] as { palette: string[] }).palette[2]).toBe("#abcdef");
});

it("keeps untouched slots following the theme when one swatch is edited", () => {
  const { updates, color } = setup();
  fireEvent.change(color(0), { target: { value: "#010203" } });
  const palette = (updates[0] as { palette: string[] }).palette;
  expect(palette[0]).toBe("#010203");
  expect(palette.slice(1)).toEqual(Array.from({ length: 7 }, (_, i) => expect.stringMatching(new RegExp(`^var\\(--chart-${i + 2}, #[0-9a-f]{6}\\)$`))));
});
