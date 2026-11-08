// Unit tests for the default `embed` void renderer -- plain function
// component against a minimal VoidRendererProps double, same convention as
// ImageView.test.tsx (no need for a full <Editor> mount).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor as CoreEditor } from "@jul-editor/core";
import type { VoidRendererProps } from "../context.js";
import { EmbedView } from "./embed-view.js";

afterEach(cleanup);

function baseProps(overrides: Partial<VoidRendererProps> = {}): VoidRendererProps {
  return {
    block: { id: "e1", type: "embed", props: {} },
    editor: {} as CoreEditor,
    selected: false,
    updateProps: vi.fn(),
    ...overrides,
  };
}

describe("EmbedView (default embed renderer)", () => {
  it("shows a URL input when empty, and typing alone never calls updateProps", () => {
    const updateProps = vi.fn();
    render(<EmbedView {...baseProps({ updateProps })} />);
    const input = screen.getByRole("textbox", { name: /embed url/i });
    fireEvent.change(input, { target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    expect(updateProps).not.toHaveBeenCalled();
  });

  it("Enter in the empty-state input commits provider/url/id in one updateProps call", () => {
    const updateProps = vi.fn();
    render(<EmbedView {...baseProps({ updateProps })} />);
    const input = screen.getByRole("textbox", { name: /embed url/i });
    fireEvent.change(input, { target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateProps).toHaveBeenCalledTimes(1);
    expect(updateProps).toHaveBeenCalledWith({ provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ", title: "" });
  });

  it("Enter with an empty/blank draft does nothing", () => {
    const updateProps = vi.fn();
    render(<EmbedView {...baseProps({ updateProps })} />);
    const input = screen.getByRole("textbox", { name: /embed url/i });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateProps).not.toHaveBeenCalled();
  });

  it("renders a youtube-nocookie iframe for a youtube embed with a valid id", () => {
    render(
      <EmbedView
        {...baseProps({ block: { id: "e1", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } } })}
      />,
    );
    const iframe = document.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation allow-popups");
  });

  it("never renders an iframe for a non-allowlisted provider, even with a crafted id", () => {
    render(
      <EmbedView
        {...baseProps({ block: { id: "e1", type: "embed", props: { provider: "x", url: "https://x.com/a/status/1", id: "'\"><script>" } } })}
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://x.com/a/status/1");
  });

  it("renders a link card for a plain link provider", () => {
    render(<EmbedView {...baseProps({ block: { id: "e1", type: "embed", props: { provider: "link", url: "https://example.com", title: "Example" } } })} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: "Example" }).getAttribute("href")).toBe("https://example.com");
  });

  it("shows a title input only when selected", () => {
    const block = { id: "e1", type: "embed", props: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" } };
    const { rerender } = render(<EmbedView {...baseProps({ block, selected: false })} />);
    expect(screen.queryByRole("textbox", { name: /embed title/i })).toBeNull();
    rerender(<EmbedView {...baseProps({ block, selected: true })} />);
    expect(screen.getByRole("textbox", { name: /embed title/i })).not.toBeNull();
  });
});
