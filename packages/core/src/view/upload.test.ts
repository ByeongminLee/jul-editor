import { describe, expect, it, vi } from "vitest";
import { createUploadRegistry, dataUrlToFile, performUpload } from "./upload.js";

describe("dataUrlToFile", () => {
  it("decodes a base64 data: URL into a File with the right mime/bytes", async () => {
    const file = dataUrlToFile("data:image/png;base64,aGVsbG8=", "pic.png"); // "hello"
    expect(file).not.toBeNull();
    expect(file!.type).toBe("image/png");
    expect(file!.name).toBe("pic.png");
    expect(await file!.text()).toBe("hello");
  });

  it("decodes a non-base64 (percent-encoded) data: URL", async () => {
    const file = dataUrlToFile("data:text/plain,hello%20world");
    expect(await file!.text()).toBe("hello world");
  });

  it("returns null for a malformed data: URL", () => {
    expect(dataUrlToFile("not-a-data-url")).toBeNull();
  });
});

describe("createUploadRegistry / performUpload", () => {
  it("marks 'uploading' immediately, then clears on success and hands the result to applyResult", async () => {
    const registry = createUploadRegistry();
    const file = new File(["x"], "x.png", { type: "image/png" });
    const onUpload = vi.fn().mockResolvedValue({ src: "https://cdn/x.png", assetId: "a1" });
    const applyResult = vi.fn();

    performUpload(registry, "b1", file, onUpload, applyResult);
    expect(registry.get("b1")).toEqual({ status: "uploading" });
    expect(registry.getFile("b1")).toBe(file);

    await vi.waitFor(() => expect(applyResult).toHaveBeenCalledWith({ src: "https://cdn/x.png", assetId: "a1" }));
    expect(registry.get("b1")).toBeUndefined(); // cleared: "ready" has no tracked state
    expect(registry.getFile("b1")).toBeUndefined();
  });

  it("marks 'error' on failure and keeps the File around for a retry", async () => {
    const registry = createUploadRegistry();
    const file = new File(["x"], "x.png", { type: "image/png" });
    const onUpload = vi.fn().mockRejectedValue(new Error("network down"));
    const applyResult = vi.fn();

    performUpload(registry, "b1", file, onUpload, applyResult);
    await vi.waitFor(() => expect(registry.get("b1")).toEqual({ status: "error", message: "network down" }));
    expect(applyResult).not.toHaveBeenCalled();
    expect(registry.getFile("b1")).toBe(file); // still available for retry

    // retry succeeds
    onUpload.mockResolvedValueOnce({ src: "ok.png" });
    performUpload(registry, "b1", registry.getFile("b1")!, onUpload, applyResult);
    expect(registry.get("b1")).toEqual({ status: "uploading" });
    await vi.waitFor(() => expect(applyResult).toHaveBeenCalledWith({ src: "ok.png" }));
    expect(registry.get("b1")).toBeUndefined();
  });

  it("notifies onChange listeners on start/succeed/fail", async () => {
    const registry = createUploadRegistry();
    const seen: string[] = [];
    registry.onChange((id) => seen.push(id));
    const onUpload = vi.fn().mockResolvedValue({ src: "ok" });
    performUpload(registry, "b1", new File(["x"], "x"), onUpload, () => {});
    expect(seen).toEqual(["b1"]); // start
    await vi.waitFor(() => expect(seen).toEqual(["b1", "b1"])); // succeed
  });
});
