// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarkView } from "./bookmark-view.js";
import { IframeView } from "./iframe-view.js";
import { embedSlashItem, linkSlashItems } from "./index.js";

afterEach(cleanup);
const empty = (type: string) => ({ id: "x", type, props: {} });

describe("empty bookmark / iframe blocks ask for a url", () => {
  for (const [name, View, type] of [["BookmarkView", BookmarkView, "bookmark"], ["IframeView", IframeView, "iframe"]] as const) {
    it(`${name}: Enter stores the typed url (bare domains get https://)`, () => {
      const updateProps = vi.fn();
      const { getByRole } = render(<View block={empty(type)} updateProps={updateProps} selected />);
      const input = getByRole("textbox") as HTMLInputElement;
      expect(document.activeElement).toBe(input); // a fresh slash insert is selected: focus the field
      fireEvent.change(input, { target: { value: "github.com/example/jul-editor" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(updateProps).toHaveBeenCalledWith({ url: "https://github.com/example/jul-editor" });
    });
    it(`${name}: refuses a non http(s) value and stays read-only without updateProps`, () => {
      const updateProps = vi.fn();
      const { getByRole, unmount } = render(<View block={empty(type)} updateProps={updateProps} />);
      fireEvent.change(getByRole("textbox"), { target: { value: "javascript:alert(1)" } });
      fireEvent.keyDown(getByRole("textbox"), { key: "Enter" });
      expect(updateProps).not.toHaveBeenCalled();
      expect(getByRole("alert")).toBeTruthy();
      unmount();
      const ro = render(<View block={empty(type)} readOnly />);
      expect(ro.queryByRole("textbox")).toBeNull();
      expect(ro.container.textContent).toContain("No URL");
    });
  }
});

it("the iframe slash item does not reuse core's 'Embed' title", () => {
  expect(embedSlashItem.title).not.toBe("Embed");
  expect(new Set(linkSlashItems.map((i) => i.title)).size).toBe(linkSlashItems.length);
});

it("focuses the url field when it mounts while the editor has focus (slash insert), not otherwise", () => {
  const root = document.createElement("div");
  root.tabIndex = 0;
  document.body.append(root);
  const editor = { getRoot: () => root } as never;
  const idle = render(<BookmarkView block={empty("bookmark")} editor={editor} updateProps={() => {}} />);
  expect(document.activeElement).not.toBe(idle.getByRole("textbox"));
  idle.unmount();
  root.focus();
  const typing = render(<BookmarkView block={empty("bookmark")} editor={editor} updateProps={() => {}} />);
  expect(document.activeElement).toBe(typing.getByRole("textbox"));
  root.remove();
});
