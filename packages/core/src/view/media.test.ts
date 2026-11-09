// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "./editor.js";
import { coreRegistry, coreBlocks, coreInlines, coreMarks } from "../model/builtins.js";
import { createRegistry, defineBlock } from "../model/schema.js";
import { toDoc } from "../store/store.js";
import { newId } from "../model/id.js";
import type { CreateEditorOptions } from "./editor.js";
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
function mount(options: Partial<CreateEditorOptions> = {}) {
  const root = document.createElement("div"); document.body.appendChild(root);
  const editor = createEditor({element: root, registry: coreRegistry, defaultValue: {version: 1, blocks: [{id: "p", type: "paragraph", props: {}}]}, ...options});
  editors.push(editor); return editor;
}
const picture = () => new File(["image"], "photo.png", {type: "image/png"});

describe("media lifecycle", () => {
  it("previews deferred files without persisting their bytes, then saves durable URLs", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const upload = vi.fn().mockResolvedValue({src: "https://cdn.example/photo.png", assetId: "asset-1"});
    const editor = mount({uploadMode: "deferred", onUpload: upload});
    const [id] = editor.insertFiles([picture()]);
    expect(id).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(editor.getUploadState(id!)).toEqual({status: "queued"});
    expect(editor.getUploadPreview(id!)).toBe("blob:local-preview");
    expect(JSON.stringify(toDoc(editor.getState().store))).not.toMatch(/blob:|data:|local-preview/);
    expect(editor.getPendingUploads()).toHaveLength(1);
    expect(await editor.uploadPending()).toEqual({uploaded: [id], failed: []});
    expect(editor.getState().store.records.get(id!)!.props).toMatchObject({src: "https://cdn.example/photo.png", assetId: "asset-1"});
    expect(editor.getPendingUploads()).toHaveLength(0);
    expect(revoke).toHaveBeenCalledWith("blob:local-preview");
  });
  it("shares in-flight work between save and retry and retains failed files", async () => {
    let resolve!: (result: {src: string}) => void;
    const upload = vi.fn(() => new Promise<{src: string}>(r => {resolve = r;}));
    const editor = mount({onUpload: upload});
    const [id] = editor.insertFiles([picture()]);
    editor.retryUpload(id!);
    const flush = editor.uploadPending();
    expect(upload).toHaveBeenCalledTimes(1);
    resolve({src: "data:image/png;base64,eA=="});
    expect(await flush).toEqual({uploaded: [], failed: [id]});
    expect(editor.getUploadState(id!)?.status).toBe("error");
    expect(editor.getPendingUploads()).toHaveLength(1);
  });
  it("reports a file added while uploadPending is already waiting on another upload", async () => {
    let resolveFirst!: (result: {src: string}) => void;
    const upload = vi.fn((file: File) => file.name === "first.png"
      ? new Promise<{src: string}>(resolve => { resolveFirst = resolve; })
      : Promise.resolve({src: "https://cdn.example/second.png"}));
    const editor = mount({uploadMode: "deferred", onUpload: upload});
    const [first] = editor.insertFiles([new File(["a"], "first.png", {type: "image/png"})]);
    const flush = editor.uploadPending();
    const [second] = editor.insertFiles([new File(["b"], "second.png", {type: "image/png"})]);
    resolveFirst({src: "https://cdn.example/first.png"});
    const result = await flush;
    expect(result.uploaded).toContain(first);
    expect([...result.uploaded, ...result.failed]).toContain(second);
    if (result.failed.length === 0) expect(editor.getPendingUploads()).toHaveLength(0);
  });
  it("does not report a newly queued file removed before the flush ends", async () => {
    let resolveFirst!: (result: {src: string}) => void;
    const editor = mount({uploadMode: "deferred", onUpload: () => new Promise(resolve => { resolveFirst = resolve; })});
    const [first] = editor.insertFiles([picture()]);
    const flush = editor.uploadPending();
    const [removed] = editor.insertFiles([picture()]);
    editor.update(tx => tx.removeBlock(removed!));
    resolveFirst({src: "https://cdn.example/first.png"});
    expect(await flush).toEqual({uploaded: [first], failed: []});
    expect(editor.getPendingUploads()).toHaveLength(0);
  });
  it("does not recreate deleted blocks when an upload completes", async () => {
    let resolve!: (result: {src: string}) => void;
    const editor = mount({onUpload: () => new Promise(r => {resolve = r;})});
    const [id] = editor.insertFiles([picture()]);
    const flush = editor.uploadPending();
    editor.update(tx => tx.removeBlock(id!));
    resolve({src: "https://cdn.example/photo.png"});
    await flush;
    expect(editor.getState().store.records.has(id!)).toBe(false);
    expect(editor.getPendingUploads()).toHaveLength(0);
  });
  it("routes non-image files through the application block factory", async () => {
    const registry = createRegistry({blocks: [...coreBlocks, defineBlock({type: "attachment", content: "none", children: "none", props: {src: "", name: "", assetId: null}})], inlines: coreInlines, marks: coreMarks});
    const upload = vi.fn().mockResolvedValue({src: "/uploads/report.pdf", assetId: "pdf-1"});
    const editor = mount({registry, uploadMode: "deferred", onUpload: upload, createFileBlock: file => ({id: newId(), type: "attachment", props: {src: "", name: file.name}})});
    const file = new File(["pdf"], "report.pdf", {type: "application/pdf"});
    const [id] = editor.insertFiles([file]);
    await editor.uploadPending();
    expect(upload).toHaveBeenCalledWith(file, {blockId: id, kind: "file"});
    expect(editor.getState().store.records.get(id!)!.props).toMatchObject({src: "/uploads/report.pdf", name: "report.pdf"});
  });
  it("handles synchronous uploader errors and missing callbacks without losing queued Files", async () => {
    const editor = mount({uploadMode: "deferred", onUpload: () => {throw new Error("offline");}});
    const [id] = editor.insertFiles([picture()]);
    expect(await editor.uploadPending()).toEqual({uploaded: [], failed: [id]});
    expect(editor.getUploadState(id!)).toEqual({status: "error", message: "offline"});
    const deferred = mount({uploadMode: "deferred"});
    const [pending] = deferred.insertFiles([picture()]);
    expect(await deferred.uploadPending()).toEqual({uploaded: [], failed: [pending]});
    expect(deferred.getPendingUploads()).toHaveLength(1);
  });
  it("accepts image drops on editor padding and keeps them deferred", () => {
    const editor = mount({uploadMode: "deferred"});
    const root = document.querySelector("[data-jul-editor-root]")!;
    const event = new Event("drop", {bubbles: true, cancelable: true});
    Object.defineProperties(event, {dataTransfer: {value: {getData: () => "", files: [picture()]}}, clientX: {value: 0}, clientY: {value: 50}});
    root.dispatchEvent(event);
    expect(editor.getPendingUploads()).toHaveLength(1);
    expect(editor.getDoc().blocks.some(block => block.type === "image")).toBe(true);
  });

  it("preserves an external URL entered while a previous upload was pending", async () => {
    let resolve!: (result: {src: string}) => void;
    const editor = mount({onUpload: () => new Promise(r => {resolve = r;})});
    const [id] = editor.insertFiles([picture()]);
    const flush = editor.uploadPending();
    editor.update(tx => tx.setProps(id!, {src: "https://images.example/chosen.png"}));
    resolve({src: "https://cdn.example/older-upload.png"});
    await flush;
    expect(editor.getState().store.records.get(id!)!.props.src).toBe("https://images.example/chosen.png");
  });

});

