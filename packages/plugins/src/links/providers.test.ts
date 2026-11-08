import { describe, expect, it } from "vitest";
import { parseLink } from "./providers.js";

describe("parseLink", () => {
  it("parses github repo / issue / pr / gist / user", () => {
    expect(parseLink("https://github.com/jul/editor")).toMatchObject({ provider: "github", kind: "repo", title: "jul/editor", icon: "github-repo" });
    expect(parseLink("https://github.com/jul/editor/issues/12")).toMatchObject({ kind: "issue", title: "jul/editor#12", subtitle: "Issue #12", ids: { number: "12" } });
    expect(parseLink("https://github.com/jul/editor/pull/3/files")).toMatchObject({ kind: "pr", subtitle: "Pull request #3", icon: "github-pr" });
    expect(parseLink("https://gist.github.com/octocat/6cad326836d38bd3a7ae")).toMatchObject({ provider: "github", kind: "gist", ids: { user: "octocat", id: "6cad326836d38bd3a7ae" } });
    expect(parseLink("https://github.com/octocat")).toMatchObject({ kind: "user" });
    expect(parseLink("https://github.com/settings/profile").provider).toBe("link");
  });

  it("parses figma with the file name from the slug", () => {
    expect(parseLink("https://www.figma.com/design/AbCdEf1234567890/My-Cool_file?node-id=1-2")).toMatchObject({ provider: "figma", kind: "design", title: "My Cool file", ids: { fileKey: "AbCdEf1234567890" } });
    expect(parseLink("https://www.figma.com/proto/AbCdEf1234567890/Flow").subtitle).toBe("Figma prototype");
  });

  it("parses youtube, loom, notion, google docs, linear, codepen", () => {
    expect(parseLink("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ provider: "youtube", ids: { videoId: "dQw4w9WgXcQ" } });
    expect(parseLink("https://www.loom.com/share/0123456789abcdef0123456789abcdef")).toMatchObject({ provider: "loom" });
    expect(parseLink("https://www.notion.so/acme/Roadmap-Q3-0123456789abcdef0123456789abcdef")).toMatchObject({ provider: "notion", title: "Roadmap Q3" });
    expect(parseLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit")).toMatchObject({ provider: "google-docs", kind: "sheet", icon: "google-sheet" });
    expect(parseLink("https://linear.app/acme/issue/ENG-123/fix-the-thing")).toMatchObject({ provider: "linear", title: "ENG-123 fix the thing" });
    expect(parseLink("https://codepen.io/someone/pen/abCDef1")).toMatchObject({ provider: "codepen", ids: { user: "someone", penId: "abCDef1" } });
  });

  it("rejects lookalike hosts (never substring/suffix matches)", () => {
    for (const u of [
      "https://github.com.evil.com/a/b",
      "https://evilgithub.com/a/b",
      "https://figma.com.evil.com/design/AbCdEf1234567890/x",
      "https://notfigma.com/design/AbCdEf1234567890/x",
      "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://loom.com.evil.io/share/0123456789abcdef0123456789abcdef",
      "https://docs.google.com.evil.com/document/d/1AbCdEfGhIjKlMnOpQrStUv",
      "https://linear.app.evil.com/acme/issue/ENG-1",
      "https://evil.com/github.com/a/b",
      "https://github.com@evil.com/a/b",
    ]) {
      expect(parseLink(u).provider, u).toBe("link");
    }
  });

  it("falls back for unknown, invalid and non-http urls without throwing", () => {
    expect(parseLink("https://example.com/a/b/")).toMatchObject({ provider: "link", domain: "example.com", title: "example.com/a/b" });
    expect(parseLink("www.example.com")).toMatchObject({ provider: "link", url: "https://www.example.com/", domain: "example.com" });
    expect(parseLink("javascript:alert(1)")).toMatchObject({ provider: "link", url: "" });
    expect(parseLink("not a url").url).toBe("");
    expect(parseLink(undefined as never).url).toBe("");
  });
});
