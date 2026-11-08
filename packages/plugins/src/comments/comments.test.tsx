// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { coreBlocks, coreInlines, coreMarks, createEditor, createRegistry } from "@jul-editor/core";
import type { Doc, Editor } from "@jul-editor/core";
import { fromHTML, toHTML, toMarkdown } from "@jul-editor/core/serde";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBroadcastCommentAdapter, createMemoryCommentAdapter } from "./adapter.js";
import { createCommentsController } from "./controller.js";
import { addCommentMark, commentMark, findCommentRanges, threadIdsAtPoint } from "./mark.js";
import { AddCommentButton, CommentsPanel, CommentsProvider } from "./react.js";
import type { CommentAuthor } from "./types.js";

const registry = createRegistry({ blocks: coreBlocks, inlines: coreInlines, marks: [...coreMarks, commentMark] });
const me: CommentAuthor = { id: "u1", name: "Mina", color: "#08f" };

function makeDoc(): Doc {
  return {
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "hello brave world" }] },
      { id: "p2", type: "paragraph", props: {}, content: [{ type: "text", text: "second block" }] },
    ],
  };
}

const sel = (blockId: string, from: number, to = from) => ({ type: "text" as const, anchor: { blockId, offset: from }, focus: { blockId, offset: to } });
let editor: Editor;
let element: HTMLElement;

function mount(doc: Doc = makeDoc()): Editor {
  element = document.createElement("div");
  document.body.appendChild(element);
  editor = createEditor({ element, registry, defaultValue: doc });
  return editor;
}
/** "types" one char through the real beforeinput path (so mark inheritance rules apply). */
function type(at: { blockId: string; offset: number }, text: string): void {
  editor.update((tx) => tx.setSelection(sel(at.blockId, at.offset)));
  element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
}
const text = (id: string) => (editor.getState().store.records.get(id)?.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "")).join("");
const rangeOf = (tid: string) => findCommentRanges(editor.getState().store).get(tid);

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cleanup();
  editor?.destroy();
});

