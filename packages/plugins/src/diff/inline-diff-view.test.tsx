// @vitest-environment jsdom
import type { Block, Doc } from "@jul-editor/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffCompare, DiffView, InlineDiffView, SuggestionView } from "./";

afterEach(cleanup);
const doc = (blocks: Block[]): Doc => ({ version: 1, blocks });
const p = (id: string, text: string): Block => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }] });

const before = doc([p("a", "hello world"), p("b", "gone"), p("c", "same")]);
const after = doc([p("a", "hello brave world"), p("c", "same"), p("d", "fresh")]);

describe("InlineDiffView", () => {
  it("renders ins/del inline in one document with block statuses", () => {
    const { container } = render(<InlineDiffView before={before} after={after} />);
    expect(container.querySelector("[data-id=a] ins")?.textContent).toBe("brave ");
    expect(container.querySelector("[data-id=b]")?.getAttribute("data-diff")).toBe("delete");
    expect(container.querySelector("[data-id=b] del")?.textContent).toBe("gone");
    expect(container.querySelector("[data-id=d]")?.getAttribute("data-diff")).toBe("insert");
    expect(container.querySelector("[data-id=c]")?.getAttribute("data-diff")).toBe("same");
  });

  it("exposes attribution", () => {
    const { container } = render(<InlineDiffView before={before} after={after} attribute={() => ({ id: "ai", name: "Agent", color: "rgb(1, 2, 3)" })} />);
    const ins = container.querySelector("[data-id=a] ins") as HTMLElement;
    expect(ins.getAttribute("data-diff-author")).toBe("ai");
    expect(ins.getAttribute("title")).toBe("Agent");
    expect(ins.style.getPropertyValue("--jul-editor-diff-author")).toBe("rgb(1, 2, 3)");
  });

  it("DiffView layout=inline and DiffCompare toggle", () => {
    const a = render(<DiffView before={before} after={after} layout="inline" />);
    expect(a.container.querySelector("[data-jul-editor-diff-inline]")).not.toBeNull();
    cleanup();
    const { container } = render(<DiffCompare before={before} after={after} />);
    expect(container.querySelector("[data-jul-editor-diff-view]")).not.toBeNull();
    fireEvent.click(container.querySelector("button[data-layout=inline]")!);
    expect(container.querySelector("[data-jul-editor-diff-inline]")).not.toBeNull();
  });
});

describe("SuggestionView", () => {
  it("accept/reject per change and Accept all produce the resulting doc", () => {
    const onResult = vi.fn();
    const { container } = render(<SuggestionView base={before} proposed={after} onResult={onResult} />);
    expect(container.querySelector("[data-suggestion-pending]")?.textContent).toBe("3 pending");

    fireEvent.click(container.querySelector("[data-for='text:a:0'] button[data-action=accept]")!);
    expect(container.querySelector("[data-id=a]")?.textContent).toContain("hello brave ");
    expect(container.querySelector("[data-id=a] ins")).toBeNull();
    expect(container.querySelector("[data-suggestion-pending]")?.textContent).toBe("2 pending");

    fireEvent.click(container.querySelector("[data-for='insert:d'] button[data-action=reject]")!);
    expect(container.querySelector("[data-id=d]")).toBeNull();

    fireEvent.click(container.querySelector("button[data-action=accept-all]")!);
    const last = onResult.mock.calls.at(-1)![0] as Doc;
    expect(last).toEqual(after);
    fireEvent.click(container.querySelector("button[data-action=reject-all]")!);
    expect(onResult.mock.calls.at(-1)![0]).toEqual(before);
  });
});
