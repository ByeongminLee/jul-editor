// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Inline } from "../model/types.js";
import { buildContentDOM, plainTextOf, readContentFromDOM, runKey } from "./inline-dom.js";

function contentEl(inlines: Inline[]): HTMLElement {
  const div = document.createElement("div");
  const built = buildContentDOM(inlines);
  for (const n of built.nodes) div.appendChild(n);
  return div;
}

describe("buildContentDOM / readContentFromDOM round-trip", () => {
  it("plain text", () => {
    const inlines: Inline[] = [{ type: "text", text: "hello" }];
    const el = contentEl(inlines);
    expect(el.textContent).toBe("hello");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("marks nest as strong/em/s/code/a", () => {
    const inlines: Inline[] = [
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.test" } }] },
    ];
    const el = contentEl(inlines);
    expect(el.querySelector("strong")?.textContent).toBe("bold");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://x.test");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("multiple marks nest (bold+italic)", () => {
    const inlines: Inline[] = [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] }];
    const el = contentEl(inlines);
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("underline/subscript/superscript render as real <u>/<sub>/<sup> tags and round-trip", () => {
    const inlines: Inline[] = [
      { type: "text", text: "u", marks: [{ type: "underline" }] },
      { type: "text", text: "sub", marks: [{ type: "subscript" }] },
      { type: "text", text: "sup", marks: [{ type: "superscript" }] },
    ];
    const el = contentEl(inlines);
    expect(el.querySelector("u")?.textContent).toBe("u");
    expect(el.querySelector("sub")?.textContent).toBe("sub");
    expect(el.querySelector("sup")?.textContent).toBe("sup");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("highlight renders as <mark>, with data-jul-editor-highlight only for a non-default color, and round-trips either way", () => {
    const plain: Inline[] = [{ type: "text", text: "a", marks: [{ type: "highlight" }] }];
    const plainEl = contentEl(plain);
    expect(plainEl.querySelector("mark")?.hasAttribute("data-jul-editor-highlight")).toBe(false);
    expect(readContentFromDOM(plainEl, coreRegistry, plain)).toEqual(plain);

    const colored: Inline[] = [{ type: "text", text: "b", marks: [{ type: "highlight", attrs: { color: "yellow" } }] }];
    const coloredEl = contentEl(colored);
    expect(coloredEl.querySelector("mark")?.getAttribute("data-jul-editor-highlight")).toBe("yellow");
    expect(readContentFromDOM(coloredEl, coreRegistry, colored)).toEqual(colored);
  });

  it("textColor renders as span[data-jul-editor-color] (the generic data-mark fallback) and round-trips", () => {
    const inlines: Inline[] = [{ type: "text", text: "c", marks: [{ type: "textColor", attrs: { color: "red" } }] }];
    const el = contentEl(inlines);
    const span = el.querySelector("span[data-mark='textColor']")!;
    expect(span.getAttribute("data-jul-editor-color")).toBe("red");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("mention renders as an editable span[data-mention] with the label as text", () => {
    const inlines: Inline[] = [{ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } }];
    const el = contentEl(inlines);
    const span = el.querySelector("[data-mention]")!;
    expect(span.getAttribute("contenteditable")).not.toBe("false");
    expect(span.textContent).toBe("@Alice");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("tag mentions render #label and absorb typed text after the atomic tag", () => {
    const inlines: Inline[] = [{ type: "mention", attrs: { kind: "tag", id: "t1", label: "research" } }];
    const el = contentEl(inlines);
    const span = el.querySelector("[data-mention]")!;
    expect(span.textContent).toBe("#research");
    expect(plainTextOf(inlines)).toBe("#research");
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
    span.textContent = "#researchx";
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual([...inlines, { type: "text", text: "x" }]);
  });

  it("empty content renders a placeholder <br>, ignored on read-back", () => {
    const el = contentEl([]);
    expect(el.querySelector("br[data-jul-editor-placeholder]")).not.toBeNull();
    expect(readContentFromDOM(el, coreRegistry, [])).toEqual([]);
  });

  it("trailing newline gets one extra trailing <br>", () => {
    const inlines: Inline[] = [{ type: "text", text: "a\n" }];
    const el = contentEl(inlines);
    expect(el.querySelectorAll("br").length).toBe(1);
    expect(readContentFromDOM(el, coreRegistry, inlines)).toEqual(inlines);
  });

  it("text typed inside a mention span is split out as a trailing run after it", () => {
    const prior: Inline[] = [{ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } }];
    const el = contentEl(prior);
    const span = el.querySelector("[data-mention]") as HTMLElement;
    span.textContent = "@Alicex"; // simulate the browser appending a char while composing/typing
    const result = readContentFromDOM(el, coreRegistry, prior);
    expect(result).toEqual([{ type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } }, { type: "text", text: "x" }]);
  });

  it("plainTextOf treats a mention as its label", () => {
    const inlines: Inline[] = [{ type: "text", text: "hi " }, { type: "mention", attrs: { kind: "user", id: "u1", label: "@Bob" } }];
    expect(plainTextOf(inlines)).toBe("hi @Bob");
  });

  it("runKey ignores text length but not marks/mention identity", () => {
    expect(runKey({ type: "text", text: "a" })).toBe(runKey({ type: "text", text: "abc" }));
    expect(runKey({ type: "text", text: "a", marks: [{ type: "bold" }] })).not.toBe(runKey({ type: "text", text: "a" }));
    expect(runKey({ type: "mention", attrs: { kind: "user", id: "1", label: "x" } })).not.toBe(
      runKey({ type: "mention", attrs: { kind: "user", id: "2", label: "x" } }),
    );
  });
});