describe("comment mark anchoring", () => {
  it("anchors a range and reports it per thread", () => {
    mount();
    expect(addCommentMark(editor, registry, sel("p1", 6, 11), "t1")).toBe(true); // "brave"
    expect(rangeOf("t1")).toEqual([{ blockId: "p1", from: 6, to: 11 }]);
    expect(threadIdsAtPoint({ store: editor.getState().store, selection: sel("p1", 8) })).toEqual(["t1"]);
  });

  it("survives typing before, inside and after the range (and does not grow at its edges)", () => {
    mount();
    addCommentMark(editor, registry, sel("p1", 6, 11), "t1"); // "brave" = [6,11)
    type({ blockId: "p1", offset: 0 }, "X"); // before the block's text
    expect(text("p1")).toBe("Xhello brave world");
    expect(rangeOf("t1")).toEqual([{ blockId: "p1", from: 7, to: 12 }]);
    type({ blockId: "p1", offset: 9 }, "-"); // inside "brave"
    expect(text("p1")).toBe("Xhello br-ave world");
    expect(rangeOf("t1")).toEqual([{ blockId: "p1", from: 7, to: 13 }]);
    type({ blockId: "p1", offset: 13 }, "!"); // right AFTER the range: not part of it
    expect(rangeOf("t1")).toEqual([{ blockId: "p1", from: 7, to: 13 }]);
    type({ blockId: "p1", offset: 7 }, "<"); // right BEFORE the range start: not part of it
    expect(rangeOf("t1")).toEqual([{ blockId: "p1", from: 8, to: 14 }]);
  });

  it("detaches when the anchored text is deleted, keeps the thread, and reattaches on undo", async () => {
    mount();
    const adapter = createMemoryCommentAdapter();
    const c = createCommentsController({ editor, adapter, author: me, registry });
    editor.update((tx) => tx.setSelection(sel("p1", 6, 11)));
    expect(c.beginDraft()).toBe(true);
    const thread = await c.submitDraft("why brave?");
    expect(thread?.anchor).toEqual({ type: "text", quote: "brave" });
    expect(c.getState().threads[0]).toMatchObject({ detached: false });

    editor.update((tx) => tx.deleteRange(sel("p1", 5, 11)).setSelection(sel("p1", 5)));
    const v = c.getState().threads[0]!;
    expect(v.detached).toBe(true);
    expect(v.thread.comments).toHaveLength(1); // kept

    editor.commands.undo();
    expect(c.getState().threads[0]!.detached).toBe(false);
    c.destroy();
  });

  it("handles overlapping threads on the same text", () => {
    mount();
    addCommentMark(editor, registry, sel("p1", 0, 11), "a");
    addCommentMark(editor, registry, sel("p1", 6, 17), "b");
    expect(rangeOf("a")).toEqual([{ blockId: "p1", from: 0, to: 11 }]);
    expect(rangeOf("b")).toEqual([{ blockId: "p1", from: 6, to: 17 }]);
  });

  it("anchors across blocks and block anchors detach when the block is removed", async () => {
    mount();
    expect(addCommentMark(editor, registry, { type: "text", anchor: { blockId: "p1", offset: 12 }, focus: { blockId: "p2", offset: 6 } }, "x")).toBe(true);
    expect(rangeOf("x")).toEqual([
      { blockId: "p1", from: 12, to: 17 },
      { blockId: "p2", from: 0, to: 6 },
    ]);
    const c = createCommentsController({ editor, adapter: createMemoryCommentAdapter(), author: me });
    expect(c.beginBlockDraft("p2")).toBe(true);
    await c.submitDraft("whole block");
    expect(c.getState().threads[0]!.detached).toBe(false);
    editor.update((tx) => tx.removeBlock("p2"));
    expect(c.getState().threads[0]!.detached).toBe(true);
    c.destroy();
  });

  it("keeps threadId through the live DOM (so IME/DOM re-reads cannot drop it)", () => {
    mount();
    addCommentMark(editor, registry, sel("p1", 6, 11), "t1");
    const span = element.querySelector('[data-mark="comment"]');
    expect(span?.getAttribute("data-mark-thread-id")).toBe("t1");
    expect(span?.textContent).toBe("brave");
  });
});

describe("serde", () => {
  it("HTML: span[data-thread-id] out and back; markdown: plain text", () => {
    mount();
    addCommentMark(editor, registry, sel("p1", 6, 11), "t1");
    const doc = editor.getDoc();
    const html = toHTML(doc, { registry });
    expect(html).toContain('<span data-thread-id="t1">brave</span>');
    const back = fromHTML(html, { registry, parser: new DOMParser() } as never).doc;
    const runs = back.blocks[0]!.content as Array<{ text: string; marks?: Array<{ type: string; attrs?: { threadId: string } }> }>;
    expect(runs.find((r) => r.text === "brave")?.marks).toEqual([{ type: "comment", attrs: { threadId: "t1" } }]);
    // an unrelated pasted span must NOT become a comment
    const plain = fromHTML("<p><span>hi</span></p>", { registry, parser: new DOMParser() } as never).doc;
    expect(JSON.stringify(plain)).not.toContain("comment");
    expect(toMarkdown(doc, { registry }).markdown).toContain("hello brave world");
    expect(toMarkdown(doc, { registry }).markdown).not.toContain("t1");
  });
});

