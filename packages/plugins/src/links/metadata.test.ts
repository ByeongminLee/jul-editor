import { describe, expect, it, vi } from "vitest";
import { cacheFetchMetadata, cardFromProps, createStaticMetadata, fallbackCard, resolveCard } from "./metadata.js";

describe("resolveCard", () => {
  it("without a callback returns the URL-rule card as ready", async () => {
    const s = await resolveCard("https://github.com/jul/editor");
    expect(s.status).toBe("ready");
    expect(s.card).toMatchObject({ provider: "github", title: "jul/editor", description: "GitHub repository", image: "" });
  });
  it("merges fetched metadata, resolving and sanitizing asset urls", async () => {
    const fetchMetadata = vi.fn(async () => ({ title: "  Real   title ", description: "d", image: "/og.png", favicon: "javascript:alert(1)", siteName: "Example" }));
    const s = await resolveCard("https://example.com/post", { fetchMetadata });
    expect(s.status).toBe("ready");
    expect(s.card).toMatchObject({ title: "Real title", description: "d", image: "https://example.com/og.png", favicon: "", siteName: "Example" });
    expect(fetchMetadata).toHaveBeenCalledWith("https://example.com/post", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("failure yields error state with the fallback card, never throws", async () => {
    const s = await resolveCard("https://example.com/post", { fetchMetadata: async () => Promise.reject(new Error("502")) });
    expect(s).toMatchObject({ status: "error", error: "502" });
    expect(s.card).toEqual(fallbackCard("https://example.com/post"));
  });
  it("times out", async () => {
    const s = await resolveCard("https://example.com", { fetchMetadata: () => new Promise(() => {}), timeoutMs: 10 });
    expect(s.status).toBe("error");
  });
  it("does not call the callback for an invalid url", async () => {
    const f = vi.fn();
    const s = await resolveCard("javascript:alert(1)", { fetchMetadata: f });
    expect(f).not.toHaveBeenCalled();
    expect(s.status).toBe("ready");
  });
});

describe("adapters", () => {
  it("cacheFetchMetadata dedupes in flight and caches successes only", async () => {
    let n = 0;
    const c = cacheFetchMetadata(async () => {
      n++;
      return { title: "t" };
    });
    await Promise.all([c("https://a.com", { signal: new AbortController().signal }), c("https://a.com", { signal: new AbortController().signal })]);
    await c("https://a.com", { signal: new AbortController().signal });
    expect(n).toBe(1);
    let fails = 0;
    const f = cacheFetchMetadata(async () => {
      fails++;
      throw new Error("x");
    });
    await f("https://b.com", { signal: new AbortController().signal }).catch(() => {});
    await f("https://b.com", { signal: new AbortController().signal }).catch(() => {});
    expect(fails).toBe(2);
  });
  it("createStaticMetadata answers known urls and rejects others", async () => {
    const m = createStaticMetadata({ "https://a.com": { title: "A" } });
    await expect(m("https://a.com", { signal: new AbortController().signal })).resolves.toEqual({ title: "A" });
    await expect(m("https://b.com", { signal: new AbortController().signal })).rejects.toThrow();
  });
  it("cardFromProps re-validates untrusted props", () => {
    expect(cardFromProps({ url: "javascript:alert(1)", title: "x" }).url).toBe("");
    expect(cardFromProps({ url: "https://a.com", image: "javascript:x" }).image).toBe("");
  });
});
