import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Slot } from "./slot.js";

afterEach(() => cleanup());

describe("Slot (asChild)", () => {
  it("merges className, forwards the ref, and composes onClick (child first, then Slot's own)", () => {
    const ref = createRef<HTMLAnchorElement>();
    const order: string[] = [];
    render(
      <Slot className="outer" data-jul-editor-toolbar-item="" onClick={() => order.push("outer")}>
        <a ref={ref} href="#" className="inner" onClick={() => order.push("inner")}>
          link
        </a>
      </Slot>,
    );

    const el = screen.getByText("link");
    expect(el.tagName).toBe("A");
    expect(el.className).toContain("outer");
    expect(el.className).toContain("inner");
    expect(el.getAttribute("data-jul-editor-toolbar-item")).toBe("");
    expect(ref.current).toBe(el);

    fireEvent.click(el);
    expect(order).toEqual(["inner", "outer"]);
  });

  it("lets the child's own prop win when Slot didn't set it, and Slot's own value win otherwise", () => {
    render(
      <Slot aria-pressed="true" data-testid="slot-target">
        <button aria-label="from child">child label</button>
      </Slot>,
    );
    const el = screen.getByTestId("slot-target");
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("from child");
  });
});
