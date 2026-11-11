// Unit tests for the default `codeBlock` decoration chrome against a minimal
// mock editor (only the getState() surface handleCopy actually reads) -- same
// convention as ImageView.test.tsx, no full <Editor>/createEditor mount.
//
// Mounted with NO <EditorContext.Provider> at all (as before) exercises
// the no-context fallback (EN_LABELS, CodeBlockView.tsx's own `useContext`
// convention -- must not throw the way `useEditorContext` would); a separate
// describe block below wraps it in a real <EditorContext.Provider> with
// locale="ko"-resolved labels to prove the labels actually flow through.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor as CoreEditor } from "@jul-editor/core";
import type { VoidRendererProps } from "../context.js";
import { LabelsContext } from "../context.js";
import { KO_LABELS } from "../labels.js";
import { createCodeBlockRenderer } from "./code-block-view.js";

afterEach(cleanup);

const LANGUAGES = [
  { value: "plaintext", label: "Plain Text" },
  { value: "ts", label: "TypeScript" },
  { value: "python", label: "Python" },
];

function mockEditor(content: string): CoreEditor {
  return {
    getState: () => ({
      store: { records: new Map([["c1", { id: "c1", type: "codeBlock", props: {}, content: [{ type: "text", text: content }], childIds: [], parentId: null }]]) },
      selection: null,
    }),
  } as unknown as CoreEditor;
}

function baseProps(overrides: Partial<VoidRendererProps> = {}): VoidRendererProps {
  return {
    block: { id: "c1", type: "codeBlock", props: { language: "ts" } },
    editor: mockEditor("const x = 1;"),
    selected: false,
    updateProps: vi.fn(),
    ...overrides,
  };
}

describe("createCodeBlockRenderer", () => {
  it("renders a headless chrome with a language select (current value from block.props) and a copy button, default (no context) labels are English", () => {
    const CodeBlockView = createCodeBlockRenderer({ languages: LANGUAGES });
    render(<CodeBlockView {...baseProps()} />);
    const select = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    expect(select.value).toBe("ts");
    expect(screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["plaintext", "ts", "python"]);
    expect(screen.getByRole("button", { name: "Copy code" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy code" }).textContent).toBe("Copy");
  });

  it("changing the language calls updateProps({language}) -- never touches doc content", () => {
    const updateProps = vi.fn();
    const CodeBlockView = createCodeBlockRenderer({ languages: LANGUAGES });
    render(<CodeBlockView {...baseProps({ updateProps })} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "python" } });
    expect(updateProps).toHaveBeenCalledWith({ language: "python" });
  });

  it("copy button writes the block's CURRENT code text (read from editor.getState(), not a stale prop) to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const CodeBlockView = createCodeBlockRenderer({ languages: LANGUAGES });
    render(<CodeBlockView {...baseProps({ editor: mockEditor("let live = 2;") })} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("let live = 2;"));
  });

  it("shows a transient 'copied' state after a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const CodeBlockView = createCodeBlockRenderer({ languages: LANGUAGES });
    render(<CodeBlockView {...baseProps()} />);
    const button = screen.getByRole("button", { name: "Copy code" });
    fireEvent.click(button);
    // `data-copied` now distinguishes "done" from "error" (a rejected
    // Clipboard API falls back to execCommand instead of losing the state
    // entirely) -- see CodeBlockView.tsx's own writeClipboardText.
    await vi.waitFor(() => expect(button.getAttribute("data-copied")).toBe("done"));
    await vi.waitFor(() => expect(button.textContent).toBe("Copied"));
  });
});

// With a real <LabelsContext.Provider> (locale="ko"-resolved labels),
// the same chrome shows the Korean strings instead -- proving the labels
// genuinely flow from context, not just that EN_LABELS happens to fall back
// correctly when there's no provider at all (the describe block above).
describe("createCodeBlockRenderer with a ko-locale LabelsContext", () => {
  function renderWithKoContext(props: VoidRendererProps): void {
    const CodeBlockView = createCodeBlockRenderer({ languages: LANGUAGES });
    render(
      <LabelsContext.Provider value={KO_LABELS}>
        <CodeBlockView {...props} />
      </LabelsContext.Provider>,
    );
  }

  it("shows the Korean language/copy labels", () => {
    renderWithKoContext(baseProps());
    expect(screen.getByRole("combobox", { name: "언어" })).toBeDefined();
    const button = screen.getByRole("button", { name: "코드 복사" });
    expect(button.textContent).toBe("복사");
  });

  it("shows the Korean '복사됨' transient state after a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithKoContext(baseProps());
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "코드 복사" }).textContent).toBe("복사됨"));
  });
});

it('selects a canonical language for a stored alias without duplicating it', () => {
  const Code = createCodeBlockRenderer({ languages: [{ value: 'js', label: 'JavaScript', aliases: ['javascript'] }] });
  const updateProps = vi.fn();
  render(<Code {...baseProps({ block: { id: 'c1', type: 'codeBlock', props: { language: 'javascript' } }, updateProps })} />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.value).toBe('js');
  expect(select.options).toHaveLength(1);
  expect(updateProps).not.toHaveBeenCalled();
});
