import { describe, expect, it } from "vitest";
import { embedIframeSrc, embedWatchUrl, parseEmbedIframeSrc, parseEmbedUrl } from "./embed.js";

describe("parseEmbedUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=5", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/123456789", "vimeo", "123456789"],
    ["https://player.vimeo.com/video/123456789", "vimeo", "123456789"],
    ["https://www.vimeo.com/123456789", "vimeo", "123456789"],
    ["https://x.com/someone/status/1234567890", "x", ""],
    ["https://twitter.com/someone/status/1234567890", "x", ""],
    ["https://example.com/page", "link", ""],
    ["not a url at all", "link", ""],
    ["", "link", ""],
    ["ftp://example.com/file", "link", ""],
    // scheme-spoofing / injection
    ["javascript:alert(1)", "link", ""],
    ["javascript://youtube.com/watch?v=dQw4w9WgXcQ", "link", ""],
    ["data:text/html,<script>alert(1)</script>", "link", ""],
    // lookalike hosts -- must NEVER classify as the real provider
    ["https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "link", ""],
    ["https://evilyoutube.com/watch?v=dQw4w9WgXcQ", "link", ""],
    ["https://notyoutu.be/dQw4w9WgXcQ", "link", ""],
    ["https://vimeo.com.evil.com/123456789", "link", ""],
    ["https://x.com.evil.com/a/status/1", "link", ""],
    // id injection / malformed ids -- rejected, falls back to link
    ['https://www.youtube.com/watch?v="><script>alert(1)</script>', "link", ""],
    ["https://youtu.be/short", "link", ""], // too short to be a real 11-char id
    ["https://vimeo.com/not-a-number", "link", ""],
    ["https://x.com/someone/not-a-status", "link", ""],
    // subdomains are fine (genuine dot-boundary)
    ["https://www.youtube.com/watch?v=abcdefghijk", "youtube", "abcdefghijk"],
  ])("%s -> %s / %s", (url, provider, id) => {
    expect(parseEmbedUrl(url)).toEqual({ provider, url: url.trim(), id });
  });
});

describe("embedIframeSrc", () => {
  it("builds a youtube-nocookie src for a valid youtube id", () => {
    expect(embedIframeSrc("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
  it("builds a player.vimeo.com src for a valid vimeo id", () => {
    expect(embedIframeSrc("vimeo", "123456789")).toBe("https://player.vimeo.com/video/123456789");
  });
  it("never returns an iframe src for x/link providers", () => {
    expect(embedIframeSrc("x", "1234567890")).toBeNull();
    expect(embedIframeSrc("link", "anything")).toBeNull();
  });
  it("rejects a malformed/injected id even for an allowlisted provider", () => {
    expect(embedIframeSrc("youtube", '"><script>alert(1)</script>')).toBeNull();
    expect(embedIframeSrc("vimeo", "12; DROP TABLE")).toBeNull();
  });
});

describe("parseEmbedIframeSrc (fromHTML's reverse mapping)", () => {
  it("recognizes our own allowlisted iframe srcs", () => {
    expect(parseEmbedIframeSrc("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseEmbedIframeSrc("https://player.vimeo.com/video/123456789")).toEqual({ provider: "vimeo", id: "123456789" });
  });
  it("rejects a plain (non-nocookie) youtube embed src, and any other iframe", () => {
    expect(parseEmbedIframeSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBeNull();
    expect(parseEmbedIframeSrc("https://evil.example.com/embed/x")).toBeNull();
    expect(parseEmbedIframeSrc("http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBeNull(); // must be https
  });
});

describe("embedWatchUrl", () => {
  it("reconstructs a canonical watch url from provider+id", () => {
    expect(embedWatchUrl("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(embedWatchUrl("vimeo", "123456789")).toBe("https://vimeo.com/123456789");
    expect(embedWatchUrl("x", "")).toBe("");
    expect(embedWatchUrl("link", "")).toBe("");
  });
});
