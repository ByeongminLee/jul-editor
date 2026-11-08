import { describe, expect, it, vi } from "vitest";
import { MissingResolverError, MissingUrlResolverError, createFetchResolveData, defaultResolveData, readDataSource } from "./resolve-data.js";

describe("data sources", () => {
  it("reads legacy CSV, inline JSON, URL, and host view descriptors", () => {
    expect(readDataSource({ type: "inline", csv: "x\n1" })).toEqual({ type: "inline", csv: "x\n1" });
    expect(readDataSource({ type: "inline", format: "json", json: "[]" })).toEqual({ type: "inline", format: "json", json: "[]" });
    expect(readDataSource({ type: "url", format: "csv", url: "https://cdn.example/data.csv" })).toEqual({ type: "url", format: "csv", url: "https://cdn.example/data.csv" });
    expect(readDataSource({ type: "view", viewId: "sales" })).toEqual({ type: "view", viewId: "sales" });
  });

  it("resolves inline CSV and JSON without network access", async () => {
    await expect(defaultResolveData({ type: "inline", csv: "x\n1" })).resolves.toMatchObject({ rows: [[1]] });
    await expect(defaultResolveData({ type: "inline", format: "json", json: '[{"x":2}]' })).resolves.toMatchObject({ rows: [[2]] });
  });

  it("requires an explicit resolver for URL and view sources", async () => {
    await expect(defaultResolveData({ type: "url", format: "csv", url: "https://cdn.example/data.csv" })).rejects.toBeInstanceOf(MissingUrlResolverError);
    await expect(defaultResolveData({ type: "view", viewId: "sales" })).rejects.toBeInstanceOf(MissingResolverError);
  });

  it("fetches CSV and JSON URLs, preserving signed query strings", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(url.endsWith(".json?sig=abc") ? '[{"x":3}]' : "x\n4"));
    const resolve = createFetchResolveData(fetcher);
    await expect(resolve({ type: "url", format: "json", url: "https://cdn.example/data.json?sig=abc" })).resolves.toMatchObject({ rows: [[3]] });
    await expect(resolve({ type: "url", format: "csv", url: "https://cdn.example/data.csv" })).resolves.toMatchObject({ rows: [[4]] });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://cdn.example/data.json?sig=abc", "https://cdn.example/data.csv"]);
  });

  it("reports unsupported URLs and HTTP errors", async () => {
    const fetcher = vi.fn(async () => new Response("denied", { status: 403 }));
    const resolve = createFetchResolveData(fetcher);
    await expect(resolve({ type: "url", format: "csv", url: "file:///tmp/data.csv" })).rejects.toThrow(/http/i);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(resolve({ type: "url", format: "csv", url: "https://cdn.example/data.csv" })).rejects.toThrow(/403/);
  });

  it("lets a host resolver handle view IDs alongside URL fetching", async () => {
    const host = vi.fn(async () => ({ columns: ["x"], columnTypes: ["number" as const], rows: [[7]] }));
    const resolve = createFetchResolveData(vi.fn(), host);
    await expect(resolve({ type: "view", viewId: "sales" })).resolves.toMatchObject({ rows: [[7]] });
    expect(host).toHaveBeenCalledWith({ type: "view", viewId: "sales" });
  });
});
