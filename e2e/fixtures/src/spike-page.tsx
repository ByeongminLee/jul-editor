// IME spike gate: mounts @jul-editor/core's vanilla view (no @jul-editor/react
// involved) on a 3-paragraph doc, one void block for the "typing inside a
// void's own input never reaches the model" e2e case, and exposes
// window.__julEditorSpike = { getDoc, view, setCaret } for e2e/ime-spike.spec.ts
// (a name distinct from EditorPage.tsx's own window.__julEditor -- TS's
// declaration merging requires every `declare global` for the same property
// to share one exact type, and this page's raw createView (no Editor/history)
// genuinely has a different shape (`view`, no `editor`/`setSelection`)).
import { useEffect, useRef } from "react";
import {
  coreRegistry,
  createTransaction,
  createView,
  fromDoc,
  toDoc,
  writeDOMSelection,
  type Block,
  type EditorState,
  type Transaction,
} from "@jul-editor/core";

declare global {
  interface Window {
    __julEditorSpike?: {
      getDoc: () => ReturnType<typeof toDoc>;
      view: ReturnType<typeof createView>;
      /** Test-only convenience: focuses the editor and places a collapsed
       * caret at (blockId, offset) via the real DOM Selection API -- the
       * same mechanism a mouse click would use. Actual typing/composition
       * afterwards goes through the real input pipeline, nothing faked. */
      setCaret: (blockId: string, offset: number) => void;
    };
  }
}

function initialState(): EditorState {
  const blocks: Block[] = [
    { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "First paragraph." }] },
    {
      id: "p2",
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "Second " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " paragraph mentions " },
        { type: "mention", attrs: { kind: "user", id: "u1", label: "@Alice" } },
        { type: "text", text: "." },
      ],
    },
    { id: "p3", type: "paragraph", props: {}, content: [{ type: "text", text: "Third paragraph." }] },
    { id: "v1", type: "image", props: { src: "spike.png", alt: "spike" } },
    { id: "p4", type: "paragraph", props: {}, content: [] },
  ];
  const store = fromDoc({ version: 1, blocks }, coreRegistry);
  return { store, selection: { type: "text", anchor: { blockId: "p1", offset: 0 }, focus: { blockId: "p1", offset: 0 } } };
}

export function SpikePage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let state = initialState();
    const dispatch = (build: (tx: Transaction) => Transaction) => {
      const tx = createTransaction(state, coreRegistry);
      const result = build(tx).commit();
      state = result.state;
      return result;
    };

    const view = createView({
      element,
      state,
      registry: coreRegistry,
      dispatch,
      renderVoid: (block, container) => {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = String(block.props.alt ?? "void");
        input.setAttribute("data-testid", "void-input");
        container.appendChild(input);
      },
    });

    window.__julEditorSpike = {
      view,
      getDoc: () => toDoc(view.getState().store),
      setCaret: (blockId, offset) => {
        element.focus();
        const point = { blockId, offset };
        writeDOMSelection(element, { type: "text", anchor: point, focus: point });
      },
    };

    return () => {
      view.destroy();
      delete window.__julEditorSpike;
    };
  }, []);

  return <div data-testid="page-spike" ref={ref} />;
}