describe("memory adapter", () => {
  it("does CRUD, emits changes, and removes a thread with its last comment", async () => {
    const a = createMemoryCommentAdapter();
    const seen: string[] = [];
    a.subscribe((c) => seen.push(c.type));
    const t = await a.createThread({ id: "t1", anchor: { type: "text", quote: "q" }, body: "first", author: me });
    expect(t.status).toBe("open");
    const t2 = await a.addReply("t1", { body: "reply", author: me });
    expect(t2.comments).toHaveLength(2);
    const t3 = await a.editComment("t1", t2.comments[0]!.id, "edited");
    expect(t3.comments[0]).toMatchObject({ body: "edited" });
    expect(t3.comments[0]!.editedAt).toBeTypeOf("number");
    expect((await a.resolveThread("t1", me)).status).toBe("resolved");
    expect((await a.reopenThread("t1")).resolvedBy).toBeUndefined();
    expect(await a.deleteComment("t1", t2.comments[1]!.id)).toMatchObject({ comments: [{ body: "edited" }] });
    expect(await a.deleteComment("t1", t2.comments[0]!.id)).toBeNull();
    expect(await a.listThreads()).toEqual([]);
    await expect(a.addReply("nope", { body: "x", author: me })).rejects.toThrow();
    expect(seen).toEqual(["created", "updated", "updated", "updated", "updated", "updated", "deleted"]);
  });

  it("returns copies, not live references", async () => {
    const a = createMemoryCommentAdapter();
    const t = await a.createThread({ anchor: { type: "block", blockId: "b" }, body: "x", author: me });
    t.comments[0]!.body = "mutated";
    expect((await a.listThreads())[0]!.comments[0]!.body).toBe("x");
  });
});

describe("broadcast adapter", () => {
  it("syncs two adapters on one channel and catches a late joiner up", async () => {
    const name = `test-${Math.random()}`;
    const a = createBroadcastCommentAdapter(name);
    const b = createBroadcastCommentAdapter(name);
    const got: string[] = [];
    b.subscribe((c) => got.push(c.type));
    await a.createThread({ id: "t1", anchor: { type: "text", quote: "q" }, body: "hi", author: me });
    await waitFor(async () => expect((await b.listThreads()).map((t) => t.id)).toEqual(["t1"]));
    await a.resolveThread("t1");
    await waitFor(async () => expect((await b.listThreads())[0]!.status).toBe("resolved"));
    expect(got).toEqual(["created", "updated"]); // no echo loops
    const late = createBroadcastCommentAdapter(name);
    await waitFor(async () => expect((await late.listThreads()).map((t) => t.id)).toEqual(["t1"]));
    await a.deleteThread("t1");
    await waitFor(async () => expect(await b.listThreads()).toEqual([]));
    a.close();
    b.close();
    late.close();
  });
});

describe("controller flow", () => {
  it("create, reply, resolve, reopen, delete fire callbacks and keep doc + adapter in step", async () => {
    mount();
    const adapter = createMemoryCommentAdapter();
    const cb = { onThreadCreated: vi.fn(), onThreadUpdated: vi.fn(), onThreadResolved: vi.fn(), onThreadReopened: vi.fn(), onThreadDeleted: vi.fn() };
    const c = createCommentsController({ editor, adapter, author: me, registry, ...cb });
    editor.update((tx) => tx.setSelection(sel("p1", 0, 5)));
    const t = (await c.addComment("  nice  "))!;
    expect(t.comments[0]!.body).toBe("nice"); // trimmed
    expect(cb.onThreadCreated).toHaveBeenCalledTimes(1);
    expect(rangeOf(t.id)).toEqual([{ blockId: "p1", from: 0, to: 5 }]);
    expect(c.getState().selectedThreadId).toBe(t.id);

    await c.reply(t.id, "agreed");
    expect(c.getState().threads[0]!.thread.comments).toHaveLength(2);
    expect(await c.reply(t.id, "   ")).toBeNull(); // empty reply ignored

    await c.resolve(t.id);
    expect(c.getState().threads[0]!.thread.status).toBe("resolved");
    expect(cb.onThreadResolved).toHaveBeenCalledTimes(1);
    c.setFilter("open");
    expect(c.getState().filter).toBe("open");
    await c.reopen(t.id);
    expect(c.getState().threads[0]!.thread.status).toBe("open");
    expect(cb.onThreadReopened).toHaveBeenCalledTimes(1);
    expect(cb.onThreadUpdated).toHaveBeenCalledTimes(3); // reply, resolve, reopen
    await c.deleteThread(t.id);
    expect(rangeOf(t.id)).toBeUndefined(); // mark stripped
    expect(c.getState().threads).toEqual([]);
    expect(cb.onThreadDeleted).toHaveBeenCalledWith(t.id);
    expect(text("p1")).toBe("hello brave world"); // text untouched
    c.destroy();
  });

  it("selects the thread under the caret and rejects a draft whose text moved on", async () => {
    mount();
    const c = createCommentsController({ editor, adapter: createMemoryCommentAdapter(), author: me, registry });
    editor.update((tx) => tx.setSelection(sel("p1", 6, 11)));
    const t = (await c.addComment("x"))!;
    c.select(null);
    editor.update((tx) => tx.setSelection(sel("p1", 8)));
    expect(c.getState().selectedThreadId).toBe(t.id);
    editor.update((tx) => tx.setSelection(sel("p2", 2)));
    expect(c.getState().selectedThreadId).toBeNull();

    editor.update((tx) => tx.setSelection(sel("p2", 0, 6)));
    expect(c.beginDraft()).toBe(true);
    editor.update((tx) => tx.deleteRange(sel("p2", 0, 3)));
    expect(await c.submitDraft("late")).toBeNull();
    expect(c.getState().draft).toBeNull();
    c.destroy();
  });

  it("a host adapter failure leaves the doc untouched", async () => {
    mount();
    const adapter = { ...createMemoryCommentAdapter(), createThread: () => Promise.reject(new Error("offline")) };
    const c = createCommentsController({ editor, adapter, author: me, registry });
    editor.update((tx) => tx.setSelection(sel("p1", 0, 5)));
    expect(await c.addComment("x")).toBeNull();
    expect(findCommentRanges(editor.getState().store).size).toBe(0);
    c.destroy();
  });
});