describe("attachUpload", () => {
  it("stages a file for an image block that is already in the doc (a fromHTML data: image after setDoc)", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:imported-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const upload = vi.fn().mockResolvedValue({src: "https://cdn.example/imported.png"});
    const editor = mount({uploadMode: "deferred", onUpload: upload});
    editor.setDoc({version: 1, blocks: [{id: "img", type: "image", props: {src: "", alt: "chart"}}]});
    expect(editor.attachUpload("img", picture())).toBe(true);
    expect(editor.getUploadState("img")).toEqual({status: "queued"});
    expect(editor.getUploadPreview("img")).toBe("blob:imported-preview");
    expect(JSON.stringify(editor.getDoc())).not.toMatch(/blob:/);
    expect(editor.getPendingUploads().map((p) => p.blockId)).toEqual(["img"]);
    expect(await editor.uploadPending()).toEqual({uploaded: ["img"], failed: []});
    expect(editor.getState().store.records.get("img")!.props).toMatchObject({src: "https://cdn.example/imported.png", alt: "chart"});
  });
  it("refuses a missing block and an editor with no upload path", () => {
    expect(mount({uploadMode: "deferred"}).attachUpload("nope", picture())).toBe(false);
    const editor = mount();
    editor.setDoc({version: 1, blocks: [{id: "img", type: "image", props: {src: ""}}]});
    expect(editor.attachUpload("img", picture())).toBe(false);
    expect(editor.getUploadState("img")).toBeUndefined();
  });
});
