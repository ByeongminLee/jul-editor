// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import type { Op, Selection } from "../store/types.js";
import { createEditor } from "./editor.js";

function make() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return createEditor({
    element,
    registry: coreRegistry,
    defaultValue: { version: 1, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hello" }] }] },
  });
}

const textOf = (e: ReturnType<typeof make>) => (e.getState().store.records.get("a")?.content ?? []).map((i) => (i as { text: string }).text).join("");
const insert = (at: number, text: string): Op => ({ type: "replaceContent", id: "a", from: at, to: at, inlines: [{ type: "text", text }] });

describe("editor.applyRemote / getRegistry", () => {
  it("exposes the registry", () => {
    expect(make().getRegistry()).toBe(coreRegistry);
  });

  it("applies ops without an undo entry, flags the change as remote, maps the selection", () => {
    const e = make();
    const metas: Array<boolean | undefined> = [];
    e.on("change", (_s, meta) => metas.push(meta?.remote));
    e.update((tx) => tx.setSelection({ type: "text", anchor: { blockId: "a", offset: 5 }, focus: { blockId: "a", offset: 5 } }));
    const mapped: Selection = { type: "text", anchor: { blockId: "a", offset: 7 }, focus: { blockId: "a", offset: 7 } };
    const { changedIds } = e.applyRemote([insert(0, "ab")], { mapSelection: () => mapped });
    expect(changedIds.has("a")).toBe(true);
    expect(textOf(e)).toBe("abhello");
    expect(e.getState().selection).toEqual(mapped);
    expect(metas).toEqual([false, true]); // the local selection commit, then the remote one
    e.commands.undo(); // nothing local to undo: the remote edit stays
    expect(textOf(e)).toBe("abhello");
  });

  it("skips ops that do not apply and does not emit for a no-op batch", () => {
    const e = make();
    let n = 0;
    e.on("change", () => n++);
    e.applyRemote([{ type: "removeBlock", id: "missing" }]);
    expect(n).toBe(0);
    expect(textOf(e)).toBe("hello");
  });

  it("keeps a remote edit when a later local edit is undone", () => {
    const e = make();
    e.update((tx) => tx.insertText({ blockId: "a", offset: 5 }, "!"));
    e.applyRemote([insert(0, ">>")]);
    expect(textOf(e)).toBe(">>hello!");
    e.commands.undo();
    expect(textOf(e)).toBe(">>hello");
  });
});
