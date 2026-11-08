// I18n unit tests for MentionMenu's own default markup (Loading.../No
// results, and `kind`'s localized display text) -- same `vi.mock("../hooks.js")`
// + captured-registerSuggestion-config approach as useSuggestion.test.ts (no
// real DOM/view pipeline needed; MentionMenu's own `useEditorContext` call is
// satisfied by a plain <EditorContext.Provider> (any truthy value -- it's
// only used as an "inside <Editor>" guard here), and its labels come from
// the separate <LabelsContext.Provider> (labels/locale live in
// their own context now, not on EditorContextValue).
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorContextValue } from "../context.js";
import { EditorContext, LabelsContext } from "../context.js";
import { EN_LABELS, KO_LABELS } from "../labels.js";
import { MentionMenu } from "./mention-menu.js";

interface FakeConfig {
  char: string;
  onUpdate(state: { open: boolean; query: string; range: { blockId: string; from: number; to: number } | null; rect: null }): void;
}

let captured: FakeConfig | null = null;
const registerSuggestion = vi.fn((config: FakeConfig) => {
  captured = config;
  return { closeSuggestion: vi.fn(), replaceRange: vi.fn(), destroy: vi.fn() };
});

vi.mock("../hooks.js", () => ({
  useEditor: () => ({ registerSuggestion }),
}));

function openWith() {
  captured!.onUpdate({ open: true, query: "", range: { blockId: "b1", from: 0, to: 1 }, rect: null });
}

const FAKE_CTX = {} as unknown as EditorContextValue;

beforeEach(() => {
  registerSuggestion.mockClear();
  captured = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MentionMenu i18n", () => {
  it("shows the (default, en) 'Loading...' text while the search promise is pending", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn(() => new Promise<never>(() => {})); // never resolves
    render(
      <EditorContext.Provider value={FAKE_CTX}>
        <LabelsContext.Provider value={EN_LABELS}>
          <MentionMenu onSearch={onSearch} />
        </LabelsContext.Provider>
      </EditorContext.Provider>,
    );
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("shows the (default, en) 'No results' text once the search resolves empty", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn().mockResolvedValue([]);
    render(
      <EditorContext.Provider value={FAKE_CTX}>
        <LabelsContext.Provider value={EN_LABELS}>
          <MentionMenu onSearch={onSearch} />
        </LabelsContext.Provider>
      </EditorContext.Provider>,
    );
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("No results")).toBeDefined();
  });

  it("with KO_LABELS in context, shows '불러오는 중...'/'결과 없음' instead, and the listbox's aria-label reflects the current kind ('사용자')", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn(() => new Promise<never>(() => {}));
    render(
      <EditorContext.Provider value={FAKE_CTX}>
        <LabelsContext.Provider value={KO_LABELS}>
          <MentionMenu onSearch={onSearch} />
        </LabelsContext.Provider>
      </EditorContext.Provider>,
    );
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("불러오는 중...")).toBeDefined();
    expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("사용자");
  });

  it("render-prop children receive `kindLabel` (localized 'user'/'post' display text)", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn().mockResolvedValue([]);
    render(
      <EditorContext.Provider value={FAKE_CTX}>
        <LabelsContext.Provider value={KO_LABELS}>
          <MentionMenu onSearch={onSearch}>{(args) => <div data-testid="kind-label">{args.kindLabel}</div>}</MentionMenu>
        </LabelsContext.Provider>
      </EditorContext.Provider>,
    );
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByTestId("kind-label").textContent).toBe("사용자");
  });
});
