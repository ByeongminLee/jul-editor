import { describe, expect, it } from "vitest";
import { computeDropTarget, dropIndicatorRect } from "./drop-target.js";

const RECT = { top: 100, bottom: 120, left: 50, width: 400 };

describe("computeDropTarget", () => {
  it("top half of the rect -> before", () => {
    expect(computeDropTarget("t1", RECT, 60, 105)).toEqual({ targetId: "t1", placement: "before" });
  });

  it("bottom half of the rect -> after", () => {
    expect(computeDropTarget("t1", RECT, 60, 115)).toEqual({ targetId: "t1", placement: "after" });
  });

  it("exactly at the vertical midpoint counts as the bottom half (after)", () => {
    expect(computeDropTarget("t1", RECT, 60, 110)).toEqual({ targetId: "t1", placement: "after" });
  });

  it("more than 40px right of the target's left edge -> child, regardless of vertical half", () => {
    expect(computeDropTarget("t1", RECT, 50 + 41, 105)).toEqual({ targetId: "t1", placement: "child" });
    expect(computeDropTarget("t1", RECT, 50 + 41, 115)).toEqual({ targetId: "t1", placement: "child" });
  });

  it("exactly 40px right stays before/after (child needs to exceed the threshold)", () => {
    expect(computeDropTarget("t1", RECT, 50 + 40, 105)).toEqual({ targetId: "t1", placement: "before" });
  });

  it("left of the target's own left edge never triggers child", () => {
    expect(computeDropTarget("t1", RECT, 10, 105)).toEqual({ targetId: "t1", placement: "before" });
  });
});

describe("dropIndicatorRect", () => {
  it("before -> a zero-height line at the rect's top edge", () => {
    expect(dropIndicatorRect(RECT, "before")).toEqual({ top: 100, left: 50, width: 400, height: 0 });
  });

  it("after -> a zero-height line at the rect's bottom edge", () => {
    expect(dropIndicatorRect(RECT, "after")).toEqual({ top: 120, left: 50, width: 400, height: 0 });
  });

  it("child -> the target's own full rect", () => {
    expect(dropIndicatorRect(RECT, "child")).toEqual({ top: 100, left: 50, width: 400, height: 20 });
  });
});
