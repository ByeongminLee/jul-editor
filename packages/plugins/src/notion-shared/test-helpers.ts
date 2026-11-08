// Test-only helpers for the callout/toggle/toc/columns suites (not exported from any entry point).
import { coreBlocks, coreInlines, coreMarks, createEditor, createRegistry, createTransaction, fromDoc } from "@jul-editor/core";
import type { Block, Doc, Editor, EditorState, Registry, Selection, Transaction } from "@jul-editor/core";
import { calloutBlock } from "../callout/block.js";
import { toggleBlock } from "../toggle/block.js";
import { tocBlock } from "../toc/block.js";

export const registry: Registry = /* @__PURE__ */ createRegistry({ blocks: [...coreBlocks, calloutBlock, toggleBlock, tocBlock], inlines: coreInlines, marks: coreMarks });

export const doc = (blocks: Block[]): Doc => ({ version: 1, blocks });
export const text = (t: string) => [{ type: "text" as const, text: t }];
export const para = (id: string, t = ""): Block => ({ id, type: "paragraph", props: {}, content: t ? text(t) : [] });

/** Structural comparison without ids. */
export function stripIds(blocks: Block[]): unknown {
  return blocks.map((b) => ({ type: b.type, props: b.props, content: b.content, children: b.children ? stripIds(b.children) : undefined }));
}

export function caretAt(blockId: string, offset: number): Selection {
  return { type: "text", anchor: { blockId, offset }, focus: { blockId, offset } };
}

/** Runs a KeymapFn/input-rule style handler against a pure state; returns the resulting state. */
export function stateOf(d: Doc, selection: Selection | null, reg: Registry = registry): EditorState {
  return { store: fromDoc(d, reg), selection };
}

export function dispatcher(initial: EditorState, reg: Registry = registry) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    dispatch(build: (tx: Transaction) => Transaction) {
      const result = build(createTransaction(state, reg)).commit();
      state = result.state;
      return result;
    },
  };
}

export function mountEditor(d: Doc, reg: Registry = registry): { editor: Editor; element: HTMLElement; destroy(): void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = createEditor({ element, registry: reg, defaultValue: d });
  return {
    editor,
    element,
    destroy() {
      editor.destroy();
      element.remove();
    },
  };
}
