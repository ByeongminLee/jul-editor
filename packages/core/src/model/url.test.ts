import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "./url.js";
import { sanitizeBlockProps } from "./canonical.js";

describe("sanitizeUrl", () => {
  describe("rejects unsafe link vectors", () => {
    const badLinks = [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "JaVa\tscript:alert(1)",
      "java\nscript:alert(1)",
      "&#x6a;avascript:alert(1)",
      "&#106;avascript:alert(1)",
      "\u0000javascript:alert(1)",
      " javascript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html,<script>alert(1)</script>",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "javascript\u0009:alert(1)",
      "jav\u0000ascript:alert(1)",
    ];
    for (const url of badLinks) {
      it(`rejects ${JSON.stringify(url)}`, () => {
        expect(sanitizeUrl(url, "link")).toBeNull();
      });
    }
  });

  describe("accepts safe link vectors", () => {
    const goodLinks: [string, string][] = [
      ["https://example.com/a", "https://example.com/a"],
      ["http://example.com/a", "http://example.com/a"],
      ["mailto:a@b.com", "mailto:a@b.com"],
      ["/relative/path", "/relative/path"],
      ["./relative", "./relative"],
      ["../up", "../up"],
      ["#fragment", "#fragment"],
      ["jul-editor:page/123", "jul-editor:page/123"],
      ["", ""],
    ];
    for (const [url, expected] of goodLinks) {
      it(`accepts ${JSON.stringify(url)}`, () => {
        expect(sanitizeUrl(url, "link")).toBe(expected);
      });
    }
  });

  describe("image", () => {
    it("rejects javascript:", () => {
      expect(sanitizeUrl("javascript:alert(1)", "image")).toBeNull();
    });
    it("rejects mailto for image", () => {
      expect(sanitizeUrl("mailto:a@b.com", "image")).toBeNull();
    });
    it("rejects data:", () => {
      expect(sanitizeUrl("data:image/png;base64,abc", "image")).toBeNull();
    });
    it("rejects blob: without allowBlob", () => {
      expect(sanitizeUrl("blob:https://example.com/uuid", "image")).toBeNull();
    });
    it("accepts blob: with allowBlob", () => {
      expect(sanitizeUrl("blob:https://example.com/uuid", "image", { allowBlob: true })).toBe(
        "blob:https://example.com/uuid",
      );
    });
    it("accepts https", () => {
      expect(sanitizeUrl("https://example.com/a.png", "image")).toBe("https://example.com/a.png");
    });
    it("accepts relative", () => {
      expect(sanitizeUrl("/uploads/a.png", "image")).toBe("/uploads/a.png");
    });
    it("rejects jul-editor: (link-only scheme)", () => {
      expect(sanitizeUrl("jul-editor:page/123", "image")).toBeNull();
    });
  });

  it("is not fooled by attribute-escape quotes embedded in the url", () => {
    // sanitizeUrl doesn't escape for HTML output (toHTML's job); it just
    // rejects unsafe schemes. A quote in a path segment passes the scheme
    // check but must survive unescaped here -- escaping happens at toHTML.
    expect(sanitizeUrl('https://example.com/"onmouseover=alert(1)', "link")).toBe(
      'https://example.com/"onmouseover=alert(1)',
    );
  });
});

it("never persists temporary or unsafe attachment URLs", () => {
  expect(sanitizeBlockProps("attachment", { src: "blob:https://example.com/temporary", name: "report.pdf" })).toEqual({ name: "report.pdf" });
  expect(sanitizeBlockProps("attachment", { src: "data:text/html,bad", name: "report.pdf" })).toEqual({ name: "report.pdf" });
  expect(sanitizeBlockProps("attachment", { src: "https://cdn.example.com/report.pdf", name: "report.pdf" })).toEqual({ src: "https://cdn.example.com/report.pdf", name: "report.pdf" });
});
