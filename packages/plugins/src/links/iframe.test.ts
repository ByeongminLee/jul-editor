import { describe, expect, it } from "vitest";
import { iframeSrcToUrl, originAllowed, providerIframe, resolveIframe } from "./iframe.js";

describe("providerIframe src transforms", () => {
  it("figma uses the embed endpoint with embed_host and the encoded url", () => {
    const s = providerIframe("https://www.figma.com/design/AbCdEf1234567890/My-file?node-id=1-2");
    expect(s?.src).toBe("https://www.figma.com/embed?embed_host=jul&url=" + encodeURIComponent("https://www.figma.com/design/AbCdEf1234567890/My-file?node-id=1-2"));
    expect(providerIframe("https://www.figma.com/file/AbCdEf1234567890/x", { figmaEmbedHost: "my app" })?.src).toContain("embed_host=jul&");
  });
  it("youtube / vimeo / loom / codepen / google docs", () => {
    expect(providerIframe("https://youtu.be/dQw4w9WgXcQ")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(providerIframe("https://vimeo.com/123456789")?.src).toBe("https://player.vimeo.com/video/123456789");
    expect(providerIframe("https://www.loom.com/share/0123456789abcdef0123456789abcdef")?.src).toBe("https://www.loom.com/embed/0123456789abcdef0123456789abcdef");
    expect(providerIframe("https://codepen.io/someone/pen/abCDef1")?.src).toBe("https://codepen.io/someone/embed/abCDef1?default-tab=result");
    expect(providerIframe("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit")?.src).toBe("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/preview");
    expect(providerIframe("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUv/edit")?.src).toMatch(/\/embed$/);
  });
  it("gist uses a null-origin srcdoc, never a direct src", () => {
    const s = providerIframe("https://gist.github.com/octocat/6cad326836d38bd3a7ae");
    expect(s?.src).toBeUndefined();
    expect(s?.srcdoc).toContain('src="https://gist.github.com/octocat/6cad326836d38bd3a7ae.js"');
    expect(s?.sandbox).not.toContain("allow-same-origin");
  });
  it("github repo, lookalike and plain pages are not embeddable", () => {
    expect(providerIframe("https://github.com/a/b")).toBeNull();
    expect(providerIframe("https://figma.com.evil.com/design/AbCdEf1234567890/x")).toBeNull();
    expect(providerIframe("https://example.com")).toBeNull();
    expect(providerIframe("https://www.google.com/maps/place/Seoul")).toBeNull();
    expect(providerIframe("https://www.google.com/maps/embed?pb=!1m18")?.src).toContain("/maps/embed");
  });
});

describe("generic iframe origin allowlist (default deny)", () => {
  it("denies everything by default", () => {
    expect(resolveIframe("https://example.com/app")).toBeNull();
    expect(resolveIframe("https://example.com/app", { allowedOrigins: [] })).toBeNull();
  });
  it("matches exact origin and dot-boundary wildcard only", () => {
    const a = ["https://example.com", "https://*.corp.io"];
    expect(originAllowed("https://example.com/x?y=1", a)).toBe(true);
    expect(originAllowed("https://app.corp.io/x", a)).toBe(true);
    expect(originAllowed("https://corp.io/x", a)).toBe(false);
    expect(originAllowed("https://example.com.evil.com/x", a)).toBe(false);
    expect(originAllowed("https://evilexample.com/x", a)).toBe(false);
    expect(originAllowed("https://evilcorp.io/x", a)).toBe(false);
    expect(originAllowed("http://example.com/x", a)).toBe(false);
    expect(originAllowed("https://example.com:8443/x", a)).toBe(false);
    expect(originAllowed("https://user:pw@example.com/x", a)).toBe(false);
    expect(originAllowed("javascript:alert(1)", a)).toBe(false);
  });
  it("uses the host sandbox", () => {
    const s = resolveIframe("https://example.com/app", { allowedOrigins: ["https://example.com"], sandbox: "allow-scripts" });
    expect(s).toMatchObject({ provider: "generic", src: "https://example.com/app", sandbox: "allow-scripts" });
  });
});

describe("iframeSrcToUrl", () => {
  it("recovers the page url from our constructed srcs", () => {
    const u = "https://www.figma.com/design/AbCdEf1234567890/My-file";
    expect(iframeSrcToUrl(providerIframe(u)!.src!)).toBe(u);
    expect(iframeSrcToUrl("https://www.loom.com/embed/0123456789abcdef0123456789abcdef")).toBe("https://www.loom.com/share/0123456789abcdef0123456789abcdef");
    expect(iframeSrcToUrl("https://example.com/x")).toBe("https://example.com/x");
  });
});