describe("components", () => {
  it("add comment -> compose -> thread card -> reply -> resolve -> filter", async () => {
    mount();
    const adapter = createMemoryCommentAdapter();
    const onThreadCreated = vi.fn();
    render(
      <CommentsProvider editor={editor} adapter={adapter} author={me} onThreadCreated={onThreadCreated}>
        <AddCommentButton />
        <CommentsPanel />
      </CommentsProvider>,
    );
    const add = await screen.findByRole("button", { name: "Add comment" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    act(() => void editor.update((tx) => tx.setSelection(sel("p1", 6, 11))));
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);

    const box = await screen.findByRole("textbox", { name: "Write a comment" });
    fireEvent.change(box, { target: { value: "looks off" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("looks off");
    expect(onThreadCreated).toHaveBeenCalledTimes(1);
    // highlighted anchor exists in the editor DOM and the stylesheet is injected
    expect(element.querySelector('[data-mark-thread-id]')?.textContent).toBe("brave");
    expect(document.querySelector("[data-jul-editor-comment-styles]")).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Reply" }), { target: { value: "me too" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    await screen.findByText("me too");

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await screen.findByRole("button", { name: "Reopen" });
    fireEvent.click(screen.getByRole("tab", { name: "Open" }));
    expect(screen.queryByText("looks off")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Resolved" }));
    expect(screen.getByText("looks off")).toBeTruthy();
  });

  it("clicking highlighted text selects its thread card", async () => {
    mount();
    const adapter = createMemoryCommentAdapter();
    await adapter.createThread({ id: "t1", anchor: { type: "text", quote: "brave" }, body: "pinned", author: me });
    addCommentMark(editor, registry, sel("p1", 6, 11), "t1");
    render(
      <CommentsProvider editor={editor} adapter={adapter} author={me}>
        <CommentsPanel layout="aligned" />
      </CommentsProvider>,
    );
    await screen.findByText("pinned");
    fireEvent.mouseOver(element.querySelector('[data-mark-thread-id="t1"]')!);
    fireEvent.click(element.querySelector('[data-mark-thread-id="t1"]')!);
    await waitFor(() => expect(document.querySelector('[data-thread-id="t1"]')?.hasAttribute("data-selected")).toBe(true));
  });
});
